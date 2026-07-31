import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  assignCalibration,
  expireEvaluatorAuthorizations,
  getCalibrationAssignment,
  getCalibrationProgram,
  normalizeCalibration,
  publishCalibrationProgram,
  saveCalibrationSubmission,
} from '../services/calibrationGovernance.js';
import { calculateReliabilitySnapshots } from '../services/calibrationReliability.js';

const router = Router();
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[CALIBRATION] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        code: error.code || 'CALIBRATION_ERROR',
        message: status >= 500 ? 'Evaluator-quality service failed.' : error.message,
        details: status < 500 ? error.details || null : null,
      });
    }
  };
}

function text(value, max = 20000) {
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

async function programInScope(req, programId) {
  const program = await getCalibrationProgram(programId);
  if (!program) return null;
  if (!companyScope(req) && program.audienceBranch !== String(req.userBranch || '')) return null;
  return program;
}

async function assignmentForSelf(req, assignmentId, evaluatorType) {
  const detail = await getCalibrationAssignment(assignmentId);
  if (!detail || detail.evaluatorId !== String(req.userId) || detail.evaluatorType !== evaluatorType) return null;
  return detail;
}

async function selfDashboard(req, res, evaluatorType) {
  await expireEvaluatorAuthorizations('self-dashboard');
  const [assignments, authorizations, reliability, actions] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT a.assignment_id AS assignmentId, a.status, a.attempt_no AS attemptNo,
              a.assigned_at AS assignedAt, a.due_at AS dueAt,
              a.score_pct AS scorePct, a.agreement_pct AS agreementPct,
              a.critical_agreement_pct AS criticalAgreementPct,
              a.result, a.valid_until AS validUntil,
              p.program_code AS programCode, p.program_name AS programName,
              t.template_name AS templateName, t.version_no AS templateVersion
         FROM evaluator_calibration_assignment a
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
         INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
        WHERE a.evaluator_id = ? AND a.evaluator_type = ?
        ORDER BY a.assigned_at DESC LIMIT 200`,
      String(req.userId), evaluatorType,
    ),
    prisma.$queryRawUnsafe(
      `SELECT a.authorization_id AS authorizationId, a.status,
              a.calibration_score_pct AS calibrationScorePct,
              a.authorized_at AS authorizedAt, a.valid_until AS validUntil,
              a.suspension_reason AS suspensionReason,
              a.revocation_reason AS revocationReason,
              t.template_id AS templateId, t.template_name AS templateName,
              t.version_no AS templateVersion
         FROM evaluator_authorization a
         INNER JOIN practical_assessment_template t ON t.template_id = a.template_id
        WHERE a.evaluator_id = ? AND a.evaluator_type = ?
        ORDER BY a.valid_until DESC`,
      String(req.userId), evaluatorType,
    ),
    prisma.$queryRawUnsafe(
      `SELECT s.snapshot_id AS snapshotId, s.period_start AS periodStart,
              s.period_end AS periodEnd, s.evaluation_count AS evaluationCount,
              s.paired_evaluation_count AS pairedEvaluationCount,
              s.average_score_pct AS averageScorePct,
              s.mean_absolute_difference AS meanAbsoluteDifference,
              s.agreement_within_five_pct AS agreementWithinFivePct,
              s.critical_agreement_pct AS criticalAgreementPct,
              s.moderation_rate_pct AS moderationRatePct,
              s.severity_index AS severityIndex,
              s.reliability_status AS reliabilityStatus,
              s.bias_flag AS biasFlag, t.template_name AS templateName,
              t.version_no AS templateVersion
         FROM evaluator_reliability_snapshot s
         INNER JOIN practical_assessment_template t ON t.template_id = s.template_id
        WHERE s.evaluator_id = ? AND s.evaluator_type = ?
        ORDER BY s.period_end DESC, t.template_name LIMIT 100`,
      String(req.userId), evaluatorType,
    ),
    prisma.$queryRawUnsafe(
      `SELECT q.action_id AS actionId, q.action_type AS actionType,
              q.priority, q.status, q.reason, q.assigned_at AS assignedAt,
              q.due_at AS dueAt, q.completed_at AS completedAt,
              q.completion_notes AS completionNotes,
              t.template_name AS templateName, t.version_no AS templateVersion
         FROM evaluator_quality_action q
         LEFT JOIN practical_assessment_template t ON t.template_id = q.template_id
        WHERE q.evaluator_id = ? AND q.evaluator_type = ?
        ORDER BY FIELD(q.status,'OPEN','IN_PROGRESS','COMPLETED','CANCELLED'), q.due_at, q.assigned_at DESC`,
      String(req.userId), evaluatorType,
    ),
  ]);
  res.json({ ok: true, data: normalizeCalibration({ assignments, authorizations, reliability, actions }) });
}

router.get('/coordinator/me', ...coordinatorAuth, requirePermission('calibration.view_self'), route((req, res) => selfDashboard(req, res, 'coordinator')));
router.get('/admin/me', ...adminAuth, requirePermission('calibration.view_self'), route((req, res) => selfDashboard(req, res, 'admin')));

async function assignmentDetail(req, res, evaluatorType) {
  const detail = await assignmentForSelf(req, req.params.assignmentId, evaluatorType);
  if (!detail) return res.status(404).json({ ok: false, message: 'Calibration assignment not found.' });
  return res.json({ ok: true, data: detail });
}

async function submitAssignment(req, res, evaluatorType, submit) {
  const existing = await assignmentForSelf(req, req.params.assignmentId, evaluatorType);
  if (!existing) return res.status(404).json({ ok: false, message: 'Calibration assignment not found.' });
  const detail = await saveCalibrationSubmission({
    assignmentId: req.params.assignmentId,
    evaluatorId: req.userId,
    evaluatorType,
    responses: req.body?.responses,
    submit,
  });
  await audit({
    userIdentity: req.userId,
    userRole: evaluatorType,
    action: submit ? 'SUBMIT_EVALUATOR_CALIBRATION' : 'SAVE_EVALUATOR_CALIBRATION',
    module: 'EvaluatorQuality',
    referenceId: detail.assignmentId,
    newValue: submit ? { result: detail.result, scorePct: detail.scorePct, agreementPct: detail.agreementPct } : null,
  });
  return res.json({ ok: true, message: submit ? `Calibration submitted: ${detail.result}.` : 'Calibration draft saved.', data: detail });
}

router.get('/coordinator/assignments/:assignmentId', ...coordinatorAuth, requirePermission('calibration.view_self'), route((req, res) => assignmentDetail(req, res, 'coordinator')));
router.put('/coordinator/assignments/:assignmentId', ...coordinatorAuth, requirePermission('calibration.submit_self'), route((req, res) => submitAssignment(req, res, 'coordinator', false)));
router.post('/coordinator/assignments/:assignmentId/submit', ...coordinatorAuth, requirePermission('calibration.submit_self'), route((req, res) => submitAssignment(req, res, 'coordinator', true)));
router.get('/admin/assignments/:assignmentId/self', ...adminAuth, requirePermission('calibration.view_self'), route((req, res) => assignmentDetail(req, res, 'admin')));
router.put('/admin/assignments/:assignmentId/self', ...adminAuth, requirePermission('calibration.submit_self'), route((req, res) => submitAssignment(req, res, 'admin', false)));
router.post('/admin/assignments/:assignmentId/self/submit', ...adminAuth, requirePermission('calibration.submit_self'), route((req, res) => submitAssignment(req, res, 'admin', true)));

async function saveProgram(req, programId = null) {
  const body = req.body || {};
  const programCode = text(body.programCode, 100).toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
  const programName = text(body.programName, 220);
  const templateId = text(body.templateId, 36);
  if (!programCode || !programName || !templateId) throw Object.assign(new Error('Program code, name and rubric version are required.'), { status: 400 });
  const anchors = Array.isArray(body.anchors) ? body.anchors.slice(0, 100) : [];
  if (!anchors.length) throw Object.assign(new Error('Add at least one anchor case.'), { status: 400 });
  const branch = companyScope(req) ? text(body.audienceBranch, 120) : String(req.userBranch || '');

  return prisma.$transaction(async tx => {
    const templateRows = await tx.$queryRawUnsafe(
      `SELECT template_id AS templateId, status, audience_branch AS audienceBranch
         FROM practical_assessment_template WHERE template_id = ? LIMIT 1`,
      templateId,
    );
    const template = normalizeCalibration(templateRows[0] || null);
    if (!template || template.status !== 'PUBLISHED') throw Object.assign(new Error('Select a published practical rubric version.'), { status: 409 });
    if (!companyScope(req) && template.audienceBranch && template.audienceBranch !== String(req.userBranch || '')) {
      throw Object.assign(new Error('Rubric version is outside your branch scope.'), { status: 404 });
    }
    let targetId = programId;
    if (targetId) {
      const rows = await tx.$queryRawUnsafe(
        `SELECT program_id AS programId, status, audience_branch AS audienceBranch
           FROM evaluator_calibration_program WHERE program_id = ? LIMIT 1 FOR UPDATE`,
        String(targetId),
      );
      const existing = normalizeCalibration(rows[0] || null);
      if (!existing || (!companyScope(req) && existing.audienceBranch !== String(req.userBranch || ''))) throw Object.assign(new Error('Calibration program not found.'), { status: 404 });
      if (existing.status !== 'DRAFT') throw Object.assign(new Error('Published calibration programs are immutable.'), { status: 409 });
      await tx.$executeRawUnsafe(
        `UPDATE evaluator_calibration_program
            SET program_code = ?, program_name = ?, template_id = ?, description = ?,
                evaluator_instructions = ?, audience_branch = ?, audience_process = ?,
                audience_lob = ?, passing_pct = ?, min_anchor_cases = ?, max_attempts = ?,
                authorization_valid_days = ?, default_score_tolerance = ?,
                minimum_agreement_pct = ?, maximum_severity_index = ?
          WHERE program_id = ?`,
        programCode, programName, templateId, text(body.description) || null,
        text(body.evaluatorInstructions) || null, branch, text(body.audienceProcess, 120),
        text(body.audienceLob, 120), number(body.passingPct, 85, 0, 100),
        Math.round(number(body.minAnchorCases, 2, 1, 100)),
        Math.round(number(body.maxAttempts, 3, 1, 20)),
        Math.round(number(body.authorizationValidDays, 180, 1, 3650)),
        number(body.defaultScoreTolerance, 1, 0, 10000),
        number(body.minimumAgreementPct, 80, 0, 100),
        number(body.maximumSeverityIndex, 8, 0, 100), String(targetId),
      );
      await tx.$executeRawUnsafe(`DELETE FROM evaluator_calibration_anchor WHERE program_id = ?`, String(targetId));
    } else {
      targetId = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_calibration_program
           (program_id, program_code, program_name, template_id, description,
            evaluator_instructions, audience_branch, audience_process, audience_lob,
            passing_pct, min_anchor_cases, max_attempts, authorization_valid_days,
            default_score_tolerance, minimum_agreement_pct, maximum_severity_index,
            status, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?)`,
        targetId, programCode, programName, templateId, text(body.description) || null,
        text(body.evaluatorInstructions) || null, branch, text(body.audienceProcess, 120),
        text(body.audienceLob, 120), number(body.passingPct, 85, 0, 100),
        Math.round(number(body.minAnchorCases, 2, 1, 100)),
        Math.round(number(body.maxAttempts, 3, 1, 20)),
        Math.round(number(body.authorizationValidDays, 180, 1, 3650)),
        number(body.defaultScoreTolerance, 1, 0, 10000),
        number(body.minimumAgreementPct, 80, 0, 100),
        number(body.maximumSeverityIndex, 8, 0, 100), String(req.userId),
      );
    }

    const validCriteria = normalizeCalibration(await tx.$queryRawUnsafe(
      `SELECT c.criterion_id AS criterionId, c.max_score AS maxScore
         FROM practical_rubric_criterion c
         INNER JOIN practical_rubric_section s ON s.section_id = c.section_id
        WHERE s.template_id = ?`,
      templateId,
    ));
    const criterionMap = new Map(validCriteria.map(item => [item.criterionId, item]));
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] || {};
      const title = text(anchor.anchorTitle, 240);
      const scenario = text(anchor.scenarioDescription);
      if (!title || !scenario) continue;
      const anchorId = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_calibration_anchor
           (anchor_id, program_id, anchor_code, anchor_title,
            scenario_description, evidence_reference, evidence_url,
            evaluator_notes, sort_order, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        anchorId, String(targetId), text(anchor.anchorCode, 100).toUpperCase() || `ANCHOR-${index + 1}`,
        title, scenario, text(anchor.evidenceReference, 500) || null,
        text(anchor.evidenceUrl, 4000) || null, text(anchor.evaluatorNotes) || null,
        Math.round(number(anchor.sortOrder, index + 1, 1, 10000)), bool(anchor.active, true) ? 1 : 0,
      );
      const scores = Array.isArray(anchor.expectedScores) ? anchor.expectedScores.slice(0, 500) : [];
      for (const item of scores) {
        const criterion = criterionMap.get(text(item.criterionId, 36));
        if (!criterion) continue;
        const expectedScore = number(item.expectedScore, 0, 0, number(criterion.maxScore));
        await tx.$executeRawUnsafe(
          `INSERT INTO evaluator_calibration_expected_score
             (expected_score_id, anchor_id, criterion_id, expected_score,
              tolerance, expected_critical_fail, rationale)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(), anchorId, criterion.criterionId, expectedScore,
          number(item.tolerance, number(body.defaultScoreTolerance, 1), 0, number(criterion.maxScore)),
          bool(item.expectedCriticalFail) ? 1 : 0, text(item.rationale) || null,
        );
      }
    }
    return getCalibrationProgram(targetId, tx);
  });
}

router.get('/admin/catalog', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const params = [];
  let templateScope = '';
  let evaluatorScope = '';
  if (!companyScope(req)) {
    templateScope = ` AND (t.audience_branch = '' OR t.audience_branch = ?)`;
    evaluatorScope = ` AND r.branch = ?`;
    params.push(String(req.userBranch || ''));
  }
  const [templates, evaluators] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT t.template_id AS templateId, t.template_code AS templateCode,
              t.template_name AS templateName, t.version_no AS versionNo,
              t.audience_branch AS audienceBranch, t.audience_process AS audienceProcess,
              t.audience_lob AS audienceLob
         FROM practical_assessment_template t
        WHERE t.status = 'PUBLISHED' AND t.active = 1${templateScope}
        ORDER BY t.template_name, t.version_no DESC`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT r.login_id AS evaluatorId,
              CASE WHEN r.portal_access = 'Admin' THEN 'admin' ELSE 'coordinator' END AS evaluatorType,
              r.name, r.role, r.portal_access AS portalAccess, r.branch, r.process, r.lob
         FROM role_access_matrix r
        WHERE r.active = 1 AND r.portal_access IN ('Admin','Coordinator')${evaluatorScope}
        ORDER BY r.branch, r.name, r.login_id LIMIT 5000`,
      ...params,
    ),
  ]);
  res.json({ ok: true, data: normalizeCalibration({ templates, evaluators }) });
}));

router.get('/admin/programs', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const params = [];
  let scopeSql = '';
  if (!companyScope(req)) {
    scopeSql = ` WHERE p.audience_branch = ?`;
    params.push(String(req.userBranch || ''));
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT p.program_id AS programId, p.program_code AS programCode,
            p.program_name AS programName, p.status, p.active,
            p.passing_pct AS passingPct, p.min_anchor_cases AS minAnchorCases,
            p.authorization_valid_days AS authorizationValidDays,
            p.minimum_agreement_pct AS minimumAgreementPct,
            p.maximum_severity_index AS maximumSeverityIndex,
            p.audience_branch AS audienceBranch, p.published_at AS publishedAt,
            t.template_name AS templateName, t.version_no AS templateVersion,
            COUNT(DISTINCT a.anchor_id) AS anchorCount
       FROM evaluator_calibration_program p
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
       LEFT JOIN evaluator_calibration_anchor a ON a.program_id = p.program_id AND a.active = 1
      ${scopeSql}
      GROUP BY p.program_id, p.program_code, p.program_name, p.status, p.active,
               p.passing_pct, p.min_anchor_cases, p.authorization_valid_days,
               p.minimum_agreement_pct, p.maximum_severity_index,
               p.audience_branch, p.published_at, t.template_name, t.version_no
      ORDER BY FIELD(p.status,'DRAFT','PUBLISHED','CLOSED'), p.updated_at DESC`,
    ...params,
  );
  res.json({ ok: true, data: normalizeCalibration(rows) });
}));

