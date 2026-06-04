import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const SCORM_DIR = path.resolve(UPLOAD_DIR, 'scorm');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Parse imsmanifest.xml to extract SCORM version, title, and entry point
function parseManifest(manifestPath) {
  const xml = fs.readFileSync(manifestPath, 'utf-8');

  // Detect SCORM version from metadata or namespace
  let scormVersion = '1.2';
  if (xml.includes('CAM 1.3') || xml.includes('2004') || xml.includes('adlcp:scormType') === false && xml.includes('imsss:')) {
    scormVersion = '2004';
  }
  if (xml.includes('version="1.2"') || xml.includes('SCORM_1.2')) scormVersion = '1.2';
  if (xml.includes('version="2004"') || xml.includes('SCORM_CAM_1.3') || xml.includes('adlseq:') || xml.includes('imsss:')) scormVersion = '2004';

  // Extract title — try <title> inside <organizations>
  const titleMatch = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'SCORM Package';

  // Extract entry point — href of first <resource> with type="webcontent" or sco
  const resourceMatch = xml.match(/<resource[^>]+href="([^"]+)"[^>]*(\/?>|>)/i);
  let entryPoint = resourceMatch ? resourceMatch[1] : 'index.html';

  // Sometimes the entry is in <item><adlcp:parameters> — fallback to index.html
  if (!entryPoint || entryPoint.includes('..')) entryPoint = 'index.html';

  return { scormVersion, title, entryPoint };
}

// ── Upload SCORM package ──────────────────────────────────────────────────────
export async function uploadScorm(req, res) {
  if (!req.file) return res.status(400).json({ ok: false, message: 'No ZIP file uploaded.' });

  const { moduleId, contentTitle } = req.body;
  if (!moduleId) return res.status(400).json({ ok: false, message: 'moduleId is required.' });

  const mod = await prisma.moduleMaster.findUnique({ where: { moduleId } });
  if (!mod) return res.status(404).json({ ok: false, message: 'Module not found.' });

  const packageId = `SCORM-${uuidv4().slice(0, 8).toUpperCase()}`;
  const packageDir = path.join(SCORM_DIR, packageId);

  try {
    ensureDir(SCORM_DIR);
    ensureDir(packageDir);

    // Extract ZIP
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(packageDir, true);

    // Clean up temp upload
    fs.unlinkSync(req.file.path);

    // Find and parse manifest
    const manifestPath = path.join(packageDir, 'imsmanifest.xml');
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(packageDir, { recursive: true, force: true });
      return res.status(400).json({ ok: false, message: 'imsmanifest.xml not found. Make sure you upload a valid SCORM package.' });
    }

    const { scormVersion, title, entryPoint } = parseManifest(manifestPath);
    const finalTitle = (contentTitle || '').trim() || title;

    // Create ContentMaster record
    const contentId = `CON-SCORM-${uuidv4().slice(0, 8).toUpperCase()}`;
    const packageUrl = `/uploads/scorm/${packageId}`;

    const [content] = await prisma.$transaction([
      prisma.contentMaster.create({
        data: {
          contentId,
          moduleId,
          contentType: 'scorm',
          contentTitle: finalTitle,
          directMediaUrl: `${packageUrl}/${entryPoint}`,
          playerMode: 'SCORM',
          contentOrder: (await prisma.contentMaster.count({ where: { moduleId } })) + 1,
          required: true,
          estimatedMins: 0,
          completionRulePct: 80,
        },
      }),
      prisma.scormPackage.create({
        data: {
          packageId,
          contentId,
          moduleId,
          title: finalTitle,
          scormVersion,
          entryPoint,
          packagePath: packageDir,
          packageUrl,
          mastery: 80,
          uploadedBy: req.userId,
        },
      }),
    ]);

    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'UPLOAD_SCORM',
      module: 'SCORM',
      referenceId: packageId,
      newValue: { title: finalTitle, scormVersion, moduleId },
    });

    res.json({
      ok: true,
      data: {
        packageId,
        contentId,
        title: finalTitle,
        scormVersion,
        entryPoint,
      },
    });
  } catch (err) {
    // Cleanup on failure
    if (fs.existsSync(packageDir)) fs.rmSync(packageDir, { recursive: true, force: true });
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[SCORM] Upload error:', err);
    res.status(500).json({ ok: false, message: err.message || 'SCORM upload failed.' });
  }
}

