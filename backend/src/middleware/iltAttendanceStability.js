import { syncIltSessionStates } from '../services/iltLifecycleWorker.js';

let lastRequestSyncAt = 0;
let requestSyncRunning = false;
const REQUEST_SYNC_TTL_MS = 60_000;

async function runRequestSync() {
  if (requestSyncRunning || Date.now() - lastRequestSyncAt < REQUEST_SYNC_TTL_MS) return;
  requestSyncRunning = true;
  try {
    await syncIltSessionStates();
    lastRequestSyncAt = Date.now();
  } catch (error) {
    console.warn('[ILT] Request lifecycle sync skipped:', error.message);
  } finally {
    requestSyncRunning = false;
  }
}

if (process.env.LMS_RUN_SCHEDULERS === 'true') {
  const runWorkerSync = () => {
    syncIltSessionStates()
      .then(result => {
        if (result.started || result.expiredCheckins || result.awaitingFinalization) {
          console.log(`[ILT] Started ${result.started}; cleared ${result.expiredCheckins} check-in codes; ${result.awaitingFinalization} awaiting finalization.`);
        }
      })
      .catch(error => console.warn('[ILT] Lifecycle worker skipped:', error.message));
  };
  runWorkerSync();
  const timer = setInterval(runWorkerSync, 5 * 60 * 1000);
  timer.unref?.();
}

export function normalizeIltAttendanceRequest(req, _res, next) {
  runRequestSync();
  const isAttendanceWrite = req.method === 'PUT'
    && /^\/(coordinator|admin)\/sessions\/[^/]+\/attendance\/[^/]+\/?$/.test(req.path);
  if (isAttendanceWrite && String(req.body?.attendanceStatus || '').toUpperCase() === 'ABSENT') {
    req.body = { ...(req.body || {}), attendedMinutes: 0, checkinAt: null, checkoutAt: null };
  }
  next();
}
