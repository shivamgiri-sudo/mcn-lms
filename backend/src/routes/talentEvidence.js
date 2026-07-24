import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import { getTalentSnapshot } from '../services/talent.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];

function text(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function companyScope(req) {
  return req.permissionScope === 'company' || !req.userBranch;
}

function scopedBranch(req) {
  return companyScope(req) ? '' : String(req.userBranch || '');
}

async function employeeInScope(req, employeeId) {
  const trainee = await prisma.traineeMaster.findUnique({
    where: { employeeId },
    select: {
      employeeId: true,
      traineeName: true,
      email: true,
      mobile: true,
      branch: true,
      process: true,
      lob: true,
      batchNo: true,
      classroomId: true,
      status: true,
      riskStatus: true,
    },
  });
  if (!trainee) return null;
  if (!companyScope(req) && String(trainee.branch || '') !== String(req.userBranch || '')) return null;
  return trainee;
}

router.get(
  '/admin/evidence/catalog',
  ...adminAuth,
  requirePermission('talent.skills.view'),
  async (req, res) => {
    const search = text(req.query?.q, 100);
    const branch = scopedBranch(req);
    try {
      const [skills, contents, assessments, contentMaps, assessmentMaps] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT skill_id AS skillId, skill_code AS skillCode,
                  skill_name AS skillName, category, level_scale AS levelScale
             FROM skill_master
            WHERE active = 1
              AND (? = '' OR skill_name LIKE CONCAT('%', ?, '%')
                   OR skill_code LIKE CONCAT('%', ?, '%')
                   OR category LIKE CONCAT('%', ?, '%'))
            ORDER BY category, skill_name LIMIT 500`,
          search, search, search, search,
        ),
        prisma.$queryRawUnsafe(
          `SELECT cm.content_id AS referenceId, cm.content_title AS referenceTitle,
                  cm.content_type AS referenceType, mm.module_title AS parentTitle,
                  cl.classroom_name AS classroomName, cl.branch,
                  cl.process, cl.lob
             FROM content_master cm
             INNER JOIN module_master mm ON mm.module_id = cm.module_id
             INNER JOIN classroom_master cl ON cl.classroom_id = mm.classroom_id
            WHERE cm.active = 1 AND mm.active = 1 AND cl.active = 1
              AND (? = '' OR cl.branch = ? OR cl.branch IS NULL OR cl.branch = '')
              AND (? = '' OR cm.content_title LIKE CONCAT('%', ?, '%')
                   OR cm.content_id LIKE CONCAT('%', ?, '%')
                   OR mm.module_title LIKE CONCAT('%', ?, '%'))
            ORDER BY cl.classroom_name, mm.day_no, mm.module_order, cm.content_order
            LIMIT 1000`,
          branch, branch, search, search, search, search,
        ),
        prisma.$queryRawUnsafe(
          `SELECT am.assessment_id AS referenceId,
                  am.assessment_name AS referenceTitle,
                  'assessment' AS referenceType,
                  COALESCE(mm.module_title, CONCAT('Day ', am.day_no)) AS parentTitle,
                  cl.classroom_name AS classroomName, cl.branch,
                  cl.process, cl.lob, am.passing_pct AS passingPct
             FROM assessment_master am
             INNER JOIN classroom_master cl ON cl.classroom_id = am.classroom_id
             LEFT JOIN module_master mm ON mm.module_id = am.module_id
            WHERE am.active = 1 AND cl.active = 1
              AND (? = '' OR cl.branch = ? OR cl.branch IS NULL OR cl.branch = '')
              AND (? = '' OR am.assessment_name LIKE CONCAT('%', ?, '%')
                   OR am.assessment_id LIKE CONCAT('%', ?, '%'))
            ORDER BY cl.classroom_name, am.day_no, am.sort_order
            LIMIT 1000`,
          branch, branch, search, search, search,
        ),
        prisma.$queryRawUnsafe(
          `SELECT csm.id, csm.content_id AS referenceId,
                  csm.skill_id AS skillId, sm.skill_name AS skillName,
                  csm.target_level AS targetLevel, csm.weight,
                  csm.active, csm.mapped_by AS mappedBy,
                  csm.updated_at AS updatedAt
             FROM content_skill_map csm
             INNER JOIN skill_master sm ON sm.skill_id = csm.skill_id
            WHERE csm.active = 1 ORDER BY csm.updated_at DESC LIMIT 2000`,
        ),
        prisma.$queryRawUnsafe(
          `SELECT asm.id, asm.assessment_id AS referenceId,
                  asm.skill_id AS skillId, sm.skill_name AS skillName,
                  asm.target_level AS targetLevel, asm.weight,
                  asm.active, asm.mapped_by AS mappedBy,
                  asm.updated_at AS updatedAt
             FROM assessment_skill_map asm
             INNER JOIN skill_master sm ON sm.skill_id = asm.skill_id
            WHERE asm.active = 1 ORDER BY asm.updated_at DESC LIMIT 2000`,
        ),
      ]);
      const visibleContentIds = new Set(contents.map(row => row.referenceId));
      const visibleAssessmentIds = new Set(assessments.map(row => row.referenceId));
      return res.json({
        ok: true,
        data: {
          skills,
          contents,
          assessments,
          contentMaps: contentMaps.filter(row => visibleContentIds.has(row.referenceId)),
          assessmentMaps: assessmentMaps.filter(row => visibleAssessmentIds.has(row.referenceId)),
        },
      });
    } catch (error) {
      console.error('[TALENT] evidence catalog failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load evidence catalog.' });
    }
  },
);

router.get(
  '/admin/employees/search',
  ...adminAuth,
  requirePermission('talent.skills.view'),
  async (req, res) => {
    const search = text(req.query?.q, 100);
    if (search.length < 2) return res.json({ ok: true, data: [] });
    const branch = scopedBranch(req);
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT tm.employee_id AS employeeId, tm.trainee_name AS traineeName,
                tm.email, tm.mobile, tm.branch, tm.process, tm.lob,
                tm.batch_no AS batchNo, tm.risk_status AS riskStatus,
                COUNT(DISTINCT esp.skill_id) AS skillCount,
                SUM(CASE WHEN esp.status = 'GAP' THEN 1 ELSE 0 END) AS gapCount
           FROM trainee_master tm
           LEFT JOIN employee_skill_profile esp ON esp.employee_id = tm.employee_id
          WHERE tm.status = 'Active'
            AND (? = '' OR tm.branch = ?)
            AND (tm.employee_id LIKE CONCAT('%', ?, '%')
                 OR tm.trainee_name LIKE CONCAT('%', ?, '%')
                 OR tm.email LIKE CONCAT('%', ?, '%')
                 OR tm.mobile LIKE CONCAT('%', ?, '%'))
          GROUP BY tm.employee_id
          ORDER BY tm.trainee_name
          LIMIT 50`,
        branch, branch, search, search, search, search,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      console.error('[TALENT] employee search failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not search employees.' });
    }
  },
);

