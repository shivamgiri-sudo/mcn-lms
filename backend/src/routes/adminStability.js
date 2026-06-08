import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { generateId, generateSalt, hashPassword } from '../utils/hash.js';

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

async function computeBatchCounters(batchNo) {
  const [totalTrainees, certified, handoverToOps, ojtReady] = await Promise.all([
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' } } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, certificationStatus: 'Certified' } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, handoverToOps: true } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, ojtReady: true } }),
  ]);
  return { totalTrainees, certified, handoverToOps, ojtReady };
}

async function ensureContentRepositoryTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS content_repository_master (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      repository_content_id VARCHAR(191) NOT NULL UNIQUE,
      title VARCHAR(500) NOT NULL,
      content_type VARCHAR(100) NOT NULL DEFAULT 'document',
      category VARCHAR(255) NULL,
      sub_category VARCHAR(255) NULL,
      process VARCHAR(255) NULL,
      lob VARCHAR(255) NULL,
      tags TEXT NULL,
      source_type VARCHAR(100) NOT NULL DEFAULT 'local',
      direct_media_url TEXT NULL,
      local_file_path TEXT NULL,
      drive_file_id VARCHAR(255) NULL,
      drive_url TEXT NULL,
      player_mode VARCHAR(100) NOT NULL DEFAULT 'Auto',
      estimated_mins INT NOT NULL DEFAULT 0,
      completion_rule_pct DOUBLE NOT NULL DEFAULT 80,
      description TEXT NULL,
      version_no INT NOT NULL DEFAULT 1,
      status VARCHAR(100) NOT NULL DEFAULT 'Active',
      created_by VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_repo_status (status),
      INDEX idx_repo_process_lob (process, lob),
      INDEX idx_repo_category (category),
      INDEX idx_repo_type (content_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

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

    const duplicate = await prisma.traineeMaster.findFirst({
      where: {
        status: { not: 'Deleted' },
        OR: [
          { employeeId },
          { lmsId },
          ...(email ? [{ email: { equals: email, mode: 'insensitive' } }] : []),
          ...(mobile ? [{ mobile: { endsWith: mobile } }] : []),
        ],
      },
    });
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

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_INDEPENDENT_LMS_USER', module: 'Accounts', referenceId: employeeId, newValue: { lmsId, traineeName } });
    return res.json({ ok: true, data: { employeeId, lmsId, traineeName, email, mobile, tempPassword }, message: `LMS user created: ${employeeId}` });
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
      id,
      repoId,
      title,
      clean(req.body?.contentType) || 'document',
      clean(req.body?.category),
      clean(req.body?.subCategory),
      clean(req.body?.process),
      clean(req.body?.lob),
      clean(req.body?.tags),
      clean(req.body?.sourceType) || 'local',
      clean(req.body?.directMediaUrl),
      clean(req.body?.localFilePath),
      clean(req.body?.driveFileId),
      clean(req.body?.driveUrl),
      clean(req.body?.playerMode) || 'Auto',
      Number(req.body?.estimatedMins || 0),
      Number(req.body?.completionRulePct || 80),
      clean(req.body?.description),
      Number(req.body?.versionNo || 1),
      'Active',
      req.userId
    );

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_CONTENT_REPOSITORY_ITEM', module: 'ContentRepository', referenceId: repoId, newValue: { title } });
    return res.json({ ok: true, data: { repositoryContentId: repoId }, message: 'Repository content saved.' });
  } catch (err) {
    console.error('[adminStability] content repository create failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to save repository content.' });
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

export default router;
