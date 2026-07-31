import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { normalizeCalibration } from './calibrationGovernance.js';

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function identity(item) {
  return `${item.evaluatorType}:${item.evaluatorId}`;
}

function orderedPair(left, right) {
  return identity(left).localeCompare(identity(right)) <= 0 ? [left, right] : [right, left];
}

function periodDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('Reliability period is invalid.'), { status: 400, code: 'RELIABILITY_PERIOD_INVALID' });
  return parsed;
}

export async function calculateReliabilitySnapshots({ periodStart, periodEnd, actorId = 'reliability-worker' }) {
  const start = periodDate(periodStart);
  const end = periodDate(periodEnd);
  if (end < start) throw Object.assign(new Error('Reliability period end cannot precede its start.'), { status: 400, code: 'RELIABILITY_PERIOD_INVALID' });

  const evaluations = normalizeCalibration(await prisma.$queryRawUnsafe(
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

  const policies = normalizeCalibration(await prisma.$queryRawUnsafe(
    `SELECT template_id AS templateId,
            minimum_agreement_pct AS minimumAgreementPct,
            maximum_severity_index AS maximumSeverityIndex
       FROM evaluator_calibration_program
      WHERE status = 'PUBLISHED' AND active = 1`,
  ));
  const policyByTemplate = new Map(policies.map(item => [item.templateId, item]));

  const assignments = new Map();
  const templateScores = new Map();
  const evaluatorMetrics = new Map();
  const pairMetrics = new Map();

  for (const row of evaluations) {
    if (!assignments.has(row.assignmentId)) assignments.set(row.assignmentId, []);
    assignments.get(row.assignmentId).push(row);
    if (!templateScores.has(row.templateId)) templateScores.set(row.templateId, []);
    templateScores.get(row.templateId).push(numeric(row.percentage));
    const key = `${row.templateId}|${identity(row)}`;
    if (!evaluatorMetrics.has(key)) evaluatorMetrics.set(key, {
      templateId: row.templateId,
      evaluatorId: row.evaluatorId,
      evaluatorType: row.evaluatorType,
      evaluationCount: 0,
      scoreTotal: 0,
      pairedCount: 0,
      differenceTotal: 0,
      withinFiveCount: 0,
      criticalAgreementCount: 0,
      moderationCount: 0,
    });
    const metric = evaluatorMetrics.get(key);
    metric.evaluationCount += 1;
    metric.scoreTotal += numeric(row.percentage);
  }

  for (const rows of assignments.values()) {
    if (rows.length !== 2) continue;
    const [left, right] = rows;
    const difference = Math.abs(numeric(left.percentage) - numeric(right.percentage));
    const withinFive = difference <= 5.00001;
    const criticalAgreement = Boolean(left.criticalFail) === Boolean(right.criticalFail);
    for (const own of [left, right]) {
      const metric = evaluatorMetrics.get(`${own.templateId}|${identity(own)}`);
      metric.pairedCount += 1;
      metric.differenceTotal += difference;
      if (withinFive) metric.withinFiveCount += 1;
      if (criticalAgreement) metric.criticalAgreementCount += 1;
      if (own.moderated) metric.moderationCount += 1;
    }
    const [a, b] = orderedPair(left, right);
    const pairKey = `${a.templateId}|${identity(a)}|${identity(b)}`;
    if (!pairMetrics.has(pairKey)) pairMetrics.set(pairKey, {
      templateId: a.templateId,
      evaluatorAId: a.evaluatorId,
      evaluatorAType: a.evaluatorType,
      evaluatorBId: b.evaluatorId,
      evaluatorBType: b.evaluatorType,
      pairedCount: 0,
      differenceTotal: 0,
      withinFiveCount: 0,
      criticalAgreementCount: 0,
      moderationCount: 0,
    });
    const pair = pairMetrics.get(pairKey);
    pair.pairedCount += 1;
    pair.differenceTotal += difference;
    if (withinFive) pair.withinFiveCount += 1;
    if (criticalAgreement) pair.criticalAgreementCount += 1;
    if (a.moderated) pair.moderationCount += 1;
  }

  const periodStartKey = start.toISOString().slice(0, 10);
  const periodEndKey = end.toISOString().slice(0, 10);
  let snapshotCount = 0;
  let pairCount = 0;
  let actionCount = 0;

  await prisma.$transaction(async tx => {
    for (const item of evaluatorMetrics.values()) {
      const templateValues = templateScores.get(item.templateId) || [];
      const templateAverage = templateValues.length
        ? templateValues.reduce((sum, value) => sum + value, 0) / templateValues.length
        : 0;
      const averageScore = item.evaluationCount ? item.scoreTotal / item.evaluationCount : 0;
      const meanAbsoluteDifference = item.pairedCount ? item.differenceTotal / item.pairedCount : null;
      const agreementWithinFive = item.pairedCount ? item.withinFiveCount / item.pairedCount * 100 : null;
      const criticalAgreement = item.pairedCount ? item.criticalAgreementCount / item.pairedCount * 100 : null;
      const moderationRate = item.pairedCount ? item.moderationCount / item.pairedCount * 100 : null;
      const severityIndex = averageScore - templateAverage;
      const policy = policyByTemplate.get(item.templateId) || { minimumAgreementPct: 80, maximumSeverityIndex: 8 };
      let reliabilityStatus = 'INSUFFICIENT_DATA';
      if (item.pairedCount >= 5) {
        const severe = Math.abs(severityIndex) > numeric(policy.maximumSeverityIndex, 8) * 1.5
          || numeric(agreementWithinFive) < numeric(policy.minimumAgreementPct, 80) - 15
          || numeric(criticalAgreement) < 70;
        const watch = Math.abs(severityIndex) > numeric(policy.maximumSeverityIndex, 8)
          || numeric(agreementWithinFive) < numeric(policy.minimumAgreementPct, 80)
          || numeric(criticalAgreement) < 85;
        reliabilityStatus = severe ? 'RECALIBRATION_REQUIRED' : watch ? 'WATCH' : 'RELIABLE';
      }
      const biasFlag = Math.abs(severityIndex) > numeric(policy.maximumSeverityIndex, 8);
      const existing = await tx.$queryRawUnsafe(
        `SELECT snapshot_id AS snapshotId
           FROM evaluator_reliability_snapshot
          WHERE period_start = ? AND period_end = ? AND template_id = ?
            AND evaluator_id = ? AND evaluator_type = ? LIMIT 1 FOR UPDATE`,
        periodStartKey, periodEndKey, item.templateId, item.evaluatorId, item.evaluatorType,
      );
      const snapshotId = existing[0]?.snapshotId || randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_reliability_snapshot
           (snapshot_id, period_start, period_end, template_id,
            evaluator_id, evaluator_type, evaluation_count, paired_evaluation_count,
            average_score_pct, template_average_score_pct, mean_absolute_difference,
            agreement_within_five_pct, critical_agreement_pct, moderation_rate_pct,
            severity_index, reliability_status, bias_flag, calculated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           evaluation_count = VALUES(evaluation_count),
           paired_evaluation_count = VALUES(paired_evaluation_count),
           average_score_pct = VALUES(average_score_pct),
           template_average_score_pct = VALUES(template_average_score_pct),
           mean_absolute_difference = VALUES(mean_absolute_difference),
           agreement_within_five_pct = VALUES(agreement_within_five_pct),
           critical_agreement_pct = VALUES(critical_agreement_pct),
           moderation_rate_pct = VALUES(moderation_rate_pct),
           severity_index = VALUES(severity_index),
           reliability_status = VALUES(reliability_status),
           bias_flag = VALUES(bias_flag), calculated_at = UTC_TIMESTAMP(3),
           calculated_by = VALUES(calculated_by)`,
        snapshotId, periodStartKey, periodEndKey, item.templateId,
        item.evaluatorId, item.evaluatorType, item.evaluationCount, item.pairedCount,
        averageScore, templateAverage, meanAbsoluteDifference, agreementWithinFive,
        criticalAgreement, moderationRate, severityIndex, reliabilityStatus,
        biasFlag ? 1 : 0, String(actorId),
      );
      snapshotCount += 1;

      if (reliabilityStatus === 'RECALIBRATION_REQUIRED') {
        const open = await tx.$queryRawUnsafe(
          `SELECT action_id AS actionId FROM evaluator_quality_action
            WHERE evaluator_id = ? AND evaluator_type = ? AND template_id = ?
              AND action_type = 'RECALIBRATION' AND status IN ('OPEN','IN_PROGRESS') LIMIT 1`,
          item.evaluatorId, item.evaluatorType, item.templateId,
        );
        if (!open.length) {
          await tx.$executeRawUnsafe(
            `INSERT INTO evaluator_quality_action
               (action_id, evaluator_id, evaluator_type, template_id,
                source_snapshot_id, action_type, priority, status,
                reason, assigned_by, due_at)
             VALUES (?, ?, ?, ?, ?, 'RECALIBRATION', 'HIGH', 'OPEN', ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 14 DAY))`,
            randomUUID(), item.evaluatorId, item.evaluatorType, item.templateId,
            snapshotId,
            `Reliability requires recalibration. Agreement ${agreementWithinFive == null ? 'n/a' : agreementWithinFive.toFixed(1)}%, severity ${severityIndex.toFixed(1)}, critical agreement ${criticalAgreement == null ? 'n/a' : criticalAgreement.toFixed(1)}%.`,
            String(actorId),
          );
          actionCount += 1;
        }
      }
    }

    for (const item of pairMetrics.values()) {
      const existing = await tx.$queryRawUnsafe(
        `SELECT pair_id AS pairId FROM evaluator_reliability_pair
          WHERE period_start = ? AND period_end = ? AND template_id = ?
            AND evaluator_a_id = ? AND evaluator_a_type = ?
            AND evaluator_b_id = ? AND evaluator_b_type = ? LIMIT 1 FOR UPDATE`,
        periodStartKey, periodEndKey, item.templateId,
        item.evaluatorAId, item.evaluatorAType, item.evaluatorBId, item.evaluatorBType,
      );
      const pairId = existing[0]?.pairId || randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO evaluator_reliability_pair
           (pair_id, period_start, period_end, template_id,
            evaluator_a_id, evaluator_a_type, evaluator_b_id, evaluator_b_type,
            paired_count, mean_absolute_difference, agreement_within_five_pct,
            critical_agreement_pct, moderation_rate_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           paired_count = VALUES(paired_count),
           mean_absolute_difference = VALUES(mean_absolute_difference),
           agreement_within_five_pct = VALUES(agreement_within_five_pct),
           critical_agreement_pct = VALUES(critical_agreement_pct),
           moderation_rate_pct = VALUES(moderation_rate_pct),
           calculated_at = UTC_TIMESTAMP(3)`,
        pairId, periodStartKey, periodEndKey, item.templateId,
        item.evaluatorAId, item.evaluatorAType, item.evaluatorBId, item.evaluatorBType,
        item.pairedCount, item.differenceTotal / item.pairedCount,
        item.withinFiveCount / item.pairedCount * 100,
        item.criticalAgreementCount / item.pairedCount * 100,
        item.moderationCount / item.pairedCount * 100,
      );
      pairCount += 1;
    }
  });

  return {
    evaluations: evaluations.length,
    pairedAssignments: [...pairMetrics.values()].reduce((sum, item) => sum + item.pairedCount, 0),
    snapshots: snapshotCount,
    pairs: pairCount,
    qualityActions: actionCount,
  };
}
