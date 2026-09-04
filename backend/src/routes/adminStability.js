import { Router } from 'express';
import path from 'path';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { getFormOptions } from '../services/formOptions.js';
import { generateId, generateSalt, hashPassword } from '../utils/hash.js';
import { contentUpload } from '../utils/upload.js';
import {
  autoAssignModulesForNewUser,
  ensureContentRepositoryTable,
  ensureIndependentModuleTables,
  getIndependentModuleById,
} from '../services/independentModules.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function cleanEmail(value) {
  return clean(value)?.toLowerCase() || null;
}

function cleanMobile(value) {
  const text = String(value ?? '').replace(/\D/g, '').slice(-10);
  return text || null;
}

function like(value) {
  return `%${String(value || '').replace(/[%_]/g, '')}%`;
}

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = true) {
  if (value === true || value === 'true' || value === '1' || value === 1 || value === 'Yes') return true;
  if (value === false || value === 'false' || value === '0' || value === 0 || value === 'No') return false;
  return fallback;
}

function repoPathFromFile(file) {
  if (!file?.filename) return null;
  return `/uploads/content/${file.filename}`;
}

function guessContentType(file, fallback = 'document') {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) return 'video';
  if (ext === '.pdf') return 'pdf';
  if (['.ppt', '.pptx'].includes(ext)) return 'ppt';
  if (['.doc', '.docx'].includes(ext)) return 'document';
  if (['.xls', '.xlsx'].includes(ext)) return 'spreadsheet';
  if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) return 'image';
  return fallback;
}

