import { prisma } from '../utils/db.js';
import { generateId } from '../utils/hash.js';

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function ensureContentRepositoryTable() {
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

// The table predates the branch column, so CREATE TABLE IF NOT EXISTS alone would
// leave existing installations without it. Add it in place when it is missing.
async function ensureBranchColumn() {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    'independent_module_master', 'branch');
  if (Number(row?.present ?? row?.PRESENT ?? 0) > 0) return;
  await prisma.$executeRawUnsafe('ALTER TABLE independent_module_master ADD COLUMN branch VARCHAR(255) NULL AFTER lob');
}

export async function ensureIndependentModuleTables() {
  await ensureContentRepositoryTable();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS independent_module_master (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      module_id VARCHAR(191) NOT NULL UNIQUE,
      module_name VARCHAR(500) NOT NULL,
      category VARCHAR(255) NULL,
      process VARCHAR(255) NULL,
      lob VARCHAR(255) NULL,
      branch VARCHAR(255) NULL,
      description TEXT NULL,
      estimated_mins INT NOT NULL DEFAULT 0,
      status VARCHAR(100) NOT NULL DEFAULT 'Active',
      created_by VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ind_module_status (status),
      INDEX idx_ind_module_process_lob (process, lob),
      INDEX idx_ind_module_category (category)
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
      UNIQUE KEY uq_ind_module_content (module_id, repository_content_id),
      INDEX idx_ind_content_module (module_id),
      INDEX idx_ind_content_repo (repository_content_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS independent_module_auto_assign_rule (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      rule_id VARCHAR(191) NOT NULL UNIQUE,
      module_id VARCHAR(191) NOT NULL,
      rule_name VARCHAR(500) NOT NULL,
      scope_type VARCHAR(100) NOT NULL DEFAULT 'All',
      scope_value VARCHAR(255) NULL,
      assignment_type VARCHAR(100) NOT NULL DEFAULT 'Mandatory',
      message TEXT NULL,
      due_days INT NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_auto_rule_active (active),
      INDEX idx_auto_rule_scope (scope_type, scope_value),
      INDEX idx_auto_rule_module (module_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureBranchColumn();
}

export async function getIndependentModuleById(moduleId) {
  await ensureIndependentModuleTables();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT * FROM independent_module_master WHERE module_id = ? AND status = ?',
    moduleId,
    'Active',
  );
  return rows?.[0] || null;
}

export async function assignIndependentModuleToUser({ moduleId, employeeId, assignmentType = 'Mandatory', message = null, assignedBy = null, dueDays = 0 }) {
  const module = await getIndependentModuleById(moduleId);
  if (!module || !employeeId) return { assigned: false, reason: 'Module or employee missing' };

  const dueDate = toInt(dueDays, 0) > 0 ? new Date(Date.now() + toInt(dueDays, 0) * 24 * 60 * 60 * 1000) : null;
  const existing = await prisma.assignedModule.findFirst({
    where: { moduleId, assignedTo: employeeId, assignedToType: 'individual', active: true },
  });
  if (existing) return { assigned: false, reason: 'Already assigned' };

  await prisma.assignedModule.create({
    data: {
      moduleId,
      moduleName: module.module_name,
      broadcastTitle: module.module_name,
      assignedTo: employeeId,
      assignedToType: 'individual',
      assignmentType,
      message: message || module.description || 'Auto-assigned module for new LMS user.',
      assignedBy,
      dueDate,
      active: true,
    },
  });
  return { assigned: true, moduleId, moduleName: module.module_name };
}

export async function autoAssignModulesForNewUser({ employeeId, branch, process, lob, designation, createdBy }) {
  await ensureIndependentModuleTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM independent_module_auto_assign_rule WHERE active = 1 AND (
      scope_type = 'All'
      OR (scope_type = 'Branch' AND scope_value = ?)
      OR (scope_type = 'Process' AND scope_value = ?)
      OR (scope_type = 'LOB' AND scope_value = ?)
      OR (scope_type = 'Designation' AND scope_value = ?)
    ) ORDER BY created_at ASC`,
    clean(branch) || '',
    clean(process) || '',
    clean(lob) || '',
    clean(designation) || '',
  );

  const results = [];
  for (const rule of rows || []) {
    const result = await assignIndependentModuleToUser({
      moduleId: rule.module_id,
      employeeId,
      assignmentType: rule.assignment_type || 'Mandatory',
      message: rule.message,
      assignedBy: createdBy,
      dueDays: Number(rule.due_days || 0),
    });
    results.push({ ruleId: rule.rule_id, moduleId: rule.module_id, ...result });
  }
  return results;
}

export function newIndependentId(prefix) {
  return generateId(prefix);
}

// ── Direct-broadcast wrappers ───────────────────────────────────────────────
// A "direct" broadcast (admin picks one specific already-existing Assessment
// or Content item, without first drilling into a classroom/module) still has
// to land on AssignedModule.moduleId — that column is required. When the
// picked item already belongs to a real classroom/module we just reuse that
// moduleId directly (see resolveBroadcastTarget in controllers/admin.js).
// When it does NOT (a standalone assessment, or a content_repository_master
// item), we get-or-create a thin independent_module_master row that wraps
// just that one item, keyed deterministically so re-broadcasting the same
// item reuses the same wrapper instead of creating duplicates. Zero
// trainee-side changes are needed — enrichIndependentAssignments() in
// routes/traineeStability.js already knows how to render any
// independent_module_master-backed assignment.

export function assessmentWrapperModuleId(assessmentId) {
  return `IND-ASSESSMENT-${assessmentId}`;
}

export function contentWrapperModuleId(repositoryContentId) {
  return `IND-CONTENT-${repositoryContentId}`;
}

// Get-or-create the wrapper module for a standalone assessment (no content
// map row needed — the trainee-side assessment is resolved separately, off
// AssignedModule.assessmentId, by attachAssessmentsToAssignments).
export async function ensureIndependentWrapperForAssessment({ assessmentId, assessmentName, createdBy = null }) {
  await ensureIndependentModuleTables();
  const moduleId = assessmentWrapperModuleId(assessmentId);
  const name = clean(assessmentName) || moduleId;
  const existing = await prisma.$queryRawUnsafe(
    'SELECT module_id FROM independent_module_master WHERE module_id = ?',
    moduleId,
  );
  if (!existing?.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO independent_module_master (id, module_id, module_name, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Active', ?, NOW(), NOW())`,
      generateId('IMM'), moduleId, name, createdBy,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE independent_module_master SET status = 'Active', module_name = ? WHERE module_id = ?`,
      name, moduleId,
    );
  }
  return moduleId;
}

// Get-or-create the wrapper module for a standalone content_repository_master
// item, plus the single content-map row that ties the wrapper to it.
export async function ensureIndependentWrapperForContent({ repositoryContentId, title, createdBy = null }) {
  await ensureIndependentModuleTables();
  const moduleId = contentWrapperModuleId(repositoryContentId);
  const name = clean(title) || moduleId;
  const existing = await prisma.$queryRawUnsafe(
    'SELECT module_id FROM independent_module_master WHERE module_id = ?',
    moduleId,
  );
  if (!existing?.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO independent_module_master (id, module_id, module_name, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Active', ?, NOW(), NOW())`,
      generateId('IMM'), moduleId, name, createdBy,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE independent_module_master SET status = 'Active', module_name = ? WHERE module_id = ?`,
      name, moduleId,
    );
  }
  const mapExisting = await prisma.$queryRawUnsafe(
    'SELECT id FROM independent_module_content_map WHERE module_id = ? AND repository_content_id = ?',
    moduleId, repositoryContentId,
  );
  if (!mapExisting?.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO independent_module_content_map (id, module_id, repository_content_id, sort_order, required, active, created_at)
       VALUES (?, ?, ?, 0, 1, 1, NOW())`,
      generateId('IMC'), moduleId, repositoryContentId,
    );
  }
  return moduleId;
}

export function dayWrapperModuleId(classroomId, dayNo) {
  return `IND-DAY-${classroomId}-${dayNo}`;
}

// Get-or-create the wrapper module for "A Specific Day" direct-broadcast mode:
// every active ModuleMaster row for a classroomId+dayNo, and every active
// ContentMaster row across those modules, riding along as one AssignedModule
// row instead of one broadcast per module. Used only when a day has MORE THAN
// ONE module (resolveBroadcastTarget in controllers/admin.js reuses the real
// module directly when a day has exactly one, same as the assessment/content
// direct-assign modes reuse a real module when the picked item already has one).
//
// Content rows here point at REAL content_master items, not
// content_repository_master ones — independent_module_content_map's
// repository_content_id column is repurposed with a "CM:<contentId>" marker
// so enrichIndependentAssignments() in routes/traineeStability.js knows to
// resolve it against content_master instead. That keeps this table's shape
// (and the assessment/content wrapper functions above) completely unchanged.
//
// Re-broadcasting the same classroom+day replaces the map rows each time, so
// it always reflects that day's CURRENT active modules/content rather than a
// stale snapshot from whenever it was first broadcast.
export async function ensureIndependentWrapperForDay({ classroomId, dayNo, dayLabel, contentRows, createdBy = null }) {
  await ensureIndependentModuleTables();
  const moduleId = dayWrapperModuleId(classroomId, dayNo);
  const name = clean(dayLabel) || moduleId;
  const existing = await prisma.$queryRawUnsafe(
    'SELECT module_id FROM independent_module_master WHERE module_id = ?',
    moduleId,
  );
  if (!existing?.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO independent_module_master (id, module_id, module_name, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Active', ?, NOW(), NOW())`,
      generateId('IMM'), moduleId, name, createdBy,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE independent_module_master SET status = 'Active', module_name = ? WHERE module_id = ?`,
      name, moduleId,
    );
  }

  await prisma.$executeRawUnsafe(
    'DELETE FROM independent_module_content_map WHERE module_id = ?',
    moduleId,
  );
  const rows = Array.isArray(contentRows) ? contentRows : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.contentId) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO independent_module_content_map (id, module_id, repository_content_id, sort_order, required, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      generateId('IMC'), moduleId, `CM:${row.contentId}`, i, row.required === false ? 0 : 1,
    );
  }
  return moduleId;
}
