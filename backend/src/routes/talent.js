import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  requirePermission,
  listEffectivePermissions,
  clearPermissionCache,
} from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import { getTalentSnapshot, syncEmployeeSkills } from '../services/talent.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];
const traineeAuth = [requireSession, requireRole('trainee')];
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const VALID_SCOPES = new Set(['self', 'own_batch', 'branch', 'company']);
const VALID_USER_TYPES = new Set(['admin', 'coordinator', 'trainee', 'management']);
const VALID_STEP_TYPES = new Set(['CONTENT', 'ASSESSMENT', 'SKILL', 'CLASSROOM', 'MANUAL']);

function text(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function code(value) {
  return text(value, 60).toUpperCase().replace(/[^A-Z0-9_-]/g, '_').replace(/_+/g, '_');
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function positiveNumber(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scopeFor(req) {
  return String(req.permissionScope || 'self');
}

function branchAllowed(req, branch) {
  return scopeFor(req) === 'company' || !req.userBranch || String(branch || '') === String(req.userBranch);
}

async function getAdminPath(req, pathId, statuses = null) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM learning_path_master WHERE path_id = ? LIMIT 1`,
    String(pathId),
  );
  const path = rows[0];
  if (!path) return null;
  if (statuses && !statuses.includes(path.status)) return null;
  if (!branchAllowed(req, path.audience_branch)) return null;
  return path;
}

async function validateStepReference(stepType, referenceId) {
  if (stepType === 'CONTENT') return Boolean(await prisma.contentMaster.findUnique({ where: { contentId: referenceId }, select: { contentId: true } }));
  if (stepType === 'ASSESSMENT') return Boolean(await prisma.assessmentMaster.findUnique({ where: { assessmentId: referenceId }, select: { assessmentId: true } }));
  if (stepType === 'CLASSROOM') return Boolean(await prisma.classroomMaster.findUnique({ where: { classroomId: referenceId }, select: { classroomId: true } }));
  if (stepType === 'SKILL') {
    const rows = await prisma.$queryRawUnsafe(`SELECT skill_id FROM skill_master WHERE skill_id = ? AND active = 1 LIMIT 1`, referenceId);
    return Boolean(rows.length);
  }
  return stepType === 'MANUAL' && Boolean(referenceId);
}

router.get('/permissions/effective', requireSession, async (req, res) => {
  try {
    const permissions = await listEffectivePermissions(req);
    return res.json({ ok: true, data: permissions });
  } catch (error) {
    console.error('[TALENT] effective permissions failed:', error.message);
    return res.status(503).json({ ok: false, message: 'Permission service is not ready.' });
  }
});

router.get(
  '/admin/permissions',
  ...adminAuth,
  requirePermission('access.permissions.manage'),
  async (_req, res) => {
    try {
      const [permissions, roleGrants, overrides] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT permission_key AS permissionKey, module_name AS moduleName,
                  action_name AS actionName, description, risk_level AS riskLevel, active
             FROM permission_master ORDER BY module_name, action_name`,
        ),
        prisma.$queryRawUnsafe(
          `SELECT id, user_type AS userType, role_key AS roleKey,
                  permission_key AS permissionKey, allowed,
                  data_scope AS dataScope, conditions_json AS conditions,
                  created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
             FROM role_permission
            ORDER BY user_type, role_key, permission_key`,
        ),
        prisma.$queryRawUnsafe(
          `SELECT id, user_id AS userId, user_type AS userType,
                  permission_key AS permissionKey, allowed,
                  data_scope AS dataScope, expires_at AS expiresAt,
                  reason, granted_by AS grantedBy, created_at AS createdAt,
                  updated_at AS updatedAt
             FROM user_permission_override
            ORDER BY updated_at DESC LIMIT 500`,
        ),
      ]);
      return res.json({ ok: true, data: { permissions, roleGrants, overrides } });
    } catch (error) {
      console.error('[TALENT] permission matrix failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load permission matrix.' });
    }
  },
);

