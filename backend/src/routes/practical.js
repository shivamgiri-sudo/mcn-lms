import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  claimEvaluation,
  createAssignment,
  createTemplateVersion,
  getAssignmentDetail,
  getTemplateDetail,
  normalize,
  publishTemplate,
  resolveModeration,
  saveEvaluation,
  saveSubmission,
} from '../services/practicalGovernance.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[PRACTICAL] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        message: status >= 500 ? 'Practical assessment service failed.' : error.message,
        code: error.code || 'PRACTICAL_ERROR',
        details: status < 500 ? error.details || null : null,
      });
    }
  };
}

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function number(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function companyScope(req) {
  return req.permissionScope === 'company'
    || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

async function coordinatorOwnsEmployee(coordinatorId, employeeId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.employee_id
       FROM trainee_master t
       INNER JOIN batch_master b ON b.batch_no = t.batch_no
      WHERE t.employee_id = ? AND b.coordinator_login_id = ? AND t.status = 'Active'
      LIMIT 1`,
    String(employeeId), String(coordinatorId),
  );
  return Boolean(rows.length);
}

async function ensureAssignmentScope(req, assignmentId, actorType) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.employee_id AS employeeId,
            a.batch_no AS batchNo, a.branch, b.coordinator_login_id AS coordinatorLoginId
       FROM practical_assessment_assignment a
       LEFT JOIN batch_master b ON b.batch_no = a.batch_no
      WHERE a.assignment_id = ? LIMIT 1`,
    String(assignmentId),
  );
  const item = normalize(rows[0] || null);
  if (!item) {
    const error = new Error('Practical assessment assignment not found.');
    error.status = 404;
    throw error;
  }
  if (actorType === 'coordinator' && item.coordinatorLoginId !== String(req.userId)) {
    const error = new Error('Assignment is outside your owned-batch scope.');
    error.status = 404;
    throw error;
  }
  if (actorType === 'admin' && !companyScope(req) && item.branch !== String(req.userBranch || '')) {
    const error = new Error('Assignment is outside your branch scope.');
    error.status = 404;
    throw error;
  }
  return item;
}

async function ensureEvaluationScope(req, evaluationId, actorType) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT e.evaluation_id AS evaluationId, e.assignment_id AS assignmentId,
            e.evaluator_id AS evaluatorId, e.evaluator_type AS evaluatorType,
            a.branch, b.coordinator_login_id AS coordinatorLoginId
       FROM practical_evaluation e
       INNER JOIN practical_assessment_assignment a ON a.assignment_id = e.assignment_id
       LEFT JOIN batch_master b ON b.batch_no = a.batch_no
      WHERE e.evaluation_id = ? LIMIT 1`,
    String(evaluationId),
  );
  const item = normalize(rows[0] || null);
  if (!item || item.evaluatorId !== String(req.userId) || item.evaluatorType !== actorType) {
    const error = new Error('Evaluation assignment not found.');
    error.status = 404;
    throw error;
  }
  if (actorType === 'coordinator' && item.coordinatorLoginId !== String(req.userId)) {
    const error = new Error('Evaluation is outside your owned-batch scope.');
    error.status = 404;
    throw error;
  }
  if (actorType === 'admin' && !companyScope(req) && item.branch !== String(req.userBranch || '')) {
    const error = new Error('Evaluation is outside your branch scope.');
    error.status = 404;
    throw error;
  }
  return item;
}

function hideBlindPeer(detail, viewerId, viewerType) {
  if (!detail?.blindEvaluation || detail.status === 'PASSED' || detail.status === 'FAILED') return detail;
  const submittedCount = detail.evaluations.filter(item => item.status === 'SUBMITTED').length;
  if (submittedCount >= Number(detail.evaluatorCount || 1)) return detail;
  return {
    ...detail,
    evaluations: detail.evaluations.map(item => {
      if (item.evaluatorId === String(viewerId) && item.evaluatorType === viewerType) return item;
      return {
        evaluationId: item.evaluationId,
        evaluatorSlot: item.evaluatorSlot,
        status: item.status,
        evaluatorId: null,
        evaluatorType: null,
        totalScore: null,
        percentage: null,
        result: null,
        criticalFail: null,
        summary: null,
        strengths: null,
        developmentNotes: null,
        scores: [],
      };
    }),
  };
}

function learnerView(detail) {
  if (!detail) return detail;
  const finalized = ['PASSED', 'FAILED'].includes(detail.status);
  return {
    ...detail,
    evaluations: finalized
      ? detail.evaluations.map(item => ({
          evaluatorSlot: item.evaluatorSlot,
          percentage: item.percentage,
          result: item.result,
          criticalFail: item.criticalFail,
          summary: item.summary,
          strengths: item.strengths,
          developmentNotes: item.developmentNotes,
          scores: item.scores,
        }))
      : [],
    events: detail.events.filter(item => !['EVALUATION_SAVED', 'EVALUATION_CLAIMED'].includes(item.eventType)),
  };
}

async function listTemplatesForScope(req) {
  const params = [];
  let scopeSql = '';
  if (!companyScope(req)) {
    scopeSql = ` AND (audience_branch = '' OR audience_branch = ?)`;
    params.push(String(req.userBranch || ''));
  }
  return normalize(await prisma.$queryRawUnsafe(
    `SELECT template_id AS templateId, template_code AS templateCode,
            template_name AS templateName, version_no AS versionNo,
            audience_branch AS audienceBranch, audience_process AS audienceProcess,
            audience_lob AS audienceLob, passing_pct AS passingPct,
            max_attempts AS maxAttempts, evaluator_count AS evaluatorCount,
            blind_evaluation AS blindEvaluation,
            moderation_threshold_pct AS moderationThresholdPct,
            status, active, published_at AS publishedAt, updated_at AS updatedAt
       FROM practical_assessment_template
      WHERE active = 1${scopeSql}
      ORDER BY template_code, version_no DESC`,
    ...params,
  ));
}

async function saveTemplateDraft(req, templateId = null) {
  const body = req.body || {};
  const templateCode = text(body.templateCode, 80).toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
  const templateName = text(body.templateName, 220);
  if (!templateCode || !templateName) {
    const error = new Error('Template code and name are required.');
    error.status = 400;
    throw error;
  }
  const sections = Array.isArray(body.sections) ? body.sections.slice(0, 30) : [];
  if (!sections.length) {
    const error = new Error('Add at least one rubric section.');
    error.status = 400;
    throw error;
  }
  const branch = companyScope(req) ? text(body.audienceBranch, 120) : String(req.userBranch || '');
  return prisma.$transaction(async tx => {
    let targetId = templateId;
    if (targetId) {
      const rows = await tx.$queryRawUnsafe(
        `SELECT template_id AS templateId, status, audience_branch AS audienceBranch
           FROM practical_assessment_template WHERE template_id = ? LIMIT 1 FOR UPDATE`,
        String(targetId),
      );
      const existing = normalize(rows[0] || null);
      if (!existing) {
        const error = new Error('Practical assessment template not found.');
        error.status = 404;
        throw error;
      }
      if (existing.status !== 'DRAFT') {
        const error = new Error('Published rubric versions are immutable. Create a new version instead.');
        error.status = 409;
        throw error;
      }
      if (!companyScope(req) && existing.audienceBranch !== String(req.userBranch || '')) {
        const error = new Error('Template is outside your branch scope.');
        error.status = 404;
        throw error;
      }
      await tx.$executeRawUnsafe(
        `UPDATE practical_assessment_template
            SET template_code = ?, template_name = ?, description = ?,
                learner_instructions = ?, evaluator_instructions = ?,
                audience_branch = ?, audience_process = ?, audience_lob = ?,
                classroom_id = ?, module_id = ?, ilt_session_id = ?, passing_pct = ?,
                max_attempts = ?, evaluator_count = ?, blind_evaluation = ?,
                moderation_threshold_pct = ?
          WHERE template_id = ?`,
        templateCode, templateName, text(body.description, 30000) || null,
        text(body.learnerInstructions, 30000) || null, text(body.evaluatorInstructions, 30000) || null,
        branch, text(body.audienceProcess, 120), text(body.audienceLob, 120),
        text(body.classroomId, 120) || null, text(body.moduleId, 120) || null,
        text(body.iltSessionId, 36) || null, number(body.passingPct, 70, 0, 100),
        Math.round(number(body.maxAttempts, 2, 1, 20)),
        Math.round(number(body.evaluatorCount, 1, 1, 2)), bool(body.blindEvaluation) ? 1 : 0,
        number(body.moderationThresholdPct, 15, 0, 100), String(targetId),
      );
      await tx.$executeRawUnsafe(`DELETE FROM practical_rubric_section WHERE template_id = ?`, String(targetId));
    } else {
      targetId = randomUUID();
      const versions = await tx.$queryRawUnsafe(
        `SELECT COALESCE(MAX(version_no),0) AS maxVersion
           FROM practical_assessment_template WHERE template_code = ? FOR UPDATE`,
        templateCode,
      );
      const versionNo = number(versions[0]?.maxVersion, 0) + 1;
      await tx.$executeRawUnsafe(
        `INSERT INTO practical_assessment_template
           (template_id, template_code, template_name, version_no, description,
            learner_instructions, evaluator_instructions, audience_branch,
            audience_process, audience_lob, classroom_id, module_id, ilt_session_id,
            passing_pct, max_attempts, evaluator_count, blind_evaluation,
            moderation_threshold_pct, status, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?)`,
        targetId, templateCode, templateName, versionNo, text(body.description, 30000) || null,
        text(body.learnerInstructions, 30000) || null, text(body.evaluatorInstructions, 30000) || null,
        branch, text(body.audienceProcess, 120), text(body.audienceLob, 120),
        text(body.classroomId, 120) || null, text(body.moduleId, 120) || null,
        text(body.iltSessionId, 36) || null, number(body.passingPct, 70, 0, 100),
        Math.round(number(body.maxAttempts, 2, 1, 20)),
        Math.round(number(body.evaluatorCount, 1, 1, 2)), bool(body.blindEvaluation) ? 1 : 0,
        number(body.moderationThresholdPct, 15, 0, 100), String(req.userId),
      );
    }

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      const section = sections[sectionIndex] || {};
      const sectionTitle = text(section.sectionTitle, 220);
      if (!sectionTitle) continue;
      const sectionId = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO practical_rubric_section
           (section_id, template_id, section_code, section_title, description, sort_order, weight_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        sectionId, String(targetId), text(section.sectionCode, 80).toUpperCase() || `SECTION-${sectionIndex + 1}`,
        sectionTitle, text(section.description, 20000) || null,
        Math.round(number(section.sortOrder, sectionIndex + 1, 1, 10000)),
        number(section.weightPct, 0, 0.01, 100),
      );
      const criteria = Array.isArray(section.criteria) ? section.criteria.slice(0, 100) : [];
      for (let criterionIndex = 0; criterionIndex < criteria.length; criterionIndex += 1) {
        const criterion = criteria[criterionIndex] || {};
        const criterionTitle = text(criterion.criterionTitle, 240);
        if (!criterionTitle) continue;
        const maxScore = number(criterion.maxScore, 5, 0.01, 10000);
        const critical = bool(criterion.critical);
        await tx.$executeRawUnsafe(
          `INSERT INTO practical_rubric_criterion
             (criterion_id, section_id, criterion_code, criterion_title, description,
              observable_behavior, sort_order, max_score, weight_pct, critical,
              critical_min_score, evidence_required, skill_id, skill_level_awarded,
              rating_scale_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(), sectionId,
          text(criterion.criterionCode, 80).toUpperCase() || `CRITERION-${criterionIndex + 1}`,
          criterionTitle, text(criterion.description, 20000) || null,
          text(criterion.observableBehavior, 20000) || null,
          Math.round(number(criterion.sortOrder, criterionIndex + 1, 1, 10000)),
          maxScore, number(criterion.weightPct, 0, 0.01, 100), critical ? 1 : 0,
          critical ? number(criterion.criticalMinScore, 0, 0, maxScore) : null,
          bool(criterion.evidenceRequired) ? 1 : 0,
          text(criterion.skillId, 36) || null,
          criterion.skillLevelAwarded == null ? null : number(criterion.skillLevelAwarded, 1, 0.01, 10),
          criterion.ratingScaleJson ? JSON.stringify(criterion.ratingScaleJson) : null,
        );
      }
    }
    return getTemplateDetail(targetId, tx);
  });
}