// ── Get SCORM package info ────────────────────────────────────────────────────
export async function getScormPackage(req, res) {
  try {
    const { packageId } = req.params;
    const pkg = await prisma.scormPackage.findUnique({ where: { packageId } });
    if (!pkg) return res.status(404).json({ ok: false, message: 'Package not found.' });
    res.json({ ok: true, data: pkg });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Delete SCORM package ──────────────────────────────────────────────────────
export async function deleteScormPackage(req, res) {
  try {
    const { packageId } = req.params;
    const pkg = await prisma.scormPackage.findUnique({ where: { packageId } });
    if (!pkg) return res.status(404).json({ ok: false, message: 'Package not found.' });

    // Soft-delete the content record
    await prisma.contentMaster.update({ where: { contentId: pkg.contentId }, data: { active: false } });
    await prisma.scormPackage.update({ where: { packageId }, data: { active: false } });

    res.json({ ok: true, message: 'SCORM package removed.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Launch: get session data for the learner ─────────────────────────────────
export async function getScormSession(req, res) {
  try {
    const { packageId } = req.params;
    const employeeId = req.userId;

    const pkg = await prisma.scormPackage.findUnique({ where: { packageId } });
    if (!pkg || !pkg.active) return res.status(404).json({ ok: false, message: 'Package not found.' });

    let session = await prisma.scormSession.findUnique({
      where: { packageId_employeeId: { packageId, employeeId } },
    });

    if (!session) {
      session = await prisma.scormSession.create({
        data: {
          id: uuidv4(),
          packageId,
          employeeId,
          attempts: 1,
        },
      });
    } else {
      session = await prisma.scormSession.update({
        where: { packageId_employeeId: { packageId, employeeId } },
        data: { attempts: { increment: 1 }, lastAccessedAt: new Date() },
      });
    }

    // Get learner info
    const trainee = await prisma.traineeMaster.findUnique({
      where: { employeeId },
      select: { traineeName: true, employeeId: true },
    });

    res.json({
      ok: true,
      session,
      package: {
        packageId: pkg.packageId,
        scormVersion: pkg.scormVersion,
        entryPoint: pkg.entryPoint,
        packageUrl: pkg.packageUrl,
        mastery: pkg.mastery,
        title: pkg.title,
      },
      learner: {
        id: employeeId,
        name: trainee?.traineeName || employeeId,
      },
    });
  } catch (err) {
    console.error('[SCORM] Session error:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Save CMI data (called from SCORM API shim) ────────────────────────────────
export async function saveScormSession(req, res) {
  try {
    const { packageId } = req.params;
    const employeeId = req.userId;
    const {
      completionStatus, successStatus,
      scoreRaw, scoreMax, scoreMin, scoreScaled,
      totalTime, suspendData, location, exitStatus,
    } = req.body;

    const data = { lastAccessedAt: new Date() };
    if (completionStatus !== undefined) data.completionStatus = completionStatus;
    if (successStatus !== undefined) data.successStatus = successStatus;
    if (scoreRaw !== undefined) data.scoreRaw = scoreRaw != null ? parseFloat(scoreRaw) : null;
    if (scoreMax !== undefined) data.scoreMax = scoreMax != null ? parseFloat(scoreMax) : null;
    if (scoreMin !== undefined) data.scoreMin = scoreMin != null ? parseFloat(scoreMin) : null;
    if (scoreScaled !== undefined) data.scoreScaled = scoreScaled != null ? parseFloat(scoreScaled) : null;
    if (totalTime !== undefined) data.totalTime = totalTime;
    if (suspendData !== undefined) data.suspendData = suspendData;
    if (location !== undefined) data.location = location;
    if (exitStatus !== undefined) data.exitStatus = exitStatus;

    await prisma.scormSession.upsert({
      where: { packageId_employeeId: { packageId, employeeId } },
      create: { id: uuidv4(), packageId, employeeId, ...data },
      update: data,
    });

    // Sync completion back to ContentProgress if completed/passed
    const isCompleted = completionStatus === 'completed' || completionStatus === 'passed'
      || successStatus === 'passed';

    if (isCompleted) {
      const pkg = await prisma.scormPackage.findUnique({
        where: { packageId },
        select: { contentId: true, moduleId: true },
      });
      if (pkg) {
        const trainee = await prisma.traineeMaster.findUnique({
          where: { employeeId },
          select: { classroomId: true },
        });
        if (trainee?.classroomId) {
          await prisma.contentProgress.upsert({
            where: { contentId_employeeId: { contentId: pkg.contentId, employeeId } },
            create: {
              contentId: pkg.contentId,
              employeeId,
              classroomId: trainee.classroomId,
              completionStatus: 'Completed',
              completionPct: 100,
              firstOpenedAt: new Date(),
              completedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            update: {
              completionStatus: 'Completed',
              completionPct: 100,
              completedAt: new Date(),
              lastOpenedAt: new Date(),
            },
          });
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[SCORM] Save session error:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