router.put(
  '/admin/permissions/role',
  ...adminAuth,
  requirePermission('access.permissions.manage'),
  async (req, res) => {
    const userType = text(req.body?.userType, 30).toLowerCase();
    const roleKey = text(req.body?.roleKey, 100) || '*';
    const permissionKey = text(req.body?.permissionKey, 120);
    const dataScope = text(req.body?.dataScope, 30).toLowerCase() || 'self';
    if (!VALID_USER_TYPES.has(userType) || !permissionKey || !VALID_SCOPES.has(dataScope)) {
      return res.status(400).json({ ok: false, message: 'Valid user type, permission and data scope are required.' });
    }
    try {
      const permission = await prisma.$queryRawUnsafe(`SELECT permission_key FROM permission_master WHERE permission_key = ? AND active = 1`, permissionKey);
      if (!permission.length) return res.status(404).json({ ok: false, message: 'Permission not found.' });
      await prisma.$executeRawUnsafe(
        `INSERT INTO role_permission
           (id, user_type, role_key, permission_key, allowed, data_scope, conditions_json, created_by)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           allowed = VALUES(allowed), data_scope = VALUES(data_scope),
           conditions_json = VALUES(conditions_json), created_by = VALUES(created_by)`,
        userType, roleKey, permissionKey, bool(req.body?.allowed, true) ? 1 : 0,
        dataScope, req.body?.conditions ? JSON.stringify(req.body.conditions) : null, req.userId,
      );
      clearPermissionCache();
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPSERT_ROLE_PERMISSION', module: 'Access', referenceId: `${userType}:${roleKey}:${permissionKey}`, newValue: { allowed: bool(req.body?.allowed, true), dataScope } });
      return res.json({ ok: true, message: 'Role permission updated.' });
    } catch (error) {
      console.error('[TALENT] role permission update failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not update role permission.' });
    }
  },
);

router.put(
  '/admin/permissions/user',
  ...adminAuth,
  requirePermission('access.permissions.manage'),
  async (req, res) => {
    const userId = text(req.body?.userId, 120);
    const userType = text(req.body?.userType, 30).toLowerCase();
    const permissionKey = text(req.body?.permissionKey, 120);
    const dataScope = text(req.body?.dataScope, 30).toLowerCase() || 'self';
    const expiresAt = dateOrNull(req.body?.expiresAt);
    if (!userId || !VALID_USER_TYPES.has(userType) || !permissionKey || !VALID_SCOPES.has(dataScope)) {
      return res.status(400).json({ ok: false, message: 'Valid user, type, permission and data scope are required.' });
    }
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO user_permission_override
           (id, user_id, user_type, permission_key, allowed, data_scope,
            expires_at, reason, granted_by)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           allowed = VALUES(allowed), data_scope = VALUES(data_scope),
           expires_at = VALUES(expires_at), reason = VALUES(reason),
           granted_by = VALUES(granted_by)`,
        userId, userType, permissionKey, bool(req.body?.allowed, true) ? 1 : 0,
        dataScope, expiresAt, text(req.body?.reason, 500) || null, req.userId,
      );
      clearPermissionCache(userId);
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPSERT_USER_PERMISSION', module: 'Access', referenceId: `${userType}:${userId}:${permissionKey}`, newValue: { allowed: bool(req.body?.allowed, true), dataScope, expiresAt } });
      return res.json({ ok: true, message: 'User permission override updated.' });
    } catch (error) {
      console.error('[TALENT] user permission update failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not update user permission.' });
    }
  },
);

router.get(
  '/admin/skills',
  ...adminAuth,
  requirePermission('talent.skills.view'),
  async (req, res) => {
    try {
      const search = text(req.query?.q, 100);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT sm.skill_id AS skillId, sm.skill_code AS skillCode,
                sm.skill_name AS skillName, sm.category, sm.description,
                sm.level_scale AS levelScale, sm.active,
                COUNT(DISTINCT rsr.id) AS requirementCount,
                COUNT(DISTINCT csm.id) AS contentMapCount,
                COUNT(DISTINCT asm.id) AS assessmentMapCount,
                COUNT(DISTINCT esp.employee_id) AS profiledEmployees
           FROM skill_master sm
           LEFT JOIN role_skill_requirement rsr ON rsr.skill_id = sm.skill_id AND rsr.active = 1
           LEFT JOIN content_skill_map csm ON csm.skill_id = sm.skill_id AND csm.active = 1
           LEFT JOIN assessment_skill_map asm ON asm.skill_id = sm.skill_id AND asm.active = 1
           LEFT JOIN employee_skill_profile esp ON esp.skill_id = sm.skill_id
          WHERE (? = '' OR sm.skill_name LIKE CONCAT('%', ?, '%') OR sm.skill_code LIKE CONCAT('%', ?, '%') OR sm.category LIKE CONCAT('%', ?, '%'))
          GROUP BY sm.skill_id
          ORDER BY sm.active DESC, sm.category, sm.skill_name
          LIMIT 500`,
        search, search, search, search,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      console.error('[TALENT] skill list failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load skills.' });
    }
  },
);

