import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  getDevelopmentSnapshot,
  issueRenewedCertification,
  syncCertificationLifecycleForEmployee,
  syncCoachingPlan,
} from '../services/developmentGovernance.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];
const PLAN_STATUSES = new Set(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
const GOAL_STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'CANCELLED']);
const SESSION_STATUSES = new Set(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'MISSED']);

function text(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function number(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), max) : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function dateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function companyScope(req) {
  return req.permissionScope === 'company' || !req.userBranch;
}

async function ownedBatch(batchNo, coordinatorId) {
  return prisma.batchMaster.findFirst({ where: { batchNo, coordinatorLoginId: coordinatorId } });
}

async function scopedPlan(planId, req, actorType) {
  const rows = actorType === 'coordinator'
    ? await prisma.$queryRawUnsafe(
        `SELECT cp.plan_id AS planId, cp.employee_id AS employeeId,
                cp.batch_no AS batchNo, cp.branch, cp.status
           FROM coaching_plan cp
           INNER JOIN batch_master bm ON bm.batch_no = cp.batch_no
          WHERE cp.plan_id = ? AND bm.coordinator_login_id = ? LIMIT 1`,
        String(planId), String(req.userId),
      )
    : await prisma.$queryRawUnsafe(
        `SELECT plan_id AS planId, employee_id AS employeeId,
                batch_no AS batchNo, branch, status
           FROM coaching_plan WHERE plan_id = ? LIMIT 1`,
        String(planId),
      );
  const plan = rows[0] || null;
  if (!plan) return null;
  if (actorType === 'admin' && !companyScope(req) && String(plan.branch || '') !== String(req.userBranch || '')) return null;
  return plan;
}

async function scopedRenewalCase(caseId, req, actorType) {
  const rows = actorType === 'coordinator'
    ? await prisma.$queryRawUnsafe(
        `SELECT crc.case_id AS caseId, crc.employee_id AS employeeId,
                crc.status, ec.batch_no AS batchNo, ec.branch
           FROM certification_renewal_case crc
           INNER JOIN employee_certification ec ON ec.certification_id = crc.certification_id
           INNER JOIN batch_master bm ON bm.batch_no = ec.batch_no
          WHERE crc.case_id = ? AND bm.coordinator_login_id = ? LIMIT 1`,
        String(caseId), String(req.userId),
      )
    : await prisma.$queryRawUnsafe(
        `SELECT crc.case_id AS caseId, crc.employee_id AS employeeId,
                crc.status, ec.batch_no AS batchNo, ec.branch
           FROM certification_renewal_case crc
           INNER JOIN employee_certification ec ON ec.certification_id = crc.certification_id
          WHERE crc.case_id = ? LIMIT 1`,
        String(caseId),
      );
  const row = rows[0] || null;
  if (!row) return null;
  if (actorType === 'admin' && !companyScope(req) && String(row.branch || '') !== String(req.userBranch || '')) return null;
  return row;
}

