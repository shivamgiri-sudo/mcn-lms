// Dedicated, isolated scheduler for the Daily Batch Report — deliberately its own
// file/timer rather than a 6th job bolted onto utils/scheduler.js, so a bug here
// can't affect deadline reminders, risk alerts, etc. Follows the exact same
// self-rescheduling setTimeout pattern (no cron library) and reads
// DailyBatchReportSettings fresh on every firing, so an admin-edited send time
// takes effect within 24h without a restart.
import { prisma } from '../utils/db.js';
import { sendDailyBatchReport } from './dailyBatchReport.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST() { return new Date(Date.now() + IST_OFFSET_MS); }

function parseTime(str) {
  const [h, m] = (str || '19:00').split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 19, m: Number.isFinite(m) ? m : 0 };
}

function msUntilIST(hh, mm) {
  const now = nowIST();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

async function getSettings() {
  try {
    return await prisma.dailyBatchReportSettings.findUnique({ where: { id: 'default' } });
  } catch (err) {
    console.error('[DAILY-BATCH-REPORT] Could not load settings:', err.message);
    return null;
  }
}

async function runDailyBatchReports() {
  const settings = await getSettings();
  if (!settings || !settings.enabled) return;

  const todayStart = new Date(new Date().toDateString());
  const batches = await prisma.batchMaster.findMany({ where: { batchStatus: 'Active' }, select: { batchNo: true } });

  for (const b of batches) {
    try {
      // Idempotency: never let an automatic run re-send a report already sent
      // today for this batch (a manual Resend from the admin dashboard bypasses
      // this check deliberately, by calling sendDailyBatchReport directly).
      const existing = await prisma.dailyBatchReportLog.findUnique({
        where: { batchNo_reportDate: { batchNo: b.batchNo, reportDate: todayStart } },
      });
      if (existing?.status === 'Sent') continue;

      await sendDailyBatchReport(b.batchNo, todayStart, { trigger: 'Automatic', sentBy: null });
    } catch (err) {
      console.error(`[DAILY-BATCH-REPORT] Failed for batch ${b.batchNo}:`, err.message);
    }
  }
}

function scheduleNext() {
  getSettings().then(settings => {
    const { h, m } = parseTime(settings?.sendTime);
    const delay = msUntilIST(h, m);
    const fireAt = new Date(Date.now() + delay);
    console.log(`[DAILY-BATCH-REPORT] Next run scheduled for ${fireAt.toISOString()} (IST ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')})`);
    setTimeout(async () => {
      console.log('[DAILY-BATCH-REPORT] Running scheduled daily batch reports');
      try { await runDailyBatchReports(); } catch (err) { console.error('[DAILY-BATCH-REPORT] Run failed:', err.message); }
      scheduleNext();
    }, delay);
  });
}

export function startDailyBatchReportScheduler() {
  scheduleNext();
}
