import { createHash, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { emitNotificationEvent } from './notificationOutbox.js';

function normalize(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function text(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function certificateCode(authorizationId) {
  const token = hash(`MCN-LMS:EVALUATOR:${authorizationId}`).slice(0, 16).toUpperCase();
  return `MCN-EVAL-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}`;
}

function certificateStatus(authorization) {
  if (authorization.status === 'REVOKED') return 'REVOKED';
  if (authorization.status === 'SUSPENDED') return 'SUSPENDED';
  if (authorization.status === 'EXPIRED' || new Date(authorization.validUntil).getTime() <= Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

async function authorizationRows(limit = 5000) {
  return normalize(await prisma.$queryRawUnsafe(
    `SELECT a.authorization_id AS authorizationId, a.evaluator_id AS evaluatorId,
            a.evaluator_type AS evaluatorType, a.template_id AS templateId,
            a.program_id AS programId, a.calibration_assignment_id AS calibrationAssignmentId,
            a.status, a.calibration_score_pct AS calibrationScorePct,
            a.authorized_at AS authorizedAt, a.valid_until AS validUntil,
            a.revoked_by AS revokedBy, a.revoked_at AS revokedAt,
            a.revocation_reason AS revocationReason,
            p.program_code AS programCode, p.program_name AS programName,
            t.template_code AS templateCode, t.template_name AS templateName,
            t.version_no AS templateVersion,
            r.name AS evaluatorName, r.role AS evaluatorRole, r.branch,
            r.process, r.lob
       FROM evaluator_authorization a
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
       INNER JOIN practical_assessment_template t ON t.template_id = a.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = a.evaluator_id
      ORDER BY a.updated_at DESC LIMIT ?`,
    Number(limit),
  ));
}

export async function syncEvaluatorAuthorizationCertificates(actorId = 'calibration-operations', limit = 5000) {
  const rows = await authorizationRows(limit);
  let created = 0;
  let updated = 0;
  let notified = 0;
  for (const row of rows) {
    const existing = normalize(await prisma.$queryRawUnsafe(
      `SELECT certificate_id AS certificateId, status
         FROM evaluator_authorization_certificate
        WHERE authorization_id = ? LIMIT 1`,
      String(row.authorizationId),
    ));
    const certificateId = existing[0]?.certificateId || randomUUID();
    const code = certificateCode(row.authorizationId);
    const status = certificateStatus(row);
    const verificationHash = hash(`${code}:${row.authorizationId}:${new Date(row.validUntil).toISOString()}`);
    const snapshot = {
      certificateCode: code,
      evaluatorId: row.evaluatorId,
      evaluatorType: row.evaluatorType,
      evaluatorName: row.evaluatorName || row.evaluatorId,
      evaluatorRole: row.evaluatorRole || null,
      branch: row.branch || '',
      process: row.process || '',
      lob: row.lob || '',
      templateId: row.templateId,
      templateCode: row.templateCode,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      programId: row.programId,
      programCode: row.programCode,
      programName: row.programName,
      calibrationScorePct: row.calibrationScorePct,
      validFrom: row.authorizedAt,
      validUntil: row.validUntil,
      issuedBy: actorId,
    };
    await prisma.$executeRawUnsafe(
      `INSERT INTO evaluator_authorization_certificate
         (certificate_id, certificate_code, authorization_id, evaluator_id,
          evaluator_type, template_id, program_id, calibration_assignment_id,
          issued_at, valid_from, valid_until, status, verification_hash,
          snapshot_json, issued_by, revoked_by, revoked_at, revocation_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         evaluator_id = VALUES(evaluator_id), evaluator_type = VALUES(evaluator_type),
         template_id = VALUES(template_id), program_id = VALUES(program_id),
         calibration_assignment_id = VALUES(calibration_assignment_id),
         valid_from = VALUES(valid_from), valid_until = VALUES(valid_until),
         status = VALUES(status), verification_hash = VALUES(verification_hash),
         snapshot_json = VALUES(snapshot_json), revoked_by = VALUES(revoked_by),
         revoked_at = VALUES(revoked_at), revocation_reason = VALUES(revocation_reason)`,
      certificateId, code, row.authorizationId, row.evaluatorId, row.evaluatorType,
      row.templateId, row.programId, row.calibrationAssignmentId || null,
      row.authorizedAt, row.validUntil, status, verificationHash,
      JSON.stringify(snapshot), String(actorId), row.revokedBy || null,
      row.revokedAt || null, row.revocationReason || null,
    );
    if (existing.length) updated += 1;
    else created += 1;
    if (status === 'ACTIVE') {
      await emitNotificationEvent({
        eventType: 'EVALUATOR_CERTIFICATE_ISSUED',
        entityType: 'EVALUATOR_CERTIFICATE',
        entityId: certificateId,
        actorId,
        actorType: 'system',
        branch: row.branch || '',
        processName: row.process || '',
        lobName: row.lob || '',
        payload: {
          recipientType: row.evaluatorType,
          recipientId: row.evaluatorId,
          certificateCode: code,
          templateName: row.templateName,
          templateVersion: row.templateVersion,
          validUntil: row.validUntil,
          priority: 'NORMAL',
        },
        idempotencyKey: `evaluator-certificate-issued:${certificateId}`,
      });
      notified += 1;
    }
  }
  return { scanned: rows.length, created, updated, notified };
}

export async function generateEvaluatorQualityNotifications(limit = 5000) {
  const today = new Date();
  const [assignments, authorizations, reliability, actions] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT a.assignment_id AS assignmentId, a.evaluator_id AS evaluatorId,
              a.evaluator_type AS evaluatorType, a.attempt_no AS attemptNo,
              a.status, a.assigned_at AS assignedAt, a.due_at AS dueAt,
              DATEDIFF(DATE(a.due_at), UTC_DATE()) AS daysRemaining,
              p.program_name AS programName, p.audience_branch AS branch,
              p.audience_process AS processName, p.audience_lob AS lobName,
              t.template_name AS templateName, t.version_no AS templateVersion
         FROM evaluator_calibration_assignment a
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
         INNER JOIN practical_assessment_template t ON t.template_id = p.template_id
        WHERE a.status IN ('ASSIGNED','IN_PROGRESS')
        ORDER BY a.assigned_at DESC LIMIT ?`,
      Number(limit),
    ),
    prisma.$queryRawUnsafe(
      `SELECT a.authorization_id AS authorizationId, a.evaluator_id AS evaluatorId,
              a.evaluator_type AS evaluatorType, a.status, a.valid_until AS validUntil,
              DATEDIFF(DATE(a.valid_until), UTC_DATE()) AS daysRemaining,
              p.audience_branch AS branch, p.audience_process AS processName,
              p.audience_lob AS lobName, t.template_name AS templateName,
              t.version_no AS templateVersion
         FROM evaluator_authorization a
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
         INNER JOIN practical_assessment_template t ON t.template_id = a.template_id
        WHERE a.status IN ('ACTIVE','EXPIRED')
        ORDER BY a.valid_until LIMIT ?`,
      Number(limit),
    ),
    prisma.$queryRawUnsafe(
      `SELECT s.snapshot_id AS snapshotId, s.evaluator_id AS evaluatorId,
              s.evaluator_type AS evaluatorType, s.period_start AS periodStart,
              s.period_end AS periodEnd, s.agreement_within_five_pct AS agreementPct,
              s.critical_agreement_pct AS criticalAgreementPct,
              s.severity_index AS severityIndex, s.reliability_status AS reliabilityStatus,
              t.template_name AS templateName, t.version_no AS templateVersion,
              r.branch, r.process AS processName, r.lob AS lobName
         FROM evaluator_reliability_snapshot s
         INNER JOIN practical_assessment_template t ON t.template_id = s.template_id
         LEFT JOIN role_access_matrix r ON r.login_id = s.evaluator_id
        WHERE s.reliability_status IN ('WATCH','RECALIBRATION_REQUIRED')
          AND s.period_end >= DATE_SUB(UTC_DATE(), INTERVAL 120 DAY)
        ORDER BY s.period_end DESC LIMIT ?`,
      Number(limit),
    ),
    prisma.$queryRawUnsafe(
      `SELECT q.action_id AS actionId, q.evaluator_id AS evaluatorId,
              q.evaluator_type AS evaluatorType, q.due_at AS dueAt,
              t.template_name AS templateName, t.version_no AS templateVersion,
              r.branch, r.process AS processName, r.lob AS lobName
         FROM evaluator_quality_action q
         LEFT JOIN practical_assessment_template t ON t.template_id = q.template_id
         LEFT JOIN role_access_matrix r ON r.login_id = q.evaluator_id
        WHERE q.action_type = 'RECALIBRATION' AND q.status IN ('OPEN','IN_PROGRESS')
        ORDER BY q.assigned_at DESC LIMIT ?`,
      Number(limit),
    ),
  ]);

  const assignmentRows = normalize(assignments);
  const authorizationRowsResult = normalize(authorizations);
  const reliabilityRows = normalize(reliability);
  const actionRows = normalize(actions);
  let assigned = 0;
  let due = 0;
  let overdue = 0;
  let expiring = 0;
  let expired = 0;
  let watch = 0;
  let recalibration = 0;

  for (const row of assignmentRows) {
    const common = {
      recipientType: row.evaluatorType,
      recipientId: row.evaluatorId,
      programName: row.programName,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      attemptNo: row.attemptNo,
      dueAt: row.dueAt,
    };
    await emitNotificationEvent({
      eventType: 'CALIBRATION_ASSIGNED', entityType: 'CALIBRATION_ASSIGNMENT',
      entityId: row.assignmentId, branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
      payload: { ...common, priority: 'HIGH' },
      idempotencyKey: `calibration-assigned:${row.assignmentId}`,
    });
    assigned += 1;
    if (!row.dueAt) continue;
    const daysRemaining = Number(row.daysRemaining);
    if ([3, 1, 0].includes(daysRemaining)) {
      await emitNotificationEvent({
        eventType: 'CALIBRATION_DUE_REMINDER', entityType: 'CALIBRATION_ASSIGNMENT',
        entityId: row.assignmentId, branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
        payload: { ...common, daysRemaining, priority: daysRemaining === 0 ? 'HIGH' : 'NORMAL' },
        idempotencyKey: `calibration-due:${row.assignmentId}:${daysRemaining}:${dateKey(today)}`,
      });
      due += 1;
    }
    if (daysRemaining < 0 && [-1, -3, -7, -14, -30].includes(daysRemaining)) {
      await emitNotificationEvent({
        eventType: 'CALIBRATION_OVERDUE', entityType: 'CALIBRATION_ASSIGNMENT',
        entityId: row.assignmentId, branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
        payload: { ...common, overdueDays: Math.abs(daysRemaining), priority: 'HIGH' },
        idempotencyKey: `calibration-overdue:${row.assignmentId}:${Math.abs(daysRemaining)}:${dateKey(today)}`,
      });
      overdue += 1;
    }
  }

  for (const row of authorizationRowsResult) {
    const common = {
      recipientType: row.evaluatorType,
      recipientId: row.evaluatorId,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      validUntil: row.validUntil,
    };
    const daysRemaining = Number(row.daysRemaining);
    if (row.status === 'ACTIVE' && [30, 14, 7, 3, 1, 0].includes(daysRemaining)) {
      await emitNotificationEvent({
        eventType: 'EVALUATOR_AUTHORIZATION_EXPIRING', entityType: 'EVALUATOR_AUTHORIZATION',
        entityId: row.authorizationId, branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
        payload: { ...common, daysRemaining, priority: daysRemaining <= 3 ? 'HIGH' : 'NORMAL' },
        idempotencyKey: `evaluator-authorization-expiring:${row.authorizationId}:${daysRemaining}:${dateKey(today)}`,
      });
      expiring += 1;
    }
    if (row.status === 'EXPIRED') {
      await emitNotificationEvent({
        eventType: 'EVALUATOR_AUTHORIZATION_EXPIRED', entityType: 'EVALUATOR_AUTHORIZATION',
        entityId: row.authorizationId, branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
        payload: { ...common, priority: 'CRITICAL' },
        idempotencyKey: `evaluator-authorization-expired:${row.authorizationId}:${dateKey(row.validUntil)}`,
      });
      expired += 1;
    }
  }

  for (const row of reliabilityRows) {
    const eventType = row.reliabilityStatus === 'RECALIBRATION_REQUIRED'
      ? 'EVALUATOR_RECALIBRATION_REQUIRED'
      : 'EVALUATOR_RELIABILITY_WATCH';
    await emitNotificationEvent({
      eventType, entityType: 'EVALUATOR_RELIABILITY_SNAPSHOT', entityId: row.snapshotId,
      branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
      payload: {
        recipientType: row.evaluatorType, recipientId: row.evaluatorId,
        templateName: row.templateName, templateVersion: row.templateVersion,
        periodStart: row.periodStart, periodEnd: row.periodEnd,
        agreementPct: number(row.agreementPct).toFixed(1),
        criticalAgreementPct: number(row.criticalAgreementPct).toFixed(1),
        severityIndex: number(row.severityIndex).toFixed(1),
        priority: row.reliabilityStatus === 'RECALIBRATION_REQUIRED' ? 'CRITICAL' : 'HIGH',
      },
      idempotencyKey: `evaluator-reliability:${row.snapshotId}:${row.reliabilityStatus}`,
    });
    if (row.reliabilityStatus === 'RECALIBRATION_REQUIRED') recalibration += 1;
    else watch += 1;
  }

  for (const row of actionRows) {
    await emitNotificationEvent({
      eventType: 'EVALUATOR_RECALIBRATION_REQUIRED', entityType: 'EVALUATOR_QUALITY_ACTION', entityId: row.actionId,
      branch: row.branch || '', processName: row.processName || '', lobName: row.lobName || '',
      payload: {
        recipientType: row.evaluatorType, recipientId: row.evaluatorId,
        templateName: row.templateName || 'Evaluator quality', templateVersion: row.templateVersion || '',
        dueAt: row.dueAt, priority: 'CRITICAL',
      },
      idempotencyKey: `evaluator-recalibration-action:${row.actionId}`,
    });
  }

  return {
    scanned: assignmentRows.length + authorizationRowsResult.length + reliabilityRows.length + actionRows.length,
    assigned, due, overdue, expiring, expired, watch, recalibration,
    generated: assigned + due + overdue + expiring + expired + watch + recalibration + actionRows.length,
  };
}

async function cohortGroups(periodStart, periodEnd, cohortType) {
  const expressions = {
    COMPANY: `'ALL'`,
    BRANCH: `COALESCE(NULLIF(r.branch,''),'UNASSIGNED')`,
    PROCESS: `COALESCE(NULLIF(r.process,''),'UNASSIGNED')`,
    LOB: `COALESCE(NULLIF(r.lob,''),'UNASSIGNED')`,
  };
  const expression = expressions[cohortType];
  if (!expression) throw new Error(`Unsupported cohort type ${cohortType}`);
  return normalize(await prisma.$queryRawUnsafe(
    `SELECT s.template_id AS templateId, ${expression} AS cohortValue,
            COUNT(DISTINCT CONCAT(s.evaluator_type, ':', s.evaluator_id)) AS evaluatorCount,
            SUM(s.evaluation_count) AS evaluationCount,
            SUM(s.paired_evaluation_count) AS pairedEvaluationCount,
            AVG(s.average_score_pct) AS averageScorePct,
            AVG(s.agreement_within_five_pct) AS averageAgreementPct,
            AVG(s.critical_agreement_pct) AS averageCriticalAgreementPct,
            AVG(s.moderation_rate_pct) AS averageModerationRatePct,
            AVG(ABS(s.severity_index)) AS averageAbsoluteSeverityIndex,
            SUM(s.reliability_status = 'RELIABLE') AS reliableCount,
            SUM(s.reliability_status = 'WATCH') AS watchCount,
            SUM(s.reliability_status = 'RECALIBRATION_REQUIRED') AS recalibrationRequiredCount,
            SUM(s.reliability_status = 'INSUFFICIENT_DATA') AS insufficientDataCount
       FROM evaluator_reliability_snapshot s
       LEFT JOIN role_access_matrix r ON r.login_id = s.evaluator_id
      WHERE s.period_start = ? AND s.period_end = ?
      GROUP BY s.template_id, ${expression}`,
    periodStart, periodEnd,
  ));
}

export async function calculateReliabilityCohorts({ periodStart, periodEnd, actorId = 'calibration-operations' }) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw Object.assign(new Error('A valid reliability cohort period is required.'), { status: 400 });
  }
  const startDate = dateKey(start);
  const endDate = dateKey(end);
  let snapshots = 0;
  for (const cohortType of ['COMPANY', 'BRANCH', 'PROCESS', 'LOB']) {
    const groups = await cohortGroups(startDate, endDate, cohortType);
    for (const row of groups) {
      const existing = normalize(await prisma.$queryRawUnsafe(
        `SELECT cohort_snapshot_id AS cohortSnapshotId
           FROM evaluator_reliability_cohort_snapshot
          WHERE period_start = ? AND period_end = ? AND template_id = ?
            AND cohort_type = ? AND cohort_value = ? LIMIT 1`,
        startDate, endDate, row.templateId, cohortType, row.cohortValue,
      ));
      const snapshotId = existing[0]?.cohortSnapshotId || randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO evaluator_reliability_cohort_snapshot
           (cohort_snapshot_id, period_start, period_end, template_id,
            cohort_type, cohort_value, evaluator_count, evaluation_count,
            paired_evaluation_count, average_score_pct, average_agreement_pct,
            average_critical_agreement_pct, average_moderation_rate_pct,
            average_absolute_severity_index, reliable_count, watch_count,
            recalibration_required_count, insufficient_data_count,
            calculated_at, calculated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
         ON DUPLICATE KEY UPDATE
           evaluator_count = VALUES(evaluator_count), evaluation_count = VALUES(evaluation_count),
           paired_evaluation_count = VALUES(paired_evaluation_count),
           average_score_pct = VALUES(average_score_pct),
           average_agreement_pct = VALUES(average_agreement_pct),
           average_critical_agreement_pct = VALUES(average_critical_agreement_pct),
           average_moderation_rate_pct = VALUES(average_moderation_rate_pct),
           average_absolute_severity_index = VALUES(average_absolute_severity_index),
           reliable_count = VALUES(reliable_count), watch_count = VALUES(watch_count),
           recalibration_required_count = VALUES(recalibration_required_count),
           insufficient_data_count = VALUES(insufficient_data_count),
           calculated_at = UTC_TIMESTAMP(3), calculated_by = VALUES(calculated_by)`,
        snapshotId, startDate, endDate, row.templateId, cohortType, row.cohortValue,
        row.evaluatorCount, row.evaluationCount, row.pairedEvaluationCount,
        row.averageScorePct, row.averageAgreementPct, row.averageCriticalAgreementPct,
        row.averageModerationRatePct, row.averageAbsoluteSeverityIndex,
        row.reliableCount, row.watchCount, row.recalibrationRequiredCount,
        row.insufficientDataCount, String(actorId),
      );
      snapshots += 1;
    }
  }
  return { periodStart: startDate, periodEnd: endDate, snapshots };
}

export async function getCertificateByCode(code) {
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT c.certificate_id AS certificateId, c.certificate_code AS certificateCode,
            c.evaluator_id AS evaluatorId, c.evaluator_type AS evaluatorType,
            c.status, c.issued_at AS issuedAt, c.valid_from AS validFrom,
            c.valid_until AS validUntil, c.verification_hash AS verificationHash,
            c.snapshot_json AS snapshotJson, t.template_name AS templateName,
            t.version_no AS templateVersion, p.program_name AS programName
       FROM evaluator_authorization_certificate c
       INNER JOIN practical_assessment_template t ON t.template_id = c.template_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = c.program_id
      WHERE c.certificate_code = ? LIMIT 1`,
    text(code, 64).toUpperCase(),
  ));
  const certificate = rows[0] || null;
  if (!certificate) return null;
  const snapshot = typeof certificate.snapshotJson === 'string'
    ? JSON.parse(certificate.snapshotJson)
    : certificate.snapshotJson;
  return { ...certificate, snapshotJson: snapshot };
}

export async function listEvaluatorCertificates(evaluatorId, evaluatorType) {
  return normalize(await prisma.$queryRawUnsafe(
    `SELECT certificate_id AS certificateId, certificate_code AS certificateCode,
            status, issued_at AS issuedAt, valid_from AS validFrom,
            valid_until AS validUntil, verification_hash AS verificationHash,
            snapshot_json AS snapshotJson
       FROM evaluator_authorization_certificate
      WHERE evaluator_id = ? AND evaluator_type = ?
      ORDER BY valid_until DESC`,
    String(evaluatorId), String(evaluatorType),
  ));
}

export async function getEvaluatorReliabilityTrend(evaluatorId, evaluatorType, templateId = null, limit = 24) {
  const params = [String(evaluatorId), String(evaluatorType)];
  let templateFilter = '';
  if (templateId) {
    templateFilter = ' AND s.template_id = ?';
    params.push(String(templateId));
  }
  params.push(Math.min(120, Math.max(1, Number(limit) || 24)));
  return normalize(await prisma.$queryRawUnsafe(
    `SELECT s.snapshot_id AS snapshotId, s.period_start AS periodStart,
            s.period_end AS periodEnd, s.template_id AS templateId,
            t.template_name AS templateName, t.version_no AS templateVersion,
            s.evaluation_count AS evaluationCount,
            s.paired_evaluation_count AS pairedEvaluationCount,
            s.average_score_pct AS averageScorePct,
            s.agreement_within_five_pct AS agreementWithinFivePct,
            s.critical_agreement_pct AS criticalAgreementPct,
            s.moderation_rate_pct AS moderationRatePct,
            s.severity_index AS severityIndex, s.reliability_status AS reliabilityStatus
       FROM evaluator_reliability_snapshot s
       INNER JOIN practical_assessment_template t ON t.template_id = s.template_id
      WHERE s.evaluator_id = ? AND s.evaluator_type = ?${templateFilter}
      ORDER BY s.period_end DESC, t.template_name LIMIT ?`,
    ...params,
  ));
}

export async function listCohortBenchmarks({ branch = null, process = null, lob = null, templateId = null, limit = 200 }) {
  const scopes = [{ type: 'COMPANY', value: 'ALL' }];
  if (branch) scopes.push({ type: 'BRANCH', value: String(branch) });
  if (process) scopes.push({ type: 'PROCESS', value: String(process) });
  if (lob) scopes.push({ type: 'LOB', value: String(lob) });
  const clauses = scopes.map(() => '(c.cohort_type = ? AND c.cohort_value = ?)').join(' OR ');
  const params = scopes.flatMap(item => [item.type, item.value]);
  let templateFilter = '';
  if (templateId) {
    templateFilter = ' AND c.template_id = ?';
    params.push(String(templateId));
  }
  params.push(Math.min(1000, Math.max(1, Number(limit) || 200)));
  return normalize(await prisma.$queryRawUnsafe(
    `SELECT c.cohort_snapshot_id AS cohortSnapshotId, c.period_start AS periodStart,
            c.period_end AS periodEnd, c.template_id AS templateId,
            t.template_name AS templateName, t.version_no AS templateVersion,
            c.cohort_type AS cohortType, c.cohort_value AS cohortValue,
            c.evaluator_count AS evaluatorCount, c.evaluation_count AS evaluationCount,
            c.paired_evaluation_count AS pairedEvaluationCount,
            c.average_score_pct AS averageScorePct,
            c.average_agreement_pct AS averageAgreementPct,
            c.average_critical_agreement_pct AS averageCriticalAgreementPct,
            c.average_moderation_rate_pct AS averageModerationRatePct,
            c.average_absolute_severity_index AS averageAbsoluteSeverityIndex,
            c.reliable_count AS reliableCount, c.watch_count AS watchCount,
            c.recalibration_required_count AS recalibrationRequiredCount,
            c.insufficient_data_count AS insufficientDataCount
       FROM evaluator_reliability_cohort_snapshot c
       INNER JOIN practical_assessment_template t ON t.template_id = c.template_id
      WHERE (${clauses})${templateFilter}
      ORDER BY c.period_end DESC, c.cohort_type, t.template_name LIMIT ?`,
    ...params,
  ));
}

export async function runEvaluatorQualityOperationsCycle(source = 'manual') {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400000);
  const certificates = await syncEvaluatorAuthorizationCertificates(`operations-${source}`);
  const cohorts = await calculateReliabilityCohorts({ periodStart: start, periodEnd: end, actorId: `operations-${source}` });
  const notifications = await generateEvaluatorQualityNotifications();
  return { certificates, cohorts, notifications };
}

export { normalize };