async function createPlan(req, res, actorType) {
  const employeeId = text(req.body?.employeeId, 120);
  const title = text(req.body?.title, 200);
  const batchNo = text(req.params.batchNo || req.body?.batchNo, 120);
  if (!employeeId || !title) return res.status(400).json({ ok: false, message: 'Employee ID and plan title are required.' });

  let batch = null;
  if (actorType === 'coordinator') {
    batch = await ownedBatch(batchNo, req.userId);
    if (!batch) return res.status(404).json({ ok: false, message: 'Owned batch not found.' });
  } else if (batchNo) {
    batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch || (!companyScope(req) && String(batch.branch || '') !== String(req.userBranch || ''))) {
      return res.status(404).json({ ok: false, message: 'Batch not found in your scope.' });
    }
  }

  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
  if (!trainee || trainee.status !== 'Active') return res.status(404).json({ ok: false, message: 'Active employee not found.' });
  if (batchNo && trainee.batchNo !== batchNo) return res.status(409).json({ ok: false, message: 'Employee does not belong to this batch.' });
  if (actorType === 'admin' && !companyScope(req) && String(trainee.branch || '') !== String(req.userBranch || '')) {
    return res.status(404).json({ ok: false, message: 'Employee not found in your scope.' });
  }

  const planId = randomUUID();
  const status = bool(req.body?.activate, true) ? 'ACTIVE' : 'DRAFT';
  const priority = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(text(req.body?.priority, 20).toUpperCase())
    ? text(req.body.priority, 20).toUpperCase()
    : 'MEDIUM';
  await prisma.$executeRawUnsafe(
    `INSERT INTO coaching_plan
       (plan_id, employee_id, batch_no, branch, process_name, lob_name,
        title, reason_code, source, priority, status, start_at, due_at,
        success_criteria, owner_id, owner_type, created_by, activated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    planId, employeeId, trainee.batchNo, trainee.branch, trainee.process, trainee.lob,
    title, text(req.body?.reasonCode, 60) || 'DEVELOPMENT', text(req.body?.source, 60) || 'MANUAL',
    priority, status, dateOrNull(req.body?.startAt) || new Date(), dateOrNull(req.body?.dueAt),
    text(req.body?.successCriteria, 10000) || null, text(req.body?.ownerId, 120) || req.userId,
    actorType, req.userId, status === 'ACTIVE' ? new Date() : null,
  );
  await audit({
    userIdentity: req.userId,
    userRole: actorType,
    action: 'CREATE_COACHING_PLAN',
    module: 'Development',
    referenceId: planId,
    newValue: { employeeId, batchNo: trainee.batchNo, title, status, priority },
  });
  return res.status(201).json({ ok: true, data: { planId, employeeId, status }, message: 'Coaching plan created.' });
}

async function addGoal(req, res, actorType) {
  const plan = await scopedPlan(req.params.planId, req, actorType);
  if (!plan) return res.status(404).json({ ok: false, message: 'Coaching plan not found in your scope.' });
  if (!['DRAFT', 'ACTIVE'].includes(plan.status)) return res.status(409).json({ ok: false, message: 'Goals cannot be added to a closed plan.' });
  const goalTitle = text(req.body?.goalTitle, 220);
  if (!goalTitle) return res.status(400).json({ ok: false, message: 'Goal title is required.' });
  const skillId = text(req.body?.skillId, 60) || null;
  if (skillId) {
    const rows = await prisma.$queryRawUnsafe(`SELECT skill_id FROM skill_master WHERE skill_id = ? AND active = 1 LIMIT 1`, skillId);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Active skill not found.' });
  }
  const goalId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO coaching_goal
       (goal_id, plan_id, skill_id, goal_title, metric_type,
        baseline_value, target_value, current_value, progress_pct,
        status, due_at, evidence_required, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'NOT_STARTED', ?, ?, ?)`,
    goalId, plan.planId, skillId, goalTitle, text(req.body?.metricType, 40).toUpperCase() || 'PERCENT',
    req.body?.baselineValue === undefined ? null : number(req.body.baselineValue),
    req.body?.targetValue === undefined ? null : number(req.body.targetValue),
    req.body?.currentValue === undefined ? null : number(req.body.currentValue),
    dateOrNull(req.body?.dueAt), bool(req.body?.evidenceRequired, true) ? 1 : 0, req.userId,
  );
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'ADD_COACHING_GOAL', module: 'Development', referenceId: goalId, newValue: { planId: plan.planId, skillId, goalTitle } });
  return res.status(201).json({ ok: true, data: { goalId }, message: 'Coaching goal added.' });
}

