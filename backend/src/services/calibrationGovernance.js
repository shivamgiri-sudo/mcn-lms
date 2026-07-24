import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';

function fail(status, message, code = 'CALIBRATION_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, max = 20000) {
  return String(value || '').trim().slice(0, max);
}

export function normalizeCalibration(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeCalibration);
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeCalibration(item)]));
  }
  return value;
}

export async function getCalibrationProgram(programId, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT p.program_id AS programId, p.program_code AS programCode,
            p.program_name AS programName, p.template_id AS templateId,
            p.description, p.evaluator_instructions AS evaluatorInstructions,
            p.audience_branch AS audienceBranch, p.audience_process AS audienceProcess,
            p.audience_lob AS audienceLob, p.passing_pct AS passingPct,
            p.min_anchor_cases AS minAnchorCases, p.max_attempts AS maxAttempts,
            p.authorization_valid_days AS authorizationValidDays,
            p.default_score_tolerance AS defaultScoreTolerance,
            p.minimum_agreement_pct AS minimumAgreementPct,
            p.maximum_severity_index AS maximumSeverityIndex,
            p.status, p.active, p.created_by AS createdBy,
            p.published_by AS publishedBy, p.published_at AS publishedAt,
            t.template_code AS templateCode, t.template_name AS templateName,
            t.version_no AS templateVersion, t.status AS templateStatus
       FROM evaluator_calibration_program p
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
      WHERE p.program_id = ? LIMIT 1`,
    String(programId),
  );
  const program = normalizeCalibration(rows[0] || null);
  if (!program) return null;
  const [anchors, expected, criteria] = await Promise.all([
    db.$queryRawUnsafe(
      `SELECT anchor_id AS anchorId, program_id AS programId,
              anchor_code AS anchorCode, anchor_title AS anchorTitle,
              scenario_description AS scenarioDescription,
              evidence_reference AS evidenceReference, evidence_url AS evidenceUrl,
              evaluator_notes AS evaluatorNotes, sort_order AS sortOrder, active
         FROM evaluator_calibration_anchor
        WHERE program_id = ? ORDER BY sort_order, anchor_title`,
      String(programId),
    ),
    db.$queryRawUnsafe(
      `SELECT x.expected_score_id AS expectedScoreId, x.anchor_id AS anchorId,
              x.criterion_id AS criterionId, x.expected_score AS expectedScore,
              x.tolerance, x.expected_critical_fail AS expectedCriticalFail,
              x.rationale
         FROM evaluator_calibration_expected_score x
         INNER JOIN evaluator_calibration_anchor a ON a.anchor_id = x.anchor_id
        WHERE a.program_id = ?`,
      String(programId),
    ),
    db.$queryRawUnsafe(
      `SELECT c.criterion_id AS criterionId, c.criterion_code AS criterionCode,
              c.criterion_title AS criterionTitle, c.max_score AS maxScore,
              c.critical, c.critical_min_score AS criticalMinScore,
              s.section_title AS sectionTitle, s.sort_order AS sectionOrder,
              c.sort_order AS criterionOrder
         FROM practical_rubric_criterion c
         INNER JOIN practical_rubric_section s ON s.section_id = c.section_id
         INNER JOIN evaluator_calibration_program p ON p.template_id = s.template_id
        WHERE p.program_id = ?
        ORDER BY s.sort_order, c.sort_order`,
      String(programId),
    ),
  ]);
  const normalizedExpected = normalizeCalibration(expected);
  return {
    ...program,
    criteria: normalizeCalibration(criteria),
    anchors: normalizeCalibration(anchors).map(anchor => ({
      ...anchor,
      expectedScores: normalizedExpected.filter(item => item.anchorId === anchor.anchorId),
    })),
  };
}

function validateProgram(program) {
  if (program.templateStatus !== 'PUBLISHED') fail(409, 'Calibration requires a published practical rubric version.', 'TEMPLATE_NOT_PUBLISHED');
  const activeAnchors = program.anchors.filter(item => item.active);
  if (activeAnchors.length < number(program.minAnchorCases, 1)) {
    fail(409, `Add at least ${program.minAnchorCases} active anchor cases before publishing.`, 'ANCHOR_MINIMUM_NOT_MET');
  }
  if (!program.criteria.length) fail(409, 'The linked rubric contains no criteria.', 'RUBRIC_CRITERIA_EMPTY');
  for (const anchor of activeAnchors) {
    const scoreMap = new Map(anchor.expectedScores.map(item => [item.criterionId, item]));
    for (const criterion of program.criteria) {
      const expected = scoreMap.get(criterion.criterionId);
      if (!expected) {
        fail(409, `Anchor “${anchor.anchorTitle}” is missing an expected score for “${criterion.criterionTitle}”.`, 'ANCHOR_SCORE_INCOMPLETE');
      }
      if (number(expected.expectedScore) > number(criterion.maxScore)) {
        fail(409, `Expected score for “${criterion.criterionTitle}” exceeds the rubric maximum.`, 'EXPECTED_SCORE_RANGE');
      }
    }
  }
  return { anchorCount: activeAnchors.length, criterionCount: program.criteria.length };
}

export async function publishCalibrationProgram(programId, actorId) {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRawUnsafe(
      `SELECT program_id AS programId, status FROM evaluator_calibration_program
        WHERE program_id = ? LIMIT 1 FOR UPDATE`,
      String(programId),
    );
    if (!locked.length) fail(404, 'Calibration program not found.', 'PROGRAM_NOT_FOUND');
    if (locked[0].status === 'PUBLISHED') return getCalibrationProgram(programId, tx);
    if (locked[0].status !== 'DRAFT') fail(409, 'Only draft calibration programs can be published.', 'PROGRAM_NOT_DRAFT');
    const program = await getCalibrationProgram(programId, tx);
    validateProgram(program);
    await tx.$executeRawUnsafe(
      `UPDATE evaluator_calibration_program
          SET status = 'PUBLISHED', published_by = ?, published_at = UTC_TIMESTAMP(3)
        WHERE program_id = ?`,
      String(actorId), String(programId),
    );
    return getCalibrationProgram(programId, tx);
  });
}

export async function assignCalibration({ programId, evaluatorId, evaluatorType, dueAt, actorId }) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT program_id AS programId, status, max_attempts AS maxAttempts,
              audience_branch AS audienceBranch
         FROM evaluator_calibration_program WHERE program_id = ? LIMIT 1 FOR UPDATE`,
      String(programId),
    );
    const program = normalizeCalibration(rows[0] || null);
    if (!program || program.status !== 'PUBLISHED') fail(409, 'Select a published calibration program.', 'PROGRAM_NOT_PUBLISHED');
    const attempts = await tx.$queryRawUnsafe(
      `SELECT COALESCE(MAX(attempt_no),0) AS lastAttempt
         FROM evaluator_calibration_assignment
        WHERE program_id = ? AND evaluator_id = ? AND evaluator_type = ? FOR UPDATE`,
      String(programId), String(evaluatorId), String(evaluatorType),
    );
    const attemptNo = number(attempts[0]?.lastAttempt) + 1;
    if (attemptNo > number(program.maxAttempts, 1)) fail(409, 'Maximum calibration attempts have been reached.', 'CALIBRATION_ATTEMPT_LIMIT');
    const assignmentId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO evaluator_calibration_assignment
         (assignment_id, program_id, evaluator_id, evaluator_type,
          attempt_no, status, assigned_by, due_at)
       VALUES (?, ?, ?, ?, ?, 'ASSIGNED', ?, ?)`,
      assignmentId, String(programId), String(evaluatorId), String(evaluatorType),
      attemptNo, String(actorId), dueAt || null,
    );
    return getCalibrationAssignment(assignmentId, tx);
  });
}

export async function getCalibrationAssignment(assignmentId, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.program_id AS programId,
            a.evaluator_id AS evaluatorId, a.evaluator_type AS evaluatorType,
            a.attempt_no AS attemptNo, a.status, a.assigned_by AS assignedBy,
            a.assigned_at AS assignedAt, a.due_at AS dueAt,
            a.started_at AS startedAt, a.submitted_at AS submittedAt,
            a.score_pct AS scorePct, a.mean_absolute_deviation AS meanAbsoluteDeviation,
            a.agreement_pct AS agreementPct,
            a.critical_agreement_pct AS criticalAgreementPct,
            a.result, a.certified_at AS certifiedAt, a.valid_until AS validUntil,
            p.program_name AS programName, p.program_code AS programCode,
            p.passing_pct AS passingPct, p.minimum_agreement_pct AS minimumAgreementPct,
            p.authorization_valid_days AS authorizationValidDays,
            p.evaluator_instructions AS evaluatorInstructions,
            p.template_id AS templateId, t.template_name AS templateName,
            t.version_no AS templateVersion
       FROM evaluator_calibration_assignment a
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
      WHERE a.assignment_id = ? LIMIT 1`,
    String(assignmentId),
  );
  const assignment = normalizeCalibration(rows[0] || null);
  if (!assignment) return null;
  const [program, responses] = await Promise.all([
    getCalibrationProgram(assignment.programId, db),
    db.$queryRawUnsafe(
      `SELECT response_id AS responseId, assignment_id AS assignmentId,
              anchor_id AS anchorId, criterion_id AS criterionId,
              submitted_score AS submittedScore, expected_score AS expectedScore,
              tolerance, absolute_deviation AS absoluteDeviation,
              within_tolerance AS withinTolerance,
              submitted_critical_fail AS submittedCriticalFail,
              expected_critical_fail AS expectedCriticalFail,
              critical_agreement AS criticalAgreement,
              evaluator_observation AS evaluatorObservation
         FROM evaluator_calibration_response WHERE assignment_id = ?`,
      String(assignmentId),
    ),
  ]);
  return { ...assignment, program, responses: normalizeCalibration(responses) };
}

