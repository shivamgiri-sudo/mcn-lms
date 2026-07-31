import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const SCORM_DIR = path.resolve(UPLOAD_DIR, 'scorm');
const MAX_ENTRIES = Math.max(1, Number.parseInt(process.env.SCORM_MAX_ENTRIES || '5000', 10));
const MAX_UNCOMPRESSED_BYTES = Math.max(1, Number.parseInt(process.env.SCORM_MAX_UNCOMPRESSED_MB || '500', 10)) * 1024 * 1024;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanXmlText(value, fallback) {
  const text = String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return text.slice(0, 500) || fallback;
}

function safeEntryPoint(value) {
  const raw = String(value || 'index.html').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
    throw new Error('SCORM entry point must be a relative package path.');
  }
  const pathOnly = raw.split(/[?#]/)[0].replace(/\\/g, '/');
  const parts = pathOnly.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part.includes('\0'))) {
    throw new Error('SCORM entry point is unsafe.');
  }
  return raw;
}

function parseManifest(manifestPath) {
  const xml = fs.readFileSync(manifestPath, 'utf8');
  let scormVersion = '1.2';
  if (xml.includes('CAM 1.3') || xml.includes('SCORM_CAM_1.3') || xml.includes('adlseq:') || xml.includes('imsss:') || xml.includes('2004')) {
    scormVersion = '2004';
  }
  if (xml.includes('version="1.2"') || xml.includes('SCORM_1.2')) scormVersion = '1.2';

  const titleMatch = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const resourceMatch = xml.match(/<resource[^>]+href="([^"]+)"[^>]*(?:\/?>|>)/i);
  return {
    scormVersion,
    title: cleanXmlText(titleMatch?.[1], 'SCORM Package'),
    entryPoint: safeEntryPoint(resourceMatch?.[1] || 'index.html'),
  };
}

function packageBaseUrl() {
  const external = String(process.env.SCORM_CONTENT_ORIGIN || '').trim().replace(/\/$/, '');
  if (external) {
    const parsed = new URL(external);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('SCORM_CONTENT_ORIGIN must be an HTTP(S) origin.');
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new Error('SCORM_CONTENT_ORIGIN must use HTTPS in production.');
    }
    return external;
  }

  if (process.env.NODE_ENV !== 'production' && process.env.SCORM_ALLOW_SAME_ORIGIN === 'true') {
    return '/uploads/scorm';
  }
  return null;
}

function isSymlinkEntry(entry) {
  const unixMode = Number(entry.attr || 0) >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

function validateAndExtract(zipPath, packageDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (!entries.length) throw new Error('SCORM archive is empty.');
  if (entries.length > MAX_ENTRIES) throw new Error(`SCORM archive exceeds the ${MAX_ENTRIES}-entry limit.`);

  let totalBytes = 0;
  for (const entry of entries) {
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    const parts = name.split('/').filter(Boolean);
    if (!name || name.startsWith('/') || parts.some(part => part === '..' || part.includes('\0'))) {
      throw new Error('SCORM archive contains an unsafe path.');
    }
    if (isSymlinkEntry(entry)) throw new Error('SCORM archive cannot contain symbolic links.');
    totalBytes += Number(entry.header?.size || 0);
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('SCORM archive exceeds the allowed uncompressed size.');
    }
  }

  ensureDir(packageDir);
  const root = path.resolve(packageDir);
  for (const entry of entries) {
    const relative = String(entry.entryName).replace(/\\/g, '/');
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('SCORM extraction path escaped its package directory.');
    if (entry.isDirectory) {
      ensureDir(target);
    } else {
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, entry.getData(), { flag: 'wx' });
    }
  }
}

async function moduleForAdmin(moduleId, req) {
  const module = await prisma.moduleMaster.findUnique({
    where: { moduleId },
    include: { classroom: true },
  });
  if (!module || !module.active) return { error: { status: 404, message: 'Module not found.' } };
  if (req.userBranch && module.classroom?.branch !== req.userBranch) {
    return { error: { status: 403, message: 'This module is outside your branch scope.' } };
  }
  return { module };
}