async function addSession(req, res, actorType) {
  const plan = await scopedPlan(req.params.planId, req, actorType);
  if (!plan) return res.status(404).json({ ok: false, message: 'Coaching plan not found in your scope.' });
  if (!['DRAFT', 'ACTIVE'].includes(plan.status)) return res.status(409).json({ ok: false, message: 'Sessions cannot be added to a closed plan.' });
  const scheduledAt = dateOrNull(req.body?.scheduledAt);
  if (!scheduledAt) return res.status(400).json({ ok: false, message: 'Valid session date and time are required.' });
  const sessionId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO coaching_session
       (session_id, plan_id, session_type, status, scheduled_at,
        coach_id, coach_role, agenda, next_follow_up_at, created_by)
     VALUES (?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?, ?)`,
    sessionId, plan.planId, text(req.body?.sessionType, 40).toUpperCase() || 'COACHING',
    scheduledAt, text(req.body?.coachId, 120) || req.userId,
    text(req.body?.coachRole, 60) || actorType, text(req.body?.agenda, 10000) || null,
    dateOrNull(req.body?.nextFollowUpAt), req.userId,
  );
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'SCHEDULE_COACHING_SESSION', module: 'Development', referenceId: sessionId, newValue: { planId: plan.planId, scheduledAt } });
  return res.status(201).json({ ok: true, data: { sessionId }, message: 'Coaching session scheduled.' });
}

async function updateGoal(req, res, actorType) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT cg.goal_id AS goalId, cg.plan_id AS planId,
            cg.skill_id AS skillId, cg.status,
            cg.evidence_required AS evidenceRequired,
            cp.employee_id AS employeeId
       FROM coaching_goal cg
       INNER JOIN coaching_plan cp ON cp.plan_id = cg.plan_id
      WHERE cg.goal_id = ? LIMIT 1`,
    String(req.params.goalId),
  );
  const goal = rows[0];
  if (!goal) return res.status(404).json({ ok: false, message: 'Coaching goal not found.' });
  const plan = await scopedPlan(goal.planId, req, actorType);
  if (!plan) return res.status(404).json({ ok: false, message: 'Coaching goal is outside your scope.' });

  const status = text(req.body?.status, 30).toUpperCase() || goal.status;
  if (!GOAL_STATUSES.has(status)) return res.status(400).json({ ok: false, message: 'Invalid goal status.' });
  const completionNotes = text(req.body?.completionNotes, 10000);
  const evidenceReference = text(req.body?.evidenceReference, 200);
  if (status === 'COMPLETED' && !completionNotes) return res.status(400).json({ ok: false, message: 'Completion notes are required.' });
  if (status === 'COMPLETED' && goal.evidenceRequired && !evidenceReference) {
    return res.status(400).json({ ok: false, message: 'Evidence reference is required to complete this goal.' });
  }
  const progressPct = status === 'COMPLETED' ? 100 : number(req.body?.progressPct, 0, 100);
  const currentValue = req.body?.currentValue === undefined ? null : number(req.body.currentValue);

  await prisma.$executeRawUnsafe(
    `UPDATE coaching_goal
        SET current_value = COALESCE(?, current_value),
            progress_pct = ?, status = ?, completion_notes = ?,
            completed_at = CASE WHEN ? = 'COMPLETED' THEN UTC_TIMESTAMP(3) ELSE NULL END
      WHERE goal_id = ?`,
    currentValue, progressPct, status, completionNotes || null, status, goal.goalId,
  );
  if (evidenceReference) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO coaching_goal_evidence
         (evidence_id, goal_id, evidence_type, reference_id,
          evidence_value, notes, recorded_by, evidence_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         evidence_value = VALUES(evidence_value), notes = VALUES(notes),
         recorded_by = VALUES(recorded_by), evidence_at = VALUES(evidence_at)`,
      goal.goalId, text(req.body?.evidenceType, 40).toUpperCase() || 'MANUAL', evidenceReference,
      currentValue, text(req.body?.evidenceNotes, 10000) || completionNotes || null, req.userId,
    );
  }
  const skillLevelAwarded = number(req.body?.skillLevelAwarded, 0, 10);
  if (status === 'COMPLETED' && goal.skillId && skillLevelAwarded > 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO skill_evidence
         (id, employee_id, skill_id, evidence_type, reference_id,
          score_pct, level_awarded, evidence_status, notes,
          recorded_by, evidence_at)
       VALUES (UUID(), ?, ?, 'COACHING_GOAL', ?, ?, ?, 'VALID', ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         score_pct = VALUES(score_pct), level_awarded = VALUES(level_awarded),
         evidence_status = 'VALID', notes = VALUES(notes),
         recorded_by = VALUES(recorded_by), evidence_at = VALUES(evidence_at)`,
      goal.employeeId, goal.skillId, goal.goalId, progressPct, skillLevelAwarded, completionNotes, req.userId,
    );
  }
  await syncCoachingPlan(goal.planId);
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'UPDATE_COACHING_GOAL', module: 'Development', referenceId: goal.goalId, newValue: { status, progressPct, skillLevelAwarded } });
  return res.json({ ok: true, message: 'Coaching goal updated.' });
}

