import { calculateReliabilitySnapshots } from '../services/calibrationReliability.js';
import { expireEvaluatorAuthorizations } from '../services/calibrationGovernance.js';
import { runEvaluatorQualityOperationsCycle } from '../services/calibrationOperations.js';
import { runAppealGovernanceCycle } from '../services/calibrationAppeals.js';

let running = false;
let lastRequestCycleAt = 0;
const REQUEST_FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;
const WORKER_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function runCycle(source) {
  if (running) return null;
  running = true;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 29 * 86400000);
    const expired = await expireEvaluatorAuthorizations(`calibration-${source}`);
    const reliability = await calculateReliabilitySnapshots({
      periodStart: start,
      periodEnd: end,
      actorId: `calibration-${source}`,
    });
    const operations = await runEvaluatorQualityOperationsCycle(source);
    const governance = await runAppealGovernanceCycle(source);
    const activity = Number(expired.expiredAuthorizations || 0)
      + Number(expired.expiredAssignments || 0)
      + Number(reliability.snapshots || 0)
      + Number(reliability.pairs || 0)
      + Number(reliability.qualityActions || 0)
      + Number(operations.certificates?.created || 0)
      + Number(operations.certificates?.updated || 0)
      + Number(operations.cohorts?.snapshots || 0)
      + Number(operations.notifications?.generated || 0)
      + Number(governance.expiredPacks || 0)
      + Number(governance.slaBreaches || 0);
    if (activity) {
      console.log(`[CALIBRATION] ${source} cycle processed ${activity} authorization, reliability, credential, appeal or governance item(s).`);
    }
    return { expired, reliability, operations, governance };
  } catch (error) {
    console.warn(`[CALIBRATION] ${source} cycle failed:`, error.message);
    return null;
  } finally {
    running = false;
  }
}

if (process.env.LMS_RUN_SCHEDULERS === 'true') {
  setImmediate(() => runCycle('worker-start'));
  const timer = setInterval(() => runCycle('worker'), WORKER_INTERVAL_MS);
  timer.unref?.();
}

export function calibrationRuntime(req, res, next) {
  if (Date.now() - lastRequestCycleAt >= REQUEST_FALLBACK_TTL_MS) {
    lastRequestCycleAt = Date.now();
    res.on('finish', () => setImmediate(() => runCycle('request-fallback')));
  }
  next();
}

export async function runCalibrationCycleNow(source = 'manual') {
  return runCycle(source);
}
