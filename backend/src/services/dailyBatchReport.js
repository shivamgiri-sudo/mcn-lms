// Dynamic Daily Batch Training Performance & Completion Email Reporting System.
//
// Core principle (the whole point of this module): a batch's report only ever
// contains activities that were ACTUALLY assigned/attempted for that batch on
// that date. An activity nobody touched today is simply absent from the report
// -- never shown as "Pending"/"Not Attempted" for a process it doesn't apply to.
// Each activity provider below returns `null` when there is nothing to report,
// and the report/email builder skips null sections entirely.
//
// Every status/number in the generated report comes from real LMS data via the
// functions in this file -- narrative sentences are template strings filled
// from those computed values, never invented (see RULE ENGINE section).
import { prisma } from '../utils/db.js';
import { sendEmail } from '../utils/notify.js';
import { audit } from '../utils/audit.js';

const IST_OFFSET_MS = 330 * 60 * 1000; // same idiom as routes/traineeStability.js's istDayBounds()

function istDayBounds(now = new Date()) {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const startLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocalMs - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function fmtDateLabel(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function getSettings() {
  const s = await prisma.dailyBatchReportSettings.findUnique({ where: { id: 'default' } });
  return s || {
    id: 'default', enabled: false, sendTime: '19:00', typingWpmTarget: 25, typingAccuracyTarget: 97,
    tniMinTraineeCount: 3, tniMinPct: 30, requirePreviewApproval: false, superAdminEmails: null,
  };
}

async function getActivityConfig(process, lob) {
  const cfg = await prisma.dailyBatchActivityConfig.findFirst({ where: { process, lob } });
  // No config row yet for this process/LOB: fall back to "everything possible" so
  // a newly-created process isn't silently muted -- the per-date providers still
  // only surface what actually happened today.
  return cfg || {
    typingTest: true, classroomCurriculum: true, videoCourse: true, assessment: true,
    learningNugget: true, pkt: true, calibration: true, certification: true, eLearning: true,
  };
}

// ─── ATTENDANCE (always present — the one section common to every report) ────

async function getAttendanceSection(batch, dayStart, dayEnd, trainees) {
  const rows = await prisma.attendanceInference.findMany({
    where: { batchNo: batch.batchNo, date: { gte: dayStart, lt: dayEnd } },
  });
  const byEmp = new Map(rows.map(r => [r.employeeId, r]));
  const perTrainee = new Map();
  let present = 0;
  for (const t of trainees) {
    const rec = byEmp.get(t.employeeId);
    const isPresent = rec?.finalAttendance === 'Present';
    if (isPresent) present++;
    perTrainee.set(t.employeeId, isPresent ? 'Present' : 'Absent');
  }
  const total = trainees.length;
  const trainingDay = batch.startDate
    ? Math.max(1, Math.floor((dayStart.getTime() - new Date(batch.startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1)
    : null;
  return {
    total, present, absent: total - present,
    pct: total ? Math.round((present / total) * 1000) / 10 : 0,
    trainingDay, perTrainee,
  };
}

// ─── ACTIVITY PROVIDERS ────────────────────────────────────────────────────────
// Each provider returns null when nothing about this activity happened today for
// this batch (i.e. not applicable to today's report), or an object of the shape:
//   { key, label, assignedCount, perTrainee: Map(employeeId -> {status, detail, focusReason, weakTopics}),
//     batchSummary: {...}, gaps: [{employeeId, reason}] }

export function classifyTyping(netWpm, accuracyPct, wpmTarget, accuracyTarget) {
  const accOk = accuracyPct >= accuracyTarget;
  const wpmOk = netWpm > wpmTarget;
  if (accOk && wpmOk) return { status: 'Target Met', observation: null };
  if (accOk && !wpmOk) return { status: 'Speed Focus', observation: 'Accuracy is meeting the target; however, typing speed requires improvement.' };
  if (!accOk && wpmOk) return { status: 'Accuracy Focus', observation: 'Typing speed is satisfactory; however, accuracy requires improvement.' };
  return { status: 'Speed + Accuracy Focus', observation: 'Both typing speed and accuracy require improvement.' };
}

async function getTypingActivity(batch, dayStart, dayEnd, trainees, settings) {
  const empIds = trainees.map(t => t.employeeId);
  const attempts = await prisma.typingTestAttempt.findMany({
    where: { employeeId: { in: empIds }, attemptDate: { gte: dayStart, lt: dayEnd }, status: { in: ['Pass', 'Fail'] } },
  });
  if (!attempts.length) return null;

  const byEmp = new Map(attempts.map(a => [a.employeeId, a]));
  const perTrainee = new Map();
  const gaps = [];
  let metTarget = 0;

  for (const t of trainees) {
    const a = byEmp.get(t.employeeId);
    if (!a) { perTrainee.set(t.employeeId, { status: 'Not Attempted' }); continue; }
    // The daily REPORT's own configurable target (settings.typingWpmTarget/
    // typingAccuracyTarget) drives this classification -- deliberately separate
    // from TypingTestSettings' own Pass/Fail gate on the attempt itself, since
    // this report's targets are its own governance layer, not a re-display of
    // the typing test's internal pass/fail.
    const { status, observation } = classifyTyping(a.netWpm || 0, a.accuracyPct || 0, settings.typingWpmTarget, settings.typingAccuracyTarget);
    if (status === 'Target Met') metTarget++;
    else gaps.push({ employeeId: t.employeeId, reason: status });
    perTrainee.set(t.employeeId, {
      status, observation,
      detail: { grossWpm: a.grossWpm, netWpm: a.netWpm, accuracyPct: a.accuracyPct, errorCount: a.errorCount },
    });
  }

  return {
    key: 'typingTest', label: 'Daily Typing Test', assignedCount: attempts.length,
    perTrainee, gaps,
    batchSummary: { attempted: attempts.length, metTarget, needFocus: attempts.length - metTarget },
  };
}

async function getAssessmentActivity(batch, dayStart, dayEnd, trainees) {
  const empIds = trainees.map(t => t.employeeId);
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { employeeId: { in: empIds }, submittedAt: { gte: dayStart, lt: dayEnd } },
    include: { assessment: { select: { assessmentName: true, passingPct: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  if (!attempts.length) return null;

  // One attempt per trainee for today's report — their latest submission today.
  const byEmp = new Map();
  for (const a of attempts) if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, a);

  // Weak-topic analysis: aggregate wrong answers by topic across today's attempts,
  // using the same assessment_question_response table the governed assessment
  // engine already tags with a topic per answer. If a response has no topic
  // (empty string, i.e. no mapping was ever configured for that question), it is
  // excluded from weak-topic counting rather than treated as its own "topic".
  const attemptIds = [...byEmp.values()].map(a => a.attemptId);
  let topicRows = [];
  if (attemptIds.length) {
    const placeholders = attemptIds.map(() => '?').join(',');
    topicRows = await prisma.$queryRawUnsafe(
      `SELECT attempt_id AS attemptId, topic, is_correct AS isCorrect
         FROM assessment_question_response
        WHERE attempt_id IN (${placeholders}) AND topic <> ''`,
      ...attemptIds,
    );
  }
  const topicsByAttempt = new Map();
  const wrongCountByTopic = new Map();
  for (const row of topicRows) {
    if (!topicsByAttempt.has(row.attemptId)) topicsByAttempt.set(row.attemptId, []);
    if (!Number(row.isCorrect)) {
      topicsByAttempt.get(row.attemptId).push(row.topic);
      wrongCountByTopic.set(row.topic, (wrongCountByTopic.get(row.topic) || 0) + 1);
    }
  }
  const hasTopicMapping = topicRows.length > 0;

  const perTrainee = new Map();
  const gaps = [];
  let passed = 0;

  for (const t of trainees) {
    const a = byEmp.get(t.employeeId);
    if (!a) { perTrainee.set(t.employeeId, { status: 'Not Attempted' }); continue; }
    const isPass = a.result === 'Pass';
    if (isPass) passed++;
    else gaps.push({ employeeId: t.employeeId, reason: 'Assessment Focus' });
    const weakTopics = topicsByAttempt.get(a.attemptId) || [];
    perTrainee.set(t.employeeId, {
      status: isPass ? 'Passed' : 'Failed',
      observation: isPass ? 'Assessment Cleared' : 'Assessment Focus Required',
      detail: {
        assessmentName: a.assessment?.assessmentName || 'Assessment',
        score: Math.round(a.percentage), passingScore: a.assessment?.passingPct ?? 60,
        correctAnswers: a.correctAnswers, wrongAnswers: a.wrongAnswers,
      },
      // Never invent a weak topic when no mapping exists for this question set —
      // the spec is explicit that this must say so verbatim rather than guess.
      weakTopics: isPass ? [] : (hasTopicMapping ? [...new Set(weakTopics)] : null),
    });
  }

  // Batch-level weak topics: the raw counts feed computeBatchTNI() later, using
  // the admin-configured thresholds — not hardcoded here.
  return {
    key: 'assessment', label: 'Assessment', assignedCount: attempts.length,
    perTrainee, gaps, topicWrongCounts: wrongCountByTopic, hasTopicMapping,
    batchSummary: { attempted: byEmp.size, passed, failed: byEmp.size - passed },
  };
}

// Serves BOTH "Classroom Curriculum" and "Video Course" — in this LMS's schema
// they are the same underlying mechanism (ModuleMaster/ContentMaster + per-day
// VideoWatchLog activity + cumulative ContentProgress), just presented under a
// different label depending on which the process is configured for. If a
// process has both enabled, one combined section is produced rather than two
// duplicate tables over the same data.
async function getCurriculumActivity(batch, dayStart, dayEnd, trainees, label, key) {
  if (!batch.classroomId) return null;
  const empIds = trainees.map(t => t.employeeId);

  const [modules, todayLogs] = await Promise.all([
    prisma.moduleMaster.findMany({ where: { classroomId: batch.classroomId, active: true, required: true }, include: { contents: { where: { active: true, required: true } } } }),
    prisma.videoWatchLog.findMany({ where: { employeeId: { in: empIds }, classroomId: batch.classroomId, createdAt: { gte: dayStart, lt: dayEnd } } }),
  ]);
  if (!todayLogs.length) return null; // nobody touched curriculum content today

  const activeModuleIds = new Set(todayLogs.map(l => l.moduleId));
  const relevantModules = modules.filter(m => activeModuleIds.has(m.moduleId));
  if (!relevantModules.length) return null;
  const contentIds = relevantModules.flatMap(m => m.contents.map(c => c.contentId));
  if (!contentIds.length) return null;

  const progress = await prisma.contentProgress.findMany({
    where: { employeeId: { in: empIds }, contentId: { in: contentIds } },
  });
  const progressByEmp = new Map();
  for (const p of progress) {
    if (!progressByEmp.has(p.employeeId)) progressByEmp.set(p.employeeId, []);
    progressByEmp.get(p.employeeId).push(p);
  }

  const perTrainee = new Map();
  const gaps = [];
  let completed = 0, inProgress = 0, notStarted = 0;

  for (const t of trainees) {
    const rows = progressByEmp.get(t.employeeId) || [];
    const relevant = rows.filter(r => contentIds.includes(r.contentId));
    if (!relevant.length) { perTrainee.set(t.employeeId, { status: 'Not Started', observation: 'Not Started – Follow-up Required' }); notStarted++; gaps.push({ employeeId: t.employeeId, reason: `${label} Completion Focus` }); continue; }
    const allDone = relevant.every(r => r.completionStatus === 'Completed');
    const anyDone = relevant.some(r => r.completionStatus === 'Completed' || r.completionPct > 0);
    const avgPct = Math.round(relevant.reduce((s, r) => s + (r.completionPct || 0), 0) / relevant.length);
    let status;
    if (allDone) { status = 'Completed'; completed++; }
    else if (anyDone) { status = 'In Progress'; inProgress++; gaps.push({ employeeId: t.employeeId, reason: `${label} Completion Focus` }); }
    else { status = 'Not Started'; notStarted++; gaps.push({ employeeId: t.employeeId, reason: `${label} Completion Focus` }); }
    perTrainee.set(t.employeeId, {
      status, detail: { completionPct: avgPct, modulesTouchedToday: relevantModules.length },
      observation: status === 'Completed' ? `${label} Completed` : status === 'In Progress' ? 'In Progress' : 'Not Started – Follow-up Required',
    });
  }

  return {
    key, label, assignedCount: trainees.length, perTrainee, gaps,
    batchSummary: { completed, inProgress, notStarted, completionPct: trainees.length ? Math.round((completed / trainees.length) * 1000) / 10 : 0 },
    modules: relevantModules.map(m => ({ moduleId: m.moduleId, title: m.moduleTitle })),
  };
}

async function getNuggetActivity(batch, dayStart, dayEnd, trainees) {
  const empIds = trainees.map(t => t.employeeId);
  if (!empIds.length) return null;
  const placeholders = empIds.map(() => '?').join(',');
  // Mirrors the existing GET /independent-modules/:moduleId/reading-report join
  // (routes/adminStability.js) but scoped to this batch's trainees across all of
  // their active broadcast/independent-module ("nugget") assignments rather than
  // one module at a time.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.employee_id AS employeeId, a.module_id AS moduleId, a.module_name AS moduleName,
            MAX(p.acknowledged_at) AS acknowledgedAt, MAX(p.completion_status) AS completionStatus
       FROM assigned_modules a
       INNER JOIN independent_module_content_map c ON c.module_id = a.module_id AND c.active = 1
       INNER JOIN content_repository_master r ON r.repository_content_id = c.repository_content_id
       INNER JOIN trainee_master t
               ON t.status <> 'Deleted' AND t.employee_id IN (${placeholders})
              AND ((a.assigned_to_type = 'individual' AND t.employee_id = a.assigned_to)
                OR (a.assigned_to_type = 'batch'      AND t.batch_no    = a.assigned_to)
                OR (a.assigned_to_type = 'process'    AND t.process     = a.assigned_to)
                OR (a.assigned_to_type = 'branch'     AND t.branch      = a.assigned_to)
                OR  a.assigned_to_type = 'company')
       LEFT JOIN content_progress p ON p.employee_id = t.employee_id AND p.content_id = r.repository_content_id
      WHERE a.active = 1
      GROUP BY t.employee_id, a.module_id, a.module_name`,
    ...empIds,
  );
  if (!rows.length) return null;

  const byEmp = new Map();
  for (const row of rows) {
    if (!byEmp.has(row.employeeId)) byEmp.set(row.employeeId, []);
    byEmp.get(row.employeeId).push(row);
  }

  const perTrainee = new Map();
  const gaps = [];
  let acknowledged = 0, pending = 0;
  const nuggetNames = new Set();

  for (const t of trainees) {
    const assigned = byEmp.get(t.employeeId) || [];
    if (!assigned.length) { perTrainee.set(t.employeeId, { status: 'Not Assigned' }); continue; }
    assigned.forEach(a => nuggetNames.add(a.moduleName));
    const allAck = assigned.every(a => a.acknowledgedAt);
    const pendingNames = assigned.filter(a => !a.acknowledgedAt).map(a => a.moduleName);
    if (allAck) { acknowledged++; perTrainee.set(t.employeeId, { status: 'Acknowledged' }); }
    else {
      pending++;
      gaps.push({ employeeId: t.employeeId, reason: 'Learning Activity Pending' });
      perTrainee.set(t.employeeId, { status: 'Pending', detail: { pendingNuggets: pendingNames } });
    }
  }

  return {
    key: 'learningNugget', label: 'Learning Nugget', assignedCount: byEmp.size, perTrainee, gaps,
    batchSummary: { acknowledged, pending, nuggetNames: [...nuggetNames] },
  };
}

// ─── RULE ENGINE (data-driven; no generated/guessed values — section 33) ──────

function computeTraineeOverall(t, attendanceStatus, activities) {
  if (attendanceStatus === 'Absent') {
    return { priority: 'Normal', observation: 'Absent', reasons: [] };
  }
  const reasons = [];
  let significantGaps = 0, minorGaps = 0;
  for (const act of activities) {
    const rec = act.perTrainee.get(t.employeeId);
    if (!rec) continue;
    if (act.key === 'typingTest') {
      if (rec.status === 'Speed + Accuracy Focus') { reasons.push('Typing Speed + Accuracy Focus'); significantGaps++; }
      else if (rec.status === 'Speed Focus') { reasons.push('Typing Speed Focus'); minorGaps++; }
      else if (rec.status === 'Accuracy Focus') { reasons.push('Typing Accuracy Focus'); minorGaps++; }
      else if (rec.status === 'Not Attempted') { reasons.push('Typing Test Not Attempted'); significantGaps++; }
    } else if (act.key === 'assessment') {
      if (rec.status === 'Failed') {
        const topics = rec.weakTopics && rec.weakTopics.length ? ` Refresher required on ${rec.weakTopics.join(', ')}.` : '';
        reasons.push(`Assessment not cleared.${topics}`); significantGaps++;
      } else if (rec.status === 'Not Attempted') { reasons.push('Assessment Not Attempted'); significantGaps++; }
    } else if (act.key === 'learningNugget') {
      if (rec.status === 'Pending') { reasons.push('Learning Nugget acknowledgement pending'); minorGaps++; }
    } else if (act.key === 'classroomCurriculum' || act.key === 'videoCourse') {
      if (rec.status === 'Not Started') { reasons.push(`${act.label} not started`); significantGaps++; }
      else if (rec.status === 'In Progress') { reasons.push(`${act.label} in progress`); minorGaps++; }
    }
  }

  let priority = 'Normal';
  if (significantGaps >= 2) priority = 'Priority Focus';
  else if (significantGaps === 1) priority = 'Focus';
  else if (minorGaps >= 2) priority = 'Focus';
  else if (minorGaps === 1) priority = 'Monitor';

  let observation;
  if (!reasons.length) observation = 'Strong Performance – All assigned activities successfully completed and applicable performance targets met.';
  else if (priority === 'Priority Focus') observation = `Priority Focus – ${reasons.join('; ')}.`;
  else observation = `${reasons[0].split(' ').slice(0, 3).join(' ')} Focus – ${reasons.join('; ')}.`;

  return { priority, observation, reasons };
}

function selectBestPerformers(trainees, attendance, activities, traineeOverall) {
  // Only meaningful when at least one activity produces an actual performance
  // score (typing/assessment) — a pure acknowledgement-only day has nothing to
  // rank people on, per section 18.
  const hasPerformanceData = activities.some(a => a.key === 'typingTest' || a.key === 'assessment');
  if (!hasPerformanceData) return [];

  const candidates = trainees.filter(t => attendance.perTrainee.get(t.employeeId) === 'Present' && traineeOverall.get(t.employeeId)?.priority === 'Normal');
  const scored = candidates.map(t => {
    const typing = activities.find(a => a.key === 'typingTest')?.perTrainee.get(t.employeeId);
    const assessment = activities.find(a => a.key === 'assessment')?.perTrainee.get(t.employeeId);
    // Simple composite: assessment score weighted highest, typing accuracy/WPM secondary.
    const score = (assessment?.detail?.score || 0) + (typing?.detail?.netWpm || 0) + (typing?.detail?.accuracyPct || 0) / 2;
    return { t, typing, assessment, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

  return scored.map(({ t, typing, assessment }) => {
    const parts = [];
    if (typing?.detail) parts.push(`${typing.detail.netWpm} WPM with ${typing.detail.accuracyPct}% accuracy`);
    if (assessment?.detail) parts.push(`scored ${assessment.detail.score}% in today's assessment`);
    return { employeeId: t.employeeId, name: t.traineeName || t.employeeId, summary: `${t.traineeName || t.employeeId} – ${parts.join(', ')} and completed all assigned learning activities.` };
  });
}

function selectFocusTrainees(trainees, attendance, traineeOverall) {
  return trainees
    .filter(t => attendance.perTrainee.get(t.employeeId) === 'Present')
    .map(t => ({ t, overall: traineeOverall.get(t.employeeId) }))
    .filter(({ overall }) => overall && ['Monitor', 'Focus', 'Priority Focus'].includes(overall.priority))
    .sort((a, b) => {
      const rank = { 'Priority Focus': 0, 'Focus': 1, 'Monitor': 2 };
      return rank[a.overall.priority] - rank[b.overall.priority];
    })
    .map(({ t, overall }) => ({ employeeId: t.employeeId, name: t.traineeName || t.employeeId, priority: overall.priority, reasons: overall.reasons }));
}

// Only raised when a gap is shared by at least tniMinTraineeCount present
// trainees AND at least tniMinPct% of them — both configured, never a hardcoded
// "any 2 people" trigger (section 20).
export function computeBatchTNI(presentCount, activities, settings) {
  const tni = [];
  const minCount = settings.tniMinTraineeCount;
  const minPct = settings.tniMinPct;

  const assessmentActivity = activities.find(a => a.key === 'assessment');
  if (assessmentActivity?.hasTopicMapping) {
    for (const [topic, count] of assessmentActivity.topicWrongCounts.entries()) {
      const pct = presentCount ? (count / presentCount) * 100 : 0;
      if (count >= minCount && pct >= minPct) {
        tni.push({ type: 'Knowledge Gap', topic, count, recommendation: `Conduct a short refresher on ${topic} followed by a knowledge check.` });
      }
    }
  }

  const typingActivity = activities.find(a => a.key === 'typingTest');
  if (typingActivity) {
    const accGaps = [...typingActivity.perTrainee.values()].filter(r => r.status === 'Accuracy Focus' || r.status === 'Speed + Accuracy Focus').length;
    const pct = presentCount ? (accGaps / presentCount) * 100 : 0;
    if (accGaps >= minCount && pct >= minPct) {
      tni.push({ type: 'Typing Accuracy', count: accGaps, recommendation: 'Schedule a focused typing-accuracy practice session for the batch.' });
    }
  }

  for (const act of activities) {
    if (act.key !== 'classroomCurriculum' && act.key !== 'videoCourse') continue;
    const incomplete = [...act.perTrainee.values()].filter(r => r.status !== 'Completed').length;
    const pct = presentCount ? (incomplete / presentCount) * 100 : 0;
    if (incomplete >= minCount && pct >= minPct) {
      tni.push({ type: 'Course Completion', label: act.label, count: incomplete, recommendation: `Follow up with the batch to close out remaining ${act.label.toLowerCase()} modules before the next assigned activity.` });
    }
  }

  return tni;
}

function computeTrainerFocus(focusTrainees, tni) {
  const actions = [];
  const byReason = new Map();
  for (const f of focusTrainees) {
    for (const r of f.reasons) {
      const key = r.split(' – ')[0].split('.')[0];
      byReason.set(key, (byReason.get(key) || 0) + 1);
    }
  }
  for (const [reason, count] of byReason.entries()) {
    actions.push(`Follow up with ${count} trainee${count > 1 ? 's' : ''} regarding: ${reason}.`);
  }
  for (const t of tni) actions.push(t.recommendation);
  if (!actions.length) return ['All assigned activities and targets were completed today — no specific intervention required.'];
  return actions;
}

function computeOverallSummary(batch, attendance, activities, focusTrainees) {
  const parts = [`${attendance.present} of ${attendance.total} trainees were present today.`];
  for (const act of activities) {
    if (act.key === 'typingTest') parts.push(`${act.batchSummary.metTarget} trainees met the Daily Typing Test target.`);
    else if (act.key === 'assessment') parts.push(`${act.batchSummary.passed} cleared today's assessment.`);
    else if (act.key === 'learningNugget') parts.push(`${act.batchSummary.acknowledged} completed all mandatory learning activities.`);
    else if (act.key === 'classroomCurriculum' || act.key === 'videoCourse') parts.push(`${act.label} completion for today's assigned curriculum is ${act.batchSummary.completionPct}%.`);
  }
  if (focusTrainees.length) parts.push(`${focusTrainees.length} trainee${focusTrainees.length > 1 ? 's' : ''} require focused intervention.`);
  return parts.join(' ');
}

// ─── REPORT ENGINE ─────────────────────────────────────────────────────────────

export async function buildDailyBatchReport(batchNo, date = new Date()) {
  const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
  if (!batch) throw new Error(`Batch ${batchNo} not found.`);
  const trainees = await prisma.traineeMaster.findMany({ where: { batchNo, status: { not: 'Deleted' } } });
  const { start, end } = istDayBounds(date);
  const settings = await getSettings();
  const activityConfig = await getActivityConfig(batch.process, batch.lob);

  const attendance = await getAttendanceSection(batch, start, end, trainees);

  const providers = [];
  if (activityConfig.typingTest) providers.push(getTypingActivity(batch, start, end, trainees, settings));
  if (activityConfig.assessment) providers.push(getAssessmentActivity(batch, start, end, trainees));
  if (activityConfig.classroomCurriculum) providers.push(getCurriculumActivity(batch, start, end, trainees, 'Classroom Curriculum', 'classroomCurriculum'));
  if (activityConfig.videoCourse && !activityConfig.classroomCurriculum) providers.push(getCurriculumActivity(batch, start, end, trainees, 'Video Course', 'videoCourse'));
  if (activityConfig.learningNugget) providers.push(getNuggetActivity(batch, start, end, trainees));

  const resolved = (await Promise.all(providers)).filter(Boolean);

  const traineeOverall = new Map();
  for (const t of trainees) {
    traineeOverall.set(t.employeeId, computeTraineeOverall(t, attendance.perTrainee.get(t.employeeId), resolved));
  }

  const bestPerformers = selectBestPerformers(trainees, attendance, resolved, traineeOverall);
  const focusTrainees = selectFocusTrainees(trainees, attendance, traineeOverall);
  const tni = computeBatchTNI(attendance.present, resolved, settings);
  const trainerFocus = computeTrainerFocus(focusTrainees, tni);
  const summary = computeOverallSummary(batch, attendance, resolved, focusTrainees);

  return {
    batch, trainees, date: start, dateLabel: fmtDateLabel(start),
    attendance, activities: resolved, traineeOverall,
    bestPerformers, focusTrainees, tni, trainerFocus, summary,
    settings,
  };
}

// ─── EMAIL BUILDER ─────────────────────────────────────────────────────────────

export function buildSubject(report) {
  const { batch, dateLabel, activities } = report;
  if (activities.length === 1) {
    const singleLabel = { typingTest: 'Typing', assessment: 'Assessment', classroomCurriculum: 'Course Completion', videoCourse: 'Course Completion', learningNugget: 'Learning' }[activities[0].key] || 'Training';
    return `Daily ${singleLabel} Performance Report | ${batch.batchName || batch.batchNo} | ${dateLabel}`;
  }
  return `Daily Training Performance Report | ${batch.batchName || batch.batchNo} | ${dateLabel}`;
}

function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderActivitySummaryTable(activities) {
  const rows = activities.map(a => {
    const s = a.batchSummary;
    if (a.key === 'typingTest') return `<tr><td>Daily Typing Test</td><td>${a.assignedCount}</td><td>${s.attempted}</td><td>${a.perTrainee.size - s.attempted}</td><td>${s.metTarget}</td></tr>`;
    if (a.key === 'assessment') return `<tr><td>Assessment</td><td>${a.assignedCount}</td><td>${s.attempted}</td><td>${a.perTrainee.size - s.attempted}</td><td>${s.passed}</td></tr>`;
    if (a.key === 'learningNugget') return `<tr><td>Learning Nugget</td><td>${a.assignedCount}</td><td>${s.acknowledged}</td><td>${s.pending}</td><td>${s.acknowledged}</td></tr>`;
    return `<tr><td>${esc(a.label)}</td><td>${a.assignedCount}</td><td>${s.completed}</td><td>${s.notStarted + s.inProgress}</td><td>${s.completed}</td></tr>`;
  }).join('');
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
    <tr style="background:#f3f4f6"><th align="left">Activity</th><th>Assigned</th><th>Completed/Attempted</th><th>Pending</th><th>Met Target/Passed</th></tr>
    ${rows}
  </table>`;
}

export function renderReportEmailHtml(report) {
  const { batch, dateLabel, attendance, activities, bestPerformers, focusTrainees, tni, trainerFocus, summary } = report;
  const section = (title, body) => `<h3 style="margin:20px 0 8px;color:#1e293b">${title}</h3>${body}`;

  let html = `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:720px">
    <p>Dear Team,</p>
    <p>Please find below the Daily Training Report for ${esc(batch.batchName || batch.batchNo)}.</p>
    ${section('Batch &amp; Attendance Summary', `
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
        <tr><td><b>Batch</b></td><td>${esc(batch.batchName)}</td></tr>
        <tr><td><b>Process</b></td><td>${esc(batch.process)}</td></tr>
        <tr><td><b>Branch</b></td><td>${esc(batch.branch)}</td></tr>
        <tr><td><b>Training Day</b></td><td>${attendance.trainingDay ? `Day ${attendance.trainingDay}` : '—'}</td></tr>
        <tr><td><b>Trainer / Coordinator</b></td><td>${esc(batch.coordinatorName)}</td></tr>
        <tr><td><b>Total Strength</b></td><td>${attendance.total}</td></tr>
        <tr><td><b>Present</b></td><td>${attendance.present}</td></tr>
        <tr><td><b>Absent</b></td><td>${attendance.absent}</td></tr>
        <tr><td><b>Attendance %</b></td><td>${attendance.pct}%</td></tr>
      </table>`)}
    ${section("Today's Activities", renderActivitySummaryTable(activities))}
  `;

  if (bestPerformers.length) {
    html += section('Best Performers', `<ul>${bestPerformers.map(b => `<li>${esc(b.summary)}</li>`).join('')}</ul>`);
  }
  if (focusTrainees.length) {
    html += section('Trainees Requiring Focus', `<ul>${focusTrainees.map(f => `<li><b>${esc(f.name)} – ${esc(f.priority)}</b><br/>${esc(f.reasons.join('; '))}</li>`).join('')}</ul>`);
  }
  if (tni.length) {
    html += section('Batch-Level TNI', `<ul>${tni.map(x => `<li><b>${esc(x.type)}${x.topic ? `: ${esc(x.topic)}` : ''}</b> – ${x.count} trainees affected. ${esc(x.recommendation)}</li>`).join('')}</ul>`);
  }
  html += section('Trainer Focus for Next Day', `<ul>${trainerFocus.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`);
  html += section('Overall Batch Status', `<p>${esc(summary)}</p>`);
  html += `<p>Regards,<br/>Training Team</p></div>`;
  return html;
}

// ─── RECIPIENTS ─────────────────────────────────────────────────────────────────

export async function resolveRecipients(batch, settings) {
  const missing = [];
  let to = null;
  if (batch.coordinatorLoginId) {
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: batch.coordinatorLoginId } });
    to = coord?.email || null;
  }
  if (!to) missing.push(`Batch Coordinator email is missing for ${batch.coordinatorLoginId || '(no coordinator assigned)'}.`);

  const cc = [];
  if (batch.branch) {
    const branchAdmins = await prisma.adminUserMaster.findMany({ where: { branch: batch.branch, active: true } });
    const emails = branchAdmins.map(a => a.email).filter(Boolean);
    if (!emails.length) missing.push(`No Admin (Branch Head) with an email on file is scoped to branch "${batch.branch}".`);
    cc.push(...emails);
  } else {
    missing.push('Batch has no branch set — cannot resolve a Branch Head.');
  }
  if (settings.superAdminEmails) {
    cc.push(...settings.superAdminEmails.split(',').map(e => e.trim()).filter(Boolean));
  }

  return { to, cc: [...new Set(cc)], missing };
}

// ─── SEND / PREVIEW / LOG ───────────────────────────────────────────────────────

export async function previewDailyBatchReport(batchNo, date = new Date()) {
  const report = await buildDailyBatchReport(batchNo, date);
  const html = renderReportEmailHtml(report);
  const subject = buildSubject(report);
  const recipients = await resolveRecipients(report.batch, report.settings);
  return { subject, html, recipients, activitiesIncluded: report.activities.map(a => a.key), summary: report.summary };
}

export async function sendDailyBatchReport(batchNo, date = new Date(), { trigger = 'Manual', sentBy = null } = {}) {
  const report = await buildDailyBatchReport(batchNo, date);
  const html = renderReportEmailHtml(report);
  const subject = buildSubject(report);
  const recipients = await resolveRecipients(report.batch, report.settings);
  const { start } = istDayBounds(date);

  const baseLog = {
    batchNo, reportDate: start, process: report.batch.process, branch: report.batch.branch,
    coordinatorLoginId: report.batch.coordinatorLoginId,
    activitiesIncluded: report.activities.map(a => a.key),
    totalTrainees: report.attendance.total, presentCount: report.attendance.present,
    subject, recipientTo: recipients.to, recipientCc: recipients.cc.join(', '),
    triggerType: trigger, sentBy, bodyHtml: html,
  };

  // Never silently skip a missing recipient — flag it for Admin instead (section 5).
  if (recipients.missing.length) {
    const logged = await prisma.dailyBatchReportLog.upsert({
      where: { batchNo_reportDate: { batchNo, reportDate: start } },
      create: { ...baseLog, status: 'Flagged', deliveryError: recipients.missing.join(' ') },
      update: { ...baseLog, status: 'Flagged', deliveryError: recipients.missing.join(' ') },
    });
    return { ok: false, status: 'Flagged', message: recipients.missing.join(' '), log: logged };
  }

  const result = await sendEmail({ to: recipients.to, cc: recipients.cc, subject, html });
  const status = result.ok ? 'Sent' : 'Failed';
  const logged = await prisma.dailyBatchReportLog.upsert({
    where: { batchNo_reportDate: { batchNo, reportDate: start } },
    create: { ...baseLog, status, sentAt: result.ok ? new Date() : null, deliveryError: result.ok ? null : result.message },
    update: { ...baseLog, status, sentAt: result.ok ? new Date() : null, deliveryError: result.ok ? null : result.message },
  });

  await audit({
    userIdentity: sentBy || 'system', userRole: sentBy ? 'Admin' : 'system', action: 'SEND_DAILY_BATCH_REPORT',
    module: 'DailyBatchReport', referenceId: batchNo, newValue: { status, trigger, activities: baseLog.activitiesIncluded },
  });

  return { ok: result.ok, status, message: result.message, log: logged };
}