function mapRepoRow(row) {
  return {
    repositoryContentId: row.repository_content_id,
    title: row.title,
    contentTitle: row.title,
    contentType: row.content_type,
    category: row.category,
    subCategory: row.sub_category,
    process: row.process,
    lob: row.lob,
    tags: row.tags,
    sourceType: row.source_type,
    directMediaUrl: row.direct_media_url,
    localFilePath: row.local_file_path,
    driveFileId: row.drive_file_id,
    driveUrl: row.drive_url,
    playerMode: row.player_mode,
    estimatedMins: row.estimated_mins,
    completionRulePct: row.completion_rule_pct,
    description: row.description,
    versionNo: row.version_no,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

async function computeBatchCounters(batchNo) {
  const [totalTrainees, certified, handoverToOps, ojtReady] = await Promise.all([
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' } } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, certificationStatus: 'Certified' } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, handoverToOps: true } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, ojtReady: true } }),
  ]);
  return { totalTrainees, certified, handoverToOps, ojtReady };
}

async function getModuleById(moduleId) {
  return getIndependentModuleById(moduleId);
}

router.get('/trainees/search', ...auth, async (req, res) => {
  try {
    const q = clean(req.query?.q);
    const where = { status: { not: 'Deleted' } };
    if (q) {
      where.OR = [
        { employeeId: { contains: q } }, { lmsId: { contains: q } }, { traineeName: { contains: q } },
        { email: { contains: q } }, { mobile: { contains: q } }, { batchNo: { contains: q } },
        { branch: { contains: q } }, { process: { contains: q } },
      ];
    }
    const trainees = await prisma.traineeMaster.findMany({ where, take: 75, orderBy: { createdAt: 'desc' } });
    return res.json({ ok: true, data: trainees });
  } catch (err) {
    console.error('[adminStability] trainee search failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to search trainee accounts.' });
  }
});

router.post('/reconcile/batch-counters', ...auth, async (req, res) => {
  try {
    const requestedBatchNo = String(req.body?.batchNo || '').trim();
    const where = requestedBatchNo ? { batchNo: requestedBatchNo } : {};
    const batches = await prisma.batchMaster.findMany({ where, orderBy: { lastUpdatedAt: 'desc' } });
    if (requestedBatchNo && batches.length === 0) return res.status(404).json({ ok: false, message: `Batch ${requestedBatchNo} not found.` });

    const results = [];
    for (const batch of batches) {
      const before = { totalTrainees: batch.totalTrainees || 0, certified: batch.certified || 0, handoverToOps: batch.handoverToOps || 0, ojtReady: batch.ojtReady || 0 };
      const after = await computeBatchCounters(batch.batchNo);
      const changed = before.totalTrainees !== after.totalTrainees || before.certified !== after.certified || before.handoverToOps !== after.handoverToOps || before.ojtReady !== after.ojtReady;
      if (changed) await prisma.batchMaster.update({ where: { batchNo: batch.batchNo }, data: after });
      results.push({ batchNo: batch.batchNo, batchName: batch.batchName, changed, before, after });
    }

    const changedCount = results.filter(r => r.changed).length;
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RECONCILE_BATCH_COUNTERS', module: 'Batch', referenceId: requestedBatchNo || 'ALL_BATCHES', newValue: { totalBatches: results.length, changedCount } });
    return res.json({ ok: true, summary: { totalBatches: results.length, changedCount }, results });
  } catch (err) {
    console.error('[adminStability] batch counter reconciliation failed:', err);
    return res.status(500).json({ ok: false, message: 'Batch counter reconciliation failed.' });
  }
});

router.post('/lms-users', ...auth, async (req, res) => {
  try {
    const traineeName = clean(req.body?.traineeName || req.body?.name);
    if (!traineeName) return res.status(400).json({ ok: false, message: 'Name is required.' });

    const mobile = cleanMobile(req.body?.mobile);
    const email = cleanEmail(req.body?.email);
    const requestedEmployeeId = clean(req.body?.employeeId);
    const employeeId = requestedEmployeeId || `LMS-${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const lmsId = clean(req.body?.lmsId) || employeeId;

    const duplicateOr = [{ employeeId }, { lmsId }];
    if (email) duplicateOr.push({ email });
    if (mobile) duplicateOr.push({ mobile: { endsWith: mobile } });
    const duplicate = await prisma.traineeMaster.findFirst({ where: { status: { not: 'Deleted' }, OR: duplicateOr } });
    if (duplicate) return res.status(409).json({ ok: false, message: `User already exists: ${duplicate.employeeId}` });

    const tempPassword = clean(req.body?.tempPassword) || (mobile ? mobile.slice(-4) : '1234');
    const salt = generateSalt();
    const passwordHash = await hashPassword(tempPassword, salt);

    const payload = {
      employeeId,
      lmsId,
      traineeName,
      email,
      mobile,
      batchNo: clean(req.body?.batchNo),
      branch: clean(req.body?.branch),
      process: clean(req.body?.process),
      lob: clean(req.body?.lob),
      classroomId: clean(req.body?.classroomId),
      classroomName: clean(req.body?.classroomName),
      status: 'Active',
      onboardingStatus: clean(req.body?.onboardingStatus) || 'Pending',
      source: 'Independent LMS User',
      empIdType: requestedEmployeeId ? 'PERMANENT' : 'TEMP',
      createdBy: req.userId,
    };

    await prisma.$transaction([
      prisma.traineeMaster.create({ data: payload }),
      prisma.userMaster.create({ data: { employeeId, passwordHash, salt, traineeName, email, mobile, branch: payload.branch, process: payload.process, lob: payload.lob, batchNo: payload.batchNo, classroomId: payload.classroomId, active: true, forcePasswordReset: true } }),
    ]);

    const autoAssignments = await autoAssignModulesForNewUser({ employeeId, branch: payload.branch, process: payload.process, lob: payload.lob, createdBy: req.userId });
    const assignedCount = autoAssignments.filter(a => a.assigned).length;

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_INDEPENDENT_LMS_USER', module: 'Accounts', referenceId: employeeId, newValue: { lmsId, traineeName, assignedCount } });
    return res.json({ ok: true, data: { employeeId, lmsId, traineeName, email, mobile, tempPassword, autoAssignments, assignedCount }, message: `LMS user created: ${employeeId}` });
  } catch (err) {
    console.error('[adminStability] create LMS user failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create LMS user.' });
  }
});

router.get('/content-repository', ...auth, async (req, res) => {
  try {
    await ensureContentRepositoryTable();
    const q = clean(req.query?.q);
    const status = clean(req.query?.status) || 'Active';
    const params = [];
    let sql = 'SELECT * FROM content_repository_master WHERE status = ?';
    params.push(status);
    if (q) {
      sql += ' AND (title LIKE ? OR category LIKE ? OR process LIKE ? OR lob LIKE ? OR tags LIKE ?)';
      params.push(like(q), like(q), like(q), like(q), like(q));
    }
    sql += ' ORDER BY updated_at DESC LIMIT 200';
    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[adminStability] content repository list failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to load content repository.' });
  }
});

router.post('/content-repository', ...auth, async (req, res) => {
  try {
    await ensureContentRepositoryTable();
    const title = clean(req.body?.title);
    if (!title) return res.status(400).json({ ok: false, message: 'Content title is required.' });
    const repoId = `REP-${generateId()}`;
    const id = generateId('repo-');

    await prisma.$executeRawUnsafe(
      `INSERT INTO content_repository_master (id, repository_content_id, title, content_type, category, sub_category, process, lob, tags, source_type, direct_media_url, local_file_path, drive_file_id, drive_url, player_mode, estimated_mins, completion_rule_pct, description, version_no, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, repoId, title, clean(req.body?.contentType) || 'document', clean(req.body?.category), clean(req.body?.subCategory), clean(req.body?.process), clean(req.body?.lob), clean(req.body?.tags), clean(req.body?.sourceType) || 'local', clean(req.body?.directMediaUrl), clean(req.body?.localFilePath), clean(req.body?.driveFileId), clean(req.body?.driveUrl), clean(req.body?.playerMode) || 'Auto', toInt(req.body?.estimatedMins, 0), toFloat(req.body?.completionRulePct, 80), clean(req.body?.description), toInt(req.body?.versionNo, 1), 'Active', req.userId
    );

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_CONTENT_REPOSITORY_ITEM', module: 'ContentRepository', referenceId: repoId, newValue: { title } });
    return res.json({ ok: true, data: { repositoryContentId: repoId }, message: 'Repository content saved.' });
  } catch (err) {
    console.error('[adminStability] content repository create failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to save repository content.' });
  }
});

