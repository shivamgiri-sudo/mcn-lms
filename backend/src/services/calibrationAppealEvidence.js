import { createHash, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { emitNotificationEvent } from './notificationOutbox.js';
import { getCalibrationAssignment } from './calibrationGovernance.js';
import { getAppeal, normalizeAppeal } from './calibrationAppeals.js';

const OPEN_STATUSES = ['SUBMITTED', 'ACKNOWLEDGED', 'INFORMATION_REQUESTED', 'UNDER_REVIEW'];
const REASSESSMENT_DUE_DAYS = Math.max(1, Number(process.env.LMS_CALIBRATION_REASSESSMENT_DUE_DAYS || 7));

function fail(status, message, code = 'CALIBRATION_GOVERNANCE_EVIDENCE_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
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
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function packCode() {
  return `MCN-GOV-${dateKey()}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
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
  return { eventId, sequenceNo, previousHash, eventHash };
}

async function createReassessment(tx, appeal, actorId) {
  const attempts = normalizeAppeal(await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(attempt_no),0) AS lastAttempt
       FROM evaluator_calibration_assignment
      WHERE program_id = ? AND evaluator_id = ? AND evaluator_type = ? FOR UPDATE`,
    String(appeal.programId), String(appeal.evaluatorId), String(appeal.evaluatorType),
  ));
  const attemptNo = Number(attempts[0]?.lastAttempt || 0) + 1;
  if (attemptNo > Number(appeal.maxAttempts || 1)) {
    fail(409, 'The calibration programme has no remaining reassessment attempts.', 'REASSESSMENT_ATTEMPT_LIMIT');
  }
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

async function collectEvidenceManifest({ assignmentId, appealId = null, packType, generatedBy }) {
  const assignment = await getCalibrationAssignment(assignmentId);
  if (!assignment) fail(404, 'Calibration assignment not found.', 'ASSIGNMENT_NOT_FOUND');

  const [authorization, certificates, reliability, auditRows, appeal] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT authorization_id AS authorizationId, status,
              calibration_score_pct AS calibrationScorePct,
              authorized_by AS authorizedBy, authorized_at AS authorizedAt,
              valid_until AS validUntil, suspended_by AS suspendedBy,
              suspended_at AS suspendedAt, suspension_reason AS suspensionReason,
              revoked_by AS revokedBy, revoked_at AS revokedAt,
              revocation_reason AS revocationReason
         FROM evaluator_authorization
        WHERE calibration_assignment_id = ? OR
              (evaluator_id = ? AND evaluator_type = ? AND template_id = ?)
        ORDER BY updated_at DESC LIMIT 5`,
      String(assignmentId), String(assignment.evaluatorId),
      String(assignment.evaluatorType), String(assignment.templateId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT certificate_code AS certificateCode,
              certificate_type AS certificateType, status,
              valid_from AS validFrom, valid_until AS validUntil,
              verification_hash AS verificationHash,
              snapshot_json AS snapshotJson, issued_at AS issuedAt
         FROM evaluator_authorization_certificate
        WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
        ORDER BY issued_at DESC LIMIT 10`,
      String(assignment.evaluatorId), String(assignment.evaluatorType), String(assignment.templateId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT period_start AS periodStart, period_end AS periodEnd,
              evaluation_count AS evaluationCount,
              paired_evaluation_count AS pairedEvaluationCount,
              agreement_within_five_pct AS agreementWithinFivePct,
              critical_agreement_pct AS criticalAgreementPct,
              moderation_rate_pct AS moderationRatePct,
              severity_index AS severityIndex,
              reliability_status AS reliabilityStatus,
              bias_flag AS biasFlag, calculated_at AS calculatedAt
         FROM evaluator_reliability_snapshot
        WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
        ORDER BY period_end DESC LIMIT 24`,
      String(assignment.evaluatorId), String(assignment.evaluatorType), String(assignment.templateId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT user_identity AS userIdentity, user_role AS userRole,
              action, module, reference_id AS referenceId,
              old_value AS oldValue, new_value AS newValue,
              status, source, created_at AS createdAt
         FROM audit_log
        WHERE reference_id IN (?, ?) OR
              (module = 'EvaluatorQuality' AND user_identity = ?)
        ORDER BY created_at DESC LIMIT 500`,
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
    certificates: normalizeAppeal(certificates)
      .map(item => ({ ...item, snapshotJson: json(item.snapshotJson) })),
    reliability: normalizeAppeal(reliability),
    audit: normalizeAppeal(auditRows)
      .map(item => ({ ...item, oldValue: json(item.oldValue), newValue: json(item.newValue) })),
  });
}