// Learner self-service.
router.get('/me', ...traineeAuth, requirePermission('practical.view_self'), route(async (req, res) => {
  const assignments = normalize(await prisma.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.status, a.attempt_no AS attemptNo,
            a.assigned_at AS assignedAt, a.due_at AS dueAt,
            a.final_percentage AS finalPercentage, a.final_result AS finalResult,
            a.critical_fail AS criticalFail, a.finalized_at AS finalizedAt,
            p.template_code AS templateCode, p.template_name AS templateName,
            p.version_no AS versionNo, p.passing_pct AS passingPct
       FROM practical_assessment_assignment a
       INNER JOIN practical_assessment_template p ON p.template_id = a.template_id
      WHERE a.employee_id = ? ORDER BY a.assigned_at DESC`,
    String(req.userId),
  ));
  res.json({ ok: true, data: assignments });
}));

router.get('/me/assignments/:assignmentId', ...traineeAuth, requirePermission('practical.view_self'), route(async (req, res) => {
  const detail = await getAssignmentDetail(req.params.assignmentId);
  if (!detail || detail.employeeId !== String(req.userId)) return res.status(404).json({ ok: false, message: 'Assignment not found.' });
  res.json({ ok: true, data: learnerView(detail) });
}));

router.put('/me/assignments/:assignmentId/submission', ...traineeAuth, requirePermission('practical.submit_self'), route(async (req, res) => {
  const detail = await saveSubmission({
    assignmentId: req.params.assignmentId,
    employeeId: req.userId,
    learnerStatement: req.body?.learnerStatement,
    evidence: req.body?.evidence,
    submit: false,
  });
  await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'SAVE_PRACTICAL_SUBMISSION', module: 'PracticalAssessment', referenceId: req.params.assignmentId });
  res.json({ ok: true, message: 'Practical assessment draft saved.', data: learnerView(detail) });
}));

router.post('/me/assignments/:assignmentId/submit', ...traineeAuth, requirePermission('practical.submit_self'), route(async (req, res) => {
  const detail = await saveSubmission({
    assignmentId: req.params.assignmentId,
    employeeId: req.userId,
    learnerStatement: req.body?.learnerStatement,
    evidence: req.body?.evidence,
    submit: true,
  });
  await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'SUBMIT_PRACTICAL_ASSESSMENT', module: 'PracticalAssessment', referenceId: req.params.assignmentId });
  res.json({ ok: true, message: 'Practical assessment submitted for evaluation.', data: learnerView(detail) });
}));

async function workQueue(req, res, actorType) {
  const params = [];
  let scopeSql = '';
  if (actorType === 'coordinator') {
    scopeSql = ` AND b.coordinator_login_id = ?`;
    params.push(String(req.userId));
  } else if (!companyScope(req)) {
    scopeSql = ` AND a.branch = ?`;
    params.push(String(req.userBranch || ''));
  }
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.employee_id AS employeeId,
            t.trainee_name AS traineeName, a.batch_no AS batchNo, a.branch,
            a.process_name AS processName, a.lob_name AS lobName,
            a.status, a.attempt_no AS attemptNo, a.due_at AS dueAt,
            a.submitted_at AS submittedAt, a.final_percentage AS finalPercentage,
            a.final_result AS finalResult, p.template_name AS templateName,
            p.template_code AS templateCode, p.version_no AS versionNo,
            p.evaluator_count AS evaluatorCount, p.blind_evaluation AS blindEvaluation,
            COUNT(e.evaluation_id) AS claimedEvaluations,
            SUM(CASE WHEN e.status = 'SUBMITTED' THEN 1 ELSE 0 END) AS submittedEvaluations
       FROM practical_assessment_assignment a
       INNER JOIN practical_assessment_template p ON p.template_id = a.template_id
       LEFT JOIN trainee_master t ON t.employee_id = a.employee_id
       LEFT JOIN batch_master b ON b.batch_no = a.batch_no
       LEFT JOIN practical_evaluation e ON e.assignment_id = a.assignment_id
      WHERE 1=1${scopeSql}
      GROUP BY a.assignment_id, a.employee_id, t.trainee_name, a.batch_no, a.branch,
               a.process_name, a.lob_name, a.status, a.attempt_no, a.due_at,
               a.submitted_at, a.final_percentage, a.final_result, p.template_name,
               p.template_code, p.version_no, p.evaluator_count, p.blind_evaluation
      ORDER BY FIELD(a.status,'MODERATION_REQUIRED','SUBMITTED','EVALUATING','ASSIGNED','IN_PROGRESS','FAILED','PASSED','CANCELLED'),
               a.due_at, a.assigned_at DESC
      LIMIT 1000`,
    ...params,
  ));
  return res.json({ ok: true, data: rows });
}

async function scopedDetail(req, res, actorType) {
  await ensureAssignmentScope(req, req.params.assignmentId, actorType);
  const detail = await getAssignmentDetail(req.params.assignmentId);
  return res.json({ ok: true, data: hideBlindPeer(detail, req.userId, actorType) });
}

async function assign(req, res, actorType) {
  const employeeId = text(req.body?.employeeId, 120);
  if (!employeeId) return res.status(400).json({ ok: false, message: 'Employee ID is required.' });
  if (actorType === 'coordinator' && !await coordinatorOwnsEmployee(req.userId, employeeId)) {
    return res.status(404).json({ ok: false, message: 'Active learner not found in your owned batches.' });
  }
  if (actorType === 'admin' && !companyScope(req)) {
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId }, select: { branch: true } });
    if (!trainee || trainee.branch !== String(req.userBranch || '')) return res.status(404).json({ ok: false, message: 'Learner not found in your branch.' });
  }
  const detail = await createAssignment({
    templateId: text(req.body?.templateId, 36),
    employeeId,
    dueAt: date(req.body?.dueAt),
    actorId: req.userId,
    actorType,
    source: req.body || {},
  });
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'ASSIGN_PRACTICAL_ASSESSMENT', module: 'PracticalAssessment', referenceId: detail.assignmentId, newValue: { employeeId, templateId: detail.templateId } });
  return res.status(201).json({ ok: true, message: 'Practical assessment assigned.', data: detail });
}