async function authorizedLearnerPackage(packageId, employeeId) {
  const [pkg, trainee] = await Promise.all([
    prisma.scormPackage.findUnique({ where: { packageId } }),
    prisma.traineeMaster.findUnique({ where: { employeeId } }),
  ]);
  if (!pkg || !pkg.active) return { error: { status: 404, message: 'Package not found.' } };
  if (!trainee || trainee.status !== 'Active') return { error: { status: 403, message: 'Trainee account is not active.' } };

  const content = await prisma.contentMaster.findUnique({
    where: { contentId: pkg.contentId },
    include: { module: true },
  });
  if (!content || !content.active || !content.module?.active) return { error: { status: 404, message: 'SCORM content is not active.' } };

  const classroomId = content.module.classroomId;
  let assigned = trainee.classroomId === classroomId;
  if (!assigned) {
    assigned = Boolean(await prisma.traineeClassroomMap.findFirst({
      where: { employeeId, classroomId, active: true },
      select: { id: true },
    }));
  }
  if (!assigned) return { error: { status: 403, message: 'This SCORM package is not assigned to you.' } };
  return { pkg, trainee, content, classroomId };
}

function finiteNumber(value, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function limitedText(value, max) {
  if (value === undefined) return undefined;
  return String(value || '').slice(0, max);
}

async function syncStandardProgress({ employeeId, trainee, content, classroomId }) {
  const now = new Date();
  await prisma.contentProgress.upsert({
    where: { employeeId_contentId: { employeeId, contentId: content.contentId } },
    create: {
      employeeId,
      classroomId,
      dayNo: content.module.dayNo || 0,
      moduleId: content.moduleId,
      contentId: content.contentId,
      opened: true,
      openCount: 1,
      firstOpenedAt: now,
      lastOpenedAt: now,
      completionStatus: 'Completed',
      completionPct: 100,
      completedAt: now,
      playerMode: 'SCORM',
    },
    update: {
      opened: true,
      completionStatus: 'Completed',
      completionPct: 100,
      completedAt: now,
      lastOpenedAt: now,
      playerMode: 'SCORM',
    },
  });

  const [total, completed, progressRows] = await Promise.all([
    prisma.contentMaster.count({ where: { module: { classroomId }, active: true } }),
    prisma.contentProgress.count({ where: { employeeId, classroomId, completionStatus: 'Completed' } }),
    prisma.contentProgress.findMany({ where: { employeeId, classroomId }, select: { opened: true, totalSecondsSpent: true } }),
  ]);
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const openedContents = progressRows.filter(row => row.opened).length;
  const totalSecondsSpent = progressRows.reduce((sum, row) => sum + Number(row.totalSecondsSpent || 0), 0);

  await prisma.$transaction([
    prisma.courseCompletionReport.upsert({
      where: { employeeId_classroomId: { employeeId, classroomId } },
      create: { employeeId, batchNo: trainee.batchNo || null, classroomId, totalContents: total, openedContents, completionPct, totalSecondsSpent, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
      update: { totalContents: total, openedContents, completionPct, totalSecondsSpent, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
    }),
    prisma.traineeMaster.update({ where: { employeeId }, data: { courseCompletionPct: completionPct } }),
  ]);
}

export async function uploadScorm(req, res) {
  if (!req.file) return res.status(400).json({ ok: false, message: 'No ZIP file uploaded.' });

  const moduleId = String(req.body?.moduleId || '').trim();
  if (!moduleId) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ ok: false, message: 'moduleId is required.' });
  }

  let baseUrl;
  try {
    baseUrl = packageBaseUrl();
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(503).json({ ok: false, message: error.message });
  }
  if (!baseUrl) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(503).json({ ok: false, message: 'SCORM content isolation is not configured. Set SCORM_CONTENT_ORIGIN, or explicitly enable same-origin SCORM only in development.' });
  }

  const moduleAccess = await moduleForAdmin(moduleId, req);
  if (moduleAccess.error) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(moduleAccess.error.status).json({ ok: false, message: moduleAccess.error.message });
  }

  const packageId = `SCORM-${uuidv4().slice(0, 8).toUpperCase()}`;
  const packageDir = path.resolve(SCORM_DIR, packageId);
  try {
    ensureDir(SCORM_DIR);
    validateAndExtract(req.file.path, packageDir);
    fs.rmSync(req.file.path, { force: true });

    const manifestPath = path.join(packageDir, 'imsmanifest.xml');
    if (!fs.existsSync(manifestPath)) throw new Error('imsmanifest.xml must exist at the root of the SCORM package.');
    const { scormVersion, title, entryPoint } = parseManifest(manifestPath);
    const entryPath = path.resolve(packageDir, entryPoint.split(/[?#]/)[0]);
    if (!entryPath.startsWith(`${packageDir}${path.sep}`) || !fs.existsSync(entryPath) || fs.statSync(entryPath).isDirectory()) {
      throw new Error('The SCORM manifest entry point does not exist in the package.');
    }

    const finalTitle = String(req.body?.contentTitle || '').trim().slice(0, 500) || title;
    const contentId = `CON-SCORM-${uuidv4().slice(0, 8).toUpperCase()}`;
    const packageUrl = `${baseUrl}/${packageId}`;
    const contentOrder = (await prisma.contentMaster.count({ where: { moduleId } })) + 1;

    await prisma.$transaction([
      prisma.contentMaster.create({
        data: { contentId, moduleId, contentType: 'scorm', contentTitle: finalTitle, directMediaUrl: `${packageUrl}/${entryPoint}`, playerMode: 'SCORM', contentOrder, required: true, estimatedMins: 0, completionRulePct: 80 },
      }),
      prisma.scormPackage.create({
        data: { packageId, contentId, moduleId, title: finalTitle, scormVersion, entryPoint, packagePath: packageDir, packageUrl, mastery: 80, uploadedBy: req.userId },
      }),
    ]);

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPLOAD_SCORM', module: 'SCORM', referenceId: packageId, newValue: { title: finalTitle, scormVersion, moduleId } });
    return res.json({ ok: true, data: { packageId, contentId, title: finalTitle, scormVersion, entryPoint, packageUrl } });
  } catch (error) {
    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.rmSync(req.file?.path, { force: true });
    console.error('[SCORM] Upload error:', error.message);
    const status = /archive|manifest|entry point|unsafe|symbolic|exceeds|empty/i.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, message: status === 400 ? error.message : 'SCORM upload failed.' });
  }
}

