import { runNotificationCampaignCycle } from '../services/notificationCampaigns.js';
import { generatePracticalAssessmentReminders } from '../services/practicalNotificationCampaigns.js';
import { withRuntimeLease } from '../services/runtimeGovernance.js';

let running = false;
let lastRequestCycleAt = 0;
const REQUEST_CYCLE_TTL_MS = 60_000;

async function executeCycle(source) {
  const practical = await generatePracticalAssessmentReminders();
  const result = await runNotificationCampaignCycle(`notification-${source}-${process.pid}`);
  const activity = Number(result.eventsBeforeEscalation?.claimed || 0)
    + Number(result.eventsAfterEscalation?.claimed || 0)
    + Number(result.deliveries?.claimed || 0)
    + Number(result.ilt?.generated || 0)
    + Number(result.coaching?.generated || 0)
    + Number(result.certifications?.generated || 0)
    + Number(result.escalations?.sent || 0)
    + Number(practical.generated || 0);
  if (activity) {
    console.log(`[NOTIFY] ${source} cycle processed ${activity} event, campaign, escalation or delivery item(s).`);
  }
  return { ...result, practical };
}

async function runCycle(source) {
  if (running) return null;
  running = true;
  try {
    const governed = await withRuntimeLease(
      'notification-campaign-cycle',
      () => executeCycle(source),
      { ttlSeconds: 300, metadata: { source, cadenceSeconds: 60 } },
    );
    if (governed.skipped) return { skipped: true, lease: governed.lease };
    return governed.result;
  } catch (error) {
    console.warn(`[NOTIFY] ${source} cycle failed:`, error.message);
    return null;
  } finally {
    running = false;
  }
}

if (process.env.LMS_RUN_SCHEDULERS === 'true') {
  setImmediate(() => runCycle('worker-start'));
  const timer = setInterval(() => runCycle('worker'), 60_000);
  timer.unref?.();
}

export function notificationRuntime(req, res, next) {
  if (Date.now() - lastRequestCycleAt >= REQUEST_CYCLE_TTL_MS) {
    lastRequestCycleAt = Date.now();
    res.on('finish', () => setImmediate(() => runCycle('request-fallback')));
  }
  next();
}

export async function runNotificationCycleNow(source = 'manual') {
  return runCycle(source);
}
