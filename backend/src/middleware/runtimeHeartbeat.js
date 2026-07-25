import { heartbeatRuntime, runtimeInstanceId } from '../services/runtimeGovernance.js';

const HEARTBEAT_SECONDS = Math.min(300, Math.max(10, Number.parseInt(process.env.LMS_RUNTIME_HEARTBEAT_SECONDS || '30', 10) || 30));
let started = false;
let timer = null;
let lastHeartbeatAt = 0;

async function beat(status = 'HEALTHY', metadata = null) {
  try {
    await heartbeatRuntime({ status, metadata });
    lastHeartbeatAt = Date.now();
  } catch (error) {
    console.warn(`[RUNTIME] Heartbeat failed for ${runtimeInstanceId()}:`, error.message);
  }
}

export function startRuntimeHeartbeat() {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;
  setImmediate(() => beat('STARTING', { source: 'process-start' }));
  timer = setInterval(() => beat('HEALTHY', { source: 'interval' }), HEARTBEAT_SECONDS * 1000);
  timer.unref?.();

  const draining = signal => {
    beat('DRAINING', { signal }).catch(() => {});
  };
  process.once('SIGTERM', () => draining('SIGTERM'));
  process.once('SIGINT', () => draining('SIGINT'));
  process.once('beforeExit', () => beat('STOPPED', { source: 'before-exit' }).catch(() => {}));
}

export function runtimeHeartbeat(req, res, next) {
  startRuntimeHeartbeat();
  if (Date.now() - lastHeartbeatAt > HEARTBEAT_SECONDS * 1000) {
    res.once('finish', () => setImmediate(() => beat(res.statusCode >= 500 ? 'DEGRADED' : 'HEALTHY', {
      source: 'request',
      requestId: req.requestId,
      statusCode: res.statusCode,
    })));
  }
  next();
}

startRuntimeHeartbeat();