router.get(
  '/admin/employees/:employeeId/talent',
  ...adminAuth,
  requirePermission('talent.skills.view'),
  requirePermission('talent.paths.view'),
  async (req, res) => {
    const employeeId = text(req.params.employeeId, 120);
    try {
      const trainee = await employeeInScope(req, employeeId);
      if (!trainee) return res.status(404).json({ ok: false, message: 'Employee not found in your data scope.' });
      const snapshot = await getTalentSnapshot(employeeId, req.userId);
      return res.json({ ok: true, data: snapshot });
    } catch (error) {
      console.error('[TALENT] employee snapshot failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load employee talent profile.' });
    }
  },
);

router.delete(
  '/admin/skills/:skillId/maps/:mapType/:referenceId',
  ...adminAuth,
  requirePermission('talent.skills.manage'),
  async (req, res) => {
    const skillId = text(req.params.skillId, 60);
    const mapType = text(req.params.mapType, 30).toLowerCase();
    const referenceId = text(req.params.referenceId, 160);
    if (!['content', 'assessment'].includes(mapType)) return res.status(400).json({ ok: false, message: 'Invalid evidence map type.' });
    try {
      if (mapType === 'content') {
        const visible = await prisma.$queryRawUnsafe(
          `SELECT cm.content_id
             FROM content_master cm
             INNER JOIN module_master mm ON mm.module_id = cm.module_id
             INNER JOIN classroom_master cl ON cl.classroom_id = mm.classroom_id
            WHERE cm.content_id = ?
              AND (? = '' OR cl.branch = ? OR cl.branch IS NULL OR cl.branch = '')
            LIMIT 1`,
          referenceId, scopedBranch(req), scopedBranch(req),
        );
        if (!visible.length) return res.status(404).json({ ok: false, message: 'Content mapping is outside your scope.' });
        await prisma.$executeRawUnsafe(
          `UPDATE content_skill_map SET active = 0, mapped_by = ?
            WHERE content_id = ? AND skill_id = ?`,
          req.userId, referenceId, skillId,
        );
      } else {
        const visible = await prisma.$queryRawUnsafe(
          `SELECT am.assessment_id
             FROM assessment_master am
             INNER JOIN classroom_master cl ON cl.classroom_id = am.classroom_id
            WHERE am.assessment_id = ?
              AND (? = '' OR cl.branch = ? OR cl.branch IS NULL OR cl.branch = '')
            LIMIT 1`,
          referenceId, scopedBranch(req), scopedBranch(req),
        );
        if (!visible.length) return res.status(404).json({ ok: false, message: 'Assessment mapping is outside your scope.' });
        await prisma.$executeRawUnsafe(
          `UPDATE assessment_skill_map SET active = 0, mapped_by = ?
            WHERE assessment_id = ? AND skill_id = ?`,
          req.userId, referenceId, skillId,
        );
      }
      await audit({
        userIdentity: req.userId,
        userRole: 'Admin',
        action: 'REMOVE_SKILL_EVIDENCE_MAP',
        module: 'Talent',
        referenceId: `${mapType}:${referenceId}:${skillId}`,
      });
      return res.json({ ok: true, message: 'Evidence mapping removed.' });
    } catch (error) {
      console.error('[TALENT] mapping removal failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not remove evidence mapping.' });
    }
  },
);

export default router;