router.post('/content-repository/upload', ...auth, contentUpload.single('file'), async (req, res) => {
  try {
    await ensureContentRepositoryTable();
    if (!req.file) return res.status(400).json({ ok: false, message: 'File is required.' });
    const title = clean(req.body?.title) || req.file.originalname;
    const repoId = `REP-${generateId()}`;
    const id = generateId('repo-');
    const publicUrl = repoPathFromFile(req.file);

    await prisma.$executeRawUnsafe(
      `INSERT INTO content_repository_master (id, repository_content_id, title, content_type, category, sub_category, process, lob, tags, source_type, direct_media_url, local_file_path, player_mode, estimated_mins, completion_rule_pct, description, version_no, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, repoId, title, clean(req.body?.contentType) || guessContentType(req.file), clean(req.body?.category), clean(req.body?.subCategory), clean(req.body?.process), clean(req.body?.lob), clean(req.body?.tags), 'local', publicUrl, req.file.path, clean(req.body?.playerMode) || 'Auto', toInt(req.body?.estimatedMins, 0), toFloat(req.body?.completionRulePct, 80), clean(req.body?.description), toInt(req.body?.versionNo, 1), 'Active', req.userId
    );

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPLOAD_CONTENT_REPOSITORY_ITEM', module: 'ContentRepository', referenceId: repoId, newValue: { title, file: req.file.originalname } });
    return res.json({ ok: true, data: { repositoryContentId: repoId, directMediaUrl: publicUrl, localFilePath: req.file.path }, message: 'Repository file uploaded.' });
  } catch (err) {
    console.error('[adminStability] content repository upload failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to upload repository file.' });
  }
});

router.delete('/content-repository/:repositoryContentId', ...auth, async (req, res) => {
  try {
    await ensureContentRepositoryTable();
    const repositoryContentId = clean(req.params.repositoryContentId);
    await prisma.$executeRawUnsafe('UPDATE content_repository_master SET status = ? WHERE repository_content_id = ?', 'Archived', repositoryContentId);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ARCHIVE_CONTENT_REPOSITORY_ITEM', module: 'ContentRepository', referenceId: repositoryContentId });
    return res.json({ ok: true, message: 'Repository content archived.' });
  } catch (err) {
    console.error('[adminStability] content repository archive failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to archive repository content.' });
  }
});

// Who actually read an assigned nugget, and for how long. Time is recorded against
// the repository content id by the same heartbeat pipeline classroom content uses,
// so 'did they spend the 2 minutes' is answerable rather than a guess.
router.get('/independent-modules/:moduleId/reading-report', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleId = clean(req.params.moduleId);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT a.assigned_to AS employeeId, t.trainee_name AS traineeName, t.batch_no AS batchNo,
              t.process, t.branch, r.repository_content_id AS contentId, r.title AS contentTitle,
              m.estimated_mins AS estimatedMins,
              p.total_seconds_spent AS secondsSpent, p.required_seconds AS requiredSeconds,
              p.completion_pct AS completionPct, p.completion_status AS completionStatus,
              p.open_count AS openCount, p.first_opened_at AS firstOpenedAt, p.last_opened_at AS lastOpenedAt
         FROM assigned_modules a
         INNER JOIN independent_module_master m ON m.module_id = a.module_id
         INNER JOIN independent_module_content_map c ON c.module_id = a.module_id AND c.active = 1
         INNER JOIN content_repository_master r ON r.repository_content_id = c.repository_content_id
         LEFT JOIN trainee_master t ON t.employee_id = a.assigned_to
         LEFT JOIN content_progress p ON p.employee_id = a.assigned_to AND p.content_id = r.repository_content_id
        WHERE a.module_id = ? AND a.active = 1 AND a.assigned_to_type = 'individual'
        ORDER BY (p.total_seconds_spent IS NULL) ASC, p.total_seconds_spent DESC, t.trainee_name ASC`,
      moduleId,
    );

    const data = (rows || []).map(row => ({
      ...row,
      secondsSpent: Number(row.secondsSpent || 0),
      requiredSeconds: Number(row.requiredSeconds || 0),
      completionPct: Number(row.completionPct || 0),
      completionStatus: row.completionStatus || 'Not Started',
      openCount: Number(row.openCount || 0),
    }));
    const opened = data.filter(row => row.openCount > 0).length;
    const completed = data.filter(row => row.completionStatus === 'Completed').length;
    return res.json({
      ok: true,
      data,
      summary: {
        assigned: data.length,
        opened,
        notOpened: data.length - opened,
        completed,
        averageSecondsSpent: data.length ? Math.round(data.reduce((sum, row) => sum + row.secondsSpent, 0) / data.length) : 0,
      },
    });
  } catch (err) {
    console.error('[adminStability] reading report failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to build the reading report.' });
  }
});
router.get('/independent-modules', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const q = clean(req.query?.q);
    const params = ['Active'];
    let sql = 'SELECT * FROM independent_module_master WHERE status = ?';
    if (q) {
      sql += ' AND (module_name LIKE ? OR category LIKE ? OR process LIKE ? OR lob LIKE ?)';
      params.push(like(q), like(q), like(q), like(q));
    }
    sql += ' ORDER BY updated_at DESC LIMIT 200';
    const modules = await prisma.$queryRawUnsafe(sql, ...params);
    const moduleIds = modules.map(m => m.module_id);
    let contentRows = [];
    if (moduleIds.length) {
      const placeholders = moduleIds.map(() => '?').join(',');
      contentRows = await prisma.$queryRawUnsafe(
        `SELECT m.module_id, m.sort_order, m.required, r.* FROM independent_module_content_map m INNER JOIN content_repository_master r ON r.repository_content_id = m.repository_content_id WHERE m.active = 1 AND m.module_id IN (${placeholders}) ORDER BY m.module_id, m.sort_order ASC`,
        ...moduleIds
      );
    }
    const byModule = {};
    for (const row of contentRows) {
      if (!byModule[row.module_id]) byModule[row.module_id] = [];
      byModule[row.module_id].push({ ...mapRepoRow(row), sortOrder: row.sort_order, required: !!row.required });
    }
    return res.json({ ok: true, data: modules.map(m => ({ ...m, contents: byModule[m.module_id] || [] })) });
  } catch (err) {
    console.error('[adminStability] independent module list failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to load independent modules.' });
  }
});

