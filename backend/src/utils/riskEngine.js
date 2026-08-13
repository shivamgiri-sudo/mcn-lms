import { prisma } from './db.js';

const THRESHOLDS = {
  COURSE_LOW: Number.parseInt(process.env.LMS_RISK_COURSE_LOW_PCT || '60', 10),
  MCQ_LOW: Number.parseInt(process.env.LMS_RISK_MCQ_LOW_PCT || '60', 10),
  ATTENDANCE_LOW: Number.parseInt(process.env.LMS_RISK_ATTENDANCE_LOW_PCT || '70', 10),
  QA_BREACH_HOURS: Number.parseInt(process.env.LMS_RISK_QA_BREACH_HOURS || '24', 10),
  ZERO_PROGRESS_GRACE_DAYS: Number.parseInt(process.env.LMS_RISK_ZERO_PROGRESS_GRACE_DAYS || '2', 10),
};

function ageInDays(date) {
  if (!date) return 0;
  return Math.max(0, (Date.now() - new Date(date).getTime()) / 86400000);
}

function severityRank(value) {
  return { CRITICAL: 3, HIGH: 2, WATCH: 1, HEALTHY: 0 }[value] || 0;
}

/**
 * Synchronizes the current risk state for one trainee.
 *
 * Active conditions are upserted and reopened when they recur. Previously open
 * conditions that no longer apply are closed together with their linked pending
 * activity so dashboards represent current risk, not a permanently growing list.
 */