router.get('/admin/programs/:programId', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const program = await programInScope(req, req.params.programId);
  if (!program) return res.status(404).json({ ok: false, message: 'Calibration program not found.' });
  res.json({ ok: true, data: program });
}));

router.post('/admin/programs', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const program = await saveProgram(req);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_CALIBRATION_PROGRAM', module: 'EvaluatorQuality', referenceId: program.programId });
  res.status(201).json({ ok: true, message: 'Draft calibration program created.', data: program });
}));

router.put('/admin/programs/:programId', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const existing = await programInScope(req, req.params.programId);
  if (!existing) return res.status(404).json({ ok: false, message: 'Calibration program not found.' });
  const program = await saveProgram(req, req.params.programId);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_CALIBRATION_PROGRAM', module: 'EvaluatorQuality', referenceId: program.programId });
  res.json({ ok: true, message: 'Calibration program saved.', data: program });
}));

router.post('/admin/programs/:programId/publish', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const existing = await programInScope(req, req.params.programId);
  if (!existing) return res.status(404).json({ ok: false, message: 'Calibration program not found.' });
  const program = await publishCalibrationProgram(req.params.programId, req.userId);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'PUBLISH_CALIBRATION_PROGRAM', module: 'EvaluatorQuality', referenceId: program.programId });
  res.json({ ok: true, message: 'Calibration program published and locked.', data: program });
}));