function scoreCalibration(program, inputResponses, submit) {
  const inputMap = new Map((Array.isArray(inputResponses) ? inputResponses : []).map(item => [`${item.anchorId}:${item.criterionId}`, item]));
  const calculated = [];
  let within = 0;
  let criticalTotal = 0;
  let criticalMatches = 0;
  let deviationTotal = 0;
  for (const anchor of program.anchors.filter(item => item.active)) {
    for (const expected of anchor.expectedScores) {
      const criterion = program.criteria.find(item => item.criterionId === expected.criterionId);
      const input = inputMap.get(`${anchor.anchorId}:${expected.criterionId}`);
      if (!input && submit) fail(400, `Score every criterion for anchor “${anchor.anchorTitle}”.`, 'CALIBRATION_RESPONSE_INCOMPLETE');
      if (!input) continue;
      const submittedScore = Number(input.submittedScore);
      if (!Number.isFinite(submittedScore) || submittedScore < 0 || submittedScore > number(criterion?.maxScore)) {
        fail(400, `Calibration score for “${criterion?.criterionTitle || 'criterion'}” is outside the rubric range.`, 'CALIBRATION_SCORE_RANGE');
      }
      const tolerance = number(expected.tolerance, program.defaultScoreTolerance);
      const absoluteDeviation = Math.abs(submittedScore - number(expected.expectedScore));
      const withinTolerance = absoluteDeviation <= tolerance + 0.00001;
      const submittedCriticalFail = Boolean(input.submittedCriticalFail);
      const expectedCriticalFail = Boolean(expected.expectedCriticalFail);
      const criticalAgreement = submittedCriticalFail === expectedCriticalFail;
      if (withinTolerance) within += 1;
      deviationTotal += absoluteDeviation;
      if (criterion?.critical) {
        criticalTotal += 1;
        if (criticalAgreement) criticalMatches += 1;
      }
      calculated.push({
        anchorId: anchor.anchorId,
        criterionId: expected.criterionId,
        submittedScore,
        expectedScore: number(expected.expectedScore),
        tolerance,
        absoluteDeviation,
        withinTolerance,
        submittedCriticalFail,
        expectedCriticalFail,
        criticalAgreement,
        evaluatorObservation: text(input.evaluatorObservation, 20000) || null,
      });
    }
  }
  const count = calculated.length;
  const agreementPct = count ? within / count * 100 : 0;
  const criticalAgreementPct = criticalTotal ? criticalMatches / criticalTotal * 100 : 100;
  const meanAbsoluteDeviation = count ? deviationTotal / count : 0;
  const scorePct = Math.round((agreementPct * 0.75 + criticalAgreementPct * 0.25) * 100) / 100;
  const result = scorePct >= number(program.passingPct) && agreementPct >= number(program.minimumAgreementPct) ? 'PASS' : 'FAIL';
  return {
    responses: calculated,
    scorePct,
    agreementPct: Math.round(agreementPct * 100) / 100,
    criticalAgreementPct: Math.round(criticalAgreementPct * 100) / 100,
    meanAbsoluteDeviation: Math.round(meanAbsoluteDeviation * 100) / 100,
    result,
  };
}

