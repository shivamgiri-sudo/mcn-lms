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
  const { batch, dateLabel, attendance, activities, bestPerformers, focusTrainees, tni, trainerFocus, summary, settings } = report;
  const pct = Math.round(attendance.pct || 0);
  const attColor = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  const attBg    = pct >= 80 ? '#dcfce7'  : pct >= 60 ? '#fef3c7'  : '#fee2e2';

  // ── SVG donut chart ──────────────────────────────────────────────────────────
  const circ   = 376.99; // 2 * PI * 60
  const filled = Math.min(pct / 100 * circ, circ);
  const gap    = circ - filled;
  const svgDonut = `<svg viewBox="0 0 160 160" width="160" height="160" style="display:block;margin:0 auto">
    <circle cx="80" cy="80" r="60" fill="none" stroke="#e2e8f0" stroke-width="14"/>
    <circle cx="80" cy="80" r="60" fill="none" stroke="${attColor}" stroke-width="14"
      stroke-dasharray="${filled.toFixed(2)} ${gap.toFixed(2)}" stroke-linecap="round"
      transform="rotate(-90 80 80)"/>
    <text x="80" y="74" text-anchor="middle" font-size="28" font-weight="bold" fill="${attColor}" font-family="Arial,sans-serif">${pct}%</text>
    <text x="80" y="96" text-anchor="middle" font-size="13" fill="#64748b" font-family="Arial,sans-serif">Present</text>
  </svg>`;

  // ── Activity color map ────────────────────────────────────────────────────────
  const ACT_COLOR = { typingTest: '#7c3aed', assessment: '#d97706', classroomCurriculum: '#2563eb', videoCourse: '#0891b2', learningNugget: '#0d9488' };

  // ── Activity cards ───────────────────────────────────────────────────────────
  const activityCards = activities.map(a => {
    const s     = a.batchSummary;
    const color = ACT_COLOR[a.key] || '#0d9488';
    let metrics = '';
    let compPct = 0;

    if (a.key === 'typingTest') {
      compPct  = a.assignedCount > 0 ? Math.round((s.attempted || 0) / a.assignedCount * 100) : 0;
      metrics  = `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:${color}">${s.attempted || 0}</div><div style="font-size:11px;color:#64748b">Attempted</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#16a34a">${s.metTarget || 0}</div><div style="font-size:11px;color:#64748b">Met Target</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#dc2626">${a.assignedCount - (s.attempted || 0)}</div><div style="font-size:11px;color:#64748b">Pending</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:16px;font-weight:bold;color:#1e293b">${s.avgNetWpm != null ? Number(s.avgNetWpm).toFixed(1) : '—'} WPM</div><div style="font-size:11px;color:#64748b">Avg Speed</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:16px;font-weight:bold;color:#1e293b">${s.avgAccuracy != null ? Number(s.avgAccuracy).toFixed(1) : '—'}%</div><div style="font-size:11px;color:#64748b">Avg Accuracy</div></td>
      </tr></table>`;
    } else if (a.key === 'assessment') {
      compPct  = a.assignedCount > 0 ? Math.round((s.attempted || 0) / a.assignedCount * 100) : 0;
      metrics  = `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:${color}">${s.attempted || 0}</div><div style="font-size:11px;color:#64748b">Attempted</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#16a34a">${s.passed || 0}</div><div style="font-size:11px;color:#64748b">Passed</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#dc2626">${s.failed || 0}</div><div style="font-size:11px;color:#64748b">Failed</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:16px;font-weight:bold;color:#1e293b">${s.passRate != null ? Number(s.passRate).toFixed(1) : '—'}%</div><div style="font-size:11px;color:#64748b">Pass Rate</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:16px;font-weight:bold;color:#1e293b">${s.avgScore != null ? Number(s.avgScore).toFixed(0) : '—'}/100</div><div style="font-size:11px;color:#64748b">Avg Score</div></td>
      </tr></table>`;
    } else if (a.key === 'learningNugget') {
      compPct  = a.assignedCount > 0 ? Math.round((s.acknowledged || 0) / a.assignedCount * 100) : 0;
      metrics  = `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:${color}">${s.acknowledged || 0}</div><div style="font-size:11px;color:#64748b">Acknowledged</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#dc2626">${s.pending || 0}</div><div style="font-size:11px;color:#64748b">Pending</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:16px;font-weight:bold;color:#1e293b">${compPct}%</div><div style="font-size:11px;color:#64748b">Completion</div></td>
      </tr></table>`;
    } else {
      compPct  = s.completionPct || (a.assignedCount > 0 ? Math.round((s.completed || 0) / a.assignedCount * 100) : 0);
      metrics  = `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:${color}">${s.completed || 0}</div><div style="font-size:11px;color:#64748b">Completed</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#d97706">${s.inProgress || 0}</div><div style="font-size:11px;color:#64748b">In Progress</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:22px;font-weight:bold;color:#dc2626">${s.notStarted || 0}</div><div style="font-size:11px;color:#64748b">Not Started</div></td>
        <td style="text-align:center;padding:8px 10px"><div style="font-size:16px;font-weight:bold;color:#1e293b">${compPct}%</div><div style="font-size:11px;color:#64748b">Completion</div></td>
      </tr></table>`;
    }

    const barWidth = Math.min(compPct, 100);
    const progressBar = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px">
      <tr>
        <td style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden">
          <table height="8" cellpadding="0" cellspacing="0" border="0" style="width:${barWidth}%">
            <tr><td style="background:${color};border-radius:4px;height:8px"></td></tr>
          </table>
        </td>
        <td style="width:36px;text-align:right;font-size:11px;color:#64748b;padding-left:8px">${compPct}%</td>
      </tr>
    </table>`;

    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <tr><td style="border-left:4px solid ${color};padding:12px 16px;background:#f8fafc">
        <span style="font-size:14px;font-weight:bold;color:#1e293b">${esc(a.label)}</span>
      </td></tr>
      <tr><td style="padding:4px 16px">${metrics}</td></tr>
      <tr><td style="padding:4px 16px 14px">${progressBar}</td></tr>
    </table>`;
  }).join('');

  // ── Highlights & lowlights ────────────────────────────────────────────────────
  const highlights = [];
  if (pct >= 80) highlights.push(`&#9989; Strong attendance &mdash; ${attendance.present} of ${attendance.total} trainees present`);
  if (bestPerformers.length > 0) highlights.push(`&#11088; Top performer: <strong>${esc(bestPerformers[0].name)}</strong> &mdash; ${esc(bestPerformers[0].summary)}`);
  activities.forEach(a => {
    const s = a.batchSummary;
    const cp = a.key === 'typingTest' || a.key === 'assessment'
      ? (a.assignedCount > 0 ? Math.round((s.attempted || 0) / a.assignedCount * 100) : 0)
      : (s.completionPct || (a.assignedCount > 0 ? Math.round((s.completed || 0) / a.assignedCount * 100) : 0));
    if (cp === 100) highlights.push(`&#9989; 100% completion for <strong>${esc(a.label)}</strong>`);
  });

  const lowlights = [];
  if (pct < 70) lowlights.push(`&#9888;&#65039; Attendance dropped below target &mdash; only <strong>${pct}%</strong> present`);
  if (focusTrainees.length > 0) lowlights.push(`&#9888;&#65039; <strong>${focusTrainees.length}</strong> trainee${focusTrainees.length > 1 ? 's' : ''} require${focusTrainees.length === 1 ? 's' : ''} immediate coordinator attention`);
  const critHigh = focusTrainees.filter(f => f.priority === 'Critical' || f.priority === 'High');
  critHigh.forEach(f => lowlights.push(`&#128308; <strong>${esc(f.name)}</strong> (${esc(f.priority)} priority)`));

  const hlHtml = highlights.length ? highlights.map(h => `<tr><td style="padding:5px 0;font-size:13px;color:#166534;line-height:1.5">${h}</td></tr>`).join('') : `<tr><td style="padding:5px 0;font-size:13px;color:#94a3b8;font-style:italic">No highlights recorded</td></tr>`;
  const llHtml = lowlights.length  ? lowlights.map(l  => `<tr><td style="padding:5px 0;font-size:13px;color:#991b1b;line-height:1.5">${l}</td></tr>`).join('') : `<tr><td style="padding:5px 0;font-size:13px;color:#94a3b8;font-style:italic">No alerts</td></tr>`;

  // ── Best performers ───────────────────────────────────────────────────────────
  const medals = ['&#129351;', '&#129352;', '&#129353;'];
  const bestPerfHtml = bestPerformers.length ? bestPerformers.slice(0, 5).map((b, i) => {
    const badgeHtml = (b.badges || []).map(bg => `<span style="background:#fef9c3;color:#854d0e;border:1px solid #fde047;font-size:10px;font-weight:bold;padding:2px 8px;border-radius:10px;display:inline-block;margin-right:4px">${esc(bg)}</span>`).join('');
    return `<tr style="border-bottom:1px solid #e2e8f0">
      <td style="padding:10px 16px;width:36px;font-size:20px;vertical-align:top">${medals[i] || '&#127942;'}</td>
      <td style="padding:10px 16px 10px 0">
        <div style="font-size:14px;font-weight:bold;color:#1e293b">${esc(b.name)} <span style="font-size:12px;color:#94a3b8;font-weight:normal">${esc(b.employeeId)}</span></div>
        <div style="font-size:12px;color:#475569;margin:4px 0 6px;line-height:1.5">${esc(b.summary)}</div>
        ${badgeHtml}
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="2" style="padding:12px 16px;font-size:13px;color:#94a3b8;font-style:italic">No outstanding performers recorded today</td></tr>`;

  // ── Focus trainees ────────────────────────────────────────────────────────────
  const priorityStyle = { Critical: 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca', High: 'background:#fff7ed;color:#ea580c;border:1px solid #fed7aa', Medium: 'background:#fefce8;color:#ca8a04;border:1px solid #fef08a' };
  const focusHtml = focusTrainees.length ? focusTrainees.map(f => {
    const ps = priorityStyle[f.priority] || 'background:#f1f5f9;color:#475569;border:1px solid #e2e8f0';
    return `<tr style="border-bottom:1px solid #e2e8f0">
      <td style="padding:10px 16px;width:90px;vertical-align:top">
        <span style="${ps};font-size:11px;font-weight:bold;padding:3px 10px;border-radius:10px;display:inline-block">${esc(f.priority)}</span>
      </td>
      <td style="padding:10px 16px 10px 0">
        <div style="font-size:14px;font-weight:bold;color:#1e293b">${esc(f.name)} <span style="font-size:12px;color:#94a3b8;font-weight:normal">${esc(f.employeeId)}</span></div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.5">${f.reasons.map(r => `&bull; ${esc(r)}`).join('<br/>')}</div>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="2" style="padding:12px 16px;font-size:13px;color:#94a3b8;font-style:italic">No focus trainees identified today</td></tr>`;

  // ── TNI table ─────────────────────────────────────────────────────────────────
  const tniHtml = tni.length ? tni.map(x => `<tr style="border-bottom:1px solid #e2e8f0">
    <td style="padding:10px 14px;font-size:13px;font-weight:bold;color:#1e293b;width:120px">${esc(x.type)}</td>
    <td style="padding:10px 14px;font-size:13px;color:#475569">${x.topic ? esc(x.topic) : '—'}</td>
    <td style="padding:10px 14px;font-size:13px;text-align:center;font-weight:bold;color:#dc2626;width:50px">${x.count}</td>
    <td style="padding:10px 14px;font-size:12px;color:#64748b">${esc(x.recommendation)}</td>
  </tr>`).join('') : `<tr><td colspan="4" style="padding:12px 14px;font-size:13px;color:#94a3b8;font-style:italic">No TNI items identified</td></tr>`;

  // ── Trainer focus ─────────────────────────────────────────────────────────────
  const focusListHtml = trainerFocus.map(a => `<tr><td style="padding:5px 0;font-size:13px;color:#1e40af">&#9744;&nbsp; ${esc(a)}</td></tr>`).join('');

  // ── Overall status colour ────────────────────────────────────────────────────
  const statusBorderColor = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  const statusBg          = pct >= 80 ? '#f0fdf4'  : pct >= 60 ? '#fffbeb'  : '#fef2f2';

  // ══════════════════════════════════════════════════════════════════════════════
  // FULL EMAIL HTML
  // ══════════════════════════════════════════════════════════════════════════════
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:20px 0">
<tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" border="0" style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,0.10)">

<!-- ── HEADER ─────────────────────────────────────────────────────────────── -->
<tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);padding:28px 36px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:top">
        <div style="font-size:10px;font-weight:bold;color:#7dd3fc;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">MCN T&amp;Q Training Operations</div>
        <div style="font-size:22px;font-weight:bold;color:#ffffff;margin-bottom:8px">Daily Batch Performance Report</div>
        <div style="font-size:14px;color:#93c5fd;margin-bottom:4px">${esc(batch.batchName || batch.batchNo)}</div>
        <div style="font-size:13px;color:#7dd3fc">${esc(dateLabel)} &nbsp;&middot;&nbsp; ${attendance.trainingDay ? 'Training Day ' + esc(String(attendance.trainingDay)) : '—'}</div>
      </td>
      <td style="vertical-align:top;text-align:right;width:120px">
        <div style="display:inline-block;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.25);border-radius:50px;padding:10px 18px">
          <div style="font-size:24px;font-weight:bold;color:${pct >= 80 ? '#4ade80' : pct >= 60 ? '#fbbf24' : '#f87171'}">${pct}%</div>
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Attendance</div>
        </div>
      </td>
    </tr>
  </table>
</td></tr>

<!-- ── SECTION 1: ATTENDANCE SNAPSHOT ───────────────────────────────────── -->
<tr><td style="padding:28px 36px 20px">
  <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">&#128202; Attendance Snapshot</div>

  <!-- 4 KPI tiles -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
    <tr>
      <td style="width:25%;padding:0 6px 0 0">
        <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;text-align:center">
          <tr><td>
            <div style="font-size:28px;font-weight:bold;color:#1e40af">${attendance.total}</div>
            <div style="font-size:11px;color:#3b82f6;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Strength</div>
          </td></tr>
        </table>
      </td>
      <td style="width:25%;padding:0 6px">
        <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;text-align:center">
          <tr><td>
            <div style="font-size:28px;font-weight:bold;color:#16a34a">${attendance.present}</div>
            <div style="font-size:11px;color:#22c55e;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Present</div>
          </td></tr>
        </table>
      </td>
      <td style="width:25%;padding:0 6px">
        <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;text-align:center">
          <tr><td>
            <div style="font-size:28px;font-weight:bold;color:#dc2626">${attendance.absent}</div>
            <div style="font-size:11px;color:#ef4444;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Absent</div>
          </td></tr>
        </table>
      </td>
      <td style="width:25%;padding:0 0 0 6px">
        <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:${attBg};border:1px solid ${attColor}40;border-radius:10px;text-align:center">
          <tr><td>
            <div style="font-size:28px;font-weight:bold;color:${attColor}">${pct}%</div>
            <div style="font-size:11px;color:${attColor};font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Attendance</div>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Donut chart + batch meta -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
    <tr>
      <td style="width:200px;padding:24px;border-right:1px solid #e2e8f0;text-align:center;vertical-align:middle">
        ${svgDonut}
      </td>
      <td style="padding:24px;vertical-align:middle">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:8px 0;font-size:12px;color:#64748b;width:130px">Process</td>
            <td style="padding:8px 0;font-size:13px;font-weight:bold;color:#1e293b">${esc(batch.process || '—')}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:8px 0;font-size:12px;color:#64748b">Branch</td>
            <td style="padding:8px 0;font-size:13px;color:#1e293b">${esc(batch.branch || '—')}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:8px 0;font-size:12px;color:#64748b">Coordinator</td>
            <td style="padding:8px 0;font-size:13px;color:#1e293b">${esc(batch.coordinatorName || '—')}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:12px;color:#64748b">Training Day</td>
            <td style="padding:8px 0;font-size:13px;font-weight:bold;color:#2563eb">${attendance.trainingDay ? 'Day ' + esc(String(attendance.trainingDay)) : '—'}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</td></tr>

<!-- ── SECTION 2: ACTIVITY PERFORMANCE ──────────────────────────────────── -->
<tr><td style="padding:0 36px 20px">
  <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">&#128202; Activity Performance</div>
  ${activityCards}
</td></tr>

<!-- ── SECTION 3: HIGHLIGHTS & LOWLIGHTS ────────────────────────────────── -->
<tr><td style="padding:0 36px 20px">
  <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">&#128161; Highlights &amp; Alerts</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="vertical-align:top;padding-right:8px;width:50%">
        <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;height:100%">
          <tr><td>
            <div style="font-size:12px;font-weight:bold;color:#166534;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">&#128994; Highlights</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">${hlHtml}</table>
          </td></tr>
        </table>
      </td>
      <td style="vertical-align:top;padding-left:8px;width:50%">
        <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;height:100%">
          <tr><td>
            <div style="font-size:12px;font-weight:bold;color:#991b1b;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">&#128308; Alerts &amp; Lowlights</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">${llHtml}</table>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</td></tr>

<!-- ── SECTION 4: BEST PERFORMERS ───────────────────────────────────────── -->
<tr><td style="padding:0 36px 20px">
  <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">&#127942; Best Performers</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;overflow:hidden">
    ${bestPerfHtml}
  </table>
</td></tr>

<!-- ── SECTION 5: TRAINEES REQUIRING FOCUS ──────────────────────────────── -->
<tr><td style="padding:0 36px 20px">
  <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">&#9888;&#65039; Trainees Requiring Focus</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;overflow:hidden">
    ${focusHtml}
  </table>
</td></tr>

<!-- ── SECTION 6: TNI ─────────────────────────────────────────────────────── -->
<tr><td style="padding:0 36px 20px">
  <div style="font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">&#128270; Training Need Identification (TNI)</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
    <tr style="background:#f1f5f9">
      <td style="padding:10px 14px;font-size:11px;font-weight:bold;color:#475569;text-transform:uppercase;width:120px">Type</td>
      <td style="padding:10px 14px;font-size:11px;font-weight:bold;color:#475569;text-transform:uppercase">Topic</td>
      <td style="padding:10px 14px;font-size:11px;font-weight:bold;color:#475569;text-transform:uppercase;width:50px;text-align:center">Count</td>
      <td style="padding:10px 14px;font-size:11px;font-weight:bold;color:#475569;text-transform:uppercase">Recommendation</td>
    </tr>
    ${tniHtml}
  </table>
</td></tr>

<!-- ── SECTION 7: TRAINER FOCUS ──────────────────────────────────────────── -->
<tr><td style="padding:0 36px 20px">
  <table width="100%" cellpadding="18" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px">
    <tr><td>
      <div style="font-size:12px;font-weight:bold;color:#1e40af;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">&#128198; Trainer Focus for Next Session</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${focusListHtml}</table>
    </td></tr>
  </table>
</td></tr>

<!-- ── SECTION 8: OVERALL STATUS ─────────────────────────────────────────── -->
<tr><td style="padding:0 36px 28px">
  <table width="100%" cellpadding="20" cellspacing="0" border="0" style="background:${statusBg};border-left:5px solid ${statusBorderColor};border-radius:0 8px 8px 0">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:${statusBorderColor};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Overall Batch Status</div>
      <div style="font-size:14px;color:#1e293b;line-height:1.7">${esc(summary)}</div>
    </td></tr>
  </table>
</td></tr>

<!-- ── FOOTER ─────────────────────────────────────────────────────────────── -->
<tr><td style="background:#0f172a;padding:20px 36px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#94a3b8">
        <strong style="color:#e2e8f0">MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Daily Report &nbsp;&middot;&nbsp; ${esc(dateLabel)}
      </td>
      <td align="right" style="font-size:11px;color:#475569">This is an automated report. Reply to your coordinator for queries.</td>
    </tr>
  </table>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
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
  let branchHeadFound = false;
  if (batch.branch) {
    const branchAdmins = await prisma.adminUserMaster.findMany({ where: { branch: batch.branch, active: true } });
    const emails = branchAdmins.map(a => a.email).filter(Boolean);
    branchHeadFound = emails.length > 0;
    cc.push(...emails);
  } else {
    missing.push('Batch has no branch set — cannot resolve a Branch Head.');
  }
  if (settings.superAdminEmails) {
    cc.push(...settings.superAdminEmails.split(',').map(e => e.trim()).filter(Boolean));
  }
  // A missing Branch Head falls back to actual Super Admin accounts in the system
  // (not just the manually-configured settings.superAdminEmails list) rather than
  // blocking the send.
  if (batch.branch && !branchHeadFound) {
    const superAdmins = await prisma.adminUserMaster.findMany({
      where: { role: { in: ['Super Admin', 'SuperAdmin'] }, active: true },
    });
    cc.push(...superAdmins.map(a => a.email).filter(Boolean));
  }
  if (batch.branch && !branchHeadFound && !cc.length) {
    missing.push(`No Admin (Branch Head) with an email on file is scoped to branch "${batch.branch}", and no Super Admin email is on file to fall back to.`);
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