router.post('/admin/assignments', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const program = await programInScope(req, text(req.body?.programId, 36));
  if (!program || program.status !== 'PUBLISHED') return res.status(404).json({ ok: false, message: 'Published calibration program not found.' });
  const evaluatorId = text(req.body?.evaluatorId, 120);
  const evaluatorType = text(req.body?.evaluatorType, 30);
  if (!['coordinator', 'admin'].includes(evaluatorType) || !evaluatorId) return res.status(400).json({ ok: false, message: 'Evaluator identity and type are required.' });
  const evaluator = await prisma.roleAccessMatrix.findFirst({
    where: {
      loginId: evaluatorId,
      active: true,
      portalAccess: evaluatorType === 'admin' ? 'Admin' : 'Coordinator',
      ...(!companyScope(req) ? { branch: String(req.userBranch || '') } : {}),
    },
    select: { loginId: true },
  });
  if (!evaluator) return res.status(404).json({ ok: false, message: 'Active evaluator not found in your scope.' });
  const assignment = await assignCalibration({
    programId: program.programId,
    evaluatorId,
    evaluatorType,
    dueAt: date(req.body?.dueAt),
    actorId: req.userId,
  });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ASSIGN_EVALUATOR_CALIBRATION', module: 'EvaluatorQuality', referenceId: assignment.assignmentId, newValue: { evaluatorId, evaluatorType, programId: program.programId } });
  res.status(201).json({ ok: true, message: 'Calibration assigned.', data: assignment });
}));