async function updateSession(req, res, actorType) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT session_id AS sessionId, plan_id AS planId, status
       FROM coaching_session WHERE session_id = ? LIMIT 1`,
    String(req.params.sessionId),
  );
  const session = rows[0];
  if (!session) return res.status(404).json({ ok: false, message: 'Coaching session not found.' });
  const plan = await scopedPlan(session.planId, req, actorType);
  if (!plan) return res.status(404).json({ ok: false, message: 'Coaching session is outside your scope.' });
  const status = text(req.body?.status, 30).toUpperCase() || 'COMPLETED';
  if (!SESSION_STATUSES.has(status)) return res.status(400).json({ ok: false, message: 'Invalid session status.' });
  const observationNotes = text(req.body?.observationNotes, 20000);
  const learnerCommitment = text(req.body?.learnerCommitment, 20000);
  if (status === 'COMPLETED' && (!observationNotes || !learnerCommitment)) {
    return res.status(400).json({ ok: false, message: 'Observation notes and learner commitment are required.' });
  }
  await prisma.$executeRawUnsafe(
    `UPDATE coaching_session
        SET status = ?, conducted_at = ?, duration_minutes = ?,
            observation_notes = ?, learner_commitment = ?, coach_feedback = ?,
            learner_feedback = ?, effectiveness_rating = ?, next_follow_up_at = ?
      WHERE session_id = ?`,
    status, status === 'COMPLETED' ? (dateOrNull(req.body?.conductedAt) || new Date()) : null,
    req.body?.durationMinutes === undefined ? null : Math.round(number(req.body.durationMinutes, 0, 1440)),
    observationNotes || null, learnerCommitment || null, text(req.body?.coachFeedback, 20000) || null,
    text(req.body?.learnerFeedback, 20000) || null,
    req.body?.effectivenessRating === undefined ? null : number(req.body.effectivenessRating, 0, 5),
    dateOrNull(req.body?.nextFollowUpAt), session.sessionId,
  );
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'UPDATE_COACHING_SESSION', module: 'Development', referenceId: session.sessionId, newValue: { status } });
  return res.json({ ok: true, message: `Coaching session marked ${status.toLowerCase()}.` });
}

async function updatePlanStatus(req, res, actorType) {
  const plan = await scopedPlan(req.params.planId, req, actorType);
  if (!plan) return res.status(404).json({ ok: false, message: 'Coaching plan not found in your scope.' });
  const status = text(req.body?.status, 30).toUpperCase();
  if (!PLAN_STATUSES.has(status)) return res.status(400).json({ ok: false, message: 'Invalid plan status.' });
  const closureSummary = text(req.body?.closureSummary, 10000);
  if (status === 'COMPLETED') {
    const goals = await prisma.$queryRawUnsafe(`SELECT status FROM coaching_goal WHERE plan_id = ?`, plan.planId);
    if (!goals.length || goals.some(goal => goal.status !== 'COMPLETED')) {
      return res.status(409).json({ ok: false, message: 'Complete every coaching goal before closing the plan.' });
    }
    if (!closureSummary) return res.status(400).json({ ok: false, message: 'Closure summary is required.' });
  }
  await prisma.$executeRawUnsafe(
    `UPDATE coaching_plan
        SET status = ?,
            activated_at = CASE WHEN ? = 'ACTIVE' THEN COALESCE(activated_at, UTC_TIMESTAMP(3)) ELSE activated_at END,
            completed_at = CASE WHEN ? = 'COMPLETED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
            closed_by = CASE WHEN ? IN ('COMPLETED','CANCELLED') THEN ? ELSE NULL END,
            closure_summary = ?
      WHERE plan_id = ?`,
    status, status, status, status, req.userId, closureSummary || null, plan.planId,
  );
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'UPDATE_COACHING_PLAN_STATUS', module: 'Development', referenceId: plan.planId, newValue: { status } });
  return res.json({ ok: true, message: `Coaching plan marked ${status.toLowerCase()}.` });
}

router.get('/me', ...traineeAuth,
  requirePermission('development.coaching.view_self'),
  requirePermission('development.certification.view_self'),
  async (req, res) => {
    try {
      return res.json({ ok: true, data: await getDevelopmentSnapshot(req.userId, req.userId) });
    } catch (error) {
      console.error('[DEVELOPMENT] Learner snapshot failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load development records.' });
    }
  });

router.get('/coordinator/batches/:batchNo', ...coordinatorAuth,
  requirePermission('development.coaching.manage_batch'),
  requirePermission('development.certification.manage_batch'),
  async (req, res) => {
    try {
      const batch = await ownedBatch(text(req.params.batchNo, 120), req.userId);
      if (!batch) return res.status(404).json({ ok: false, message: 'Owned batch not found.' });
      const employees = await prisma.traineeMaster.findMany({
        where: { batchNo: batch.batchNo, status: 'Active' },
        select: { employeeId: true, traineeName: true, riskStatus: true, certificationStatus: true },
        orderBy: { traineeName: 'asc' },
        take: 300,
      });
      for (const employee of employees) await syncCertificationLifecycleForEmployee(employee.employeeId, req.userId);
      const [plans, renewalCases] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT cp.plan_id AS planId, cp.employee_id AS employeeId,
                  tm.trainee_name AS traineeName, tm.risk_status AS riskStatus,
                  cp.title, cp.reason_code AS reasonCode, cp.priority,
                  cp.status, cp.start_at AS startAt, cp.due_at AS dueAt,
                  cp.owner_id AS ownerId, cp.success_criteria AS successCriteria,
                  COUNT(DISTINCT cg.goal_id) AS goalCount,
                  SUM(CASE WHEN cg.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedGoals,
                  COUNT(DISTINCT cs.session_id) AS sessionCount,
                  MAX(cs.scheduled_at) AS lastSessionAt
             FROM coaching_plan cp
             INNER JOIN trainee_master tm ON tm.employee_id = cp.employee_id
             LEFT JOIN coaching_goal cg ON cg.plan_id = cp.plan_id
             LEFT JOIN coaching_session cs ON cs.plan_id = cp.plan_id
            WHERE cp.batch_no = ?
            GROUP BY cp.plan_id
            ORDER BY FIELD(cp.status, 'ACTIVE','DRAFT','COMPLETED','CANCELLED'), cp.due_at ASC`,
          batch.batchNo,
        ),
        prisma.$queryRawUnsafe(
          `SELECT crc.case_id AS caseId, crc.employee_id AS employeeId,
                  tm.trainee_name AS traineeName, tm.risk_status AS riskStatus,
                  crc.status, crc.opened_at AS openedAt, crc.due_at AS dueAt,
                  crc.grace_until AS graceUntil, crc.blocker_reason AS blockerReason,
                  crc.manager_signoff_at AS managerSignoffAt,
                  ec.credential_number AS credentialNumber,
                  ec.certification_type AS certificationType, ec.expires_at AS expiresAt
             FROM certification_renewal_case crc
             INNER JOIN employee_certification ec ON ec.certification_id = crc.certification_id
             INNER JOIN trainee_master tm ON tm.employee_id = crc.employee_id
            WHERE ec.batch_no = ? ORDER BY crc.due_at ASC`,
          batch.batchNo,
        ),
      ]);
      return res.json({ ok: true, data: { batch, employees, plans, renewalCases } });
    } catch (error) {
      console.error('[DEVELOPMENT] Coordinator batch failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load batch development records.' });
    }
  });