router.post(
  '/admin/skills',
  ...adminAuth,
  requirePermission('talent.skills.manage'),
  async (req, res) => {
    const skillCode = code(req.body?.skillCode || req.body?.skillName);
    const skillName = text(req.body?.skillName, 160);
    const category = text(req.body?.category, 100);
    const levelScale = positiveNumber(req.body?.levelScale, 5, 10);
    if (!skillCode || !skillName || !category || levelScale < 1) {
      return res.status(400).json({ ok: false, message: 'Skill code, name, category and a valid level scale are required.' });
    }
    try {
      const skillId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO skill_master
           (skill_id, skill_code, skill_name, category, description,
            level_scale, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        skillId, skillCode, skillName, category, text(req.body?.description, 5000) || null,
        levelScale, req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_SKILL', module: 'Talent', referenceId: skillId, newValue: { skillCode, skillName, category, levelScale } });
      return res.status(201).json({ ok: true, data: { skillId, skillCode, skillName, category, levelScale } });
    } catch (error) {
      if (error.code === 'P2010' || String(error.message).includes('Duplicate')) return res.status(409).json({ ok: false, message: 'Skill code already exists.' });
      console.error('[TALENT] skill create failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not create skill.' });
    }
  },
);

router.patch(
  '/admin/skills/:skillId',
  ...adminAuth,
  requirePermission('talent.skills.manage'),
  async (req, res) => {
    const skillId = text(req.params.skillId, 60);
    const skillName = text(req.body?.skillName, 160);
    const category = text(req.body?.category, 100);
    const levelScale = positiveNumber(req.body?.levelScale, 5, 10);
    if (!skillId || !skillName || !category || levelScale < 1) return res.status(400).json({ ok: false, message: 'Valid skill details are required.' });
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE skill_master
            SET skill_name = ?, category = ?, description = ?,
                level_scale = ?, active = ?
          WHERE skill_id = ?`,
        skillName, category, text(req.body?.description, 5000) || null,
        levelScale, bool(req.body?.active, true) ? 1 : 0, skillId,
      );
      if (!result) return res.status(404).json({ ok: false, message: 'Skill not found.' });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_SKILL', module: 'Talent', referenceId: skillId, newValue: { skillName, category, levelScale, active: bool(req.body?.active, true) } });
      return res.json({ ok: true, message: 'Skill updated.' });
    } catch (error) {
      console.error('[TALENT] skill update failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not update skill.' });
    }
  },
);

router.get(
  '/admin/skill-matrix',
  ...adminAuth,
  requirePermission('talent.skills.view'),
  async (req, res) => {
    try {
      const page = Math.max(1, Math.round(positiveNumber(req.query?.page, 1, 100000)));
      const pageSize = Math.min(100, Math.max(5, Math.round(positiveNumber(req.query?.pageSize, 25, 100))));
      const branchFilter = text(req.query?.branch, 120);
      const processFilter = text(req.query?.process, 120);
      const lobFilter = text(req.query?.lob, 120);
      const batchFilter = text(req.query?.batchNo, 120);
      const designationFilter = text(req.query?.designation, 120);
      const categoryFilter = text(req.query?.category, 100);
      const search = text(req.query?.search, 120);
      const requiredOnly = bool(req.query?.requiredOnly);

      const scope = scopeFor(req);
      const restrictBranch = scope !== 'company' && req.userBranch ? String(req.userBranch) : '';
      if (restrictBranch && branchFilter && branchFilter !== restrictBranch) {
        return res.json({
          ok: true,
          data: {
            employees: [], skills: [], cells: {},
            pagination: { page, pageSize, total: 0 },
            summary: { employeeCount: 0, skillCount: 0, belowTargetEmployees: 0, belowTargetPairs: 0 },
          },
        });
      }

      const where = { status: 'Active' };
      if (restrictBranch || branchFilter) where.branch = restrictBranch || branchFilter;
      if (processFilter) where.process = processFilter;
      if (lobFilter) where.lob = lobFilter;
      if (batchFilter) where.batchNo = batchFilter;
      if (designationFilter) where.designation = designationFilter;
      if (search) where.OR = [{ employeeId: { contains: search } }, { traineeName: { contains: search } }];

      const [total, employees] = await Promise.all([
        prisma.traineeMaster.count({ where }),
        prisma.traineeMaster.findMany({
          where,
          select: { employeeId: true, traineeName: true, branch: true, process: true, lob: true, batchNo: true, designation: true, status: true },
          orderBy: { traineeName: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      const employeeIds = employees.map(employee => employee.employeeId);

      let skillRows = [];
      if (employeeIds.length && requiredOnly) {
        skillRows = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT sm.skill_id AS skillId, sm.skill_code AS skillCode,
                  sm.skill_name AS skillName, sm.category, sm.level_scale AS levelScale
             FROM role_skill_requirement rsr
             INNER JOIN skill_master sm ON sm.skill_id = rsr.skill_id AND sm.active = 1
            WHERE rsr.active = 1
              AND rsr.department = ''
              AND (rsr.designation = '' OR rsr.designation = ?)
              AND (rsr.process_name = '' OR rsr.process_name = ?)
              AND (rsr.lob_name = '' OR rsr.lob_name = ?)
              AND (? = '' OR sm.category = ?)
            ORDER BY sm.category, sm.skill_name
            LIMIT 100`,
          designationFilter, processFilter, lobFilter, categoryFilter, categoryFilter,
        );
      } else if (employeeIds.length) {
        skillRows = await prisma.$queryRawUnsafe(
          `SELECT skill_id AS skillId, skill_code AS skillCode, skill_name AS skillName,
                  category, level_scale AS levelScale
             FROM skill_master
            WHERE active = 1
              AND (? = '' OR category = ?)
            ORDER BY category, skill_name
            LIMIT 100`,
          categoryFilter, categoryFilter,
        );
      }
      const skillIds = skillRows.map(skill => skill.skillId);

      let profileRows = [];
      if (employeeIds.length && skillIds.length) {
        const employeePlaceholders = employeeIds.map(() => '?').join(',');
        const skillPlaceholders = skillIds.map(() => '?').join(',');
        profileRows = await prisma.$queryRawUnsafe(
          `SELECT employee_id AS employeeId, skill_id AS skillId,
                  current_level AS currentLevel, target_level AS targetLevel,
                  status, confidence_score AS confidenceScore,
                  last_evidence_at AS lastEvidenceAt
             FROM employee_skill_profile
            WHERE employee_id IN (${employeePlaceholders}) AND skill_id IN (${skillPlaceholders})`,
          ...employeeIds, ...skillIds,
        );
      }

      const cells = {};
      const employeesWithGap = new Set();
      let belowTargetPairs = 0;
      for (const row of profileRows) {
        if (!cells[row.employeeId]) cells[row.employeeId] = {};
        const isBelowTarget = row.status === 'GAP' || Number(row.currentLevel) < Number(row.targetLevel);
        cells[row.employeeId][row.skillId] = {
          currentLevel: row.currentLevel,
          targetLevel: row.targetLevel,
          status: row.status,
          confidenceScore: row.confidenceScore,
          lastEvidenceAt: row.lastEvidenceAt,
        };
        if (isBelowTarget) {
          belowTargetPairs += 1;
          employeesWithGap.add(row.employeeId);
        }
      }

      return res.json({
        ok: true,
        data: {
          employees,
          skills: skillRows,
          cells,
          pagination: { page, pageSize, total },
          summary: {
            employeeCount: employees.length,
            skillCount: skillRows.length,
            belowTargetEmployees: employeesWithGap.size,
            belowTargetPairs,
          },
        },
      });
    } catch (error) {
      console.error('[TALENT] skill matrix failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load the cross-employee skill matrix.' });
    }
  },
);