export async function generateGovernanceEvidencePack({
  assignmentId,
  appealId = null,
  packType = 'ASSIGNMENT',
  actorId,
  scopeLevel = 'SELF',
  expiresAt = null,
}) {
  const normalizedPackType = text(packType, 40).toUpperCase();
  if (!['ASSIGNMENT', 'APPEAL', 'COMPLETE_GOVERNANCE'].includes(normalizedPackType)) {
    fail(400, 'Select a valid evidence pack type.', 'PACK_TYPE_INVALID');
  }
  const assignment = await assignmentSummary(assignmentId);
  if (!assignment) fail(404, 'Calibration assignment not found.', 'ASSIGNMENT_NOT_FOUND');
  if (appealId) {
    const appeal = await getAppeal(appealId);
    if (!appeal || appeal.assignmentId !== String(assignmentId)) {
      fail(400, 'Appeal does not belong to the selected assignment.', 'PACK_APPEAL_MISMATCH');
    }
  }

  const manifest = await collectEvidenceManifest({
    assignmentId,
    appealId,
    packType: normalizedPackType,
    generatedBy: actorId,
  });
  const manifestHash = sha256(manifest);
  const packId = randomUUID();
  const code = packCode();

  await prisma.$transaction(async tx => {
    const versions = normalizeAppeal(await tx.$queryRawUnsafe(
      `SELECT COALESCE(MAX(version_no),0) AS lastVersion
         FROM evaluator_governance_evidence_pack
        WHERE subject_key = ? AND pack_type = ? FOR UPDATE`,
      appealId ? `appeal:${appealId}` : `assignment:${assignmentId}`,
      normalizedPackType,
    ));
    const versionNo = Number(versions[0]?.lastVersion || 0) + 1;
    await tx.$executeRawUnsafe(
      `INSERT INTO evaluator_governance_evidence_pack
         (pack_id, pack_code, subject_key, assignment_id, appeal_id,
          evaluator_id, evaluator_type, pack_type, version_no, status,
          scope_level, manifest_json, manifest_hash, generated_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      packId, code,
      appealId ? `appeal:${appealId}` : `assignment:${assignmentId}`,
      String(assignmentId), appealId ? String(appealId) : null,
      assignment.evaluatorId, assignment.evaluatorType,
      normalizedPackType, versionNo, text(scopeLevel, 20).toUpperCase(),
      JSON.stringify(manifest), manifestHash, String(actorId), expiresAt || null,
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
    `SELECT p.pack_id AS packId, p.pack_code AS packCode,
            p.subject_key AS subjectKey, p.assignment_id AS assignmentId,
            p.appeal_id AS appealId, p.evaluator_id AS evaluatorId,
            p.evaluator_type AS evaluatorType, p.pack_type AS packType,
            p.version_no AS versionNo, p.status, p.scope_level AS scopeLevel,
            p.manifest_json AS manifestJson, p.manifest_hash AS manifestHash,
            p.generated_by AS generatedBy, p.generated_at AS generatedAt,
            p.expires_at AS expiresAt, p.download_count AS downloadCount,
            p.last_downloaded_at AS lastDownloadedAt,
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
  return {
    ...pack,
    manifestJson: json(pack.manifestJson),
    integrityVerified: sha256(json(pack.manifestJson)) === pack.manifestHash,
  };
}

export async function recordEvidencePackDownload(packId) {
  await prisma.$executeRawUnsafe(
    `UPDATE evaluator_governance_evidence_pack
        SET download_count = download_count + 1,
            last_downloaded_at = UTC_TIMESTAMP(3)
      WHERE pack_id = ? AND status = 'ACTIVE'`,
    String(packId),
  );
  return getEvidencePack(packId);
}

export async function revokeEvidencePack({ packId, actorId, reason }) {
  const comment = text(reason);
  if (comment.length < 20) {
    fail(400, 'Provide a revocation reason of at least 20 characters.', 'PACK_REVOCATION_REASON_SHORT');
  }
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE evaluator_governance_evidence_pack
        SET status = 'REVOKED', revoked_by = ?,
            revoked_at = UTC_TIMESTAMP(3), revocation_reason = ?
      WHERE pack_id = ? AND status <> 'REVOKED'`,
    String(actorId), comment, String(packId),
  );
  if (!changed) fail(404, 'Active evidence pack not found.', 'PACK_NOT_FOUND');
  return getEvidencePack(packId);
}

export async function resolveCalibrationAppeal({
  appealId,
  actorId,
  actorType = 'admin',
  resolutionType,
  resolutionSummary,
  recommendedAction = 'NONE',
}) {
  const normalizedResolution = text(resolutionType, 50).toUpperCase();
  const normalizedAction = text(recommendedAction, 50).toUpperCase();
  const summary = text(resolutionSummary);
  if (!['UPHELD', 'PARTIALLY_UPHELD', 'OVERTURNED', 'PROCEDURAL_REMEDY', 'NO_ACTION'].includes(normalizedResolution)) {
    fail(400, 'Select a valid appeal resolution.', 'APPEAL_RESOLUTION_INVALID');
  }
  if (!['NONE', 'REASSESSMENT', 'COACHING', 'RESTORE_AUTHORIZATION', 'SUSPEND_AUTHORIZATION', 'POLICY_REVIEW'].includes(normalizedAction)) {
    fail(400, 'Select a valid recommended action.', 'APPEAL_ACTION_INVALID');
  }
  if (summary.length < 40) {
    fail(400, 'Resolution summary must contain at least 40 characters.', 'APPEAL_RESOLUTION_SHORT');
  }

  let reassessmentAssignmentId = null;
  await prisma.$transaction(async tx => {
    const rows = normalizeAppeal(await tx.$queryRawUnsafe(
      `SELECT x.appeal_id AS appealId, x.status,
              x.evaluator_id AS evaluatorId, x.evaluator_type AS evaluatorType,
              a.program_id AS programId, p.max_attempts AS maxAttempts
         FROM evaluator_calibration_appeal x
         INNER JOIN evaluator_calibration_assignment a ON a.assignment_id = x.assignment_id
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
        WHERE x.appeal_id = ? LIMIT 1 FOR UPDATE`,
      String(appealId),
    ));
    const appeal = rows[0];
    if (!appeal) fail(404, 'Appeal not found.', 'APPEAL_NOT_FOUND');
    if (!OPEN_STATUSES.includes(appeal.status)) {
      fail(409, 'This appeal is already closed.', 'APPEAL_ALREADY_CLOSED');
    }
    if (normalizedAction === 'REASSESSMENT') {
      reassessmentAssignmentId = await createReassessment(tx, appeal, actorId);
    }
    await tx.$executeRawUnsafe(
      `UPDATE evaluator_calibration_appeal
          SET status = 'RESOLVED', resolved_at = UTC_TIMESTAMP(3),
              resolved_by = ?, resolution_type = ?, resolution_summary = ?,
              recommended_action = ?, reassessment_assignment_id = ?
        WHERE appeal_id = ?`,
      String(actorId), normalizedResolution, summary, normalizedAction,
      reassessmentAssignmentId, String(appealId),
    );
    await appendAppealEvent(tx, {
      appealId,
      eventType: 'RESOLVED',
      actorId,
      actorType,
      comment: summary,
      payload: {
        resolutionType: normalizedResolution,
        recommendedAction: normalizedAction,
        reassessmentAssignmentId,
      },
    });
  });

  const appeal = await getAppeal(appealId);
  await emitNotificationEvent({
    eventType: 'CALIBRATION_APPEAL_RESOLVED',
    entityType: 'CALIBRATION_APPEAL',
    entityId: appealId,
    actorId,
    actorType,
    branch: appeal.branch || '',
    processName: appeal.processName || '',
    lobName: appeal.lobName || '',
    payload: {
      recipientType: appeal.evaluatorType,
      recipientId: appeal.evaluatorId,
      appealCode: appeal.appealCode,
      evaluatorName: appeal.evaluatorName || appeal.evaluatorId,
      programName: appeal.programName,
      templateName: appeal.templateName,
      resolutionType: normalizedResolution,
      recommendedAction: normalizedAction,
      priority: 'HIGH',
    },
    idempotencyKey: `calibration-appeal-resolve:${appealId}:${appeal.events.at(-1)?.sequenceNo}`,
  });

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

  await generateGovernanceEvidencePack({
    assignmentId: appeal.assignmentId,
    appealId,
    packType: 'COMPLETE_GOVERNANCE',
    actorId,
    scopeLevel: 'SELF',
  });
  return getAppeal(appealId);
}
