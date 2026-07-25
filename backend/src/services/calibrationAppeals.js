import { createHash, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { emitNotificationEvent } from './notificationOutbox.js';
import { getCalibrationAssignment } from './calibrationGovernance.js';

const OPEN_STATUSES = ['SUBMITTED', 'ACKNOWLEDGED', 'INFORMATION_REQUESTED', 'UNDER_REVIEW'];
const APPEAL_WINDOW_DAYS = Math.max(1, Number(process.env.LMS_CALIBRATION_APPEAL_WINDOW_DAYS || 14));
const APPEAL_SLA_DAYS = Math.max(1, Number(process.env.LMS_CALIBRATION_APPEAL_SLA_DAYS || 5));
const REASSESSMENT_DUE_DAYS = Math.max(1, Number(process.env.LMS_CALIBRATION_REASSESSMENT_DUE_DAYS || 7));

function fail(status, message, code = 'CALIBRATION_APPEAL_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
}

export function normalizeAppeal(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeAppeal);
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeAppeal(item)]));
  }
  return value;
}

function text(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function json(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function addDays(value, days) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result;
}

function dateKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10).replaceAll('-', '');
}

function canonicalize(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex');
}

function appealCode() {
  return `MCN-APL-${dateKey()}-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

function packCode() {
  return `MCN-GOV-${dateKey()}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

async function branchAdministrators(branch, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT login_id AS userId
       FROM role_access_matrix
      WHERE active = 1 AND portal_access = 'Admin'
        AND (role IN ('Super Admin','SuperAdmin','CEO') OR branch = ?)
      ORDER BY CASE WHEN role IN ('Super Admin','SuperAdmin','CEO') THEN 1 ELSE 0 END, login_id
      LIMIT 250`,
    String(branch || ''),
  );
  return [...new Set(normalizeAppeal(rows).map(item => item.userId).filter(Boolean))];
}

async function assignmentSummary(assignmentId, db = prisma) {
  const rows = normalizeAppeal(await db.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.program_id AS programId,
            a.evaluator_id AS evaluatorId, a.evaluator_type AS evaluatorType,
            a.attempt_no AS attemptNo, a.status, a.result,
            a.score_pct AS scorePct, a.agreement_pct AS agreementPct,
            a.critical_agreement_pct AS criticalAgreementPct,
            a.submitted_at AS submittedAt, a.certified_at AS certifiedAt,
            a.valid_until AS validUntil, a.updated_at AS updatedAt,
            p.program_code AS programCode, p.program_name AS programName,
            p.max_attempts AS maxAttempts, p.template_id AS templateId,
            t.template_code AS templateCode, t.template_name AS templateName,
            t.version_no AS templateVersion,
            r.name AS evaluatorName, r.role AS evaluatorRole,
            COALESCE(r.branch, p.audience_branch, '') AS branch,
            COALESCE(r.process, p.audience_process, '') AS processName,
            COALESCE(r.lob, p.audience_lob, '') AS lobName
       FROM evaluator_calibration_assignment a
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = a.evaluator_id
      WHERE a.assignment_id = ? LIMIT 1`,
    String(assignmentId),
  ));
  return rows[0] || null;
}

