import { emitNotificationEvent } from '../services/notificationOutbox.js';
import { syncEvaluatorAuthorizationCertificates } from '../services/calibrationOperations.js';

function successful(res, payload) {
  return res.statusCode >= 200 && res.statusCode < 300 && payload?.ok !== false;
}

async function emitAssignment(req, detail) {
  if (!detail?.assignmentId || !detail?.evaluatorId || !detail?.evaluatorType) return;
  await emitNotificationEvent({
    eventType: 'CALIBRATION_ASSIGNED',
    entityType: 'CALIBRATION_ASSIGNMENT',
    entityId: detail.assignmentId,
    actorId: req.userId,
    actorType: req.userType,
    branch: detail.program?.audienceBranch || '',
    processName: detail.program?.audienceProcess || '',
    lobName: detail.program?.audienceLob || '',
    payload: {
      recipientType: detail.evaluatorType,
      recipientId: detail.evaluatorId,
      programName: detail.programName,
      templateName: detail.templateName,
      templateVersion: detail.templateVersion,
      attemptNo: detail.attemptNo,
      dueAt: detail.dueAt,
      priority: 'HIGH',
    },
    idempotencyKey: `calibration-assigned:${detail.assignmentId}`,
  });
}

async function capture(req, payload) {
  const detail = payload?.data;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (req.method === 'POST' && path === '/api/calibration/admin/assignments') {
    await emitAssignment(req, detail);
    return;
  }
  const submitted = req.method === 'POST'
    && (/^\/api\/calibration\/coordinator\/assignments\/[^/]+\/submit$/.test(path)
      || /^\/api\/calibration\/admin\/assignments\/[^/]+\/self\/submit$/.test(path));
  if (submitted && detail?.result === 'PASS') {
    await syncEvaluatorAuthorizationCertificates(`calibration-submission-${req.userId}`);
  }
}

export function calibrationOperationsHooks(req, res, next) {
  if (!String(req.originalUrl || '').startsWith('/api/calibration/')) return next();
  const originalJson = res.json.bind(res);
  res.json = payload => {
    if (successful(res, payload)) {
      setImmediate(() => capture(req, payload).catch(error => {
        console.warn('[CALIBRATION-OPS] Immediate lifecycle capture failed:', error.message);
      }));
    }
    return originalJson(payload);
  };
  return next();
}