router.post('/independent-modules', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleName = clean(req.body?.moduleName);
    if (!moduleName) return res.status(400).json({ ok: false, message: 'Module name is required.' });
    const moduleId = clean(req.body?.moduleId) || `IMOD-${generateId()}`;
    const contents = Array.isArray(req.body?.contents) ? req.body.contents : [];

    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(
        `INSERT INTO independent_module_master (id, module_id, module_name, category, process, lob, branch, description, estimated_mins, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        generateId('im-'), moduleId, moduleName, clean(req.body?.category), clean(req.body?.process), clean(req.body?.lob), clean(req.body?.branch), clean(req.body?.description), toInt(req.body?.estimatedMins, 0), 'Active', req.userId
      );
      for (let i = 0; i < contents.length; i += 1) {
        const c = contents[i];
        const repoId = clean(c.repositoryContentId || c.repository_content_id);
        if (!repoId) continue;
        await tx.$executeRawUnsafe(
          `INSERT IGNORE INTO independent_module_content_map (id, module_id, repository_content_id, sort_order, required, active) VALUES (?, ?, ?, ?, ?, 1)`,
          generateId('imc-'), moduleId, repoId, toInt(c.sortOrder, i + 1), toBool(c.required, true) ? 1 : 0
        );
      }
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_INDEPENDENT_MODULE', module: 'IndependentModule', referenceId: moduleId, newValue: { moduleName, contentCount: contents.length } });
    return res.json({ ok: true, data: { moduleId }, message: 'Independent module created.' });
  } catch (err) {
    console.error('[adminStability] independent module create failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create independent module.' });
  }
});

router.post('/independent-modules/:moduleId/assign', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleId = clean(req.params.moduleId);
    const module = await getModuleById(moduleId);
    if (!module) return res.status(404).json({ ok: false, message: 'Independent module not found.' });
    const assignedToType = clean(req.body?.assignedToType) || 'individual';
    const assignedTo = clean(req.body?.assignedTo);
    if (!assignedTo) return res.status(400).json({ ok: false, message: 'Assigned To is required.' });
    const existing = await prisma.assignedModule.findFirst({ where: { moduleId, assignedTo, assignedToType, active: true } });
    if (existing) return res.json({ ok: true, alreadyAssigned: true, message: 'Module is already assigned.' });
    const dueDays = toInt(req.body?.dueDays, 0);
    const dueDate = dueDays > 0 ? new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000) : null;
    await prisma.assignedModule.create({ data: { moduleId, moduleName: module.module_name, broadcastTitle: module.module_name, assignedTo, assignedToType, assignmentType: clean(req.body?.assignmentType) || 'Mandatory', message: clean(req.body?.message) || module.description, assignedBy: req.userId, dueDate, active: true } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ASSIGN_INDEPENDENT_MODULE', module: 'IndependentModule', referenceId: moduleId, newValue: { assignedToType, assignedTo } });
    return res.json({ ok: true, message: 'Independent module assigned.' });
  } catch (err) {
    console.error('[adminStability] independent module assign failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to assign independent module.' });
  }
});

router.post('/independent-modules/:moduleId/auto-assign-rule', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleId = clean(req.params.moduleId);
    const module = await getModuleById(moduleId);
    if (!module) return res.status(404).json({ ok: false, message: 'Independent module not found.' });
    const scopeType = clean(req.body?.scopeType) || 'All';
    const scopeValue = scopeType === 'All' ? null : clean(req.body?.scopeValue);
    if (scopeType !== 'All' && !scopeValue) return res.status(400).json({ ok: false, message: 'Scope value is required.' });
    const ruleId = `AUTO-${generateId()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO independent_module_auto_assign_rule (id, rule_id, module_id, rule_name, scope_type, scope_value, assignment_type, message, due_days, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      generateId('iar-'), ruleId, moduleId, clean(req.body?.ruleName) || `Auto assign ${module.module_name}`, scopeType, scopeValue, clean(req.body?.assignmentType) || 'Mandatory', clean(req.body?.message), toInt(req.body?.dueDays, 0), req.userId
    );
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_AUTO_ASSIGN_RULE', module: 'IndependentModule', referenceId: ruleId, newValue: { moduleId, scopeType, scopeValue } });
    return res.json({ ok: true, data: { ruleId }, message: 'Auto-assign rule created.' });
  } catch (err) {
    console.error('[adminStability] auto assign rule failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create auto-assign rule.' });
  }
});