router.get(
  '/admin/requirements',
  ...adminAuth,
  requirePermission('talent.skills.view'),
  async (_req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT rsr.id, rsr.department, rsr.designation,
                rsr.process_name AS processName, rsr.lob_name AS lobName,
                rsr.skill_id AS skillId, sm.skill_code AS skillCode,
                sm.skill_name AS skillName, sm.category,
                rsr.required_level AS requiredLevel, rsr.critical,
                rsr.weight, rsr.active
           FROM role_skill_requirement rsr
           INNER JOIN skill_master sm ON sm.skill_id = rsr.skill_id
          ORDER BY rsr.active DESC, rsr.process_name, rsr.lob_name,
                   rsr.critical DESC, sm.skill_name
          LIMIT 1000`,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      return res.status(500).json({ ok: false, message: 'Could not load competency requirements.' });
    }
  },
);

router.put(
  '/admin/requirements',
  ...adminAuth,
  requirePermission('talent.skills.manage'),
  async (req, res) => {
    const skillId = text(req.body?.skillId, 60);
    const requiredLevel = positiveNumber(req.body?.requiredLevel, 0, 10);
    if (!skillId || requiredLevel < 1) return res.status(400).json({ ok: false, message: 'Skill and required level are required.' });
    const department = text(req.body?.department, 120);
    const designation = text(req.body?.designation, 120);
    const processName = text(req.body?.processName, 120);
    const lobName = text(req.body?.lobName, 120);
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO role_skill_requirement
           (id, department, designation, process_name, lob_name, skill_id,
            required_level, critical, weight, active, created_by)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           required_level = VALUES(required_level), critical = VALUES(critical),
           weight = VALUES(weight), active = VALUES(active), created_by = VALUES(created_by)`,
        department, designation, processName, lobName, skillId, requiredLevel,
        bool(req.body?.critical) ? 1 : 0, positiveNumber(req.body?.weight, 1, 100),
        bool(req.body?.active, true) ? 1 : 0, req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPSERT_SKILL_REQUIREMENT', module: 'Talent', referenceId: skillId, newValue: { department, designation, processName, lobName, requiredLevel, critical: bool(req.body?.critical) } });
      return res.json({ ok: true, message: 'Competency requirement saved.' });
    } catch (error) {
      console.error('[TALENT] requirement save failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not save competency requirement.' });
    }
  },
);

