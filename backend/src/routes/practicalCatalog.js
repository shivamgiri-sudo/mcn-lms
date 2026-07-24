import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { normalize } from '../services/practicalGovernance.js';

const router = Router();
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[PRACTICAL-CATALOG] ${req.method} ${req.originalUrl}:`, error.message);
      return res.status(Number(error.status || 500)).json({ ok: false, message: error.status ? error.message : 'Could not load practical assessment catalog.' });
    }
  };
}

function companyScope(req) {
  return req.permissionScope === 'company'
    || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

async function myEvaluation(req, res, evaluatorType) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT e.evaluation_id AS evaluationId, e.assignment_id AS assignmentId,
            e.evaluator_slot AS evaluatorSlot, e.status, e.percentage,
            e.result, e.critical_fail AS criticalFail, e.summary,
            e.strengths, e.development_notes AS developmentNotes
       FROM practical_evaluation e
      WHERE e.assignment_id = ? AND e.evaluator_id = ? AND e.evaluator_type = ?
      LIMIT 1`,
    String(req.params.assignmentId), String(req.userId), evaluatorType,
  );
  res.json({ ok: true, data: normalize(rows[0] || null) });
}

router.get('/coordinator/catalog', ...coordinatorAuth, requirePermission('practical.manage_scope'), route(async (req, res) => {
  const templates = await prisma.$queryRawUnsafe(
    `SELECT p.template_id AS templateId, p.template_code AS templateCode,
            p.template_name AS templateName, p.version_no AS versionNo,
            p.passing_pct AS passingPct, p.max_attempts AS maxAttempts,
            p.evaluator_count AS evaluatorCount, p.blind_evaluation AS blindEvaluation,
            p.audience_branch AS audienceBranch, p.audience_process AS audienceProcess,
            p.audience_lob AS audienceLob
       FROM practical_assessment_template p
      WHERE p.status = 'PUBLISHED' AND p.active = 1
        AND (p.audience_branch = '' OR p.audience_branch IN (
          SELECT DISTINCT COALESCE(branch,'') FROM batch_master WHERE coordinator_login_id = ?
        ))
      ORDER BY p.template_name, p.version_no DESC`,
    String(req.userId),
  );
  const learners = await prisma.$queryRawUnsafe(
    `SELECT t.employee_id AS employeeId, t.trainee_name AS traineeName,
            t.batch_no AS batchNo, t.branch, t.process, t.lob
       FROM trainee_master t
       INNER JOIN batch_master b ON b.batch_no = t.batch_no
      WHERE b.coordinator_login_id = ? AND t.status = 'Active'
      ORDER BY t.batch_no, t.trainee_name LIMIT 3000`,
    String(req.userId),
  );
  res.json({ ok: true, data: normalize({ templates, learners }) });
}));

router.get('/coordinator/assignments/:assignmentId/my-evaluation', ...coordinatorAuth, requirePermission('practical.evaluate_owned'), route((req, res) => myEvaluation(req, res, 'coordinator')));

router.get('/admin/catalog', ...adminAuth, requirePermission('practical.manage_scope'), route(async (req, res) => {
  const params = [];
  let templateScope = '';
  let learnerScope = '';
  if (!companyScope(req)) {
    templateScope = ` AND (p.audience_branch = '' OR p.audience_branch = ?)`;
    learnerScope = ` AND t.branch = ?`;
    params.push(String(req.userBranch || ''));
  }
  const templates = await prisma.$queryRawUnsafe(
    `SELECT p.template_id AS templateId, p.template_code AS templateCode,
            p.template_name AS templateName, p.version_no AS versionNo,
            p.passing_pct AS passingPct, p.max_attempts AS maxAttempts,
            p.evaluator_count AS evaluatorCount, p.blind_evaluation AS blindEvaluation,
            p.audience_branch AS audienceBranch, p.audience_process AS audienceProcess,
            p.audience_lob AS audienceLob
       FROM practical_assessment_template p
      WHERE p.status = 'PUBLISHED' AND p.active = 1${templateScope}
      ORDER BY p.template_name, p.version_no DESC`,
    ...params,
  );
  const learners = await prisma.$queryRawUnsafe(
    `SELECT t.employee_id AS employeeId, t.trainee_name AS traineeName,
            t.batch_no AS batchNo, t.branch, t.process, t.lob
       FROM trainee_master t
      WHERE t.status = 'Active'${learnerScope}
      ORDER BY t.branch, t.batch_no, t.trainee_name LIMIT 5000`,
    ...params,
  );
  const skills = await prisma.$queryRawUnsafe(
    `SELECT skill_id AS skillId, skill_code AS skillCode, skill_name AS skillName,
            category, level_scale AS levelScale
       FROM skill_master WHERE active = 1 ORDER BY category, skill_name`,
  );
  res.json({ ok: true, data: normalize({ templates, learners, skills }) });
}));

router.get('/admin/assignments/:assignmentId/my-evaluation', ...adminAuth, requirePermission('practical.manage_scope'), route((req, res) => myEvaluation(req, res, 'admin')));

export default router;
