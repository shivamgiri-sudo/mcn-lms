import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addDays(value, days) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + number(days));
  return result;
}

function credentialNumber(employeeId, processName, versionNo) {
  const processCode = String(processName || 'LMS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'LMS';
  const employeeCode = String(employeeId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-10) || 'LEARNER';
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `MCN-${processCode}-${employeeCode}-${stamp}-V${versionNo}`;
}

async function findRenewalRule(processName, lobName, certificationType = 'PROCESS_CERTIFICATION') {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT renewal_rule_id AS renewalRuleId,
            process_name AS processName, lob_name AS lobName,
            certification_type AS certificationType,
            validity_days AS validityDays,
            renewal_window_days AS renewalWindowDays,
            grace_days AS graceDays,
            learning_path_id AS learningPathId,
            assessment_id AS assessmentId,
            min_score AS minScore,
            require_no_critical_risk AS requireNoCriticalRisk,
            require_manager_signoff AS requireManagerSignoff,
            active
       FROM certification_renewal_rule
      WHERE active = 1
        AND certification_type = ?
        AND process_name IN (?, '')
        AND lob_name IN (?, '')
      ORDER BY
        CASE WHEN process_name = ? THEN 0 ELSE 1 END,
        CASE WHEN lob_name = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    certificationType,
    String(processName || ''), String(lobName || ''),
    String(processName || ''), String(lobName || ''),
  );
  return rows[0] || null;
}

