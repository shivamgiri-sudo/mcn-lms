import { prisma } from './db.js';

const THRESHOLDS = {
  COURSE_LOW: 60,
  MCQ_LOW: 60,
  ATTENDANCE_LOW: 70,
  QA_BREACH_HOURS: 24,
};

/**
 * Detects and upserts risks for a trainee.
 * Called after heartbeat sync, MCQ submit, or daily cron.
 */
export async function detectAndSyncRisks(employeeId) {
  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
  if (!trainee) return;

  const risks = [];

  if (trainee.courseCompletionPct < THRESHOLDS.COURSE_LOW && trainee.courseCompletionPct > 0) {
    risks.push({
      riskType: 'LOW_COURSE',
      riskTitle: 'Incomplete course completion',
      severity: 'WATCH',
      currentValue: trainee.courseCompletionPct,
      expectedValue: THRESHOLDS.COURSE_LOW,
    });
  }

  if (trainee.assessmentPassPct < THRESHOLDS.MCQ_LOW && trainee.assessmentAttemptPct > 0) {
    risks.push({
      riskType: 'LOW_MCQ',
      riskTitle: 'Low MCQ score',
      severity: 'HIGH',
      currentValue: trainee.assessmentPassPct,
      expectedValue: THRESHOLDS.MCQ_LOW,
    });
  }

  if (trainee.attendancePct < THRESHOLDS.ATTENDANCE_LOW && trainee.attendancePct > 0) {
    risks.push({
      riskType: 'LOW_ATTENDANCE',
      riskTitle: 'Poor attendance',
      severity: 'HIGH',
      currentValue: trainee.attendancePct,
      expectedValue: THRESHOLDS.ATTENDANCE_LOW,
    });
  }

  // Q&A SLA breach
  const breachCutoff = new Date(Date.now() - THRESHOLDS.QA_BREACH_HOURS * 60 * 60 * 1000);
  const openQueries = await prisma.traineeQueryLog.count({
    where: { employeeId, status: 'Open', createdAt: { lt: breachCutoff } },
  });
  if (openQueries > 0) {
    risks.push({
      riskType: 'QA_BREACH',
      riskTitle: 'Question SLA breach (>24h unanswered)',
      severity: 'CRITICAL',
      currentValue: openQueries,
      expectedValue: 0,
    });
  }

  for (const r of risks) {
    const riskKey = `${employeeId}_${r.riskType}`;
    await prisma.trainingRiskLog.upsert({
      where: { riskKey },
      create: {
        riskKey,
        employeeId,
        traineeName: trainee.traineeName,
        batchNo: trainee.batchNo,
        branch: trainee.branch,
        process: trainee.process,
        lob: trainee.lob,
        classroomId: trainee.classroomId,
        ...r,
        lastSeenAt: new Date(),
      },
      update: {
        ...r,
        lastSeenAt: new Date(),
        status: 'Open',
      },
    });

    // Sync pending activity
    const activityKey = `${employeeId}_${r.riskType}`;
    await prisma.pendingActivityLog.upsert({
      where: { activityKey },
      create: {
        activityKey,
        activityType: r.riskType,
        activityTitle: r.riskTitle,
        severity: r.severity,
        employeeId,
        traineeName: trainee.traineeName,
        batchNo: trainee.batchNo,
        branch: trainee.branch,
        process: trainee.process,
        lob: trainee.lob,
        referenceId: riskKey,
        source: 'Auto',
        lastSeenAt: new Date(),
      },
      update: {
        activityTitle: r.riskTitle,
        severity: r.severity,
        lastSeenAt: new Date(),
        status: 'Open',
      },
    });
  }

  // Update trainee risk status
  const maxSeverity = risks.reduce((acc, r) => {
    const order = { CRITICAL: 3, HIGH: 2, WATCH: 1, HEALTHY: 0 };
    return (order[r.severity] || 0) > (order[acc] || 0) ? r.severity : acc;
  }, 'HEALTHY');

  await prisma.traineeMaster.update({
    where: { employeeId },
    data: {
      riskStatus: risks.length > 0 ? maxSeverity : 'HEALTHY',
      riskReason: risks.map(r => r.riskTitle).join('; ') || null,
    },
  });
}