async function appendAppealEvent(db, {
  appealId,
  eventType,
  actorId,
  actorType,
  comment = null,
  payload = null,
}) {
  const previous = normalizeAppeal(await db.$queryRawUnsafe(
    `SELECT sequence_no AS sequenceNo, event_hash AS eventHash
       FROM evaluator_calibration_appeal_event
      WHERE appeal_id = ? ORDER BY sequence_no DESC LIMIT 1 FOR UPDATE`,
    String(appealId),
  ));
  const sequenceNo = Number(previous[0]?.sequenceNo || 0) + 1;
  const previousHash = previous[0]?.eventHash || null;
  const eventId = randomUUID();
  const eventPayload = {
    appealId: String(appealId),
    sequenceNo,
    eventType: String(eventType),
    actorId: String(actorId || 'system'),
    actorType: String(actorType || 'system'),
    comment: text(comment) || null,
    payload: payload || null,
    previousHash,
  };
  const eventHash = sha256(eventPayload);
  await db.$executeRawUnsafe(
    `INSERT INTO evaluator_calibration_appeal_event
       (event_id, appeal_id, sequence_no, event_type, actor_id, actor_type,
        event_comment, payload_json, previous_hash, event_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId, String(appealId), sequenceNo, String(eventType),
    String(actorId || 'system'), String(actorType || 'system'),
    text(comment) || null, payload ? JSON.stringify(payload) : null,
    previousHash, eventHash,
  );
  return { eventId, sequenceNo, eventHash, previousHash };
}

function verifyTimeline(events) {
  let previousHash = null;
  for (const event of events) {
    if ((event.previousHash || null) !== previousHash) return false;
    const calculated = sha256({
      appealId: event.appealId,
      sequenceNo: Number(event.sequenceNo),
      eventType: event.eventType,
      actorId: event.actorId,
      actorType: event.actorType,
      comment: event.eventComment || null,
      payload: json(event.payloadJson),
      previousHash,
    });
    if (calculated !== event.eventHash) return false;
    previousHash = event.eventHash;
  }
  return true;
}

export async function getAppeal(appealId, db = prisma) {
  const rows = normalizeAppeal(await db.$queryRawUnsafe(
    `SELECT x.appeal_id AS appealId, x.appeal_code AS appealCode,
            x.assignment_id AS assignmentId, x.evaluator_id AS evaluatorId,
            x.evaluator_type AS evaluatorType, x.category,
            x.desired_outcome AS desiredOutcome, x.appeal_statement AS appealStatement,
            x.status, x.priority, x.branch, x.process_name AS processName,
            x.lob_name AS lobName, x.submitted_at AS submittedAt,
            x.appeal_window_ends_at AS appealWindowEndsAt, x.sla_due_at AS slaDueAt,
            x.assigned_reviewer_id AS assignedReviewerId, x.assigned_at AS assignedAt,
            x.acknowledged_at AS acknowledgedAt,
            x.last_information_requested_at AS lastInformationRequestedAt,
            x.resolved_at AS resolvedAt, x.resolved_by AS resolvedBy,
            x.resolution_type AS resolutionType, x.resolution_summary AS resolutionSummary,
            x.recommended_action AS recommendedAction,
            x.reassessment_assignment_id AS reassessmentAssignmentId,
            x.withdrawn_at AS withdrawnAt, x.withdrawal_reason AS withdrawalReason,
            p.program_name AS programName, p.program_code AS programCode,
            t.template_name AS templateName, t.version_no AS templateVersion,
            a.attempt_no AS attemptNo, a.result AS originalResult,
            a.score_pct AS originalScorePct, r.name AS evaluatorName,
            reviewer.name AS reviewerName
       FROM evaluator_calibration_appeal x
       INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = x.assignment_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = x.evaluator_id
       LEFT JOIN role_access_matrix reviewer ON reviewer.login_id = x.assigned_reviewer_id
      WHERE x.appeal_id = ? LIMIT 1`,
    String(appealId),
  ));
  const appeal = rows[0] || null;
  if (!appeal) return null;
  const [events, packs] = await Promise.all([
    db.$queryRawUnsafe(
      `SELECT event_id AS eventId, appeal_id AS appealId, sequence_no AS sequenceNo,
              event_type AS eventType, actor_id AS actorId, actor_type AS actorType,
              event_comment AS eventComment, payload_json AS payloadJson,
              previous_hash AS previousHash, event_hash AS eventHash, created_at AS createdAt
         FROM evaluator_calibration_appeal_event WHERE appeal_id = ? ORDER BY sequence_no`,
      String(appealId),
    ),
    db.$queryRawUnsafe(
      `SELECT pack_id AS packId, pack_code AS packCode, pack_type AS packType,
              version_no AS versionNo, status, manifest_hash AS manifestHash,
              generated_at AS generatedAt, expires_at AS expiresAt,
              download_count AS downloadCount
         FROM evaluator_governance_evidence_pack
        WHERE appeal_id = ? ORDER BY version_no DESC, generated_at DESC`,
      String(appealId),
    ),
  ]);
  const normalizedEvents = normalizeAppeal(events);
  return {
    ...appeal,
    events: normalizedEvents.map(item => ({ ...item, payloadJson: json(item.payloadJson) })),
    packs: normalizeAppeal(packs),
    integrityVerified: verifyTimeline(normalizedEvents),
    slaBreached: OPEN_STATUSES.includes(appeal.status) && new Date(appeal.slaDueAt).getTime() < Date.now(),
  };
}

async function emitAppealEvent({ eventType, appeal, recipients, actorId, actorType, extra = {}, idempotencyKey }) {
  if (!recipients?.length) return null;
  return emitNotificationEvent({
    eventType,
    entityType: 'CALIBRATION_APPEAL',
    entityId: appeal.appealId,
    actorId,
    actorType,
    branch: appeal.branch || '',
    processName: appeal.processName || '',
    lobName: appeal.lobName || '',
    payload: {
      recipients,
      appealCode: appeal.appealCode,
      evaluatorName: appeal.evaluatorName || appeal.evaluatorId,
      evaluatorId: appeal.evaluatorId,
      programName: appeal.programName,
      templateName: appeal.templateName,
      recipientType: appeal.evaluatorType,
      slaDueAt: appeal.slaDueAt,
      ...extra,
    },
    idempotencyKey,
  });
}

export async function createCalibrationAppeal({ assignmentId, evaluatorId, evaluatorType, category, desiredOutcome, statement }) {
  const assignment = await assignmentSummary(assignmentId);
  if (!assignment) fail(404, 'Calibration assignment not found.', 'ASSIGNMENT_NOT_FOUND');
  if (assignment.evaluatorId !== String(evaluatorId) || assignment.evaluatorType !== String(evaluatorType)) {
    fail(404, 'Calibration assignment not found.', 'ASSIGNMENT_NOT_FOUND');
  }
  if (!['PASSED', 'FAILED'].includes(assignment.status) || !['PASS', 'FAIL'].includes(assignment.result)) {
    fail(409, 'Only a finalized calibration result may be appealed.', 'ASSIGNMENT_NOT_FINALIZED');
  }
  const normalizedCategory = text(category, 50).toUpperCase();
  const normalizedOutcome = text(desiredOutcome, 50).toUpperCase();
  const appealStatement = text(statement);
  if (!['SCORE_DISAGREEMENT', 'CRITICAL_FAIL_DISAGREEMENT', 'EVIDENCE_ACCESS', 'PROCESS_VIOLATION', 'OTHER'].includes(normalizedCategory)) {
    fail(400, 'Select a valid appeal category.', 'APPEAL_CATEGORY_INVALID');
  }
  if (!['REASSESSMENT', 'SCORE_REVIEW', 'CRITICAL_FAIL_REVIEW', 'PROCESS_REVIEW', 'OTHER'].includes(normalizedOutcome)) {
    fail(400, 'Select a valid desired outcome.', 'APPEAL_OUTCOME_INVALID');
  }
  if (appealStatement.length < 40) fail(400, 'Appeal statement must contain at least 40 characters.', 'APPEAL_STATEMENT_SHORT');

  const finalizedAt = new Date(assignment.certifiedAt || assignment.submittedAt || assignment.updatedAt);
  const appealWindowEndsAt = addDays(finalizedAt, APPEAL_WINDOW_DAYS);
  if (appealWindowEndsAt.getTime() < Date.now()) {
    fail(409, `The ${APPEAL_WINDOW_DAYS}-day appeal window has closed.`, 'APPEAL_WINDOW_CLOSED', { appealWindowEndsAt });
  }

  const appealId = randomUUID();
  const code = appealCode();
  const slaDueAt = addDays(new Date(), APPEAL_SLA_DAYS);
  const priority = ['CRITICAL_FAIL_DISAGREEMENT', 'PROCESS_VIOLATION'].includes(normalizedCategory) ? 'HIGH' : 'NORMAL';
  await prisma.$transaction(async tx => {
    const existing = await tx.$queryRawUnsafe(
      `SELECT appeal_id FROM evaluator_calibration_appeal WHERE assignment_id = ? LIMIT 1 FOR UPDATE`,
      String(assignmentId),
    );
    if (existing.length) fail(409, 'An appeal already exists for this calibration attempt.', 'APPEAL_ALREADY_EXISTS');
    await tx.$executeRawUnsafe(
      `INSERT INTO evaluator_calibration_appeal
         (appeal_id, appeal_code, assignment_id, evaluator_id, evaluator_type,
          category, desired_outcome, appeal_statement, status, priority,
          branch, process_name, lob_name, appeal_window_ends_at, sla_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?)`,
      appealId, code, String(assignmentId), String(evaluatorId), String(evaluatorType),
      normalizedCategory, normalizedOutcome, appealStatement, priority,
      assignment.branch || '', assignment.processName || '', assignment.lobName || '',
      appealWindowEndsAt, slaDueAt,
    );
    await appendAppealEvent(tx, {
      appealId,
      eventType: 'SUBMITTED',
      actorId: evaluatorId,
      actorType: evaluatorType,
      comment: appealStatement,
      payload: { category: normalizedCategory, desiredOutcome: normalizedOutcome, originalResult: assignment.result, originalScorePct: assignment.scorePct },
    });
  });

  const appeal = await getAppeal(appealId);
  const admins = await branchAdministrators(assignment.branch);
  await emitAppealEvent({
    eventType: 'CALIBRATION_APPEAL_SUBMITTED',
    appeal,
    recipients: admins.map(userId => ({ userType: 'admin', userId, priority })),
    actorId: evaluatorId,
    actorType: evaluatorType,
    idempotencyKey: `calibration-appeal-submitted:${appealId}`,
  });
  return appeal;
}

export async function provideAppealInformation({ appealId, evaluatorId, evaluatorType, response }) {
  const comment = text(response);
  if (comment.length < 20) fail(400, 'Provide at least 20 characters of additional information.', 'APPEAL_INFORMATION_SHORT');
  await prisma.$transaction(async tx => {
    const rows = normalizeAppeal(await tx.$queryRawUnsafe(
      `SELECT appeal_id AS appealId, evaluator_id AS evaluatorId, evaluator_type AS evaluatorType, status
         FROM evaluator_calibration_appeal WHERE appeal_id = ? LIMIT 1 FOR UPDATE`,
      String(appealId),
    ));
    const appeal = rows[0];
    if (!appeal || appeal.evaluatorId !== String(evaluatorId) || appeal.evaluatorType !== String(evaluatorType)) {
      fail(404, 'Appeal not found.', 'APPEAL_NOT_FOUND');
    }
    if (appeal.status !== 'INFORMATION_REQUESTED') fail(409, 'This appeal is not waiting for additional information.', 'APPEAL_NOT_WAITING_INFORMATION');
    await tx.$executeRawUnsafe(
      `UPDATE evaluator_calibration_appeal SET status = 'UNDER_REVIEW' WHERE appeal_id = ?`,
      String(appealId),
    );
    await appendAppealEvent(tx, { appealId, eventType: 'INFORMATION_PROVIDED', actorId: evaluatorId, actorType: evaluatorType, comment });
  });
  const appeal = await getAppeal(appealId);
  const recipients = appeal.assignedReviewerId
    ? [{ userType: 'admin', userId: appeal.assignedReviewerId, priority: 'HIGH' }]
    : (await branchAdministrators(appeal.branch)).map(userId => ({ userType: 'admin', userId, priority: 'HIGH' }));
  await emitAppealEvent({
    eventType: 'CALIBRATION_APPEAL_INFORMATION_PROVIDED',
    appeal,
    recipients,
    actorId: evaluatorId,
    actorType: evaluatorType,
    idempotencyKey: `calibration-appeal-information-provided:${appealId}:${appeal.events.at(-1)?.sequenceNo}`,
  });
  return appeal;
}

export async function withdrawAppeal({ appealId, evaluatorId, evaluatorType, reason }) {
  const comment = text(reason);
  if (comment.length < 20) fail(400, 'Provide a withdrawal reason of at least 20 characters.', 'APPEAL_WITHDRAWAL_REASON_SHORT');
  await prisma.$transaction(async tx => {
    const rows = normalizeAppeal(await tx.$queryRawUnsafe(
      `SELECT evaluator_id AS evaluatorId, evaluator_type AS evaluatorType, status
         FROM evaluator_calibration_appeal WHERE appeal_id = ? LIMIT 1 FOR UPDATE`,
      String(appealId),
    ));
    const appeal = rows[0];
    if (!appeal || appeal.evaluatorId !== String(evaluatorId) || appeal.evaluatorType !== String(evaluatorType)) fail(404, 'Appeal not found.', 'APPEAL_NOT_FOUND');
    if (!OPEN_STATUSES.includes(appeal.status)) fail(409, 'Only an open appeal may be withdrawn.', 'APPEAL_NOT_OPEN');
    await tx.$executeRawUnsafe(
      `UPDATE evaluator_calibration_appeal
          SET status = 'WITHDRAWN', withdrawn_at = UTC_TIMESTAMP(3), withdrawal_reason = ?
        WHERE appeal_id = ?`,
      comment, String(appealId),
    );
    await appendAppealEvent(tx, { appealId, eventType: 'WITHDRAWN', actorId: evaluatorId, actorType: evaluatorType, comment });
  });
  return getAppeal(appealId);
}

async function createReassessment(tx, appeal, actorId) {
  const attempts = normalizeAppeal(await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(attempt_no),0) AS lastAttempt
       FROM evaluator_calibration_assignment
      WHERE program_id = ? AND evaluator_id = ? AND evaluator_type = ? FOR UPDATE`,
    String(appeal.programId), String(appeal.evaluatorId), String(appeal.evaluatorType),
  ));
  const attemptNo = Number(attempts[0]?.lastAttempt || 0) + 1;
  if (attemptNo > Number(appeal.maxAttempts || 1)) fail(409, 'The calibration programme has no remaining reassessment attempts.', 'REASSESSMENT_ATTEMPT_LIMIT');
  const assignmentId = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO evaluator_calibration_assignment
       (assignment_id, program_id, evaluator_id, evaluator_type,
        attempt_no, status, assigned_by, due_at)
     VALUES (?, ?, ?, ?, ?, 'ASSIGNED', ?, ?)`,
    assignmentId, String(appeal.programId), String(appeal.evaluatorId), String(appeal.evaluatorType),
    attemptNo, String(actorId), addDays(new Date(), REASSESSMENT_DUE_DAYS),
  );
  return assignmentId;
}

export async function manageCalibrationAppeal({ appealId, action, actorId, actorType = 'admin', payload = {} }) {
  const normalizedAction = text(action, 40).toUpperCase();
  let reassessmentAssignmentId = null;
  await prisma.$transaction(async tx => {
    const rows = normalizeAppeal(await tx.$queryRawUnsafe(
      `SELECT x.appeal_id AS appealId, x.status, x.evaluator_id AS evaluatorId,
              x.evaluator_type AS evaluatorType, x.assigned_reviewer_id AS assignedReviewerId,
              a.program_id AS programId, p.max_attempts AS maxAttempts
         FROM evaluator_calibration_appeal x
         INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = x.assignment_id
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
        WHERE x.appeal_id = ? LIMIT 1 FOR UPDATE`,
      String(appealId),
    ));
    const appeal = rows[0];
    if (!appeal) fail(404, 'Appeal not found.', 'APPEAL_NOT_FOUND');
    if (!OPEN_STATUSES.includes(appeal.status)) fail(409, 'This appeal is already closed.', 'APPEAL_ALREADY_CLOSED');

    if (normalizedAction === 'ACKNOWLEDGE') {
      await tx.$executeRawUnsafe(
        `UPDATE evaluator_calibration_appeal
            SET status = 'ACKNOWLEDGED', acknowledged_at = COALESCE(acknowledged_at, UTC_TIMESTAMP(3)),
                assigned_reviewer_id = COALESCE(assigned_reviewer_id, ?),
                assigned_at = COALESCE(assigned_at, UTC_TIMESTAMP(3))
          WHERE appeal_id = ?`,
        String(actorId), String(appealId),
      );
      await appendAppealEvent(tx, { appealId, eventType: 'ACKNOWLEDGED', actorId, actorType, comment: text(payload.comment) || null });
      return;
    }

    if (normalizedAction === 'ASSIGN') {
      const reviewerId = text(payload.reviewerId, 120);
      if (!reviewerId) fail(400, 'Select an active appeal reviewer.', 'APPEAL_REVIEWER_REQUIRED');
      const reviewer = await tx.$queryRawUnsafe(
        `SELECT login_id FROM role_access_matrix WHERE login_id = ? AND active = 1 AND portal_access = 'Admin' LIMIT 1`,
        reviewerId,
      );
      if (!reviewer.length) fail(404, 'Active appeal reviewer not found.', 'APPEAL_REVIEWER_NOT_FOUND');
      await tx.$executeRawUnsafe(
        `UPDATE evaluator_calibration_appeal
            SET status = 'UNDER_REVIEW', assigned_reviewer_id = ?, assigned_at = UTC_TIMESTAMP(3),
                acknowledged_at = COALESCE(acknowledged_at, UTC_TIMESTAMP(3))
          WHERE appeal_id = ?`,
        reviewerId, String(appealId),
      );
      await appendAppealEvent(tx, { appealId, eventType: 'ASSIGNED', actorId, actorType, comment: text(payload.comment) || null, payload: { reviewerId } });
      return;
    }

    if (normalizedAction === 'REQUEST_INFORMATION') {
      const comment = text(payload.comment);
      if (comment.length < 20) fail(400, 'Information request must contain at least 20 characters.', 'APPEAL_INFORMATION_REQUEST_SHORT');
      await tx.$executeRawUnsafe(
        `UPDATE evaluator_calibration_appeal
            SET status = 'INFORMATION_REQUESTED', assigned_reviewer_id = COALESCE(assigned_reviewer_id, ?),
                assigned_at = COALESCE(assigned_at, UTC_TIMESTAMP(3)),
                acknowledged_at = COALESCE(acknowledged_at, UTC_TIMESTAMP(3)),
                last_information_requested_at = UTC_TIMESTAMP(3)
          WHERE appeal_id = ?`,
        String(actorId), String(appealId),
      );
      await appendAppealEvent(tx, { appealId, eventType: 'INFORMATION_REQUESTED', actorId, actorType, comment });
      return;
    }

    if (normalizedAction === 'RESOLVE') {
      const resolutionType = text(payload.resolutionType, 50).toUpperCase();
      const resolutionSummary = text(payload.resolutionSummary);
      const recommendedAction = text(payload.recommendedAction || 'NONE', 50).toUpperCase();
      if (!['UPHELD', 'PARTIALLY_UPHELD', 'OVERTURNED', 'PROCEDURAL_REMEDY', 'NO_ACTION'].includes(resolutionType)) {
        fail(400, 'Select a valid appeal resolution.', 'APPEAL_RESOLUTION_INVALID');
      }
      if (!['NONE', 'REASSESSMENT', 'COACHING', 'RESTORE_AUTHORIZATION', 'SUSPEND_AUTHORIZATION', 'POLICY_REVIEW'].includes(recommendedAction)) {
        fail(400, 'Select a valid recommended action.', 'APPEAL_ACTION_INVALID');
      }
      if (resolutionSummary.length < 40) fail(400, 'Resolution summary must contain at least 40 characters.', 'APPEAL_RESOLUTION_SHORT');
      if (recommendedAction === 'REASSESSMENT') reassessmentAssignmentId = await createReassessment(tx, appeal, actorId);
      await tx.$executeRawUnsafe(
        `UPDATE evaluator_calibration_appeal
            SET status = 'RESOLVED', resolved_at = UTC_TIMESTAMP(3), resolved_by = ?,
                resolution_type = ?, resolution_summary = ?, recommended_action = ?,
                reassessment_assignment_id = ?
          WHERE appeal_id = ?`,
        String(actorId), resolutionType, resolutionSummary, recommendedAction,
        reassessmentAssignmentId, String(appealId),
      );
      await appendAppealEvent(tx, {
        appealId,
        eventType: 'RESOLVED',
        actorId,
        actorType,
        comment: resolutionSummary,
        payload: { resolutionType, recommendedAction, reassessmentAssignmentId },
      });
      return;
    }

    fail(400, 'Unsupported appeal action.', 'APPEAL_ACTION_UNSUPPORTED');
  });

  const appeal = await getAppeal(appealId);
  const recipient = [{ userType: appeal.evaluatorType, userId: appeal.evaluatorId, priority: normalizedAction === 'RESOLVE' ? 'HIGH' : 'NORMAL' }];
  const eventMap = {
    ACKNOWLEDGE: 'CALIBRATION_APPEAL_ACKNOWLEDGED',
    REQUEST_INFORMATION: 'CALIBRATION_APPEAL_INFORMATION_REQUESTED',
    RESOLVE: 'CALIBRATION_APPEAL_RESOLVED',
  };
  if (eventMap[normalizedAction]) {
    await emitAppealEvent({
      eventType: eventMap[normalizedAction],
      appeal,
      recipients: recipient,
      actorId,
      actorType,
      extra: { resolutionType: appeal.resolutionType, recommendedAction: appeal.recommendedAction },
      idempotencyKey: `calibration-appeal-${normalizedAction.toLowerCase()}:${appealId}:${appeal.events.at(-1)?.sequenceNo}`,
    });
  }
  if (reassessmentAssignmentId) {
    await emitNotificationEvent({
      eventType: 'CALIBRATION_ASSIGNED',
      entityType: 'CALIBRATION_ASSIGNMENT',
      entityId: reassessmentAssignmentId,
      actorId,
      actorType,
      branch: appeal.branch || '',
      processName: appeal.processName || '',
      lobName: appeal.lobName || '',
      payload: {
        recipientType: appeal.evaluatorType,
        recipientId: appeal.evaluatorId,
        evaluatorName: appeal.evaluatorName,
        programName: appeal.programName,
        templateName: appeal.templateName,
        priority: 'HIGH',
      },
      idempotencyKey: `calibration-assigned:${reassessmentAssignmentId}`,
    });
  }
  if (normalizedAction === 'RESOLVE') await generateGovernanceEvidencePack({ assignmentId: appeal.assignmentId, appealId, packType: 'COMPLETE_GOVERNANCE', actorId, scopeLevel: 'SELF' });
  return getAppeal(appealId);
}

async function collectEvidenceManifest({ assignmentId, appealId = null, packType, generatedBy }) {
  const assignment = await getCalibrationAssignment(assignmentId);
  if (!assignment) fail(404, 'Calibration assignment not found.', 'ASSIGNMENT_NOT_FOUND');
  const [authorization, certificates, reliability, auditRows, appeal] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT authorization_id AS authorizationId, status, calibration_score_pct AS calibrationScorePct,
              authorized_by AS authorizedBy, authorized_at AS authorizedAt, valid_until AS validUntil,
              suspended_by AS suspendedBy, suspended_at AS suspendedAt, suspension_reason AS suspensionReason,
              revoked_by AS revokedBy, revoked_at AS revokedAt, revocation_reason AS revocationReason
         FROM evaluator_authorization
        WHERE calibration_assignment_id = ? OR
              (evaluator_id = ? AND evaluator_type = ? AND template_id = ?)
        ORDER BY updated_at DESC LIMIT 5`,
      String(assignmentId), String(assignment.evaluatorId), String(assignment.evaluatorType), String(assignment.templateId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT certificate_code AS certificateCode, certificate_type AS certificateType,
              status, valid_from AS validFrom, valid_until AS validUntil,
              verification_hash AS verificationHash, snapshot_json AS snapshotJson,
              issued_at AS issuedAt
         FROM evaluator_authorization_certificate
        WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
        ORDER BY issued_at DESC LIMIT 10`,
      String(assignment.evaluatorId), String(assignment.evaluatorType), String(assignment.templateId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT period_start AS periodStart, period_end AS periodEnd,
              evaluation_count AS evaluationCount, paired_evaluation_count AS pairedEvaluationCount,
              agreement_within_five_pct AS agreementWithinFivePct,
              critical_agreement_pct AS criticalAgreementPct,
              moderation_rate_pct AS moderationRatePct, severity_index AS severityIndex,
              reliability_status AS reliabilityStatus, bias_flag AS biasFlag, calculated_at AS calculatedAt
         FROM evaluator_reliability_snapshot
        WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
        ORDER BY period_end DESC LIMIT 24`,
      String(assignment.evaluatorId), String(assignment.evaluatorType), String(assignment.templateId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT user_identity AS userIdentity, user_role AS userRole, action, module,
              reference_id AS referenceId, old_value AS oldValue, new_value AS newValue,
              status, source, timestamp
         FROM audit_log
        WHERE reference_id IN (?, ?) OR
              (module = 'EvaluatorQuality' AND user_identity = ?)
        ORDER BY timestamp DESC LIMIT 500`,
      String(assignmentId), String(appealId || ''), String(assignment.evaluatorId),
    ),
    appealId ? getAppeal(appealId) : Promise.resolve(null),
  ]);
  return canonicalize({
    schemaVersion: 'MCN-EVALUATOR-GOVERNANCE-PACK-V1',
    generatedAt: new Date().toISOString(),
    generatedBy: String(generatedBy),
    packType,
    assignment,
    appeal,
    authorization: normalizeAppeal(authorization),
    certificates: normalizeAppeal(certificates).map(item => ({ ...item, snapshotJson: json(item.snapshotJson) })),
    reliability: normalizeAppeal(reliability),
    audit: normalizeAppeal(auditRows).map(item => ({ ...item, oldValue: json(item.oldValue), newValue: json(item.newValue) })),
  });
}

export async function generateGovernanceEvidencePack({ assignmentId, appealId = null, packType = 'ASSIGNMENT', actorId, scopeLevel = 'SELF', expiresAt = null }) {
  const normalizedPackType = text(packType, 40).toUpperCase();
  if (!['ASSIGNMENT', 'APPEAL', 'COMPLETE_GOVERNANCE'].includes(normalizedPackType)) fail(400, 'Select a valid evidence pack type.', 'PACK_TYPE_INVALID');
  const assignment = await assignmentSummary(assignmentId);
  if (!assignment) fail(404, 'Calibration assignment not found.', 'ASSIGNMENT_NOT_FOUND');
  if (appealId) {
    const appeal = await getAppeal(appealId);
    if (!appeal || appeal.assignmentId !== String(assignmentId)) fail(400, 'Appeal does not belong to the selected assignment.', 'PACK_APPEAL_MISMATCH');
  }
  const manifest = await collectEvidenceManifest({ assignmentId, appealId, packType: normalizedPackType, generatedBy: actorId });
  const manifestHash = sha256(manifest);
  const existing = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT pack_id AS packId FROM evaluator_governance_evidence_pack WHERE manifest_hash = ? LIMIT 1`,
    manifestHash,
  ));
  if (existing.length) return getEvidencePack(existing[0].packId);
  const subjectKey = appealId ? `appeal:${appealId}` : `assignment:${assignmentId}`;
  const packId = randomUUID();
  const code = packCode();
  await prisma.$transaction(async tx => {
    const versions = normalizeAppeal(await tx.$queryRawUnsafe(
      `SELECT COALESCE(MAX(version_no),0) AS lastVersion
         FROM evaluator_governance_evidence_pack
        WHERE subject_key = ? AND pack_type = ? FOR UPDATE`,
      subjectKey, normalizedPackType,
    ));
    const versionNo = Number(versions[0]?.lastVersion || 0) + 1;
    await tx.$executeRawUnsafe(
      `INSERT INTO evaluator_governance_evidence_pack
         (pack_id, pack_code, subject_key, assignment_id, appeal_id,
          evaluator_id, evaluator_type, pack_type, version_no, status,
          scope_level, manifest_json, manifest_hash, generated_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      packId, code, subjectKey, String(assignmentId), appealId ? String(appealId) : null,
      assignment.evaluatorId, assignment.evaluatorType, normalizedPackType, versionNo,
      text(scopeLevel, 20).toUpperCase(), JSON.stringify(manifest), manifestHash,
      String(actorId), expiresAt || null,
    );
    if (appealId) {
      await appendAppealEvent(tx, {
        appealId,
        eventType: 'PACK_GENERATED',
        actorId,
        actorType: 'admin',
        payload: { packId, packCode: code, packType: normalizedPackType, manifestHash },
      });
    }
  });
  const pack = await getEvidencePack(packId);
  await emitNotificationEvent({
    eventType: 'CALIBRATION_EVIDENCE_PACK_READY',
    entityType: 'EVALUATOR_GOVERNANCE_PACK',
    entityId: packId,
    actorId,
    actorType: 'admin',
    branch: assignment.branch || '',
    processName: assignment.processName || '',
    lobName: assignment.lobName || '',
    payload: {
      recipientType: assignment.evaluatorType,
      recipientId: assignment.evaluatorId,
      packCode: code,
      programName: assignment.programName,
      templateName: assignment.templateName,
      priority: 'NORMAL',
    },
    idempotencyKey: `calibration-evidence-pack-ready:${packId}`,
  });
  return pack;
}

export async function getEvidencePack(packId, db = prisma) {
  const rows = normalizeAppeal(await db.$queryRawUnsafe(
    `SELECT p.pack_id AS packId, p.pack_code AS packCode, p.subject_key AS subjectKey,
            p.assignment_id AS assignmentId, p.appeal_id AS appealId,
            p.evaluator_id AS evaluatorId, p.evaluator_type AS evaluatorType,
            p.pack_type AS packType, p.version_no AS versionNo, p.status,
            p.scope_level AS scopeLevel, p.manifest_json AS manifestJson,
            p.manifest_hash AS manifestHash, p.generated_by AS generatedBy,
            p.generated_at AS generatedAt, p.expires_at AS expiresAt,
            p.download_count AS downloadCount, p.last_downloaded_at AS lastDownloadedAt,
            t.template_name AS templateName, t.version_no AS templateVersion,
            pr.program_name AS programName, r.name AS evaluatorName,
            COALESCE(r.branch, pr.audience_branch, '') AS branch
       FROM evaluator_governance_evidence_pack p
       INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = p.assignment_id
       INNER JOIN evaluator_calibration_program pr ON pr.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = pr.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = p.evaluator_id
      WHERE p.pack_id = ? LIMIT 1`,
    String(packId),
  ));
  const pack = rows[0] || null;
  if (!pack) return null;
  return { ...pack, manifestJson: json(pack.manifestJson), integrityVerified: sha256(json(pack.manifestJson)) === pack.manifestHash };
}

export async function recordEvidencePackDownload(packId) {
  await prisma.$executeRawUnsafe(
    `UPDATE evaluator_governance_evidence_pack
        SET download_count = download_count + 1, last_downloaded_at = UTC_TIMESTAMP(3)
      WHERE pack_id = ? AND status = 'ACTIVE'`,
    String(packId),
  );
  return getEvidencePack(packId);
}

export async function revokeEvidencePack({ packId, actorId, reason }) {
  const comment = text(reason);
  if (comment.length < 20) fail(400, 'Provide a revocation reason of at least 20 characters.', 'PACK_REVOCATION_REASON_SHORT');
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE evaluator_governance_evidence_pack
        SET status = 'REVOKED', revoked_by = ?, revoked_at = UTC_TIMESTAMP(3), revocation_reason = ?
      WHERE pack_id = ? AND status <> 'REVOKED'`,
    String(actorId), comment, String(packId),
  );
  if (!changed) fail(404, 'Active evidence pack not found.', 'PACK_NOT_FOUND');
  return getEvidencePack(packId);
}

export async function getSelfGovernance({ evaluatorId, evaluatorType }) {
  const assignments = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.attempt_no AS attemptNo,
            a.status, a.result, a.score_pct AS scorePct, a.submitted_at AS submittedAt,
            a.certified_at AS certifiedAt, p.program_name AS programName,
            t.template_name AS templateName, t.version_no AS templateVersion,
            x.appeal_id AS appealId, x.appeal_code AS appealCode,
            DATE_ADD(COALESCE(a.certified_at, a.submitted_at, a.updated_at), INTERVAL ? DAY) AS appealWindowEndsAt
       FROM evaluator_calibration_assignment a
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
       LEFT JOIN evaluator_calibration_appeal x ON x.assignment_id = a.assignment_id
      WHERE a.evaluator_id = ? AND a.evaluator_type = ?
        AND a.status IN ('PASSED','FAILED')
      ORDER BY COALESCE(a.certified_at, a.submitted_at, a.updated_at) DESC LIMIT 100`,
    APPEAL_WINDOW_DAYS, String(evaluatorId), String(evaluatorType),
  ));
  const appeals = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT appeal_id AS appealId FROM evaluator_calibration_appeal
      WHERE evaluator_id = ? AND evaluator_type = ? ORDER BY submitted_at DESC LIMIT 100`,
    String(evaluatorId), String(evaluatorType),
  ));
  const detailedAppeals = [];
  for (const item of appeals) detailedAppeals.push(await getAppeal(item.appealId));
  const packs = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT pack_id AS packId, pack_code AS packCode, pack_type AS packType,
            version_no AS versionNo, status, manifest_hash AS manifestHash,
            generated_at AS generatedAt, expires_at AS expiresAt,
            assignment_id AS assignmentId, appeal_id AS appealId, download_count AS downloadCount
       FROM evaluator_governance_evidence_pack
      WHERE evaluator_id = ? AND evaluator_type = ?
      ORDER BY generated_at DESC LIMIT 100`,
    String(evaluatorId), String(evaluatorType),
  ));
  return {
    appealWindowDays: APPEAL_WINDOW_DAYS,
    appealSlaDays: APPEAL_SLA_DAYS,
    assignments,
    eligibleAssignments: assignments.filter(item => !item.appealId && new Date(item.appealWindowEndsAt).getTime() >= Date.now()),
    appeals: detailedAppeals,
    packs,
  };
}

export async function getAppealDashboard({ branch = null, company = false }) {
  const params = [];
  let scopeSql = '';
  if (!company) {
    scopeSql = ' WHERE x.branch = ?';
    params.push(String(branch || ''));
  }
  const appeals = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT x.appeal_id AS appealId, x.appeal_code AS appealCode,
            x.assignment_id AS assignmentId, x.evaluator_id AS evaluatorId,
            x.evaluator_type AS evaluatorType, x.category, x.desired_outcome AS desiredOutcome,
            x.status, x.priority, x.branch, x.process_name AS processName,
            x.lob_name AS lobName, x.submitted_at AS submittedAt,
            x.sla_due_at AS slaDueAt, x.assigned_reviewer_id AS assignedReviewerId,
            x.resolution_type AS resolutionType, x.recommended_action AS recommendedAction,
            p.program_name AS programName, t.template_name AS templateName,
            t.version_no AS templateVersion, r.name AS evaluatorName,
            reviewer.name AS reviewerName,
            CASE WHEN x.status IN ('SUBMITTED','ACKNOWLEDGED','INFORMATION_REQUESTED','UNDER_REVIEW')
                       AND x.sla_due_at < UTC_TIMESTAMP(3) THEN 1 ELSE 0 END AS slaBreached
       FROM evaluator_calibration_appeal x
       INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = x.assignment_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = x.evaluator_id
       LEFT JOIN role_access_matrix reviewer ON reviewer.login_id = x.assigned_reviewer_id
       ${scopeSql}
      ORDER BY FIELD(x.status,'SUBMITTED','INFORMATION_REQUESTED','ACKNOWLEDGED','UNDER_REVIEW','RESOLVED','DISMISSED','WITHDRAWN'),
               x.sla_due_at, x.submitted_at DESC LIMIT 2000`,
    ...params,
  ));
  const packs = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT p.pack_id AS packId, p.pack_code AS packCode, p.pack_type AS packType,
            p.version_no AS versionNo, p.status, p.manifest_hash AS manifestHash,
            p.generated_at AS generatedAt, p.download_count AS downloadCount,
            p.assignment_id AS assignmentId, p.appeal_id AS appealId,
            p.evaluator_id AS evaluatorId, r.name AS evaluatorName,
            t.template_name AS templateName, t.version_no AS templateVersion,
            COALESCE(r.branch, pr.audience_branch, '') AS branch
       FROM evaluator_governance_evidence_pack p
       INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = p.assignment_id
       INNER JOIN evaluator_calibration_program pr ON pr.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = pr.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = p.evaluator_id
      ${company ? '' : 'WHERE COALESCE(r.branch, pr.audience_branch, \'\') = ?'}
      ORDER BY p.generated_at DESC LIMIT 2000`,
    ...(company ? [] : [String(branch || '')]),
  ));
  const reviewers = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT login_id AS reviewerId, name, role, branch
       FROM role_access_matrix
      WHERE active = 1 AND portal_access = 'Admin'
        ${company ? '' : 'AND branch = ?'}
      ORDER BY name, login_id LIMIT 1000`,
    ...(company ? [] : [String(branch || '')]),
  ));
  return {
    scope: company ? 'company' : 'branch',
    appeals,
    packs,
    reviewers,
    metrics: {
      open: appeals.filter(item => OPEN_STATUSES.includes(item.status)).length,
      slaBreached: appeals.filter(item => Boolean(item.slaBreached)).length,
      informationRequested: appeals.filter(item => item.status === 'INFORMATION_REQUESTED').length,
      resolved: appeals.filter(item => item.status === 'RESOLVED').length,
      integrityFailures: 0,
    },
  };
}

