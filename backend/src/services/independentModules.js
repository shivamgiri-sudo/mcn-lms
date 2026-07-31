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