router.get('/independent-modules/auto-assign-rules', ...auth, async (_req, res) => {
  try {
    await ensureIndependentModuleTables();
    const rows = await prisma.$queryRawUnsafe(`SELECT r.*, m.module_name FROM independent_module_auto_assign_rule r LEFT JOIN independent_module_master m ON m.module_id = r.module_id WHERE r.active = 1 ORDER BY r.created_at DESC`);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[adminStability] auto assign rules list failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to load auto-assign rules.' });
  }
});

router.delete('/independent-modules/auto-assign-rules/:ruleId', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const ruleId = clean(req.params.ruleId);
    await prisma.$executeRawUnsafe('UPDATE independent_module_auto_assign_rule SET active = 0 WHERE rule_id = ?', ruleId);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DISABLE_AUTO_ASSIGN_RULE', module: 'IndependentModule', referenceId: ruleId });
    return res.json({ ok: true, message: 'Auto-assign rule disabled.' });
  } catch (err) {
    console.error('[adminStability] auto assign rule disable failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to disable auto-assign rule.' });
  }
});

// Replacing the file itself had no route at all - an admin could only retype the
// Direct URL by hand, which is how stale content stayed live. Swaps the stored file,
// re-derives the type, and bumps the version so the change is traceable.
router.post('/content-repository/:repositoryContentId/file', ...auth, contentUpload.single('file'), async (req, res) => {
  try {
    await ensureContentRepositoryTable();
    if (!req.file) return res.status(400).json({ ok: false, message: 'A replacement file is required.' });
    const repositoryContentId = clean(req.params.repositoryContentId);
    const rows = await prisma.$queryRawUnsafe('SELECT * FROM content_repository_master WHERE repository_content_id = ? AND status = ?', repositoryContentId, 'Active');
    const existing = rows?.[0];
    if (!existing) return res.status(404).json({ ok: false, message: 'Repository content not found.' });

    const publicUrl = repoPathFromFile(req.file);
    const contentType = clean(req.body?.contentType) || guessContentType(req.file);
    const versionNo = toInt(existing.version_no, 1) + 1;
    await prisma.$executeRawUnsafe(
      `UPDATE content_repository_master
          SET direct_media_url = ?, local_file_path = ?, source_type = 'local',
              content_type = ?, drive_file_id = NULL, drive_url = NULL, version_no = ?
        WHERE repository_content_id = ?`,
      publicUrl, req.file.path, contentType, versionNo, repositoryContentId,
    );

    await audit({
      userIdentity: req.userId, userRole: 'Admin', action: 'REPLACE_CONTENT_REPOSITORY_FILE',
      module: 'ContentRepository', referenceId: repositoryContentId,
      oldValue: { directMediaUrl: existing.direct_media_url, versionNo: existing.version_no },
      newValue: { directMediaUrl: publicUrl, file: req.file.originalname, versionNo },
    });
    return res.json({ ok: true, data: { directMediaUrl: publicUrl, contentType, versionNo }, message: `File replaced. Now version ${versionNo}.` });
  } catch (err) {
    console.error('[adminStability] content repository file replace failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to replace the repository file.' });
  }
});
router.put('/content-repository/:repositoryContentId', ...auth, async (req, res) => {
  try {
    await ensureContentRepositoryTable();
    const repositoryContentId = clean(req.params.repositoryContentId);
    const existing = await prisma.$queryRawUnsafe('SELECT * FROM content_repository_master WHERE repository_content_id = ? AND status = ?', repositoryContentId, 'Active');
    if (!existing?.[0]) return res.status(404).json({ ok: false, message: 'Repository content not found.' });
    const fields = {
      title: clean(req.body?.title),
      content_type: clean(req.body?.contentType),
      category: clean(req.body?.category),
      sub_category: clean(req.body?.subCategory),
      process: clean(req.body?.process),
      lob: clean(req.body?.lob),
      tags: clean(req.body?.tags),
      source_type: clean(req.body?.sourceType),
      direct_media_url: clean(req.body?.directMediaUrl),
      local_file_path: clean(req.body?.localFilePath),
      drive_file_id: clean(req.body?.driveFileId),
      drive_url: clean(req.body?.driveUrl),
      player_mode: clean(req.body?.playerMode),
      estimated_mins: req.body?.estimatedMins !== undefined ? toInt(req.body.estimatedMins) : undefined,
      completion_rule_pct: req.body?.completionRulePct !== undefined ? toFloat(req.body.completionRulePct) : undefined,
      description: clean(req.body?.description),
    };
    const setClauses = [];
    const params = [];
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) { setClauses.push(`${col} = ?`); params.push(val); }
    }
    if (!setClauses.length) return res.status(400).json({ ok: false, message: 'No fields to update.' });
    params.push(repositoryContentId);
    await prisma.$executeRawUnsafe(`UPDATE content_repository_master SET ${setClauses.join(', ')} WHERE repository_content_id = ?`, ...params);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_CONTENT_REPOSITORY_ITEM', module: 'ContentRepository', referenceId: repositoryContentId, newValue: fields });
    return res.json({ ok: true, message: 'Repository content updated.' });
  } catch (err) {
    console.error('[adminStability] content repository update failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update repository content.' });
  }
});