export async function runAppealGovernanceCycle(source = 'worker', limit = 500) {
  const expiredPacks = Number(await prisma.$executeRawUnsafe(
    `UPDATE evaluator_governance_evidence_pack
        SET status = 'EXPIRED'
      WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP(3)`,
  ));
  const overdue = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT x.appeal_id AS appealId, x.branch, x.process_name AS processName,
            x.lob_name AS lobName, x.evaluator_id AS evaluatorId,
            x.evaluator_type AS evaluatorType, x.appeal_code AS appealCode,
            p.program_name AS programName, t.template_name AS templateName,
            r.name AS evaluatorName
       FROM evaluator_calibration_appeal x
       INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = x.assignment_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = x.evaluator_id
      WHERE x.status IN ('SUBMITTED','ACKNOWLEDGED','INFORMATION_REQUESTED','UNDER_REVIEW')
        AND x.sla_due_at < UTC_TIMESTAMP(3)
        AND NOT EXISTS (
          SELECT 1 FROM evaluator_calibration_appeal_event e
           WHERE e.appeal_id = x.appeal_id AND e.event_type = 'SLA_BREACHED'
        )
      ORDER BY x.sla_due_at LIMIT ?`,
    Number(limit),
  ));
  let slaBreaches = 0;
  for (const item of overdue) {
    await prisma.$transaction(async tx => {
      await appendAppealEvent(tx, {
        appealId: item.appealId,
        eventType: 'SLA_BREACHED',
        actorId: `appeal-governance-${source}`,
        actorType: 'system',
        payload: { source },
      });
    });
    const admins = await branchAdministrators(item.branch);
    await emitAppealEvent({
      eventType: 'CALIBRATION_APPEAL_SLA_BREACHED',
      appeal: item,
      recipients: admins.map(userId => ({ userType: 'admin', userId, priority: 'CRITICAL' })),
      actorId: `appeal-governance-${source}`,
      actorType: 'system',
      idempotencyKey: `calibration-appeal-sla-breached:${item.appealId}`,
    });
    slaBreaches += 1;
  }
  return { source, expiredPacks, scanned: overdue.length, slaBreaches };
}