export async function getScormPackage(req, res) {
  try {
    const pkg = await prisma.scormPackage.findUnique({
      where: { packageId: req.params.packageId },
      select: { packageId: true, contentId: true, moduleId: true, title: true, scormVersion: true, entryPoint: true, packageUrl: true, mastery: true, active: true, uploadedBy: true, createdAt: true, updatedAt: true },
    });
    if (!pkg) return res.status(404).json({ ok: false, message: 'Package not found.' });
    const moduleAccess = await moduleForAdmin(pkg.moduleId, req);
    if (moduleAccess.error) return res.status(moduleAccess.error.status).json({ ok: false, message: moduleAccess.error.message });
    return res.json({ ok: true, data: pkg });
  } catch (error) {
    console.error('[SCORM] Package lookup failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteScormPackage(req, res) {
  try {
    const pkg = await prisma.scormPackage.findUnique({ where: { packageId: req.params.packageId } });
    if (!pkg) return res.status(404).json({ ok: false, message: 'Package not found.' });
    const moduleAccess = await moduleForAdmin(pkg.moduleId, req);
    if (moduleAccess.error) return res.status(moduleAccess.error.status).json({ ok: false, message: moduleAccess.error.message });

    await prisma.$transaction([
      prisma.contentMaster.update({ where: { contentId: pkg.contentId }, data: { active: false } }),
      prisma.scormPackage.update({ where: { packageId: pkg.packageId }, data: { active: false } }),
    ]);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DELETE_SCORM', module: 'SCORM', referenceId: pkg.packageId });
    return res.json({ ok: true, message: 'SCORM package removed.' });
  } catch (error) {
    console.error('[SCORM] Package removal failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getScormSession(req, res) {
  try {
    const employeeId = req.userId;
    const access = await authorizedLearnerPackage(req.params.packageId, employeeId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { pkg, trainee } = access;

    let session = await prisma.scormSession.findUnique({ where: { packageId_employeeId: { packageId: pkg.packageId, employeeId } } });
    if (!session) {
      session = await prisma.scormSession.create({ data: { id: uuidv4(), packageId: pkg.packageId, employeeId, attempts: 1 } });
    } else {
      session = await prisma.scormSession.update({ where: { packageId_employeeId: { packageId: pkg.packageId, employeeId } }, data: { lastAccessedAt: new Date() } });
    }

    return res.json({
      ok: true,
      session,
      package: { packageId: pkg.packageId, scormVersion: pkg.scormVersion, entryPoint: pkg.entryPoint, packageUrl: pkg.packageUrl, mastery: pkg.mastery, title: pkg.title },
      learner: { id: employeeId, name: trainee.traineeName || employeeId },
    });
  } catch (error) {
    console.error('[SCORM] Session error:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function saveScormSession(req, res) {
  try {
    const employeeId = req.userId;
    const access = await authorizedLearnerPackage(req.params.packageId, employeeId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { pkg, trainee, content, classroomId } = access;

    const current = await prisma.scormSession.findUnique({ where: { packageId_employeeId: { packageId: pkg.packageId, employeeId } } });
    const completionStatuses = new Set(['not attempted', 'unknown', 'incomplete', 'completed', 'passed', 'failed', 'browsed']);
    const successStatuses = new Set(['unknown', 'passed', 'failed']);
    const completionStatus = req.body?.completionStatus === undefined ? undefined : String(req.body.completionStatus).trim().toLowerCase();
    const successStatus = req.body?.successStatus === undefined ? undefined : String(req.body.successStatus).trim().toLowerCase();
    if (completionStatus !== undefined && !completionStatuses.has(completionStatus)) return res.status(400).json({ ok: false, message: 'Invalid SCORM completion status.' });
    if (successStatus !== undefined && !successStatuses.has(successStatus)) return res.status(400).json({ ok: false, message: 'Invalid SCORM success status.' });

    const data = { lastAccessedAt: new Date() };
    if (completionStatus !== undefined) data.completionStatus = completionStatus;
    if (successStatus !== undefined) data.successStatus = successStatus;
    const scoreRaw = finiteNumber(req.body?.scoreRaw, -1000000, 1000000);
    const scoreMax = finiteNumber(req.body?.scoreMax, -1000000, 1000000);
    const scoreMin = finiteNumber(req.body?.scoreMin, -1000000, 1000000);
    const scoreScaled = finiteNumber(req.body?.scoreScaled, -1, 1);
    if (req.body?.scoreRaw !== undefined) data.scoreRaw = scoreRaw;
    if (req.body?.scoreMax !== undefined) data.scoreMax = scoreMax;
    if (req.body?.scoreMin !== undefined) data.scoreMin = scoreMin;
    if (req.body?.scoreScaled !== undefined) data.scoreScaled = scoreScaled;
    if (req.body?.totalTime !== undefined) data.totalTime = limitedText(req.body.totalTime, 100);
    if (req.body?.suspendData !== undefined) data.suspendData = limitedText(req.body.suspendData, 64000);
    if (req.body?.location !== undefined) data.location = limitedText(req.body.location, 1000);
    if (req.body?.exitStatus !== undefined) data.exitStatus = limitedText(req.body.exitStatus, 100);

    const session = await prisma.scormSession.upsert({
      where: { packageId_employeeId: { packageId: pkg.packageId, employeeId } },
      create: { id: uuidv4(), packageId: pkg.packageId, employeeId, attempts: 1, ...data },
      update: data,
    });

    const completed = completionStatus === 'completed' || completionStatus === 'passed' || successStatus === 'passed';
    const wasCompleted = ['completed', 'passed'].includes(String(current?.completionStatus || '').toLowerCase()) || String(current?.successStatus || '').toLowerCase() === 'passed';
    if (completed) {
      await syncStandardProgress({ employeeId, trainee, content, classroomId });
      if (!wasCompleted) {
        await audit({ userIdentity: employeeId, userRole: 'Trainee', action: 'COMPLETE_SCORM', module: 'Learning', referenceId: pkg.packageId, newValue: { contentId: content.contentId, completionStatus, successStatus } });
      }
    }

    return res.json({ ok: true, completed, session: { completionStatus: session.completionStatus, successStatus: session.successStatus, scoreRaw: session.scoreRaw, lastAccessedAt: session.lastAccessedAt } });
  } catch (error) {
    console.error('[SCORM] Save session error:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