router.put('/independent-modules/:moduleId', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleId = clean(req.params.moduleId);
    const existing = await prisma.$queryRawUnsafe('SELECT * FROM independent_module_master WHERE module_id = ? AND status = ?', moduleId, 'Active');
    if (!existing?.[0]) return res.status(404).json({ ok: false, message: 'Independent module not found.' });
    // Attaching content posts only { contents }. The old version still wrote every
    // other column from an absent body, blanking category / process / LOB / duration
    // on the module every time someone reordered its content. Only update what was sent.
    const columns = [];
    const values = [];
    const setIfPresent = (field, column, transform = clean) => {
      if (req.body?.[field] === undefined) return;
      columns.push(`${column} = ?`);
      values.push(transform(req.body[field]));
    };
    const moduleName = clean(req.body?.moduleName);
    if (moduleName) { columns.push('module_name = ?'); values.push(moduleName); }
    setIfPresent('category', 'category');
    setIfPresent('process', 'process');
    setIfPresent('lob', 'lob');
    setIfPresent('branch', 'branch');
    setIfPresent('description', 'description');
    setIfPresent('estimatedMins', 'estimated_mins', raw => toInt(raw, 0));
    if (columns.length) {
      await prisma.$executeRawUnsafe(
        `UPDATE independent_module_master SET ${columns.join(', ')} WHERE module_id = ?`,
        ...values, moduleId);
    }
    const contents = Array.isArray(req.body?.contents) ? req.body.contents : null;
    if (contents) {
      await prisma.$executeRawUnsafe('UPDATE independent_module_content_map SET active = 0 WHERE module_id = ?', moduleId);
      for (let i = 0; i < contents.length; i += 1) {
        const c = contents[i];
        const repoId = clean(c.repositoryContentId || c.repository_content_id);
        if (!repoId) continue;
        await prisma.$executeRawUnsafe(
          `INSERT INTO independent_module_content_map (id, module_id, repository_content_id, sort_order, required, active) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), required = VALUES(required), active = 1`,
          generateId('imc-'), moduleId, repoId, toInt(c.sortOrder, i + 1), toBool(c.required, true) ? 1 : 0
        );
      }
    }
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_INDEPENDENT_MODULE', module: 'IndependentModule', referenceId: moduleId, newValue: { moduleName } });
    return res.json({ ok: true, message: 'Independent module updated.' });
  } catch (err) {
    console.error('[adminStability] independent module update failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update independent module.' });
  }
});