async function claim(req, res, actorType) {
  await ensureAssignmentScope(req, req.params.assignmentId, actorType);
  const detail = await claimEvaluation({ assignmentId: req.params.assignmentId, evaluatorId: req.userId, evaluatorType: actorType });
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'CLAIM_PRACTICAL_EVALUATION', module: 'PracticalAssessment', referenceId: req.params.assignmentId });
  return res.json({ ok: true, message: 'Evaluator slot claimed.', data: hideBlindPeer(detail, req.userId, actorType) });
}

async function evaluate(req, res, actorType, submit) {
  const scoped = await ensureEvaluationScope(req, req.params.evaluationId, actorType);
  const detail = await saveEvaluation({
    evaluationId: req.params.evaluationId,
    evaluatorId: req.userId,
    evaluatorType: actorType,
    scores: req.body?.scores,
    summary: req.body?.summary,
    strengths: req.body?.strengths,
    developmentNotes: req.body?.developmentNotes,
    submit,
  });
  await audit({ userIdentity: req.userId, userRole: actorType, action: submit ? 'SUBMIT_PRACTICAL_EVALUATION' : 'SAVE_PRACTICAL_EVALUATION', module: 'PracticalAssessment', referenceId: scoped.assignmentId });
  return res.json({ ok: true, message: submit ? 'Evaluation submitted and locked.' : 'Evaluation draft saved.', data: hideBlindPeer(detail, req.userId, actorType) });
}