router.post('/coordinator/batches/:batchNo/plans', ...coordinatorAuth, requirePermission('development.coaching.manage_batch'), (req, res) => createPlan(req, res, 'coordinator'));
router.post('/coordinator/plans/:planId/goals', ...coordinatorAuth, requirePermission('development.coaching.manage_batch'), (req, res) => addGoal(req, res, 'coordinator'));
router.post('/coordinator/plans/:planId/sessions', ...coordinatorAuth, requirePermission('development.coaching.manage_batch'), (req, res) => addSession(req, res, 'coordinator'));
router.patch('/coordinator/goals/:goalId', ...coordinatorAuth, requirePermission('development.coaching.manage_batch'), (req, res) => updateGoal(req, res, 'coordinator'));
router.patch('/coordinator/sessions/:sessionId', ...coordinatorAuth, requirePermission('development.coaching.manage_batch'), (req, res) => updateSession(req, res, 'coordinator'));
router.patch('/coordinator/plans/:planId/status', ...coordinatorAuth, requirePermission('development.coaching.manage_batch'), (req, res) => updatePlanStatus(req, res, 'coordinator'));

router.post('/coordinator/renewals/:caseId/signoff', ...coordinatorAuth,
  requirePermission('development.certification.manage_batch'), async (req, res) => {
    const renewalCase = await scopedRenewalCase(req.params.caseId, req, 'coordinator');
    if (!renewalCase) return res.status(404).json({ ok: false, message: 'Renewal case not found in your batch.' });
    await prisma.$executeRawUnsafe(
      `UPDATE certification_renewal_case
          SET manager_signoff_by = ?, manager_signoff_at = UTC_TIMESTAMP(3)
        WHERE case_id = ?`, req.userId, renewalCase.caseId,
    );
    await syncCertificationLifecycleForEmployee(renewalCase.employeeId, req.userId);
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'SIGNOFF_CERTIFICATION_RENEWAL', module: 'Development', referenceId: renewalCase.caseId });
    return res.json({ ok: true, message: 'Renewal sign-off recorded.' });
  });