async function loadCertificationEvidence(employeeId, batchNo) {
  const evidence = await prisma.certificationEvidence.findMany({
    where: { employeeId, ...(batchNo ? { batchNo } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return evidence.map(item => ({
    evidenceType: item.evidenceType,
    result: item.result,
    scorePct: item.scorePct,
    conductedBy: item.conductedBy,
    conductedAt: item.conductedAt,
    remarks: item.remarks,
  }));
}

async function nextCertificationVersion(employeeId, certificationType) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS nextVersion
       FROM employee_certification
      WHERE employee_id = ? AND certification_type = ?`,
    String(employeeId), String(certificationType),
  );
  return Math.max(1, number(rows[0]?.nextVersion, 1));
}

async function createPathEnrollment(employeeId, learningPathId, dueAt, assignedBy, source) {
  if (!learningPathId) return null;
  const existing = await prisma.$queryRawUnsafe(
    `SELECT enrollment_id AS enrollmentId
       FROM learning_path_enrollment
      WHERE path_id = ? AND employee_id = ? LIMIT 1`,
    String(learningPathId), String(employeeId),
  );
  if (existing.length) return existing[0].enrollmentId;

  const pathRows = await prisma.$queryRawUnsafe(
    `SELECT path_id AS pathId
       FROM learning_path_master
      WHERE path_id = ? AND status = 'PUBLISHED' AND active = 1 LIMIT 1`,
    String(learningPathId),
  );
  if (!pathRows.length) return null;

  const enrollmentId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO learning_path_enrollment
       (enrollment_id, path_id, employee_id, status, progress_pct,
        assigned_at, due_at, assigned_by, source)
     VALUES (?, ?, ?, 'NOT_STARTED', 0, UTC_TIMESTAMP(3), ?, ?, ?)`,
    enrollmentId, String(learningPathId), String(employeeId), dueAt,
    String(assignedBy || 'certification-engine'), String(source || 'CERTIFICATION_RENEWAL'),
  );
  const steps = await prisma.$queryRawUnsafe(
    `SELECT step_id AS stepId FROM learning_path_step WHERE path_id = ?`,
    String(learningPathId),
  );
  for (const step of steps) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO learning_path_step_progress
         (id, enrollment_id, step_id, status)
       VALUES (UUID(), ?, ?, 'LOCKED')`,
      enrollmentId, String(step.stepId),
    );
  }
  return enrollmentId;
}

export async function ensureCertificationForCertifiedTrainee(employeeId, issuedBy = 'certification-engine') {
  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
  if (!trainee || trainee.certificationStatus !== 'Certified') return null;

  const certificationType = 'PROCESS_CERTIFICATION';
  const existing = await prisma.$queryRawUnsafe(
    `SELECT certification_id AS certificationId, status,
            expires_at AS expiresAt, version_no AS versionNo
       FROM employee_certification
      WHERE employee_id = ? AND certification_type = ?
      ORDER BY version_no DESC LIMIT 1`,
    String(employeeId), certificationType,
  );
  if (existing.length) return existing[0];

  const rule = await findRenewalRule(trainee.process, trainee.lob, certificationType);
  const issuedAt = new Date();
  const expiresAt = rule ? addDays(issuedAt, rule.validityDays) : null;
  const versionNo = await nextCertificationVersion(employeeId, certificationType);
  const certificationId = randomUUID();
  const evidence = await loadCertificationEvidence(employeeId, trainee.batchNo);
  const scoreRows = await prisma.assessmentResult.findMany({
    where: { employeeId, result: 'Pass' },
    orderBy: { bestPercentage: 'desc' },
    take: 20,
  });
  const scorePct = scoreRows.length ? Math.max(...scoreRows.map(row => number(row.bestPercentage))) : null;

  await prisma.$executeRawUnsafe(
    `INSERT INTO employee_certification
       (certification_id, employee_id, batch_no, branch, process_name,
        lob_name, certification_type, credential_number, version_no,
        status, issued_at, expires_at, score_pct, issued_by, rule_id,
        renewal_rule_id, previous_certification_id, evidence_snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, NULL, ?)`,
    certificationId, trainee.employeeId, trainee.batchNo, trainee.branch,
    trainee.process, trainee.lob, certificationType,
    credentialNumber(employeeId, trainee.process, versionNo), versionNo,
    issuedAt, expiresAt, scorePct, String(issuedBy), null,
    rule?.renewalRuleId || null,
    JSON.stringify({
      courseCompletionPct: trainee.courseCompletionPct,
      assessmentPassPct: trainee.assessmentPassPct,
      attendancePct: trainee.attendancePct,
      certificationEvidence: evidence,
    }),
  );
  return { certificationId, status: 'ACTIVE', expiresAt, versionNo };
}

async function evaluateRenewalCase(caseRow) {
  const [pathEnrollment, assessmentResult, criticalRiskCount] = await Promise.all([
    caseRow.learningPathEnrollmentId
      ? prisma.$queryRawUnsafe(
          `SELECT status, progress_pct AS progressPct
             FROM learning_path_enrollment
            WHERE enrollment_id = ? LIMIT 1`,
          String(caseRow.learningPathEnrollmentId),
        ).then(rows => rows[0] || null)
      : Promise.resolve(null),
    caseRow.assessmentId
      ? prisma.assessmentResult.findUnique({
          where: { employeeId_assessmentId: { employeeId: caseRow.employeeId, assessmentId: caseRow.assessmentId } },
        })
      : Promise.resolve(null),
    caseRow.requireNoCriticalRisk
      ? prisma.trainingRiskLog.count({
          where: { employeeId: caseRow.employeeId, severity: 'CRITICAL', status: 'Open' },
        })
      : Promise.resolve(0),
  ]);

  const blockers = [];
  if (caseRow.learningPathId && pathEnrollment?.status !== 'COMPLETED') {
    blockers.push(`Renewal learning path is ${pathEnrollment?.status || 'not assigned'}.`);
  }
  if (caseRow.assessmentId) {
    const score = number(assessmentResult?.bestPercentage);
    if (assessmentResult?.result !== 'Pass' || score < number(caseRow.minScore)) {
      blockers.push(`Renewal assessment requires a passing score of ${number(caseRow.minScore)}%.`);
    }
  }
  if (number(criticalRiskCount) > 0) blockers.push(`${criticalRiskCount} open critical risk(s) must be resolved.`);
  if (caseRow.requireManagerSignoff && !caseRow.managerSignoffAt) blockers.push('Manager sign-off is required.');

  return {
    ready: blockers.length === 0,
    blockers,
    pathEnrollment,
    assessmentResult,
    criticalRiskCount,
  };
}

export async function syncCertificationLifecycleForEmployee(employeeId, actor = 'certification-engine') {
  await ensureCertificationForCertifiedTrainee(employeeId, actor);

  const certifications = await prisma.$queryRawUnsafe(
    `SELECT ec.certification_id AS certificationId,
            ec.employee_id AS employeeId, ec.batch_no AS batchNo,
            ec.branch, ec.process_name AS processName, ec.lob_name AS lobName,
            ec.certification_type AS certificationType,
            ec.credential_number AS credentialNumber,
            ec.version_no AS versionNo, ec.status,
            ec.issued_at AS issuedAt, ec.expires_at AS expiresAt,
            ec.score_pct AS scorePct, ec.issued_by AS issuedBy,
            ec.rule_id AS ruleId, ec.renewal_rule_id AS renewalRuleId,
            ec.previous_certification_id AS previousCertificationId,
            ec.certificate_url AS certificateUrl,
            crr.validity_days AS validityDays,
            crr.renewal_window_days AS renewalWindowDays,
            crr.grace_days AS graceDays,
            crr.learning_path_id AS learningPathId,
            crr.assessment_id AS assessmentId,
            crr.min_score AS minScore,
            crr.require_no_critical_risk AS requireNoCriticalRisk,
            crr.require_manager_signoff AS requireManagerSignoff
       FROM employee_certification ec
       LEFT JOIN certification_renewal_rule crr
              ON crr.renewal_rule_id = ec.renewal_rule_id
      WHERE ec.employee_id = ?
      ORDER BY ec.version_no DESC`,
    String(employeeId),
  );

  for (const cert of certifications) {
    if (!['ACTIVE', 'EXPIRING', 'EXPIRED'].includes(cert.status) || !cert.expiresAt) continue;
    const expiresAt = new Date(cert.expiresAt);
    const renewalStartsAt = addDays(expiresAt, -number(cert.renewalWindowDays, 45));
    const graceUntil = addDays(expiresAt, number(cert.graceDays, 0));
    const now = new Date();
    const nextStatus = now > graceUntil ? 'EXPIRED' : now >= renewalStartsAt ? 'EXPIRING' : 'ACTIVE';
    if (nextStatus !== cert.status) {
      await prisma.$executeRawUnsafe(
        `UPDATE employee_certification SET status = ? WHERE certification_id = ?`,
        nextStatus, String(cert.certificationId),
      );
      cert.status = nextStatus;
    }

    if (now < renewalStartsAt || ['REVOKED', 'SUPERSEDED'].includes(cert.status)) continue;
    const batchOwner = cert.batchNo
      ? await prisma.batchMaster.findUnique({ where: { batchNo: cert.batchNo }, select: { coordinatorLoginId: true } })
      : null;
    const existingCase = await prisma.$queryRawUnsafe(
      `SELECT case_id AS caseId, learning_path_enrollment_id AS learningPathEnrollmentId
         FROM certification_renewal_case
        WHERE certification_id = ? LIMIT 1`,
      String(cert.certificationId),
    );
    if (!existingCase.length) {
      const pathEnrollmentId = await createPathEnrollment(
        employeeId,
        cert.learningPathId,
        expiresAt,
        batchOwner?.coordinatorLoginId || actor,
        'CERTIFICATION_RENEWAL',
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO certification_renewal_case
           (case_id, certification_id, employee_id, renewal_rule_id,
            status, opened_at, due_at, grace_until, owner_id,
            learning_path_enrollment_id, assessment_id)
         VALUES (UUID(), ?, ?, ?, 'OPEN', UTC_TIMESTAMP(3), ?, ?, ?, ?, ?)`,
        cert.certificationId, employeeId, cert.renewalRuleId,
        expiresAt, graceUntil, batchOwner?.coordinatorLoginId || null,
        pathEnrollmentId, cert.assessmentId,
      );
    }
  }

  const cases = await prisma.$queryRawUnsafe(
    `SELECT crc.case_id AS caseId,
            crc.certification_id AS certificationId,
            crc.employee_id AS employeeId,
            crc.renewal_rule_id AS renewalRuleId,
            crc.status, crc.opened_at AS openedAt,
            crc.due_at AS dueAt, crc.grace_until AS graceUntil,
            crc.owner_id AS ownerId,
            crc.learning_path_enrollment_id AS learningPathEnrollmentId,
            crc.assessment_id AS assessmentId,
            crc.assessment_score AS assessmentScore,
            crc.manager_signoff_by AS managerSignoffBy,
            crc.manager_signoff_at AS managerSignoffAt,
            crc.blocker_reason AS blockerReason,
            crc.waiver_reason AS waiverReason,
            crc.completed_at AS completedAt,
            crc.renewed_certification_id AS renewedCertificationId,
            crr.learning_path_id AS learningPathId,
            crr.min_score AS minScore,
            crr.require_no_critical_risk AS requireNoCriticalRisk,
            crr.require_manager_signoff AS requireManagerSignoff
       FROM certification_renewal_case crc
       LEFT JOIN certification_renewal_rule crr
              ON crr.renewal_rule_id = crc.renewal_rule_id
      WHERE crc.employee_id = ?
      ORDER BY crc.due_at ASC`,
    String(employeeId),
  );

  for (const caseRow of cases) {
    if (['COMPLETED', 'WAIVED', 'CANCELLED'].includes(caseRow.status)) continue;
    const evaluation = await evaluateRenewalCase(caseRow);
    const now = new Date();
    const overdue = now > new Date(caseRow.graceUntil || caseRow.dueAt);
    const inProgress = Boolean(
      number(evaluation.pathEnrollment?.progressPct) > 0 ||
      evaluation.assessmentResult ||
      caseRow.managerSignoffAt,
    );
    const nextStatus = evaluation.ready ? 'READY' : overdue ? 'OVERDUE' : inProgress ? 'IN_PROGRESS' : 'OPEN';
    const assessmentScore = evaluation.assessmentResult ? number(evaluation.assessmentResult.bestPercentage) : null;
    await prisma.$executeRawUnsafe(
      `UPDATE certification_renewal_case
          SET status = ?, assessment_score = ?, blocker_reason = ?
        WHERE case_id = ?`,
      nextStatus, assessmentScore,
      evaluation.blockers.length ? evaluation.blockers.join(' ') : null,
      String(caseRow.caseId),
    );
    caseRow.status = nextStatus;
    caseRow.assessmentScore = assessmentScore;
    caseRow.blockerReason = evaluation.blockers.join(' ') || null;
  }

  return { certifications, cases };
}

