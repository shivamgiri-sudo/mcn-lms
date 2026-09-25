// Dedicated, isolated scheduler for the ISMS Test - Quarterly auto-assignment
// -- its own file/timer, same reasoning as dailyBatchReportScheduler.js (a
// bug here can't affect other scheduled jobs). Checks once a day (no cron
// library, same self-rescheduling setTimeout pattern) whether the current
// financial-year quarter has already been processed; if not, runs the bulk
// assignment for every active, eligible employee. Checking daily rather than
// only on the 1st of Apr/Jul/Oct/Jan means a server outage that spans a
// quarter boundary still catches up within 24h of coming back, instead of
// silently missing that quarter until someone notices.
import { prisma } from '../utils/db.js';
import { getFinancialQuarter, runQuarterlyAssignment } from './ismsQuarterlyAssessment.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const CHECK_HOUR_IST = 6; // 06:00 IST daily

function nowIST() { return new Date(Date.now() + IST_OFFSET_MS); }

function msUntilNextCheck() {
  const now = nowIST();
  const target = new Date(now);
  target.setHours(CHECK_HOUR_IST, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

async function checkAndRunQuarterlyAssignment() {
  const quarter = getFinancialQuarter();
  try {
    const already = await prisma.ismsQuarterlyRunLog.findUnique({ where: { quarterKey: quarter.key } });
    if (already) return;

    console.log(`[ISMS-QUARTERLY] Running bulk assignment for ${quarter.key}`);
    const result = await runQuarterlyAssignment({ triggerSource: 'QuarterlyScheduler' });
    await prisma.ismsQuarterlyRunLog.create({
      data: {
        quarterKey: quarter.key, triggerType: 'Automatic',
        totalEmployees: result.total, assignedCount: result.assigned,
        skippedSummary: result.skippedByReason,
      },
    });
    console.log(`[ISMS-QUARTERLY] ${quarter.key}: ${result.assigned}/${result.total} newly assigned.`);
  } catch (err) {
    console.error('[ISMS-QUARTERLY] Quarterly check failed:', err.message);
  }
}

function scheduleNext() {
  const delay = msUntilNextCheck();
  const fireAt = new Date(Date.now() + delay);
  console.log(`[ISMS-QUARTERLY] Next quarter check scheduled for ${fireAt.toISOString()} (IST ${String(CHECK_HOUR_IST).padStart(2, '0')}:00)`);
  setTimeout(async () => {
    await checkAndRunQuarterlyAssignment();
    scheduleNext();
  }, delay);
}

export function startIsmsQuarterlyScheduler() {
  // Also check once immediately at boot, so a fresh deploy inside an
  // already-current quarter doesn't wait until the next 06:00 IST tick to
  // pick up anyone who should already have been assigned.
  checkAndRunQuarterlyAssignment();
  scheduleNext();
}