router.put(
  '/admin/skills/:skillId/maps/:mapType',
  ...adminAuth,
  requirePermission('talent.skills.manage'),
  async (req, res) => {
    const skillId = text(req.params.skillId, 60);
    const mapType = text(req.params.mapType, 30).toLowerCase();
    const referenceId = text(req.body?.referenceId, 120);
    const targetLevel = positiveNumber(req.body?.targetLevel, 1, 10);
    if (!skillId || !referenceId || !['content', 'assessment'].includes(mapType)) return res.status(400).json({ ok: false, message: 'Valid skill, map type and reference are required.' });
    try {
      const exists = mapType === 'content'
        ? await prisma.contentMaster.findUnique({ where: { contentId: referenceId }, select: { contentId: true } })
        : await prisma.assessmentMaster.findUnique({ where: { assessmentId: referenceId }, select: { assessmentId: true } });
      if (!exists) return res.status(404).json({ ok: false, message: `${mapType} reference not found.` });
      const table = mapType === 'content' ? 'content_skill_map' : 'assessment_skill_map';
      const referenceColumn = mapType === 'content' ? 'content_id' : 'assessment_id';
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${table}
           (id, ${referenceColumn}, skill_id, target_level, weight, active, mapped_by)
         VALUES (UUID(), ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           target_level = VALUES(target_level), weight = VALUES(weight),
           active = 1, mapped_by = VALUES(mapped_by)`,
        referenceId, skillId, targetLevel, positiveNumber(req.body?.weight, 1, 100), req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'MAP_SKILL_EVIDENCE', module: 'Talent', referenceId: skillId, newValue: { mapType, referenceId, targetLevel } });
      return res.json({ ok: true, message: 'Skill evidence mapping saved.' });
    } catch (error) {
      console.error('[TALENT] evidence map failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not save evidence mapping.' });
    }
  },
);

router.put(
  '/admin/skills/profiles/:employeeId/:skillId',
  ...adminAuth,
  requirePermission('talent.skills.manage'),
  async (req, res) => {
    const employeeId = text(req.params.employeeId, 120);
    const skillId = text(req.params.skillId, 60);
    const currentLevel = positiveNumber(req.body?.currentLevel, 0, 10);
    const targetLevel = positiveNumber(req.body?.targetLevel, 0, 10);
    try {
      const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId }, select: { branch: true } });
      if (!trainee || !branchAllowed(req, trainee.branch)) return res.status(404).json({ ok: false, message: 'Employee not found in your scope.' });
      const status = targetLevel > 0 ? (currentLevel >= targetLevel ? 'READY' : 'GAP') : (currentLevel > 0 ? 'DEVELOPING' : 'UNASSESSED');
      await prisma.$executeRawUnsafe(
        `INSERT INTO employee_skill_profile
           (id, employee_id, skill_id, current_level, target_level,
            confidence_score, status, source, verified_by, verified_at, expires_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, UTC_TIMESTAMP(3), ?)
         ON DUPLICATE KEY UPDATE
           current_level = VALUES(current_level), target_level = VALUES(target_level),
           confidence_score = VALUES(confidence_score), status = VALUES(status),
           source = 'VERIFIED', verified_by = VALUES(verified_by),
           verified_at = VALUES(verified_at), expires_at = VALUES(expires_at)`,
        employeeId, skillId, currentLevel, targetLevel,
        positiveNumber(req.body?.confidenceScore, 100, 100), status,
        req.userId, dateOrNull(req.body?.expiresAt),
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO skill_evidence
           (id, employee_id, skill_id, evidence_type, reference_id,
            score_pct, level_awarded, evidence_status, notes,
            recorded_by, evidence_at, expires_at)
         VALUES (UUID(), ?, ?, 'MANUAL_VERIFICATION', ?, ?, ?, 'VALID', ?, ?, UTC_TIMESTAMP(3), ?)
         ON DUPLICATE KEY UPDATE
           score_pct = VALUES(score_pct), level_awarded = VALUES(level_awarded),
           evidence_status = 'VALID', notes = VALUES(notes),
           recorded_by = VALUES(recorded_by), evidence_at = VALUES(evidence_at),
           expires_at = VALUES(expires_at)`,
        employeeId, skillId, `verification:${req.userId}`, positiveNumber(req.body?.confidenceScore, 100, 100),
        currentLevel, text(req.body?.notes, 5000) || null, req.userId, dateOrNull(req.body?.expiresAt),
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'VERIFY_EMPLOYEE_SKILL', module: 'Talent', referenceId: `${employeeId}:${skillId}`, newValue: { currentLevel, targetLevel, status } });
      return res.json({ ok: true, message: 'Employee skill verified.' });
    } catch (error) {
      console.error('[TALENT] skill verification failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not verify employee skill.' });
    }
  },
);

