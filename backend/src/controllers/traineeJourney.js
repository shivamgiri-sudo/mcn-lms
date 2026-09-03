import { prisma } from '../utils/db.js';
import { evaluateCriteria } from '../services/certificationCriteria.js';

function pct(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function evidenceLabel(type) {
  return {
    mock_call: 'Mock call',
    internal: 'Internal certification',
    external: 'External certification',
  }[type] || type;
}

function statusFor({ complete, available = true, attention = false }) {
  if (complete) return 'complete';
  if (!available) return 'locked';
  if (attention) return 'attention';
  return 'current';
}

export async function getLearningJourney(req, res) {
  try {
    const employeeId = req.userId;
    const [trainee, user] = await Promise.all([
      prisma.traineeMaster.findUnique({ where: { employeeId } }),
      prisma.userMaster.findUnique({ where: { employeeId }, select: { active: true, forcePasswordReset: true, lastLogin: true } }),
    ]);
    if (!trainee || !user) return res.status(404).json({ ok: false, message: 'Trainee journey was not found.' });

    const [batch, rule, evidence, openRisks, pendingActivities, assessmentCount, assessmentResults, openQueries] = await Promise.all([
      trainee.batchNo
        ? prisma.batchMaster.findUnique({ where: { batchNo: trainee.batchNo }, select: { batchNo: true, batchName: true, batchStatus: true, startDate: true, endDate: true, coordinatorName: true } })
        : null,
      trainee.process && trainee.lob
        ? prisma.certificationRuleMaster.findFirst({ where: { process: trainee.process, lob: trainee.lob, active: true } })
        : null,
      prisma.certificationEvidence.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
        select: { evidenceType: true, result: true, scorePct: true, conductedAt: true, conductedBy: true },
      }),
      prisma.trainingRiskLog.findMany({
        where: { employeeId, status: 'Open' },
        orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
        take: 10,
        select: { severity: true, riskType: true, riskTitle: true, currentValue: true, expectedValue: true },
      }),
      prisma.pendingActivityLog.count({ where: { employeeId, status: { in: ['Open', 'Actioned'] } } }),
      trainee.classroomId ? prisma.assessmentMaster.count({ where: { classroomId: trainee.classroomId, active: true } }) : 0,
      trainee.classroomId
        ? prisma.assessmentResult.findMany({ where: { employeeId, classroomId: trainee.classroomId }, select: { result: true, bestPercentage: true } })
        : [],
      prisma.traineeQueryLog.count({ where: { employeeId, status: 'Open' } }),
    ]);

    const requirements = {
      courseCompletionPct: Number(rule?.courseCompletionMin ?? 80),
      assessmentPassPct: Number(rule?.mcqPassPctMin ?? 60),
      attendancePct: Number(rule?.attendancePctMin ?? 70),
    };

    const metrics = {
      courseCompletionPct: pct(trainee.courseCompletionPct),
      assessmentAttemptPct: pct(trainee.assessmentAttemptPct),
      assessmentPassPct: pct(trainee.assessmentPassPct),
      attendancePct: pct(trainee.attendancePct),
      assessmentsAvailable: assessmentCount,
      assessmentsPassed: assessmentResults.filter(result => result.result === 'Pass').length,
      bestAssessmentPct: assessmentResults.length ? Math.max(...assessmentResults.map(result => Number(result.bestPercentage || 0))) : null,
    };

    const onboardingComplete = Boolean(user.active && trainee.status === 'Active' && trainee.onboardingStatus !== 'Pending');
    const classroomComplete = Boolean(trainee.classroomId && trainee.batchNo);
    const learningComplete = metrics.courseCompletionPct >= requirements.courseCompletionPct;
    const assessmentComplete = metrics.assessmentPassPct >= requirements.assessmentPassPct && (assessmentCount === 0 || metrics.assessmentAttemptPct > 0);
    const hasCriticalRisk = openRisks.some(risk => risk.severity === 'CRITICAL');
    const readinessComplete = metrics.attendancePct >= requirements.attendancePct && !hasCriticalRisk;
    const ojtComplete = Boolean(trainee.ojtReady || ['Completed', 'Passed', 'Ready'].includes(String(trainee.nestingStatus || '')));
    const certified = trainee.certificationStatus === 'Certified';
    const handedOver = Boolean(trainee.handoverToOps);

    // The gates a trainee still has to clear are whatever this process configures,
    // so a client certification round or a sales target shows up here without this
    // view needing to know about it.
    const criteria = rule
      ? await prisma.certificationCriterion.findMany({ where: { ruleId: rule.ruleId, active: true }, orderBy: { sortOrder: 'asc' } })
      : [];
    const { results: criteriaResults } = evaluateCriteria(criteria, evidence);
    const missingEvidence = criteriaResults.filter(result => result.blocks && !result.met).map(result => result.label);
    // Named so the learner sees the gates their own process actually uses.
    requirements.evidenceGates = criteriaResults.filter(result => result.blocks).map(result => result.label);

    const stages = [
      {
        id: 'onboarding',
        order: 1,
        title: 'Account & Onboarding',
        icon: '👋',
        status: statusFor({ complete: onboardingComplete, attention: user.forcePasswordReset }),
        progressPct: onboardingComplete ? 100 : 25,
        summary: onboardingComplete ? 'Your LMS identity and trainee record are active.' : 'Your onboarding record still needs activation.',
        evidence: [
          { label: 'Account', value: user.active ? 'Active' : 'Inactive' },
          { label: 'Profile', value: trainee.onboardingStatus || 'Pending' },
          { label: 'Password', value: user.forcePasswordReset ? 'Reset required' : 'Private password set' },
        ],
        action: user.forcePasswordReset ? 'Create your private password from the security prompt.' : 'Review your profile details.',
      },
      {
        id: 'classroom',
        order: 2,
        title: 'Batch & Classroom',
        icon: '🏫',
        status: statusFor({ complete: classroomComplete, available: onboardingComplete }),
        progressPct: classroomComplete ? 100 : 0,
        summary: classroomComplete ? 'Your batch and classroom learning plan are assigned.' : 'A coordinator must assign your batch and classroom.',
        evidence: [
          { label: 'Batch', value: trainee.batchNo || 'Not assigned' },
          { label: 'Classroom', value: trainee.classroomName || 'Not assigned' },
          { label: 'Coordinator', value: batch?.coordinatorName || 'Not assigned' },
        ],
        action: classroomComplete ? 'Open your learning plan.' : 'Contact the training coordinator.',
      },
      {
        id: 'learning',
        order: 3,
        title: 'Learning Modules',
        icon: '📚',
        status: statusFor({ complete: learningComplete, available: classroomComplete, attention: classroomComplete && metrics.courseCompletionPct < 40 }),
        progressPct: metrics.courseCompletionPct,
        summary: `${metrics.courseCompletionPct}% complete; certification requirement is ${requirements.courseCompletionPct}%.`,
        evidence: [
          { label: 'Completion', value: `${metrics.courseCompletionPct}%` },
          { label: 'Required', value: `${requirements.courseCompletionPct}%` },
          { label: 'Risk', value: trainee.riskStatus || 'HEALTHY' },
        ],
        action: learningComplete ? 'Keep content fresh before assessment.' : 'Continue the next unlocked required module.',
      },
      {
        id: 'assessment',
        order: 4,
        title: 'Knowledge & Assessment',
        icon: '🧠',
        status: statusFor({ complete: assessmentComplete, available: learningComplete, attention: learningComplete && metrics.assessmentPassPct < requirements.assessmentPassPct }),
        progressPct: assessmentCount === 0 ? 0 : metrics.assessmentAttemptPct,
        summary: `${metrics.assessmentsPassed}/${metrics.assessmentsAvailable} assessments passed; required pass level is ${requirements.assessmentPassPct}%.`,
        evidence: [
          { label: 'Attempted', value: `${metrics.assessmentAttemptPct}%` },
          { label: 'Pass rate', value: `${metrics.assessmentPassPct}%` },
          { label: 'Best score', value: metrics.bestAssessmentPct == null ? 'No attempt' : `${Math.round(metrics.bestAssessmentPct)}%` },
        ],
        action: assessmentComplete ? 'Review explanations and weak topics.' : 'Complete the next available assessment.',
      },
      {
        id: 'readiness',
        order: 5,
        title: 'Attendance & Readiness',
        icon: '📈',
        status: statusFor({ complete: readinessComplete, available: assessmentComplete, attention: hasCriticalRisk || pendingActivities > 0 }),
        progressPct: metrics.attendancePct,
        summary: `${metrics.attendancePct}% verified attendance; requirement is ${requirements.attendancePct}%.`,
        evidence: [
          { label: 'Attendance', value: `${metrics.attendancePct}%` },
          { label: 'Open risks', value: String(openRisks.length) },
          { label: 'Pending actions', value: String(pendingActivities) },
          { label: 'Open questions', value: String(openQueries) },
        ],
        action: hasCriticalRisk ? 'Resolve the critical training risk with your coordinator.' : readinessComplete ? 'Prepare for OJT or practical readiness.' : 'Build verified activity and complete pending actions.',
      },
      {
        id: 'ojt',
        order: 6,
        title: 'OJT & Nesting',
        icon: '🎯',
        status: statusFor({ complete: ojtComplete, available: readinessComplete }),
        progressPct: ojtComplete ? 100 : trainee.ojtReady ? 75 : 0,
        summary: ojtComplete ? 'Practical readiness or nesting is complete.' : `OJT readiness: ${trainee.ojtReady ? 'Ready' : 'Pending'}; nesting: ${trainee.nestingStatus || 'Not Started'}.`,
        evidence: [
          { label: 'OJT ready', value: trainee.ojtReady ? 'Yes' : 'No' },
          { label: 'Nesting', value: trainee.nestingStatus || 'Not Started' },
        ],
        action: ojtComplete ? 'Submit or review practical evidence.' : 'Complete the assigned OJT and nesting activities.',
      },
      {
        id: 'certification',
        order: 7,
        title: 'Certification',
        icon: '🎓',
        status: statusFor({ complete: certified, available: readinessComplete && (ojtComplete || !trainee.ojtReady), attention: missingEvidence.length > 0 }),
        progressPct: certified ? 100 : Math.max(0, 100 - missingEvidence.length * 25),
        summary: certified ? 'You are certified for the assigned training programme.' : missingEvidence.length ? `Missing evidence: ${missingEvidence.join(', ')}.` : 'Certification review is pending coordinator approval.',
        evidence: evidence.slice(0, 5).map(item => ({
          label: evidenceLabel(item.evidenceType),
          value: `${item.result}${item.scorePct != null ? ` · ${Math.round(item.scorePct)}%` : ''}`,
        })),
        action: certified ? 'Download or verify your certificate when available.' : missingEvidence.length ? 'Complete the missing certification evidence.' : 'Request certification review from your coordinator.',
      },
      {
        id: 'handover',
        order: 8,
        title: 'Operations Handover',
        icon: '🚀',
        status: statusFor({ complete: handedOver, available: certified }),
        progressPct: handedOver ? 100 : 0,
        summary: handedOver ? 'Your training record has been handed over to operations.' : 'Operations handover becomes available after certification.',
        evidence: [
          { label: 'Certification', value: trainee.certificationStatus || 'Not Certified' },
          { label: 'Handover', value: handedOver ? 'Completed' : 'Pending' },
        ],
        action: handedOver ? 'Continue role-based development and refresher learning.' : certified ? 'Await coordinator operations handover.' : 'Complete certification first.',
      },
    ];

    const nextStage = stages.find(stage => stage.status !== 'complete') || stages.at(-1);
    const completedStages = stages.filter(stage => stage.status === 'complete').length;

    return res.json({
      ok: true,
      data: {
        employeeId,
        batch,
        requirements,
        metrics,
        stages,
        nextStageId: nextStage.id,
        nextAction: nextStage.action,
        completedStages,
        totalStages: stages.length,
        journeyProgressPct: Math.round((completedStages / stages.length) * 100),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[traineeJourney] journey load failed:', error);
    return res.status(500).json({ ok: false, message: 'Learning journey could not be loaded.' });
  }
}
