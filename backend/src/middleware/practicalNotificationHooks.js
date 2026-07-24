import { prisma } from '../utils/db.js';
import { emitNotificationEvent } from '../services/notificationOutbox.js';

function successful(res, payload) {
  return res.statusCode >= 200 && res.statusCode < 300 && payload?.ok !== false;
}

async function coordinatorForBatch(batchNo) {
  if (!batchNo) return null;
  const batch = await prisma.batchMaster.findUnique({
    where: { batchNo: String(batchNo) },
    select: { coordinatorLoginId: true },
  });
  return batch?.coordinatorLoginId || null;
}

async function branchAdministrators(branch) {
  const rows = await prisma.roleAccessMatrix.findMany({
    where: {
      active: true,
      portalAccess: 'Admin',
      OR: [
        { role: { in: ['Super Admin', 'SuperAdmin'] } },
        { branch: String(branch || '') },
      ],
    },
    select: { loginId: true },
    take: 100,
  });
  return [...new Set(rows.map(item => item.loginId).filter(Boolean))];
}

async function emitAssigned(req, detail) {
  await emitNotificationEvent({
    eventType: 'PRACTICAL_ASSIGNED',
    entityType: 'PRACTICAL_ASSIGNMENT',
    entityId: detail.assignmentId,
    actorId: req.userId,
    actorType: req.userType,
    branch: detail.branch || '',
    processName: detail.processName || '',
    lobName: detail.lobName || '',
    payload: {
      recipientType: 'trainee',
      recipientId: detail.employeeId,
      employeeId: detail.employeeId,
      traineeName: detail.traineeName,
      templateName: detail.templateName,
      templateCode: detail.templateCode,
      versionNo: detail.versionNo,
      attemptNo: detail.attemptNo,
      dueAt: detail.dueAt,
      priority: 'HIGH',
    },
    idempotencyKey: `practical-assigned:${detail.assignmentId}`,
  });
}

async function emitSubmitted(req, detail) {
  const coordinatorId = await coordinatorForBatch(detail.batchNo);
  const recipients = coordinatorId
    ? [{ userType: 'coordinator', userId: coordinatorId, priority: 'HIGH' }]
    : (await branchAdministrators(detail.branch)).map(userId => ({ userType: 'admin', userId, priority: 'HIGH' }));
  if (!recipients.length) return;
  await emitNotificationEvent({
    eventType: 'PRACTICAL_SUBMITTED',
    entityType: 'PRACTICAL_ASSIGNMENT',
    entityId: detail.assignmentId,
    actorId: req.userId,
    actorType: req.userType,
    branch: detail.branch || '',
    processName: detail.processName || '',
    lobName: detail.lobName || '',
    payload: {
      recipients,
      employeeId: detail.employeeId,
      traineeName: detail.traineeName,
      batchNo: detail.batchNo,
      templateName: detail.templateName,
      versionNo: detail.versionNo,
      submittedAt: detail.submittedAt,
      priority: 'HIGH',
    },
    idempotencyKey: `practical-submitted:${detail.assignmentId}:${new Date(detail.submittedAt || Date.now()).toISOString().slice(0, 19)}`,
  });
}

async function emitModeration(detail, req) {
  const admins = await branchAdministrators(detail.branch);
  if (!admins.length) return;
  await emitNotificationEvent({
    eventType: 'PRACTICAL_MODERATION_REQUIRED',
    entityType: 'PRACTICAL_ASSIGNMENT',
    entityId: detail.assignmentId,
    actorId: req.userId,
    actorType: req.userType,
    branch: detail.branch || '',
    processName: detail.processName || '',
    lobName: detail.lobName || '',
    payload: {
      recipients: admins.map(userId => ({ userType: 'admin', userId, priority: 'CRITICAL' })),
      employeeId: detail.employeeId,
      traineeName: detail.traineeName,
      batchNo: detail.batchNo,
      templateName: detail.templateName,
      reasonCode: detail.moderation?.reasonCode || 'MANUAL_REVIEW',
      scoreVariancePct: detail.moderation?.scoreVariancePct || 0,
      priority: 'CRITICAL',
    },
    idempotencyKey: `practical-moderation:${detail.assignmentId}:${detail.moderation?.caseId || 'open'}`,
  });
}

async function emitResult(detail, req) {
  await emitNotificationEvent({
    eventType: 'PRACTICAL_RESULT',
    entityType: 'PRACTICAL_ASSIGNMENT',
    entityId: detail.assignmentId,
    actorId: req.userId,
    actorType: req.userType,
    branch: detail.branch || '',
    processName: detail.processName || '',
    lobName: detail.lobName || '',
    payload: {
      recipientType: 'trainee',
      recipientId: detail.employeeId,
      employeeId: detail.employeeId,
      traineeName: detail.traineeName,
      templateName: detail.templateName,
      finalResult: detail.finalResult,
      finalPercentage: Number(detail.finalPercentage || 0).toFixed(1),
      criticalFail: Boolean(detail.criticalFail),
      priority: detail.finalResult === 'FAIL' ? 'HIGH' : 'NORMAL',
    },
    idempotencyKey: `practical-result:${detail.assignmentId}:${detail.finalResult}:${Number(detail.finalPercentage || 0).toFixed(2)}`,
  });
}

async function capture(req, payload) {
  const detail = payload?.data;
  if (!detail?.assignmentId) return;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (req.method === 'POST' && /^\/api\/practical\/(coordinator|admin)\/assignments$/.test(path)) {
    await emitAssigned(req, detail);
    return;
  }
  if (req.method === 'POST' && /^\/api\/practical\/me\/assignments\/[^/]+\/submit$/.test(path)) {
    await emitSubmitted(req, detail);
    return;
  }
  if (req.method === 'POST' && (/^\/api\/practical\/(coordinator|admin)\/evaluations\/[^/]+\/submit$/.test(path)
      || /^\/api\/practical\/admin\/moderation\/[^/]+\/resolve$/.test(path))) {
    if (detail.status === 'MODERATION_REQUIRED') await emitModeration(detail, req);
    if (['PASSED', 'FAILED'].includes(detail.status)) await emitResult(detail, req);
  }
}

export function practicalNotificationHooks(req, res, next) {
  if (!String(req.originalUrl || '').startsWith('/api/practical/')) return next();
  const originalJson = res.json.bind(res);
  res.json = payload => {
    if (successful(res, payload)) {
      setImmediate(() => capture(req, payload).catch(error => {
        console.warn('[PRACTICAL-NOTIFY] Lifecycle event capture failed:', error.message);
      }));
    }
    return originalJson(payload);
  };
  return next();
}