// Coordinator owned-batch workspace.
router.get('/coordinator/queue', ...coordinatorAuth, requirePermission('practical.evaluate_owned'), route((req, res) => workQueue(req, res, 'coordinator')));
router.get('/coordinator/assignments/:assignmentId', ...coordinatorAuth, requirePermission('practical.evaluate_owned'), route((req, res) => scopedDetail(req, res, 'coordinator')));
router.post('/coordinator/assignments', ...coordinatorAuth, requirePermission('practical.manage_scope'), route((req, res) => assign(req, res, 'coordinator')));
router.post('/coordinator/assignments/:assignmentId/claim', ...coordinatorAuth, requirePermission('practical.evaluate_owned'), route((req, res) => claim(req, res, 'coordinator')));
router.put('/coordinator/evaluations/:evaluationId', ...coordinatorAuth, requirePermission('practical.evaluate_owned'), route((req, res) => evaluate(req, res, 'coordinator', false)));
router.post('/coordinator/evaluations/:evaluationId/submit', ...coordinatorAuth, requirePermission('practical.evaluate_owned'), route((req, res) => evaluate(req, res, 'coordinator', true)));

// Administrator configuration, evaluation, moderation and reporting.
router.get('/admin/templates', ...adminAuth, requirePermission('practical.configure'), route(async (req, res) => {
  res.json({ ok: true, data: await listTemplatesForScope(req) });
}));
router.get('/admin/templates/:templateId', ...adminAuth, requirePermission('practical.configure'), route(async (req, res) => {
  const detail = await getTemplateDetail(req.params.templateId);
  if (!detail || (!companyScope(req) && detail.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Template not found.' });
  res.json({ ok: true, data: detail });
}));
router.post('/admin/templates', ...adminAuth, requirePermission('practical.configure'), route(async (req, res) => {
  const detail = await saveTemplateDraft(req);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_PRACTICAL_TEMPLATE', module: 'PracticalAssessment', referenceId: detail.templateId });
  res.status(201).json({ ok: true, message: 'Draft rubric template created.', data: detail });
}));
router.put('/admin/templates/:templateId', ...adminAuth, requirePermission('practical.configure'), route(async (req, res) => {
  const detail = await saveTemplateDraft(req, req.params.templateId);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_PRACTICAL_TEMPLATE', module: 'PracticalAssessment', referenceId: detail.templateId });
  res.json({ ok: true, message: 'Draft rubric template saved.', data: detail });
}));
router.post('/admin/templates/:templateId/publish', ...adminAuth, requirePermission('practical.configure'), route(async (req, res) => {
  const existing = await getTemplateDetail(req.params.templateId);
  if (!existing || (!companyScope(req) && existing.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Template not found.' });
  const detail = await publishTemplate(req.params.templateId, req.userId);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'PUBLISH_PRACTICAL_TEMPLATE', module: 'PracticalAssessment', referenceId: detail.templateId });
  res.json({ ok: true, message: 'Rubric version published and locked.', data: detail });
}));
router.post('/admin/templates/:templateId/version', ...adminAuth, requirePermission('practical.configure'), route(async (req, res) => {
  const existing = await getTemplateDetail(req.params.templateId);
  if (!existing || (!companyScope(req) && existing.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Template not found.' });
  const detail = await createTemplateVersion(req.params.templateId, req.userId);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'VERSION_PRACTICAL_TEMPLATE', module: 'PracticalAssessment', referenceId: detail.templateId, oldValue: { templateId: existing.templateId }, newValue: { versionNo: detail.versionNo } });
  res.status(201).json({ ok: true, message: 'New draft rubric version created.', data: detail });
}));
router.get('/admin/queue', ...adminAuth, requirePermission('practical.report'), route((req, res) => workQueue(req, res, 'admin')));
router.get('/admin/assignments/:assignmentId', ...adminAuth, requirePermission('practical.manage_scope'), route((req, res) => scopedDetail(req, res, 'admin')));
router.post('/admin/assignments', ...adminAuth, requirePermission('practical.manage_scope'), route((req, res) => assign(req, res, 'admin')));
router.post('/admin/assignments/:assignmentId/claim', ...adminAuth, requirePermission('practical.manage_scope'), route((req, res) => claim(req, res, 'admin')));
router.put('/admin/evaluations/:evaluationId', ...adminAuth, requirePermission('practical.manage_scope'), route((req, res) => evaluate(req, res, 'admin', false)));
router.post('/admin/evaluations/:evaluationId/submit', ...adminAuth, requirePermission('practical.manage_scope'), route((req, res) => evaluate(req, res, 'admin', true)));
router.post('/admin/moderation/:caseId/resolve', ...adminAuth, requirePermission('practical.moderate'), route(async (req, res) => {
  const caseRows = await prisma.$queryRawUnsafe(
    `SELECT m.assignment_id AS assignmentId FROM practical_moderation_case m WHERE m.case_id = ? LIMIT 1`,
    String(req.params.caseId),
  );
  if (!caseRows.length) return res.status(404).json({ ok: false, message: 'Moderation case not found.' });
  await ensureAssignmentScope(req, caseRows[0].assignmentId, 'admin');
  const detail = await resolveModeration({
    caseId: req.params.caseId,
    moderatorId: req.userId,
    moderatorType: 'admin',
    finalPercentage: req.body?.finalPercentage,
    finalResult: req.body?.finalResult,
    resolutionSummary: req.body?.resolutionSummary,
  });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESOLVE_PRACTICAL_MODERATION', module: 'PracticalAssessment', referenceId: detail.assignmentId, newValue: { finalPercentage: detail.finalPercentage, finalResult: detail.finalResult } });
  res.json({ ok: true, message: 'Moderation resolved and final result issued.', data: detail });
}));
router.get('/admin/report/summary', ...adminAuth, requirePermission('practical.report'), route(async (req, res) => {
  const params = [];
  let scopeSql = '';
  if (!companyScope(req)) {
    scopeSql = ` WHERE a.branch = ?`;
    params.push(String(req.userBranch || ''));
  }
  const [statusRows, templateRows, evaluatorRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT a.status, COUNT(*) AS count, AVG(a.final_percentage) AS averagePercentage
         FROM practical_assessment_assignment a${scopeSql}
        GROUP BY a.status`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT p.template_id AS templateId, p.template_name AS templateName,
              p.version_no AS versionNo, COUNT(a.assignment_id) AS assigned,
              SUM(CASE WHEN a.status = 'PASSED' THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN a.status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
              AVG(a.final_percentage) AS averagePercentage
         FROM practical_assessment_template p
         LEFT JOIN practical_assessment_assignment a ON a.template_id = p.template_id
        ${scopeSql ? `WHERE p.audience_branch = ?` : ''}
        GROUP BY p.template_id, p.template_name, p.version_no
        ORDER BY assigned DESC`,
      ...(scopeSql ? [String(req.userBranch || '')] : []),
    ),
    prisma.$queryRawUnsafe(
      `SELECT e.evaluator_id AS evaluatorId, e.evaluator_type AS evaluatorType,
              COUNT(*) AS evaluations,
              AVG(e.percentage) AS averagePercentage,
              SUM(CASE WHEN e.status = 'SUBMITTED' THEN 1 ELSE 0 END) AS submitted
         FROM practical_evaluation e
         INNER JOIN practical_assessment_assignment a ON a.assignment_id = e.assignment_id
        ${scopeSql}
        GROUP BY e.evaluator_id, e.evaluator_type
        ORDER BY evaluations DESC LIMIT 200`,
      ...params,
    ),
  ]);
  res.json({ ok: true, data: normalize({ statuses: statusRows, templates: templateRows, evaluators: evaluatorRows }) });
}));

export default router;
