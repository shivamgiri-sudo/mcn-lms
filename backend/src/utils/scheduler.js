/**
 * scheduler.js — LMS notification scheduler
 *
 * All jobs run on configurable IST times read from notification_config DB row.
 * Each job is self-rescheduling: fires once, then sets a 24-hour timeout.
 *
 * Jobs:
 *  1. Deadline Reminder       — remind trainees of assigned modules due tomorrow (or N days)
 *  2. Completion Reminder     — nudge trainees stuck with incomplete content for N days
 *  3. Daily Coverage Digest   — per-coordinator summary of their batch progress
 *  4. Coordinator Risk Alert  — list of at-risk trainees for each coordinator
 *  5. Pending Activities Digest — overdue pending activities for each coordinator
 *  6. Admin Daily Summary     — existing global stats email (already wired in server.js)
 */

import { prisma } from './db.js';
import { sendEmail } from './notify.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST() { return new Date(Date.now() + IST_OFFSET_MS); }

// Parse "HH:MM" into { h, m }
function parseTime(str) {
  const [h, m] = (str || '09:00').split(':').map(Number);
  return { h: h || 9, m: m || 0 };
}

// Milliseconds until next HH:MM IST
function msUntilIST(hh, mm) {
  const now = nowIST();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

async function getConfig() {
  try {
    let cfg = await prisma.notificationConfig.findUnique({ where: { id: 'default' } });
    if (!cfg) cfg = await prisma.notificationConfig.create({ data: { id: 'default' } });
    return cfg;
  } catch (err) {
    console.error('[SCHEDULER] Could not load notification_config:', err.message);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pct(n) { return `${Math.round(n || 0)}%`; }

function scheduleJob(name, jobFn, hh, mm) {
  const delay = msUntilIST(hh, mm);
  const fireAt = new Date(Date.now() + delay);
  console.log(`[SCHEDULER] ${name} scheduled for ${fireAt.toISOString()} (IST ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')})`);
  setTimeout(async () => {
    console.log(`[SCHEDULER] Running: ${name}`);
    try { await jobFn(); } catch (err) { console.error(`[SCHEDULER] ${name} failed:`, err.message); }
    // Reload config for next fire
    const cfg = await getConfig();
    if (cfg) {
      const timeKey = {
        'Deadline Reminder':       cfg.deadlineReminderTime,
        'Completion Reminder':     cfg.completionReminderTime,
        'Daily Coverage Digest':   cfg.dailyCoverageTime,
        'Coordinator Risk Alert':  cfg.coordinatorAlertTime,
        'Pending Activities Digest': cfg.pendingActivityAlertTime,
      }[name] || '09:00';
      const { h, m } = parseTime(timeKey);
      scheduleJob(name, jobFn, h, m);
    }
  }, delay);
}

// ── Job 1: Deadline Reminder ─────────────────────────────────────────────────
// Sends to each trainee who has an assigned module due in N days
async function runDeadlineReminder(cfg) {
  if (!cfg.deadlineReminderEnabled) return;
  const days = cfg.deadlineReminderDays || 1;
  const now = new Date();
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to   = new Date(now); to.setDate(to.getDate() + days); to.setHours(23, 59, 59, 999);

  const assignments = await prisma.assignedModule.findMany({
    where: { active: true, dueDate: { gte: from, lte: to }, assignedToType: 'individual' },
  });

  for (const a of assignments) {
    const trainee = await prisma.traineeMaster.findUnique({
      where: { employeeId: a.assignedTo },
      select: { traineeName: true, email: true, mobile: true },
    });
    if (!trainee?.email) continue;

    await sendEmail({
      to: trainee.email,
      subject: `Reminder: "${a.moduleName}" is due ${fmtDate(a.dueDate)} — MCN LMS`,
      html: `<p>Hi <b>${trainee.traineeName || a.assignedTo}</b>,</p>
<p>This is a reminder that your assigned module <b>"${a.moduleName}"</b>${a.broadcastTitle ? ` (${a.broadcastTitle})` : ''} is due on <b>${fmtDate(a.dueDate)}</b>.</p>
<p>Please log in to MCN LMS and complete it before the deadline.</p>
<p style="color:#6b7280;font-size:12px">— MCN LMS Automated Reminder</p>`,
      text: `Hi ${trainee.traineeName || a.assignedTo}, your module "${a.moduleName}" is due on ${fmtDate(a.dueDate)}. Please complete it before the deadline. — MCN LMS`,
    }).catch(e => console.error('[SCHEDULER] Deadline reminder failed:', e.message));
  }
  console.log(`[SCHEDULER] Deadline reminders sent for ${assignments.length} assignment(s).`);
}

// ── Job 2: Completion Reminder ───────────────────────────────────────────────
// Sends to trainees with < 100% completion who haven't had activity in N days
async function runCompletionReminder(cfg) {
  if (!cfg.completionReminderEnabled) return;
  const staleDays = cfg.completionReminderDays || 2;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);

  const staleTrainees = await prisma.traineeMaster.findMany({
    where: {
      status: 'Active',
      courseCompletionPct: { lt: 100 },
      email: { not: null },
    },
    select: {
      employeeId: true, traineeName: true, email: true,
      courseCompletionPct: true, batchNo: true, classroomName: true,
    },
  });

  let sent = 0;
  for (const t of staleTrainees) {
    // Check last content activity
    const lastActivity = await prisma.contentProgress.findFirst({
      where: { employeeId: t.employeeId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    if (lastActivity && lastActivity.updatedAt > cutoff) continue; // active recently

    await sendEmail({
      to: t.email,
      subject: `Keep going! Your training is ${pct(t.courseCompletionPct)} complete — MCN LMS`,
      html: `<p>Hi <b>${t.traineeName || t.employeeId}</b>,</p>
<p>You're <b>${pct(t.courseCompletionPct)}</b> through your training${t.classroomName ? ` in <b>${t.classroomName}</b>` : ''}. Don't stop now!</p>
<p>Log in to MCN LMS to pick up where you left off.</p>
<p style="color:#6b7280;font-size:12px">— MCN LMS Automated Reminder · Batch: ${t.batchNo || '—'}</p>`,
      text: `Hi ${t.traineeName || t.employeeId}, you're ${pct(t.courseCompletionPct)} through your training. Log in to continue. — MCN LMS`,
    }).catch(e => console.error('[SCHEDULER] Completion reminder failed:', e.message));
    sent++;
  }
  console.log(`[SCHEDULER] Completion reminders sent to ${sent} trainee(s).`);
}

// ── Job 3: Daily Coverage Digest (per coordinator) ───────────────────────────
// Sends each coordinator a summary of their active batches — coverage, risk, pending
async function runDailyCoverageDigest(cfg) {
  if (!cfg.dailyCoverageEnabled) return;

  const coordinators = await prisma.roleAccessMatrix.findMany({
    where: { active: true, email: { not: null } },
    select: { loginId: true, name: true, email: true },
  });

  // Also send to extra recipients configured in admin
  const extraRecipients = (cfg.dailyCoverageRecipients || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  for (const coord of coordinators) {
    const batches = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: coord.loginId, batchStatus: 'Active' },
      select: { batchNo: true, batchName: true, branch: true, process: true, totalTrainees: true },
    });
    if (batches.length === 0) continue;

    const batchNos = batches.map(b => b.batchNo);
    const [stats, atRisk, pending] = await Promise.all([
      prisma.traineeMaster.aggregate({
        where: { batchNo: { in: batchNos }, status: 'Active' },
        _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.count({
        where: { batchNo: { in: batchNos }, riskStatus: { in: ['CRITICAL', 'HIGH'] } },
      }),
      prisma.pendingActivityLog.count({
        where: { batchNo: { in: batchNos }, status: 'Open' },
      }),
    ]);

    const avgCourse = Math.round(stats._avg.courseCompletionPct || 0);
    const avgMcq    = Math.round(stats._avg.assessmentPassPct || 0);
    const avgAtt    = Math.round(stats._avg.attendancePct || 0);
    const total     = stats._count.employeeId || 0;
    const today     = new Date().toDateString();

    const batchRows = batches.map(b =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${b.batchNo}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${b.batchName || '—'}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${b.process || '—'}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right">${b.totalTrainees}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
  <div style="background:#1e40af;padding:20px 24px">
    <h2 style="color:#fff;margin:0;font-size:18px">Daily Training Coverage — ${today}</h2>
    <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Hi ${coord.name || coord.loginId}</p>
  </div>
  <div style="padding:24px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px">Active Trainees</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;font-size:16px">${total}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px">Avg Course Completion</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;font-size:16px;color:${avgCourse>=70?'#16a34a':avgCourse>=50?'#d97706':'#dc2626'}">${avgCourse}%</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px">Avg MCQ Pass Rate</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;font-size:16px;color:${avgMcq>=60?'#16a34a':'#dc2626'}">${avgMcq}%</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px">Avg Attendance</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;font-size:16px;color:${avgAtt>=70?'#16a34a':'#dc2626'}">${avgAtt}%</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px">At-Risk (CRITICAL/HIGH)</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;font-size:16px;color:${atRisk>0?'#dc2626':'#16a34a'}">${atRisk}</td></tr>
      <tr><td style="padding:8px 0;color:#555;font-size:14px">Pending Activities Open</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px;color:${pending>0?'#d97706':'#16a34a'}">${pending}</td></tr>
    </table>
    <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px">Your Active Batches</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f8fafc"><th style="padding:6px 10px;text-align:left">Batch</th><th style="padding:6px 10px;text-align:left">Name</th><th style="padding:6px 10px;text-align:left">Process</th><th style="padding:6px 10px;text-align:right">Trainees</th></tr></thead>
      <tbody>${batchRows}</tbody>
    </table>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:11px;color:#94a3b8">MCN LMS · Automated Daily Coverage Report</p></div>
</div></body></html>`;

    await sendEmail({ to: coord.email, subject: `Daily Coverage — ${total} trainees, ${avgCourse}% avg completion — ${today}`, html,
      text: `Daily Coverage ${today}: ${total} trainees, ${avgCourse}% course, ${avgMcq}% MCQ, ${atRisk} at-risk, ${pending} pending.` })
      .catch(e => console.error('[SCHEDULER] Coverage digest failed:', e.message));
  }

  // Extra recipients get the global admin summary
  if (extraRecipients.length > 0) {
    const [activeBatches, totalTrainees, avgRaw, criticalRisks] = await Promise.all([
      prisma.batchMaster.count({ where: { batchStatus: 'Active' } }),
      prisma.traineeMaster.count({ where: { status: 'Active' } }),
      prisma.traineeMaster.aggregate({ _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true }, where: { status: 'Active' } }),
      prisma.trainingRiskLog.count({ where: { severity: 'CRITICAL', status: 'Open' } }).catch(() => 0),
    ]);
    const today = new Date().toDateString();
    const ac = Math.round(avgRaw._avg.courseCompletionPct || 0);
    const am = Math.round(avgRaw._avg.assessmentPassPct || 0);
    await sendEmail({
      to: extraRecipients,
      subject: `LMS Daily Coverage — ${activeBatches} batches, ${totalTrainees} trainees — ${today}`,
      html: `<p><b>LMS Daily Coverage ${today}</b></p><ul><li>Active Batches: ${activeBatches}</li><li>Active Trainees: ${totalTrainees}</li><li>Avg Course: ${ac}%</li><li>Avg MCQ: ${am}%</li><li>Critical Risks Open: ${criticalRisks}</li></ul>`,
      text: `LMS Daily Coverage ${today}: ${activeBatches} batches, ${totalTrainees} trainees, ${ac}% course, ${am}% MCQ, ${criticalRisks} critical risks.`,
    }).catch(e => console.error('[SCHEDULER] Extra coverage digest failed:', e.message));
  }

  console.log(`[SCHEDULER] Daily coverage digest sent to ${coordinators.length} coordinator(s).`);
}

// ── Job 4: Coordinator Risk Alert ────────────────────────────────────────────
async function runCoordinatorRiskAlert(cfg) {
  if (!cfg.coordinatorAlertEnabled) return;
  const minRisk = cfg.coordinatorAlertMinRisk || 'HIGH';
  const riskLevels = minRisk === 'WATCH' ? ['CRITICAL', 'HIGH', 'WATCH']
    : minRisk === 'HIGH' ? ['CRITICAL', 'HIGH']
    : ['CRITICAL'];

  const coordinators = await prisma.roleAccessMatrix.findMany({
    where: { active: true, email: { not: null } },
    select: { loginId: true, name: true, email: true },
  });

  for (const coord of coordinators) {
    const batches = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: coord.loginId, batchStatus: 'Active' },
      select: { batchNo: true },
    });
    if (!batches.length) continue;

    const batchNos = batches.map(b => b.batchNo);
    const atRisk = await prisma.traineeMaster.findMany({
      where: { batchNo: { in: batchNos }, riskStatus: { in: riskLevels } },
      select: { employeeId: true, traineeName: true, batchNo: true, riskStatus: true, riskReason: true, courseCompletionPct: true, attendancePct: true },
      orderBy: [{ riskStatus: 'asc' }, { courseCompletionPct: 'asc' }],
      take: 50,
    });
    if (!atRisk.length) continue;

    const rows = atRisk.map(t =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px">${t.employeeId}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px">${t.traineeName || '—'}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px">${t.batchNo}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;color:${t.riskStatus==='CRITICAL'?'#dc2626':t.riskStatus==='HIGH'?'#d97706':'#ca8a04'};font-weight:700">${t.riskStatus}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#6b7280">${t.riskReason||'—'}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px">${Math.round(t.courseCompletionPct||0)}%</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
  <div style="background:#991b1b;padding:20px 24px">
    <h2 style="color:#fff;margin:0;font-size:18px">⚠ At-Risk Trainee Alert — ${new Date().toDateString()}</h2>
    <p style="color:#fecaca;margin:4px 0 0;font-size:13px">Hi ${coord.name || coord.loginId} — ${atRisk.length} trainee(s) need attention</p>
  </div>
  <div style="padding:24px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8fafc"><th style="padding:8px 10px;text-align:left;font-size:12px">Emp ID</th><th style="padding:8px 10px;text-align:left;font-size:12px">Name</th><th style="padding:8px 10px;text-align:left;font-size:12px">Batch</th><th style="padding:8px 10px;text-align:left;font-size:12px">Risk</th><th style="padding:8px 10px;text-align:left;font-size:12px">Reason</th><th style="padding:8px 10px;text-align:right;font-size:12px">Course%</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:11px;color:#94a3b8">MCN LMS · Coordinator Risk Alert · Please take action on CRITICAL risks immediately.</p></div>
</div></body></html>`;

    await sendEmail({ to: coord.email, subject: `⚠ ${atRisk.length} At-Risk Trainees — Action Required — MCN LMS`, html,
      text: `${atRisk.length} at-risk trainee(s) in your batches. Log in to MCN LMS to take action.` })
      .catch(e => console.error('[SCHEDULER] Risk alert failed:', e.message));
  }
  console.log(`[SCHEDULER] Risk alerts sent to ${coordinators.length} coordinator(s).`);
}

// ── Job 5: Pending Activities Digest ─────────────────────────────────────────
async function runPendingActivitiesDigest(cfg) {
  if (!cfg.pendingActivityAlertEnabled) return;
  const overdueDays = cfg.pendingActivityAlertDays || 1;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - overdueDays);

  const coordinators = await prisma.roleAccessMatrix.findMany({
    where: { active: true, email: { not: null } },
    select: { loginId: true, name: true, email: true },
  });

  for (const coord of coordinators) {
    const batches = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: coord.loginId, batchStatus: 'Active' },
      select: { batchNo: true },
    });
    if (!batches.length) continue;

    const batchNos = batches.map(b => b.batchNo);
    const pending = await prisma.pendingActivityLog.findMany({
      where: {
        batchNo: { in: batchNos },
        status: 'Open',
        createdAt: { lte: cutoff },
      },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
      take: 30,
    });
    if (!pending.length) continue;

    const rows = pending.map(p =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px">${p.activityTitle}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px">${p.traineeName||p.employeeId||'—'}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px">${p.batchNo||'—'}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;color:${p.severity==='CRITICAL'?'#dc2626':p.severity==='HIGH'?'#d97706':'#ca8a04'};font-weight:700">${p.severity}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#6b7280">${fmtDate(p.dueDate)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
  <div style="background:#b45309;padding:20px 24px">
    <h2 style="color:#fff;margin:0;font-size:18px">📋 Pending Activities — ${new Date().toDateString()}</h2>
    <p style="color:#fde68a;margin:4px 0 0;font-size:13px">Hi ${coord.name || coord.loginId} — ${pending.length} item(s) need follow-up</p>
  </div>
  <div style="padding:24px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8fafc"><th style="padding:8px 10px;text-align:left;font-size:12px">Activity</th><th style="padding:8px 10px;text-align:left;font-size:12px">Trainee</th><th style="padding:8px 10px;text-align:left;font-size:12px">Batch</th><th style="padding:8px 10px;text-align:left;font-size:12px">Severity</th><th style="padding:8px 10px;text-align:left;font-size:12px">Due</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:11px;color:#94a3b8">MCN LMS · Pending Activities Digest</p></div>
</div></body></html>`;

    await sendEmail({ to: coord.email, subject: `📋 ${pending.length} Pending Activities Overdue — MCN LMS`, html,
      text: `${pending.length} pending activity item(s) in your batches are overdue. Log in to MCN LMS to action them.` })
      .catch(e => console.error('[SCHEDULER] Pending activities digest failed:', e.message));
  }
  console.log(`[SCHEDULER] Pending activities digest sent to ${coordinators.length} coordinator(s).`);
}

// ── Bootstrap — called once on server startup ─────────────────────────────────
export async function startScheduler() {
  console.log('[SCHEDULER] Initialising notification scheduler…');
  const cfg = await getConfig();
  if (!cfg) { console.warn('[SCHEDULER] Could not load config — scheduler not started.'); return; }

  const jobs = [
    { name: 'Deadline Reminder',       fn: () => runDeadlineReminder(cfg),       time: cfg.deadlineReminderTime },
    { name: 'Completion Reminder',     fn: () => runCompletionReminder(cfg),     time: cfg.completionReminderTime },
    { name: 'Daily Coverage Digest',   fn: () => runDailyCoverageDigest(cfg),    time: cfg.dailyCoverageTime },
    { name: 'Coordinator Risk Alert',  fn: () => runCoordinatorRiskAlert(cfg),   time: cfg.coordinatorAlertTime },
    { name: 'Pending Activities Digest', fn: () => runPendingActivitiesDigest(cfg), time: cfg.pendingActivityAlertTime },
  ];

  for (const job of jobs) {
    const { h, m } = parseTime(job.time);
    scheduleJob(job.name, job.fn, h, m);
  }

  console.log('[SCHEDULER] All 5 notification jobs scheduled.');
}