router.get('/admin/dashboard', ...adminAuth, requirePermission('calibration.report'), route(async (req, res) => {
  await expireEvaluatorAuthorizations('admin-dashboard');
  const params = [];
  let scopeProgram = '';
  let scopeRole = '';
  if (!companyScope(req)) {
    scopeProgram = ` AND p.audience_branch = ?`;
    scopeRole = ` AND r.branch = ?`;
    params.push(String(req.userBranch || ''));
  }
  const [assignments, authorizations, reliability, pairs, actions] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT a.assignment_id AS assignmentId, a.evaluator_id AS evaluatorId,
              a.evaluator_type AS evaluatorType, a.status, a.attempt_no AS attemptNo,
              a.due_at AS dueAt, a.score_pct AS scorePct,
              a.agreement_pct AS agreementPct, a.critical_agreement_pct AS criticalAgreementPct,
              a.result, p.program_name AS programName, t.template_name AS templateName,
              t.version_no AS templateVersion, r.name AS evaluatorName
         FROM evaluator_calibration_assignment a
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
         INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
         LEFT JOIN role_access_matrix r ON r.login_id = a.evaluator_id
        WHERE 1=1${scopeProgram}
        ORDER BY FIELD(a.status,'ASSIGNED','IN_PROGRESS','FAILED','PASSED','EXPIRED','CANCELLED'), a.due_at, a.assigned_at DESC
        LIMIT 2000`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT a.authorization_id AS authorizationId, a.evaluator_id AS evaluatorId,
              a.evaluator_type AS evaluatorType, a.status,
              a.calibration_score_pct AS calibrationScorePct,
              a.authorized_at AS authorizedAt, a.valid_until AS validUntil,
              a.suspension_reason AS suspensionReason,
              a.revocation_reason AS revocationReason,
              t.template_id AS templateId, t.template_name AS templateName,
              t.version_no AS templateVersion, r.name AS evaluatorName
         FROM evaluator_authorization a
         INNER JOIN practical_assessment_template t ON t.template_id = a.template_id
         LEFT JOIN evaluator_calibration_program p ON p.program_id = a.program_id
         LEFT JOIN role_access_matrix r ON r.login_id = a.evaluator_id
        WHERE 1=1${scopeProgram}
        ORDER BY FIELD(a.status,'SUSPENDED','EXPIRED','REVOKED','ACTIVE'), a.valid_until
        LIMIT 3000`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT s.snapshot_id AS snapshotId, s.evaluator_id AS evaluatorId,
              s.evaluator_type AS evaluatorType, s.period_start AS periodStart,
              s.period_end AS periodEnd, s.evaluation_count AS evaluationCount,
              s.paired_evaluation_count AS pairedEvaluationCount,
              s.average_score_pct AS averageScorePct,
              s.mean_absolute_difference AS meanAbsoluteDifference,
              s.agreement_within_five_pct AS agreementWithinFivePct,
              s.critical_agreement_pct AS criticalAgreementPct,
              s.moderation_rate_pct AS moderationRatePct,
              s.severity_index AS severityIndex,
              s.reliability_status AS reliabilityStatus, s.bias_flag AS biasFlag,
              t.template_name AS templateName, t.version_no AS templateVersion,
              r.name AS evaluatorName
         FROM evaluator_reliability_snapshot s
         INNER JOIN practical_assessment_template t ON t.template_id = s.template_id
         LEFT JOIN evaluator_calibration_program p ON p.template_id = s.template_id AND p.status = 'PUBLISHED' AND p.active = 1
         LEFT JOIN role_access_matrix r ON r.login_id = s.evaluator_id
        WHERE 1=1${scopeProgram}
        ORDER BY s.period_end DESC, FIELD(s.reliability_status,'RECALIBRATION_REQUIRED','WATCH','RELIABLE','INSUFFICIENT_DATA')
        LIMIT 5000`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT x.pair_id AS pairId, x.period_start AS periodStart,
              x.period_end AS periodEnd, x.paired_count AS pairedCount,
              x.mean_absolute_difference AS meanAbsoluteDifference,
              x.agreement_within_five_pct AS agreementWithinFivePct,
              x.critical_agreement_pct AS criticalAgreementPct,
              x.moderation_rate_pct AS moderationRatePct,
              x.evaluator_a_id AS evaluatorAId, x.evaluator_a_type AS evaluatorAType,
              x.evaluator_b_id AS evaluatorBId, x.evaluator_b_type AS evaluatorBType,
              t.template_name AS templateName, t.version_no AS templateVersion
         FROM evaluator_reliability_pair x
         INNER JOIN practical_assessment_template t ON t.template_id = x.template_id
         LEFT JOIN evaluator_calibration_program p ON p.template_id = x.template_id AND p.status = 'PUBLISHED' AND p.active = 1
        WHERE 1=1${scopeProgram}
        ORDER BY x.period_end DESC, x.paired_count DESC LIMIT 5000`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT q.action_id AS actionId, q.evaluator_id AS evaluatorId,
              q.evaluator_type AS evaluatorType, q.action_type AS actionType,
              q.priority, q.status, q.reason, q.assigned_at AS assignedAt,
              q.due_at AS dueAt, q.completed_at AS completedAt,
              q.completion_notes AS completionNotes,
              t.template_name AS templateName, t.version_no AS templateVersion,
              r.name AS evaluatorName
         FROM evaluator_quality_action q
         LEFT JOIN practical_assessment_template t ON t.template_id = q.template_id
         LEFT JOIN evaluator_calibration_program p ON p.template_id = q.template_id AND p.status = 'PUBLISHED' AND p.active = 1
         LEFT JOIN role_access_matrix r ON r.login_id = q.evaluator_id
        WHERE 1=1${scopeProgram}
        ORDER BY FIELD(q.status,'OPEN','IN_PROGRESS','COMPLETED','CANCELLED'), FIELD(q.priority,'CRITICAL','HIGH','NORMAL','LOW'), q.due_at
        LIMIT 3000`,
      ...params,
    ),
  ]);
  res.json({ ok: true, data: normalizeCalibration({ assignments, authorizations, reliability, pairs, actions, scope: companyScope(req) ? 'company' : 'branch' }) });
}));

router.post('/admin/reliability/run', ...adminAuth, requirePermission('calibration.report'), route(async (req, res) => {
  const end = date(req.body?.periodEnd) || new Date();
  const start = date(req.body?.periodStart) || new Date(end.getTime() - 29 * 86400000);
  const result = await calculateReliabilitySnapshots({ periodStart: start, periodEnd: end, actorId: req.userId });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RUN_EVALUATOR_RELIABILITY', module: 'EvaluatorQuality', referenceId: `${start.toISOString().slice(0,10)}:${end.toISOString().slice(0,10)}`, newValue: result });
  res.json({ ok: true, message: 'Reliability snapshots recalculated.', data: result });
}));

async function authorizationAction(req, res, nextStatus) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT a.authorization_id AS authorizationId, a.status,
            p.audience_branch AS audienceBranch
       FROM evaluator_authorization a
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
      WHERE a.authorization_id = ? LIMIT 1`,
    String(req.params.authorizationId),
  );
  const item = normalizeCalibration(rows[0] || null);
  if (!item || (!companyScope(req) && item.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Evaluator authorization not found.' });
  const reason = text(req.body?.reason, 20000);
  if (['SUSPENDED', 'REVOKED'].includes(nextStatus) && reason.length < 20) return res.status(400).json({ ok: false, message: 'Provide an audited reason of at least 20 characters.' });
  if (nextStatus === 'ACTIVE') {
    const validUntil = date(req.body?.validUntil);
    if (!validUntil || validUntil <= new Date()) return res.status(400).json({ ok: false, message: 'A future authorization validity date is required.' });
    await prisma.$executeRawUnsafe(
      `UPDATE evaluator_authorization
          SET status = 'ACTIVE', valid_until = ?, suspended_by = NULL,
              suspended_at = NULL, suspension_reason = NULL,
              revoked_by = NULL, revoked_at = NULL, revocation_reason = NULL
        WHERE authorization_id = ?`,
      validUntil, String(item.authorizationId),
    );
  } else if (nextStatus === 'SUSPENDED') {
    await prisma.$executeRawUnsafe(
      `UPDATE evaluator_authorization
          SET status = 'SUSPENDED', suspended_by = ?, suspended_at = UTC_TIMESTAMP(3),
              suspension_reason = ? WHERE authorization_id = ?`,
      String(req.userId), reason, String(item.authorizationId),
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE evaluator_authorization
          SET status = 'REVOKED', revoked_by = ?, revoked_at = UTC_TIMESTAMP(3),
              revocation_reason = ? WHERE authorization_id = ?`,
      String(req.userId), reason, String(item.authorizationId),
    );
  }
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: `${nextStatus}_EVALUATOR_AUTHORIZATION`, module: 'EvaluatorQuality', referenceId: item.authorizationId, oldValue: { status: item.status }, newValue: { status: nextStatus, reason } });
  return res.json({ ok: true, message: `Evaluator authorization ${nextStatus.toLowerCase()}.` });
}

router.post('/admin/authorizations/:authorizationId/suspend', ...adminAuth, requirePermission('calibration.authorize'), route((req, res) => authorizationAction(req, res, 'SUSPENDED')));
router.post('/admin/authorizations/:authorizationId/revoke', ...adminAuth, requirePermission('calibration.authorize'), route((req, res) => authorizationAction(req, res, 'REVOKED')));
router.post('/admin/authorizations/:authorizationId/restore', ...adminAuth, requirePermission('calibration.authorize'), route((req, res) => authorizationAction(req, res, 'ACTIVE')));

router.post('/admin/actions/:actionId/complete', ...adminAuth, requirePermission('calibration.action'), route(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT q.action_id AS actionId, q.status, p.audience_branch AS audienceBranch
       FROM evaluator_quality_action q
       LEFT JOIN evaluator_calibration_program p ON p.template_id = q.template_id AND p.status = 'PUBLISHED' AND p.active = 1
      WHERE q.action_id = ? LIMIT 1`,
    String(req.params.actionId),
  );
  const item = normalizeCalibration(rows[0] || null);
  if (!item || (!companyScope(req) && item.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Evaluator quality action not found.' });
  if (!['OPEN', 'IN_PROGRESS'].includes(item.status)) return res.status(409).json({ ok: false, message: 'Quality action is already closed.' });
  const notes = text(req.body?.completionNotes, 20000);
  if (notes.length < 20) return res.status(400).json({ ok: false, message: 'Completion notes must contain at least 20 characters.' });
  await prisma.$executeRawUnsafe(
    `UPDATE evaluator_quality_action
        SET status = 'COMPLETED', completed_by = ?, completed_at = UTC_TIMESTAMP(3),
            completion_notes = ? WHERE action_id = ?`,
    String(req.userId), notes, String(item.actionId),
  );
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'COMPLETE_EVALUATOR_QUALITY_ACTION', module: 'EvaluatorQuality', referenceId: item.actionId, newValue: { completionNotes: notes } });
  res.json({ ok: true, message: 'Evaluator quality action completed.' });
}));

export default router;