router.post('/coordinator/renewals/:caseId/renew', ...coordinatorAuth,
  requirePermission('development.certification.manage_batch'), async (req, res) => {
    try {
      const renewalCase = await scopedRenewalCase(req.params.caseId, req, 'coordinator');
      if (!renewalCase) return res.status(404).json({ ok: false, message: 'Renewal case not found in your batch.' });
      await syncCertificationLifecycleForEmployee(renewalCase.employeeId, req.userId);
      const renewed = await issueRenewedCertification(renewalCase.caseId, req.userId);
      await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'RENEW_CERTIFICATION', module: 'Development', referenceId: renewalCase.caseId, newValue: renewed });
      return res.json({ ok: true, data: renewed, message: 'Certification renewed.' });
    } catch (error) {
      return res.status(409).json({ ok: false, message: error.message || 'Could not renew certification.' });
    }
  });

router.post('/admin/plans', ...adminAuth, requirePermission('development.coaching.manage'), (req, res) => createPlan(req, res, 'admin'));
router.post('/admin/plans/:planId/goals', ...adminAuth, requirePermission('development.coaching.manage'), (req, res) => addGoal(req, res, 'admin'));
router.post('/admin/plans/:planId/sessions', ...adminAuth, requirePermission('development.coaching.manage'), (req, res) => addSession(req, res, 'admin'));
router.patch('/admin/goals/:goalId', ...adminAuth, requirePermission('development.coaching.manage'), (req, res) => updateGoal(req, res, 'admin'));
router.patch('/admin/sessions/:sessionId', ...adminAuth, requirePermission('development.coaching.manage'), (req, res) => updateSession(req, res, 'admin'));
router.patch('/admin/plans/:planId/status', ...adminAuth, requirePermission('development.coaching.manage'), (req, res) => updatePlanStatus(req, res, 'admin'));

router.get('/admin/renewal-rules', ...adminAuth, requirePermission('development.certification.manage'), async (_req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT crr.renewal_rule_id AS renewalRuleId,
              crr.process_name AS processName, crr.lob_name AS lobName,
              crr.certification_type AS certificationType,
              crr.validity_days AS validityDays,
              crr.renewal_window_days AS renewalWindowDays,
              crr.grace_days AS graceDays,
              crr.learning_path_id AS learningPathId,
              lpm.path_name AS learningPathName,
              crr.assessment_id AS assessmentId,
              am.assessment_name AS assessmentName,
              crr.min_score AS minScore,
              crr.require_no_critical_risk AS requireNoCriticalRisk,
              crr.require_manager_signoff AS requireManagerSignoff,
              crr.active, crr.updated_at AS updatedAt
         FROM certification_renewal_rule crr
         LEFT JOIN learning_path_master lpm ON lpm.path_id = crr.learning_path_id
         LEFT JOIN assessment_master am ON am.assessment_id = crr.assessment_id
        ORDER BY crr.active DESC, crr.process_name, crr.lob_name`,
    );
    return res.json({ ok: true, data: rows });
  } catch {
    return res.status(500).json({ ok: false, message: 'Could not load renewal rules.' });
  }
});

router.put('/admin/renewal-rules', ...adminAuth, requirePermission('development.certification.manage'), async (req, res) => {
  const processName = text(req.body?.processName, 120);
  const lobName = text(req.body?.lobName, 120);
  const certificationType = text(req.body?.certificationType, 100).toUpperCase() || 'PROCESS_CERTIFICATION';
  const validityDays = Math.round(number(req.body?.validityDays, 365, 3650));
  const renewalWindowDays = Math.round(number(req.body?.renewalWindowDays, 45, validityDays));
  if (renewalWindowDays > validityDays) return res.status(400).json({ ok: false, message: 'Renewal window cannot exceed validity.' });
  const learningPathId = text(req.body?.learningPathId, 60) || null;
  const assessmentId = text(req.body?.assessmentId, 120) || null;
  try {
    if (learningPathId) {
      const pathRows = await prisma.$queryRawUnsafe(`SELECT path_id FROM learning_path_master WHERE path_id = ? AND status = 'PUBLISHED' AND active = 1`, learningPathId);
      if (!pathRows.length) return res.status(404).json({ ok: false, message: 'Published renewal path not found.' });
    }
    if (assessmentId) {
      const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId }, select: { assessmentId: true } });
      if (!assessment) return res.status(404).json({ ok: false, message: 'Renewal assessment not found.' });
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO certification_renewal_rule
         (renewal_rule_id, process_name, lob_name, certification_type,
          validity_days, renewal_window_days, grace_days,
          learning_path_id, assessment_id, min_score,
          require_no_critical_risk, require_manager_signoff, active, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         validity_days = VALUES(validity_days), renewal_window_days = VALUES(renewal_window_days),
         grace_days = VALUES(grace_days), learning_path_id = VALUES(learning_path_id),
         assessment_id = VALUES(assessment_id), min_score = VALUES(min_score),
         require_no_critical_risk = VALUES(require_no_critical_risk),
         require_manager_signoff = VALUES(require_manager_signoff),
         active = VALUES(active), created_by = VALUES(created_by)`,
      processName, lobName, certificationType, validityDays, renewalWindowDays,
      Math.round(number(req.body?.graceDays, 0, 365)), learningPathId, assessmentId,
      req.body?.minScore === undefined ? null : number(req.body.minScore, 0, 100),
      bool(req.body?.requireNoCriticalRisk, true) ? 1 : 0,
      bool(req.body?.requireManagerSignoff, false) ? 1 : 0,
      bool(req.body?.active, true) ? 1 : 0, req.userId,
    );
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPSERT_CERTIFICATION_RENEWAL_RULE', module: 'Development', referenceId: `${processName}:${lobName}:${certificationType}`, newValue: { validityDays, renewalWindowDays, learningPathId, assessmentId } });
    return res.json({ ok: true, message: 'Renewal rule saved.' });
  } catch (error) {
    console.error('[DEVELOPMENT] Renewal rule failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not save renewal rule.' });
  }
});