router.get(
  '/admin/paths',
  ...adminAuth,
  requirePermission('talent.paths.view'),
  async (req, res) => {
    try {
      const branch = scopeFor(req) === 'company' ? '' : String(req.userBranch || '');
      const rows = await prisma.$queryRawUnsafe(
        `SELECT lpm.path_id AS pathId, lpm.path_code AS pathCode,
                lpm.path_name AS pathName, lpm.description,
                lpm.audience_branch AS audienceBranch,
                lpm.audience_department AS audienceDepartment,
                lpm.audience_designation AS audienceDesignation,
                lpm.audience_process AS audienceProcess,
                lpm.audience_lob AS audienceLob,
                lpm.version_no AS versionNo, lpm.status, lpm.mandatory,
                lpm.active, lpm.published_at AS publishedAt,
                COUNT(DISTINCT lps.step_id) AS stepCount,
                COUNT(DISTINCT lpe.enrollment_id) AS enrollmentCount,
                SUM(CASE WHEN lpe.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedCount
           FROM learning_path_master lpm
           LEFT JOIN learning_path_step lps ON lps.path_id = lpm.path_id
           LEFT JOIN learning_path_enrollment lpe ON lpe.path_id = lpm.path_id
          WHERE (? = '' OR lpm.audience_branch IN ('', ?))
          GROUP BY lpm.path_id
          ORDER BY lpm.active DESC, lpm.updated_at DESC
          LIMIT 500`,
        branch, branch,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      console.error('[TALENT] path list failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load learning paths.' });
    }
  },
);