export async function issueRenewedCertification(caseId, actor, options = {}) {
  const caseRows = await prisma.$queryRawUnsafe(
    `SELECT crc.case_id AS caseId, crc.certification_id AS certificationId,
            crc.employee_id AS employeeId, crc.status,
            crc.renewal_rule_id AS renewalRuleId,
            ec.batch_no AS batchNo, ec.branch,
            ec.process_name AS processName, ec.lob_name AS lobName,
            ec.certification_type AS certificationType,
            ec.version_no AS versionNo,
            crr.validity_days AS validityDays
       FROM certification_renewal_case crc
       INNER JOIN employee_certification ec
               ON ec.certification_id = crc.certification_id
       LEFT JOIN certification_renewal_rule crr
              ON crr.renewal_rule_id = crc.renewal_rule_id
      WHERE crc.case_id = ? LIMIT 1`,
    String(caseId),
  );
  const row = caseRows[0];
  if (!row) throw new Error('Renewal case not found.');
  if (['COMPLETED', 'WAIVED', 'CANCELLED'].includes(row.status)) throw new Error('Renewal case is already closed.');
  if (row.status !== 'READY' && !options.waive) throw new Error('Renewal requirements are not complete.');
  if (options.waive && !String(options.waiverReason || '').trim()) throw new Error('Waiver reason is required.');

  const newVersion = number(row.versionNo, 0) + 1;
  const certificationId = randomUUID();
  const issuedAt = new Date();
  const expiresAt = addDays(issuedAt, number(row.validityDays, 365));
  const credential = credentialNumber(row.employeeId, row.processName, newVersion);
  const evidenceRows = await loadCertificationEvidence(row.employeeId, row.batchNo);

  await prisma.$transaction(async transaction => {
    await transaction.$executeRawUnsafe(
      `UPDATE employee_certification SET status = 'SUPERSEDED' WHERE certification_id = ?`,
      String(row.certificationId),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO employee_certification
         (certification_id, employee_id, batch_no, branch, process_name,
          lob_name, certification_type, credential_number, version_no,
          status, issued_at, expires_at, issued_by, renewal_rule_id,
          previous_certification_id, evidence_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
      certificationId, row.employeeId, row.batchNo, row.branch,
      row.processName, row.lobName, row.certificationType,
      credential, newVersion, issuedAt, expiresAt,
      String(actor), row.renewalRuleId, row.certificationId,
      JSON.stringify({
        renewalCaseId: row.caseId,
        waived: Boolean(options.waive),
        waiverReason: options.waiverReason || null,
        certificationEvidence: evidenceRows,
      }),
    );
    await transaction.$executeRawUnsafe(
      `UPDATE certification_renewal_case
          SET status = ?, completed_at = UTC_TIMESTAMP(3),
              renewed_certification_id = ?, waiver_reason = ?,
              waived_by = ?, waived_at = ?
        WHERE case_id = ?`,
      options.waive ? 'WAIVED' : 'COMPLETED', certificationId,
      options.waiverReason || null,
      options.waive ? String(actor) : null,
      options.waive ? new Date() : null,
      String(caseId),
    );
  });

  return { certificationId, credentialNumber: credential, versionNo: newVersion, issuedAt, expiresAt };
}

export async function syncCoachingPlan(planId) {
  const goals = await prisma.$queryRawUnsafe(
    `SELECT progress_pct AS progressPct, status
       FROM coaching_goal WHERE plan_id = ?`,
    String(planId),
  );
  if (!goals.length) return { progressPct: 0, completed: false };
  const progressPct = Math.round(goals.reduce((sum, goal) => sum + number(goal.progressPct), 0) / goals.length * 100) / 100;
  const completed = goals.every(goal => goal.status === 'COMPLETED');
  if (completed) {
    await prisma.$executeRawUnsafe(
      `UPDATE coaching_plan
          SET status = 'COMPLETED', completed_at = COALESCE(completed_at, UTC_TIMESTAMP(3))
        WHERE plan_id = ? AND status = 'ACTIVE'`,
      String(planId),
    );
  }
  return { progressPct, completed };
}

export async function getDevelopmentSnapshot(employeeId, actor = 'development-engine') {
  const certification = await syncCertificationLifecycleForEmployee(employeeId, actor);
  const plans = await prisma.$queryRawUnsafe(
    `SELECT cp.plan_id AS planId, cp.employee_id AS employeeId,
            cp.batch_no AS batchNo, cp.branch,
            cp.process_name AS processName, cp.lob_name AS lobName,
            cp.title, cp.reason_code AS reasonCode, cp.source,
            cp.priority, cp.status, cp.start_at AS startAt,
            cp.due_at AS dueAt, cp.success_criteria AS successCriteria,
            cp.owner_id AS ownerId, cp.owner_type AS ownerType,
            cp.activated_at AS activatedAt,
            cp.completed_at AS completedAt,
            cp.closure_summary AS closureSummary,
            cp.created_at AS createdAt
       FROM coaching_plan cp
      WHERE cp.employee_id = ?
      ORDER BY FIELD(cp.status, 'ACTIVE','DRAFT','COMPLETED','CANCELLED'),
               cp.due_at ASC, cp.created_at DESC`,
    String(employeeId),
  );
  const planIds = plans.map(plan => plan.planId);
  let goals = [];
  let sessions = [];
  if (planIds.length) {
    const placeholders = planIds.map(() => '?').join(',');
    [goals, sessions] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT cg.goal_id AS goalId, cg.plan_id AS planId,
                cg.skill_id AS skillId, sm.skill_name AS skillName,
                cg.goal_title AS goalTitle, cg.metric_type AS metricType,
                cg.baseline_value AS baselineValue,
                cg.target_value AS targetValue,
                cg.current_value AS currentValue,
                cg.progress_pct AS progressPct, cg.status,
                cg.due_at AS dueAt, cg.evidence_required AS evidenceRequired,
                cg.completion_notes AS completionNotes,
                cg.completed_at AS completedAt
           FROM coaching_goal cg
           LEFT JOIN skill_master sm ON sm.skill_id = cg.skill_id
          WHERE cg.plan_id IN (${placeholders})
          ORDER BY cg.due_at ASC, cg.created_at ASC`,
        ...planIds,
      ),
      prisma.$queryRawUnsafe(
        `SELECT cs.session_id AS sessionId, cs.plan_id AS planId,
                cs.session_type AS sessionType, cs.status,
                cs.scheduled_at AS scheduledAt,
                cs.conducted_at AS conductedAt,
                cs.duration_minutes AS durationMinutes,
                cs.coach_id AS coachId, cs.coach_role AS coachRole,
                cs.agenda, cs.observation_notes AS observationNotes,
                cs.learner_commitment AS learnerCommitment,
                cs.coach_feedback AS coachFeedback,
                cs.learner_feedback AS learnerFeedback,
                cs.effectiveness_rating AS effectivenessRating,
                cs.next_follow_up_at AS nextFollowUpAt
           FROM coaching_session cs
          WHERE cs.plan_id IN (${placeholders})
          ORDER BY cs.scheduled_at DESC`,
        ...planIds,
      ),
    ]);
  }

  return {
    plans: plans.map(plan => ({
      ...plan,
      goals: goals.filter(goal => goal.planId === plan.planId),
      sessions: sessions.filter(session => session.planId === plan.planId),
    })),
    certifications: certification.certifications,
    renewalCases: certification.cases,
  };
}