router.get('/admin/dashboard', ...adminAuth,
  requirePermission('development.coaching.manage'),
  requirePermission('development.certification.manage'),
  async (req, res) => {
    try {
      const branch = companyScope(req) ? '' : String(req.userBranch || '');
      const employees = await prisma.traineeMaster.findMany({
        where: { status: 'Active', ...(branch ? { branch } : {}) },
        select: { employeeId: true }, take: 2000,
      });
      for (const employee of employees) await syncCertificationLifecycleForEmployee(employee.employeeId, req.userId);
      const [coaching, certifications, renewalCases] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT cp.plan_id AS planId, cp.employee_id AS employeeId,
                  tm.trainee_name AS traineeName, cp.batch_no AS batchNo,
                  cp.branch, cp.process_name AS processName,
                  cp.title, cp.priority, cp.status, cp.due_at AS dueAt,
                  cp.owner_id AS ownerId,
                  COUNT(DISTINCT cg.goal_id) AS goalCount,
                  SUM(CASE WHEN cg.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedGoals
             FROM coaching_plan cp
             INNER JOIN trainee_master tm ON tm.employee_id = cp.employee_id
             LEFT JOIN coaching_goal cg ON cg.plan_id = cp.plan_id
            WHERE (? = '' OR cp.branch = ?)
            GROUP BY cp.plan_id
            ORDER BY FIELD(cp.status, 'ACTIVE','DRAFT','COMPLETED','CANCELLED'), cp.due_at ASC
            LIMIT 1000`, branch, branch,
        ),
        prisma.$queryRawUnsafe(
          `SELECT ec.certification_id AS certificationId,
                  ec.employee_id AS employeeId, tm.trainee_name AS traineeName,
                  ec.batch_no AS batchNo, ec.branch,
                  ec.process_name AS processName, ec.lob_name AS lobName,
                  ec.certification_type AS certificationType,
                  ec.credential_number AS credentialNumber,
                  ec.version_no AS versionNo, ec.status,
                  ec.issued_at AS issuedAt, ec.expires_at AS expiresAt,
                  ec.score_pct AS scorePct
             FROM employee_certification ec
             INNER JOIN trainee_master tm ON tm.employee_id = ec.employee_id
            WHERE (? = '' OR ec.branch = ?)
            ORDER BY ec.expires_at ASC, ec.issued_at DESC LIMIT 2000`, branch, branch,
        ),
        prisma.$queryRawUnsafe(
          `SELECT crc.case_id AS caseId, crc.employee_id AS employeeId,
                  tm.trainee_name AS traineeName, ec.batch_no AS batchNo,
                  ec.branch, crc.status, crc.due_at AS dueAt,
                  crc.grace_until AS graceUntil, crc.owner_id AS ownerId,
                  crc.blocker_reason AS blockerReason,
                  crc.manager_signoff_at AS managerSignoffAt,
                  ec.credential_number AS credentialNumber, ec.expires_at AS expiresAt
             FROM certification_renewal_case crc
             INNER JOIN employee_certification ec ON ec.certification_id = crc.certification_id
             INNER JOIN trainee_master tm ON tm.employee_id = crc.employee_id
            WHERE (? = '' OR ec.branch = ?)
            ORDER BY FIELD(crc.status, 'OVERDUE','READY','IN_PROGRESS','OPEN','COMPLETED','WAIVED','CANCELLED'), crc.due_at ASC
            LIMIT 2000`, branch, branch,
        ),
      ]);
      return res.json({ ok: true, data: { coaching, certifications, renewalCases } });
    } catch (error) {
      console.error('[DEVELOPMENT] Admin dashboard failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not load development dashboard.' });
    }
  });

router.post('/admin/employees/:employeeId/sync-certification', ...adminAuth,
  requirePermission('development.certification.manage'), async (req, res) => {
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: text(req.params.employeeId, 120) } });
    if (!trainee || (!companyScope(req) && String(trainee.branch || '') !== String(req.userBranch || ''))) {
      return res.status(404).json({ ok: false, message: 'Employee not found in your scope.' });
    }
    return res.json({ ok: true, data: await syncCertificationLifecycleForEmployee(trainee.employeeId, req.userId), message: 'Certification lifecycle synchronized.' });
  });

router.post('/admin/renewals/:caseId/renew', ...adminAuth,
  requirePermission('development.certification.manage'), async (req, res) => {
    try {
      const renewalCase = await scopedRenewalCase(req.params.caseId, req, 'admin');
      if (!renewalCase) return res.status(404).json({ ok: false, message: 'Renewal case not found in your scope.' });
      await syncCertificationLifecycleForEmployee(renewalCase.employeeId, req.userId);
      const renewed = await issueRenewedCertification(renewalCase.caseId, req.userId);
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RENEW_CERTIFICATION', module: 'Development', referenceId: renewalCase.caseId, newValue: renewed });
      return res.json({ ok: true, data: renewed, message: 'Certification renewed.' });
    } catch (error) {
      return res.status(409).json({ ok: false, message: error.message || 'Could not renew certification.' });
    }
  });

router.post('/admin/renewals/:caseId/waive', ...adminAuth,
  requirePermission('development.certification.manage'), async (req, res) => {
    try {
      const renewalCase = await scopedRenewalCase(req.params.caseId, req, 'admin');
      if (!renewalCase) return res.status(404).json({ ok: false, message: 'Renewal case not found in your scope.' });
      const waiverReason = text(req.body?.waiverReason, 10000);
      if (waiverReason.length < 20) return res.status(400).json({ ok: false, message: 'Provide a detailed waiver reason of at least 20 characters.' });
      const renewed = await issueRenewedCertification(renewalCase.caseId, req.userId, { waive: true, waiverReason });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'WAIVE_CERTIFICATION_RENEWAL', module: 'Development', referenceId: renewalCase.caseId, newValue: { ...renewed, waiverReason } });
      return res.json({ ok: true, data: renewed, message: 'Renewal waived and replacement credential issued.' });
    } catch (error) {
      return res.status(409).json({ ok: false, message: error.message || 'Could not waive renewal.' });
    }
  });

router.post('/admin/certifications/:certificationId/revoke', ...adminAuth,
  requirePermission('development.certification.manage'), async (req, res) => {
    const reason = text(req.body?.reason, 10000);
    if (reason.length < 20) return res.status(400).json({ ok: false, message: 'Provide a detailed revocation reason of at least 20 characters.' });
    const rows = await prisma.$queryRawUnsafe(
      `SELECT certification_id AS certificationId, employee_id AS employeeId,
              branch, status FROM employee_certification
        WHERE certification_id = ? LIMIT 1`, String(req.params.certificationId),
    );
    const certification = rows[0];
    if (!certification || (!companyScope(req) && String(certification.branch || '') !== String(req.userBranch || ''))) {
      return res.status(404).json({ ok: false, message: 'Certification not found in your scope.' });
    }
    if (['REVOKED', 'SUPERSEDED'].includes(certification.status)) return res.status(409).json({ ok: false, message: 'Certification is already inactive.' });
    await prisma.$executeRawUnsafe(
      `UPDATE employee_certification
          SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3),
              revoked_by = ?, revocation_reason = ?
        WHERE certification_id = ?`, req.userId, reason, certification.certificationId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE certification_renewal_case
          SET status = 'CANCELLED', blocker_reason = 'Source certification revoked.'
        WHERE certification_id = ? AND status NOT IN ('COMPLETED','WAIVED','CANCELLED')`, certification.certificationId,
    );
    await prisma.traineeMaster.updateMany({ where: { employeeId: certification.employeeId }, data: { certificationStatus: 'Revoked' } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'REVOKE_CERTIFICATION', module: 'Development', referenceId: certification.certificationId, newValue: { reason } });
    return res.json({ ok: true, message: 'Certification revoked.' });
  });

export default router;