router.delete('/independent-modules/:moduleId', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleId = clean(req.params.moduleId);
    const existing = await prisma.$queryRawUnsafe('SELECT * FROM independent_module_master WHERE module_id = ? AND status = ?', moduleId, 'Active');
    if (!existing?.[0]) return res.status(404).json({ ok: false, message: 'Independent module not found.' });
    await prisma.$executeRawUnsafe('UPDATE independent_module_master SET status = ? WHERE module_id = ?', 'Archived', moduleId);
    await prisma.$executeRawUnsafe('UPDATE independent_module_content_map SET active = 0 WHERE module_id = ?', moduleId);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ARCHIVE_INDEPENDENT_MODULE', module: 'IndependentModule', referenceId: moduleId });
    return res.json({ ok: true, message: 'Independent module archived.' });
  } catch (err) {
    console.error('[adminStability] independent module delete failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to archive independent module.' });
  }
});

router.delete('/independent-modules/:moduleId/contents/:repositoryContentId', ...auth, async (req, res) => {
  try {
    await ensureIndependentModuleTables();
    const moduleId = clean(req.params.moduleId);
    const repositoryContentId = clean(req.params.repositoryContentId);
    const existing = await prisma.$queryRawUnsafe('SELECT * FROM independent_module_content_map WHERE module_id = ? AND repository_content_id = ? AND active = 1', moduleId, repositoryContentId);
    if (!existing?.[0]) return res.status(404).json({ ok: false, message: 'Content mapping not found.' });
    await prisma.$executeRawUnsafe('UPDATE independent_module_content_map SET active = 0 WHERE module_id = ? AND repository_content_id = ?', moduleId, repositoryContentId);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'REMOVE_INDEPENDENT_MODULE_CONTENT', module: 'IndependentModule', referenceId: `${moduleId}:${repositoryContentId}` });
    return res.json({ ok: true, message: 'Content removed from module.' });
  } catch (err) {
    console.error('[adminStability] independent module remove content failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove content from module.' });
  }
});


// Forms across both portals pick branch / process / LOB from this one list.
router.get('/form-options', ...auth, async (_req, res) => {
  try {
    return res.json({ ok: true, data: await getFormOptions() });
  } catch (error) {
    console.error('[adminStability] form options failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to load form options.' });
  }
});

export default router;