export async function detectAndSyncRisks(employeeId) {
  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
  if (!trainee) return;

  const risks = [];
  const activeTrainee = trainee.status === 'Active';
  const graceDaysPassed = ageInDays(trainee.onboardingDate || trainee.createdAt) >= THRESHOLDS.ZERO_PROGRESS_GRACE_DAYS;

  if (activeTrainee && trainee.classroomId) {
    const coursePct = Number(trainee.courseCompletionPct || 0);
    if (coursePct > 0 && coursePct < THRESHOLDS.COURSE_LOW) {
      risks.push({
        riskType: 'LOW_COURSE',
        riskTitle: 'Course completion is below the expected level',
        severity: 'WATCH',
        currentValue: coursePct,
        expectedValue: THRESHOLDS.COURSE_LOW,
      });
    } else if (coursePct === 0 && graceDaysPassed) {
      risks.push({
        riskType: 'NO_COURSE_ACTIVITY',
        riskTitle: 'No verified course progress after the onboarding grace period',
        severity: 'HIGH',
        currentValue: 0,
        expectedValue: THRESHOLDS.COURSE_LOW,
      });
    }

    const attemptPct = Number(trainee.assessmentAttemptPct || 0);
    const passPct = Number(trainee.assessmentPassPct || 0);
    if (attemptPct > 0 && passPct < THRESHOLDS.MCQ_LOW) {
      risks.push({
        riskType: 'LOW_MCQ',
        riskTitle: 'Assessment performance is below the expected level',
        severity: 'HIGH',
        currentValue: passPct,
        expectedValue: THRESHOLDS.MCQ_LOW,
      });
    } else if (attemptPct === 0 && Number(trainee.courseCompletionPct || 0) >= THRESHOLDS.COURSE_LOW) {
      const assessmentCount = trainee.classroomId
        ? await prisma.assessmentMaster.count({ where: { classroomId: trainee.classroomId, active: true } })
        : 0;
      if (assessmentCount > 0) {
        risks.push({
          riskType: 'NO_ASSESSMENT_ACTIVITY',
          riskTitle: 'Required learning progressed but no assessment has been attempted',
          severity: 'WATCH',
          currentValue: 0,
          expectedValue: 1,
        });
      }
    }

    const attendancePct = Number(trainee.attendancePct || 0);
    if (attendancePct > 0 && attendancePct < THRESHOLDS.ATTENDANCE_LOW) {
      risks.push({
        riskType: 'LOW_ATTENDANCE',
        riskTitle: 'Verified attendance is below the expected level',
        severity: 'HIGH',
        currentValue: attendancePct,
        expectedValue: THRESHOLDS.ATTENDANCE_LOW,
      });
    } else if (attendancePct === 0 && graceDaysPassed) {
      risks.push({
        riskType: 'NO_VERIFIED_ATTENDANCE',
        riskTitle: 'No verified LMS attendance after the onboarding grace period',
        severity: 'HIGH',
        currentValue: 0,
        expectedValue: THRESHOLDS.ATTENDANCE_LOW,
      });
    }
  }

  const breachCutoff = new Date(Date.now() - THRESHOLDS.QA_BREACH_HOURS * 3600000);
  const openQueries = await prisma.traineeQueryLog.count({
    where: { employeeId, status: 'Open', createdAt: { lt: breachCutoff } },
  });
  if (openQueries > 0) {
    risks.push({
      riskType: 'QA_BREACH',
      riskTitle: `Question SLA breach (>${THRESHOLDS.QA_BREACH_HOURS}h unanswered)`,
      severity: 'CRITICAL',
      currentValue: openQueries,
      expectedValue: 0,
    });
  }

  const now = new Date();
  const activeTypes = new Set(risks.map(risk => risk.riskType));
  const existingOpenRisks = await prisma.trainingRiskLog.findMany({
    where: { employeeId, status: { in: ['Open', 'Actioned'] } },
    select: { id: true, riskKey: true, riskType: true, status: true },
  });
  const resolved = existingOpenRisks.filter(risk => !activeTypes.has(risk.riskType));

  await prisma.$transaction(async tx => {
    for (const risk of risks) {
      const riskKey = `${employeeId}_${risk.riskType}`;
      await tx.trainingRiskLog.upsert({
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
          ...risk,
          lastSeenAt: now,
        },
        update: {
          ...risk,
          traineeName: trainee.traineeName,
          batchNo: trainee.batchNo,
          branch: trainee.branch,
          process: trainee.process,
          lob: trainee.lob,
          classroomId: trainee.classroomId,
          lastSeenAt: now,
          status: 'Open',
          closedAt: null,
          closureRemarks: null,
        },
      });

      await tx.pendingActivityLog.upsert({
        where: { activityKey: riskKey },
        create: {
          activityKey: riskKey,
          activityType: risk.riskType,
          activityTitle: risk.riskTitle,
          severity: risk.severity,
          employeeId,
          traineeName: trainee.traineeName,
          batchNo: trainee.batchNo,
          branch: trainee.branch,
          process: trainee.process,
          lob: trainee.lob,
          referenceId: riskKey,
          source: 'Auto',
          lastSeenAt: now,
        },
        update: {
          activityTitle: risk.riskTitle,
          severity: risk.severity,
          traineeName: trainee.traineeName,
          batchNo: trainee.batchNo,
          branch: trainee.branch,
          process: trainee.process,
          lob: trainee.lob,
          lastSeenAt: now,
          status: 'Open',
          closedAt: null,
          closureRemarks: null,
        },
      });
    }

    for (const risk of resolved) {
      const closureRemarks = 'Automatically resolved because the source condition no longer applies.';
      await tx.trainingRiskLog.update({
        where: { id: risk.id },
        data: { status: 'Closed', closedAt: now, closureRemarks },
      });
      if (risk.riskKey) {
        await tx.pendingActivityLog.updateMany({
          where: { referenceId: risk.riskKey, status: { in: ['Open', 'Actioned'] } },
          data: { status: 'Closed', closedAt: now, closureRemarks },
        });
      }
    }

    const maxSeverity = risks.reduce(
      (highest, risk) => severityRank(risk.severity) > severityRank(highest) ? risk.severity : highest,
      'HEALTHY',
    );
    await tx.traineeMaster.update({
      where: { employeeId },
      data: {
        riskStatus: risks.length ? maxSeverity : 'HEALTHY',
        riskReason: risks.map(risk => risk.riskTitle).join('; ') || null,
      },
    });
  });

  return {
    employeeId,
    activeRisks: risks.length,
    resolvedRisks: resolved.length,
    riskStatus: risks.reduce(
      (highest, risk) => severityRank(risk.severity) > severityRank(highest) ? risk.severity : highest,
      'HEALTHY',
    ),
  };
}