router.post(
  '/admin/paths',
  ...adminAuth,
  requirePermission('talent.paths.manage'),
  async (req, res) => {
    const pathCode = code(req.body?.pathCode || req.body?.pathName);
    const pathName = text(req.body?.pathName, 180);
    const versionNo = Math.max(1, Math.round(positiveNumber(req.body?.versionNo, 1, 1000)));
    if (!pathCode || !pathName) return res.status(400).json({ ok: false, message: 'Path code and name are required.' });
    const audienceBranch = scopeFor(req) === 'company' ? text(req.body?.audienceBranch, 120) : String(req.userBranch || '');
    try {
      const pathId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO learning_path_master
           (path_id, path_code, path_name, description, audience_branch,
            audience_department, audience_designation, audience_process,
            audience_lob, version_no, status, mandatory, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 1, ?)`,
        pathId, pathCode, pathName, text(req.body?.description, 5000) || null,
        audienceBranch, text(req.body?.audienceDepartment, 120),
        text(req.body?.audienceDesignation, 120), text(req.body?.audienceProcess, 120),
        text(req.body?.audienceLob, 120), versionNo, bool(req.body?.mandatory) ? 1 : 0, req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_LEARNING_PATH', module: 'Talent', referenceId: pathId, newValue: { pathCode, pathName, versionNo, audienceBranch } });
      return res.status(201).json({ ok: true, data: { pathId, pathCode, pathName, versionNo, status: 'DRAFT' } });
    } catch (error) {
      if (String(error.message).includes('Duplicate')) return res.status(409).json({ ok: false, message: 'This path code and version already exist.' });
      console.error('[TALENT] path create failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not create learning path.' });
    }
  },
);

router.get(
  '/admin/paths/:pathId/steps',
  ...adminAuth,
  requirePermission('talent.paths.view'),
  async (req, res) => {
    try {
      const path = await getAdminPath(req, req.params.pathId);
      if (!path) return res.status(404).json({ ok: false, message: 'Learning path not found in your scope.' });
      const steps = await prisma.$queryRawUnsafe(
        `SELECT step_id AS stepId, path_id AS pathId, step_order AS stepOrder,
                step_type AS stepType, reference_id AS referenceId,
                step_title AS stepTitle, required, min_score AS minScore,
                min_level AS minLevel, prerequisite_step_id AS prerequisiteStepId,
                due_days AS dueDays, completion_rule_json AS completionRule
           FROM learning_path_step WHERE path_id = ? ORDER BY step_order`,
        String(path.path_id),
      );
      return res.json({ ok: true, data: { path, steps } });
    } catch (error) {
      return res.status(500).json({ ok: false, message: 'Could not load learning path steps.' });
    }
  },
);

router.post(
  '/admin/paths/:pathId/steps',
  ...adminAuth,
  requirePermission('talent.paths.manage'),
  async (req, res) => {
    const stepType = text(req.body?.stepType, 30).toUpperCase();
    const referenceId = text(req.body?.referenceId, 160);
    const stepTitle = text(req.body?.stepTitle, 200);
    const stepOrder = Math.max(1, Math.round(positiveNumber(req.body?.stepOrder, 1, 10000)));
    if (!VALID_STEP_TYPES.has(stepType) || !referenceId || !stepTitle) return res.status(400).json({ ok: false, message: 'Valid step type, reference and title are required.' });
    try {
      const path = await getAdminPath(req, req.params.pathId, ['DRAFT']);
      if (!path) return res.status(404).json({ ok: false, message: 'Editable learning path not found.' });
      if (!(await validateStepReference(stepType, referenceId))) return res.status(404).json({ ok: false, message: 'Step reference does not exist.' });
      const prerequisiteStepId = text(req.body?.prerequisiteStepId, 60) || null;
      if (prerequisiteStepId) {
        const prerequisite = await prisma.$queryRawUnsafe(
          `SELECT step_order AS stepOrder FROM learning_path_step WHERE step_id = ? AND path_id = ? LIMIT 1`,
          prerequisiteStepId, String(path.path_id),
        );
        if (!prerequisite.length || Number(prerequisite[0].stepOrder) >= stepOrder) return res.status(400).json({ ok: false, message: 'Prerequisite must be an earlier step in this path.' });
      }
      const stepId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO learning_path_step
           (step_id, path_id, step_order, step_type, reference_id,
            step_title, required, min_score, min_level,
            prerequisite_step_id, due_days, completion_rule_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        stepId, String(path.path_id), stepOrder, stepType, referenceId, stepTitle,
        bool(req.body?.required, true) ? 1 : 0,
        req.body?.minScore === undefined ? null : positiveNumber(req.body.minScore, 0, 100),
        req.body?.minLevel === undefined ? null : positiveNumber(req.body.minLevel, 0, 10),
        prerequisiteStepId,
        req.body?.dueDays === undefined ? null : Math.round(positiveNumber(req.body.dueDays, 0, 3650)),
        req.body?.completionRule ? JSON.stringify(req.body.completionRule) : null,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ADD_LEARNING_PATH_STEP', module: 'Talent', referenceId: stepId, newValue: { pathId: path.path_id, stepOrder, stepType, referenceId } });
      return res.status(201).json({ ok: true, data: { stepId, stepOrder, stepType, referenceId, stepTitle } });
    } catch (error) {
      if (String(error.message).includes('Duplicate')) return res.status(409).json({ ok: false, message: 'Step order already exists in this path.' });
      console.error('[TALENT] path step create failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not add learning path step.' });
    }
  },
);

router.post(
  '/admin/paths/:pathId/publish',
  ...adminAuth,
  requirePermission('talent.paths.manage'),
  async (req, res) => {
    try {
      const path = await getAdminPath(req, req.params.pathId, ['DRAFT']);
      if (!path) return res.status(404).json({ ok: false, message: 'Draft learning path not found.' });
      const steps = await prisma.$queryRawUnsafe(
        `SELECT step_id AS stepId, step_type AS stepType, reference_id AS referenceId,
                prerequisite_step_id AS prerequisiteStepId
           FROM learning_path_step WHERE path_id = ? ORDER BY step_order`,
        String(path.path_id),
      );
      if (!steps.length) return res.status(409).json({ ok: false, message: 'Add at least one step before publishing.' });
      for (const step of steps) {
        if (!(await validateStepReference(step.stepType, step.referenceId))) {
          return res.status(409).json({ ok: false, message: `Step reference is invalid: ${step.referenceId}` });
        }
      }
      await prisma.$executeRawUnsafe(
        `UPDATE learning_path_master
            SET status = 'PUBLISHED', published_by = ?, published_at = UTC_TIMESTAMP(3)
          WHERE path_id = ? AND status = 'DRAFT'`,
        req.userId, String(path.path_id),
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'PUBLISH_LEARNING_PATH', module: 'Talent', referenceId: path.path_id, newValue: { stepCount: steps.length } });
      return res.json({ ok: true, message: 'Learning path published.' });
    } catch (error) {
      console.error('[TALENT] path publish failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not publish learning path.' });
    }
  },
);

router.post(
  '/admin/paths/:pathId/enrollments',
  ...adminAuth,
  requirePermission('talent.paths.assign'),
  async (req, res) => {
    const employeeIds = [...new Set((Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : []).map(value => text(value, 120)).filter(Boolean))].slice(0, 1000);
    if (!employeeIds.length) return res.status(400).json({ ok: false, message: 'At least one employee ID is required.' });
    try {
      const path = await getAdminPath(req, req.params.pathId, ['PUBLISHED']);
      if (!path) return res.status(404).json({ ok: false, message: 'Published learning path not found in your scope.' });
      const trainees = await prisma.traineeMaster.findMany({
        where: { employeeId: { in: employeeIds }, status: 'Active' },
        select: { employeeId: true, branch: true },
      });
      const scoped = trainees.filter(trainee => branchAllowed(req, trainee.branch));
      const stepRows = await prisma.$queryRawUnsafe(`SELECT step_id AS stepId FROM learning_path_step WHERE path_id = ?`, String(path.path_id));
      const dueAt = dateOrNull(req.body?.dueAt);
      let created = 0;
      for (const trainee of scoped) {
        const enrollmentId = randomUUID();
        const inserted = await prisma.$executeRawUnsafe(
          `INSERT IGNORE INTO learning_path_enrollment
             (enrollment_id, path_id, employee_id, status, progress_pct,
              assigned_at, due_at, assigned_by, source)
           VALUES (?, ?, ?, 'NOT_STARTED', 0, UTC_TIMESTAMP(3), ?, ?, ?)`,
          enrollmentId, String(path.path_id), trainee.employeeId, dueAt, req.userId,
          text(req.body?.source, 40) || 'ADMIN',
        );
        if (!inserted) continue;
        created += 1;
        for (const step of stepRows) {
          await prisma.$executeRawUnsafe(
            `INSERT IGNORE INTO learning_path_step_progress
               (id, enrollment_id, step_id, status)
             VALUES (UUID(), ?, ?, 'LOCKED')`,
            enrollmentId, String(step.stepId),
          );
        }
      }
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ASSIGN_LEARNING_PATH', module: 'Talent', referenceId: path.path_id, newValue: { requested: employeeIds.length, inScope: scoped.length, created, dueAt } });
      return res.json({ ok: true, data: { requested: employeeIds.length, inScope: scoped.length, created, alreadyEnrolled: scoped.length - created, notFoundOrOutOfScope: employeeIds.length - scoped.length } });
    } catch (error) {
      console.error('[TALENT] path enrolment failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not assign learning path.' });
    }
  },
);

router.get(
  '/me',
  ...traineeAuth,
  requirePermission('talent.skills.view'),
  requirePermission('talent.paths.view'),
  async (req, res) => {
    try {
      const snapshot = await getTalentSnapshot(req.userId, req.userId);
      if (!snapshot.trainee) return res.status(404).json({ ok: false, message: 'Trainee profile not found.' });
      return res.json({ ok: true, data: snapshot });
    } catch (error) {
      console.error('[TALENT] learner snapshot failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load skills and learning paths.' });
    }
  },
);

router.post(
  '/me/refresh',
  ...traineeAuth,
  requirePermission('talent.skills.view'),
  requirePermission('talent.paths.view'),
  async (req, res) => {
    try {
      const snapshot = await getTalentSnapshot(req.userId, req.userId);
      return res.json({ ok: true, data: snapshot, message: 'Competency evidence and path progress refreshed.' });
    } catch (error) {
      console.error('[TALENT] learner refresh failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not refresh talent progress.' });
    }
  },
);

router.get(
  '/coordinator/batches/:batchNo/gaps',
  ...coordinatorAuth,
  requirePermission('talent.skills.view_batch'),
  async (req, res) => {
    try {
      const batchNo = text(req.params.batchNo, 120);
      const batch = await prisma.batchMaster.findFirst({ where: { batchNo, coordinatorLoginId: req.userId } });
      if (!batch) return res.status(404).json({ ok: false, message: 'Owned batch not found.' });
      const trainees = await prisma.traineeMaster.findMany({
        where: { batchNo, status: 'Active' },
        select: { employeeId: true, traineeName: true, process: true, lob: true, riskStatus: true },
        orderBy: { traineeName: 'asc' },
        take: 250,
      });
      const rows = [];
      for (const trainee of trainees) {
        const skills = await syncEmployeeSkills(trainee.employeeId, req.userId);
        const profiles = skills.profiles || [];
        rows.push({
          ...trainee,
          totalSkills: profiles.length,
          readyCount: profiles.filter(profile => profile.status === 'READY').length,
          gapCount: profiles.filter(profile => profile.status === 'GAP').length,
          criticalGaps: (skills.requirements || []).filter(requirement => {
            if (!requirement.critical) return false;
            const profile = profiles.find(item => item.skillId === requirement.skillId);
            return Number(profile?.currentLevel || 0) < Number(requirement.requiredLevel || 0);
          }).map(requirement => ({ skillId: requirement.skillId, skillName: requirement.skillName, requiredLevel: requirement.requiredLevel })),
          gaps: profiles.filter(profile => profile.status === 'GAP').map(profile => ({ skillId: profile.skillId, skillName: profile.skillName, category: profile.category, currentLevel: profile.currentLevel, targetLevel: profile.targetLevel })),
        });
      }
      return res.json({ ok: true, data: { batch: { batchNo: batch.batchNo, batchName: batch.batchName, process: batch.process, lob: batch.lob }, trainees: rows } });
    } catch (error) {
      console.error('[TALENT] batch gaps failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load batch competency gaps.' });
    }
  },
);

export default router;
