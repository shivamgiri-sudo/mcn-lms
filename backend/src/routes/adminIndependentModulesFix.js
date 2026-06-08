import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function like(value) {
  return `%${String(value || '').replace(/[%_]/g, '')}%`;
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

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS independent_module_master (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      module_id VARCHAR(191) NOT NULL UNIQUE,
      module_name VARCHAR(500) NOT NULL,
      category VARCHAR(255) NULL,
      process VARCHAR(255) NULL,
      lob VARCHAR(255) NULL,
      description TEXT NULL,
      estimated_mins INT NOT NULL DEFAULT 0,
      status VARCHAR(100) NOT NULL DEFAULT 'Active',
      created_by VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS independent_module_content_map (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      module_id VARCHAR(191) NOT NULL,
      repository_content_id VARCHAR(191) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      required TINYINT(1) NOT NULL DEFAULT 1,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ind_module_content (module_id, repository_content_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

router.get('/independent-modules', ...auth, async (req, res) => {
  try {
    await ensureTables();
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
        `SELECT m.module_id, m.sort_order, m.required, r.*
         FROM independent_module_content_map m
         INNER JOIN content_repository_master r ON r.repository_content_id = m.repository_content_id
         WHERE m.active = 1 AND r.status = 'Active' AND m.module_id IN (${placeholders})
         ORDER BY m.module_id, m.sort_order ASC`,
        ...moduleIds
      );
    }
    const byModule = {};
    for (const row of contentRows || []) {
      if (!byModule[row.module_id]) byModule[row.module_id] = [];
      byModule[row.module_id].push({ ...mapRepoRow(row), sortOrder: row.sort_order, required: !!row.required });
    }
    return res.json({ ok: true, data: modules.map(m => ({ ...m, contents: byModule[m.module_id] || [] })) });
  } catch (err) {
    console.error('[adminIndependentModulesFix] independent module list failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to load independent modules.' });
  }
});

export default router;