export async function saveCalibrationSubmission({ assignmentId, evaluatorId, evaluatorType, responses, submit = false }) {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRawUnsafe(
      `SELECT assignment_id AS assignmentId, program_id AS programId,
              evaluator_id AS evaluatorId, evaluator_type AS evaluatorType,
              status, attempt_no AS attemptNo
         FROM evaluator_calibration_assignment
        WHERE assignment_id = ? LIMIT 1 FOR UPDATE`,
      String(assignmentId),
    );
    const assignment = normalizeCalibration(locked[0] || null);
    if (!assignment || assignment.evaluatorId !== String(evaluatorId) || assignment.evaluatorType !== String(evaluatorType)) {
      fail(404, 'Calibration assignment not found.', 'CALIBRATION_ASSIGNMENT_NOT_FOUND');
    }
    if (!['ASSIGNED', 'IN_PROGRESS'].includes(assignment.status)) fail(409, 'This calibration attempt is already locked.', 'CALIBRATION_ASSIGNMENT_LOCKED');
    const program = await getCalibrationProgram(assignment.programId, tx);
    const calculated = scoreCalibration(program, responses, submit);
    await tx.$executeRawUnsafe(`DELETE FROM evaluator_calibration_response WHERE assignment_id = ?`, String(assignmentId));
    for (const item of calculated.responses) {
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_calibration_response
           (response_id, assignment_id, anchor_id, criterion_id,
            submitted_score, expected_score, tolerance, absolute_deviation,
            within_tolerance, submitted_critical_fail, expected_critical_fail,
            critical_agreement, evaluator_observation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), String(assignmentId), item.anchorId, item.criterionId,
        item.submittedScore, item.expectedScore, item.tolerance, item.absoluteDeviation,
        item.withinTolerance ? 1 : 0, item.submittedCriticalFail ? 1 : 0,
        item.expectedCriticalFail ? 1 : 0, item.criticalAgreement ? 1 : 0,
        item.evaluatorObservation,
      );
    }
    if (!submit) {
      await tx.$executeRawUnsafe(
        `UPDATE evaluator_calibration_assignment
            SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, UTC_TIMESTAMP(3))
          WHERE assignment_id = ?`,
        String(assignmentId),
      );
      return getCalibrationAssignment(assignmentId, tx);
    }
    const passed = calculated.result === 'PASS';
    const validUntil = passed
      ? new Date(Date.now() + number(program.authorizationValidDays, 180) * 86400000)
      : null;
    await tx.$executeRawUnsafe(
      `UPDATE evaluator_calibration_assignment
          SET status = ?, submitted_at = UTC_TIMESTAMP(3), score_pct = ?,
              mean_absolute_deviation = ?, agreement_pct = ?,
              critical_agreement_pct = ?, result = ?, certified_at = ?,
              valid_until = ?, finalized_by = ?
        WHERE assignment_id = ?`,
      passed ? 'PASSED' : 'FAILED', calculated.scorePct,
      calculated.meanAbsoluteDeviation, calculated.agreementPct,
      calculated.criticalAgreementPct, calculated.result,
      passed ? new Date() : null, validUntil, String(evaluatorId), String(assignmentId),
    );
    if (passed) {
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_authorization
           (authorization_id, evaluator_id, evaluator_type, template_id,
            program_id, calibration_assignment_id, status,
            calibration_score_pct, authorized_by, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           program_id = VALUES(program_id), calibration_assignment_id = VALUES(calibration_assignment_id),
           status = 'ACTIVE', calibration_score_pct = VALUES(calibration_score_pct),
           authorized_by = VALUES(authorized_by), authorized_at = UTC_TIMESTAMP(3),
           valid_until = VALUES(valid_until), suspended_by = NULL, suspended_at = NULL,
           suspension_reason = NULL, revoked_by = NULL, revoked_at = NULL,
           revocation_reason = NULL`,
        randomUUID(), String(evaluatorId), String(evaluatorType), String(program.templateId),
        String(program.programId), String(assignmentId), calculated.scorePct,
        String(evaluatorId), validUntil,
      );
    }
    return getCalibrationAssignment(assignmentId, tx);
  });
}

export async function checkEvaluatorAuthorization({ evaluatorId, evaluatorType, templateId, db = prisma }) {
  const programs = await db.$queryRawUnsafe(
    `SELECT program_id AS programId FROM evaluator_calibration_program
      WHERE template_id = ? AND status = 'PUBLISHED' AND active = 1 LIMIT 1`,
    String(templateId),
  );
  if (!programs.length) return { required: false, allowed: true, reason: null };
  await db.$executeRawUnsafe(
    `UPDATE evaluator_authorization
        SET status = 'EXPIRED'
      WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
        AND status = 'ACTIVE' AND valid_until <= UTC_TIMESTAMP(3)`,
    String(evaluatorId), String(evaluatorType), String(templateId),
  );
  const rows = await db.$queryRawUnsafe(
    `SELECT authorization_id AS authorizationId, status,
            calibration_score_pct AS calibrationScorePct,
            authorized_at AS authorizedAt, valid_until AS validUntil,
            suspension_reason AS suspensionReason, revocation_reason AS revocationReason
       FROM evaluator_authorization
      WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ? LIMIT 1`,
    String(evaluatorId), String(evaluatorType), String(templateId),
  );
  const authorization = normalizeCalibration(rows[0] || null);
  if (!authorization) return { required: true, allowed: false, reason: 'Complete the published calibration program before evaluating this rubric version.' };
  if (authorization.status !== 'ACTIVE') {
    return {
      required: true,
      allowed: false,
      reason: authorization.suspensionReason || authorization.revocationReason || `Evaluator authorization is ${String(authorization.status).toLowerCase()}.`,
      authorization,
    };
  }
  return { required: true, allowed: true, reason: null, authorization };
}

function evaluatorKey(id, type) {
  return `${type}:${id}`;
}

function sortedPair(left, right) {
  return evaluatorKey(left.evaluatorId, left.evaluatorType).localeCompare(evaluatorKey(right.evaluatorId, right.evaluatorType)) <= 0
    ? [left, right] : [right, left];
}

export async function calculateReliability({ periodStart, periodEnd, actorId = 'reliability-worker' }) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) fail(400, 'Reliability period is invalid.', 'RELIABILITY_PERIOD_INVALID');
  const rows = normalizeCalibration(await prisma.$queryRawUnsafe(
    `SELECT e.assignment_id AS assignmentId, a.template_id AS templateId,
            e.evaluator_id AS evaluatorId, e.evaluator_type AS evaluatorType,
            e.percentage, e.critical_fail AS criticalFail,
            CASE WHEN m.case_id IS NULL THEN 0 ELSE 1 END AS moderated
       FROM practical_evaluation e
       INNER JOIN practical_assessment_assignment a ON a.assignment_id = e.assignment_id
       LEFT JOIN practical_moderation_case m ON m.assignment_id = a.assignment_id
      WHERE e.status = 'SUBMITTED'
        AND DATE(e.submitted_at) BETWEEN DATE(?) AND DATE(?)
      ORDER BY a.template_id, e.assignment_id, e.evaluator_slot`,
    start, end,
  ));
  const byAssignment = new Map();
  for (const row of rows) {
    if (!byAssignment.has(row.assignmentId)) byAssignment.set(row.assignmentId, []);
    byAssignment.get(row.assignmentId).push(row);
  }
  const metrics = new Map();
  const pairMetrics = new Map();
  const templateScores = new Map();
  for (const row of rows) {
    if (!templateScores.has(row.templateId)) templateScores.set(row.templateId, []);
    templateScores.get(row.templateId).push(number(row.percentage));
    const key = `${row.templateId}|${evaluatorKey(row.evaluatorId, row.evaluatorType)}`;
    if (!metrics.has(key)) metrics.set(key, {
      templateId: row.templateId,
      evaluatorId: row.evaluatorId,
      evaluatorType: row.evaluatorType,
      evaluationCount: 0,
      scoreTotal: 0,
      pairedCount: 0,
      differenceTotal: 0,
      withinFive: 0,
      criticalAgreement: 0,
      moderated: 0,
    });
    const item = metrics.get(key);
    item.evaluationCount += 1;
    item.scoreTotal += number(row.percentage);
  }
  for (const evaluations of byAssignment.values()) {
    if (evaluations.length !== 2) continue;
    const [left, right] = evaluations;
    const difference = Math.abs(number(left.percentage) - number(right.percentage));
    const withinFive = difference <= 5.00001;
    const criticalAgreement = Boolean(left.criticalFail) === Boolean(right.criticalFail);
    for (const [own, peer] of [[left, right], [right, left]]) {
      const key = `${own.templateId}|${evaluatorKey(own.evaluatorId, own.evaluatorType)}`;
      const item = metrics.get(key);
      item.pairedCount += 1;
      item.differenceTotal += difference;
      if (withinFive) item.withinFive += 1;
      if (criticalAgreement) item.criticalAgreement += 1;
      if (own.moderated) item.moderated += 1;
      item.peerScoreTotal = number(item.peerScoreTotal) + number(peer.percentage);
    }
    const [a, b] = sortedPair(left, right);
    const pairKey = `${a.templateId}|${evaluatorKey(a.evaluatorId, a.evaluatorType)}|${evaluatorKey(b.evaluatorId, b.evaluatorType)}`;
    if (!pairMetrics.has(pairKey)) pairMetrics.set(pairKey, {
      templateId: a.templateId, a, b, count: 0, differenceTotal: 0, withinFive: 0, criticalAgreement: 0, moderated: 0,
    });
    const pair = pairMetrics.get(pairKey);
    pair.count += 1;
    pair.differenceTotal += difference;
    if (withinFive) pair.withinFive += 1;
    if (criticalAgreement) pair.criticalAgreement += 1;
    if (a.moderated) pair.moderated += 1;
  }
  const policies = normalizeCalibration(await prisma.$queryRawUnsafe(
    `SELECT template_id AS templateId, minimum_agreement_pct AS minimumAgreementPct,
            maximum_severity_index AS maximumSeverityIndex
       FROM evaluator_calibration_program WHERE status = 'PUBLISHED' AND active = 1`,
  ));
  const policyMap = new Map(policies.map(item => [item.templateId, item]));
  const periodStartDate = start.toISOString().slice(0, 10);
  const periodEndDate = end.toISOString().slice(0, 10);
  let snapshots = 0;
  let actions = 0;
  await prisma.$transaction(async tx => {
    for (const item of metrics.values()) {
      const templateValues = templateScores.get(item.templateId) || [];
      const templateAverage = templateValues.length ? templateValues.reduce((sum, value) => sum + value, 0) / templateValues.length : 0;
      const averageScore = item.evaluationCount ? item.scoreTotal / item.evaluationCount : 0;
      const mad = item.pairedCount ? item.differenceTotal / item.pairedCount : null;
      const agreement = item.pairedCount ? item.withinFive / item.pairedCount * 100 : null;
      const critical = item.pairedCount ? item.criticalAgreement / item.pairedCount * 100 : null;
      const moderation = item.pairedCount ? item.moderated / item.pairedCount * 100 : null;
      const severity = averageScore - templateAverage;
      const policy = policyMap.get(item.templateId) || { minimumAgreementPct: 80, maximumSeverityIndex: 8 };
      let reliabilityStatus = 'INSUFFICIENT_DATA';
      if (item.pairedCount >= 5) {
        const severe = Math.abs(severity) > number(policy.maximumSeverityIndex, 8) * 1.5
          || number(agreement) < number(policy.minimumAgreementPct, 80) - 15
          || number(critical) < 70;
        const watch = Math.abs(severity) > number(policy.maximumSeverityIndex, 8)
          || number(agreement) < number(policy.minimumAgreementPct, 80)
          || number(critical) < 85;
        reliabilityStatus = severe ? 'RECALIBRATION_REQUIRED' : watch ? 'WATCH' : 'RELIABLE';
      }
      const biasFlag = Math.abs(severity) > number(policy.maximumSeverityIndex, 8);
      const snapshotId = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_reliability_snapshot
           (snapshot_id, period_start, period_end, template_id,
            evaluator_id, evaluator_type, evaluation_count, paired_evaluation_count,
            average_score_pct, template_average_score_pct, mean_absolute_difference,
            agreement_within_five_pct, critical_agreement_pct, moderation_rate_pct,
            severity_index, reliability_status, bias_flag, calculated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           snapshot_id = VALUES(snapshot_id), evaluation_count = VALUES(evaluation_count),
           paired_evaluation_count = VALUES(paired_evaluation_count),
           average_score_pct = VALUES(average_score_pct), template_average_score_pct = VALUES(template_average_score_pct),
           mean_absolute_difference = VALUES(mean_absolute_difference),
           agreement_within_five_pct = VALUES(agreement_within_five_pct),
           critical_agreement_pct = VALUES(critical_agreement_pct), moderation_rate_pct = VALUES(moderation_rate_pct),
           severity_index = VALUES(severity_index), reliability_status = VALUES(reliability_status),
           bias_flag = VALUES(bias_flag), calculated_at = UTC_TIMESTAMP(3), calculated_by = VALUES(calculated_by)`,
        snapshotId, periodStartDate, periodEndDate, item.templateId,
        item.evaluatorId, item.evaluatorType, item.evaluationCount, item.pairedCount,
        averageScore, templateAverage, mad, agreement, critical, moderation,
        severity, reliabilityStatus, biasFlag ? 1 : 0, String(actorId),
      );
      snapshots += 1;
      if (reliabilityStatus === 'RECALIBRATION_REQUIRED') {
        const existing = await tx.$queryRawUnsafe(
          `SELECT action_id FROM evaluator_quality_action
            WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
              AND action_type = 'RECALIBRATION' AND status IN ('OPEN','IN_PROGRESS') LIMIT 1`,
          item.evaluatorId, item.evaluatorType, item.templateId,
        );
        if (!existing.length) {
          await tx.$executeRawUnsafe(
            `INSERT INTO evaluator_quality_action
               (action_id, evaluator_id, evaluator_type, template_id,
                source_snapshot_id, action_type, priority, status,
                reason, assigned_by, due_at)
             VALUES (?, ?, ?, ?, ?, 'RECALIBRATION', 'HIGH', 'OPEN', ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 14 DAY))`,
            randomUUID(), item.evaluatorId, item.evaluatorType, item.templateId,
            snapshotId,
            `Reliability requires recalibration. Agreement ${agreement == null ? 'n/a' : agreement.toFixed(1)}%, severity ${severity.toFixed(1)}, critical agreement ${critical == null ? 'n/a' : critical.toFixed(1)}%.`,
            String(actorId),
          );
          actions += 1;
        }
      }
    }
    for (const item of pairMetrics.values()) {
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_reliability_pair
           (pair_id, period_start, period_end, template_id,
            evaluator_a_id, evaluator_a_type, evaluator_b_id, evaluator_b_type,
            paired_count, mean_absolute_difference, agreement_within_five_pct,
            critical_agreement_pct, moderation_rate_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           pair_id = VALUES(pair_id), paired_count = VALUES(paired_count),
           mean_absolute_difference = VALUES(mean_absolute_difference),
           agreement_within_five_pct = VALUES(agreement_within_five_pct),
           critical_agreement_pct = VALUES(critical_agreement_pct),
           moderation_rate_pct = VALUES(moderation_rate_pct), calculated_at = UTC_TIMESTAMP(3)`,
        randomUUID(), periodStartDate, periodEndDate, item.templateId,
        item.a.evaluatorId, item.a.evaluatorType, item.b.evaluatorId, item.b.evaluatorType,
        item.count, item.differenceTotal / item.count, item.withinFive / item.count * 100,
        item.criticalAgreement / item.count * 100, item.moderated / item.count * 100,
      );
    }
  });
  return { evaluations: rows.length, pairedAssignments: [...pairMetrics.values()].reduce((sum, item) => sum + item.count, 0), snapshots, pairs: pairMetrics.size, actions };
}

export async function expireEvaluatorAuthorizations(actorId = 'authorization-worker') {
  const expired = await prisma.$executeRawUnsafe(
    `UPDATE evaluator_authorization SET status = 'EXPIRED'
      WHERE status = 'ACTIVE' AND valid_until <= UTC_TIMESTAMP(3)`,
  );
  const assignments = await prisma.$executeRawUnsafe(
    `UPDATE evaluator_calibration_assignment SET status = 'EXPIRED'
      WHERE status = 'PASSED' AND valid_until <= UTC_TIMESTAMP(3)`,
  );
  return { expiredAuthorizations: number(expired), expiredAssignments: number(assignments), actorId };
}
