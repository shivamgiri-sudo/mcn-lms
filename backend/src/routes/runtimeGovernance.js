import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  evaluateFeatureFlag,
  getRuntimeDashboard,
  getRuntimeReadiness,
  heartbeatRuntime,
  releaseRuntimeLease,
  runtimeInstanceId,
  saveFeatureFlag,
} from '../services/runtimeGovernance.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[RUNTIME] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        code: error.code || 'RUNTIME_GOVERNANCE_ERROR',
        message: status >= 500 ? 'Production runtime governance service failed.' : error.message,
        details: status < 500 ? error.details || null : null,
      });
    }
  };
}

function companyScope(req) {
  return req.permissionScope === 'company'
    || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

router.get('/runtime/health/live', (_req, res) => {
  res.json({ ok: true, service: 'lms-platform', instanceId: runtimeInstanceId(), time: new Date().toISOString() });
});

router.get('/runtime/health/ready', route(async (_req, res) => {
  const readiness = await getRuntimeReadiness({ includeDetails: false });
  res.status(readiness.ok ? 200 : 503).json(readiness);
}));

router.get('/runtime/features/:featureKey', requireSession, route(async (req, res) => {
  const decision = await evaluateFeatureFlag(req.params.featureKey, {
    userId: req.userId,
    branch: req.userBranch,
    processName: req.userProcess,
    lobName: req.userLob,
  });
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.json({ ok: true, data: decision });
}));

router.get('/runtime/admin/dashboard', ...adminAuth, requirePermission('runtime.view'), route(async (req, res) => {
  const [dashboard, readiness] = await Promise.all([
    getRuntimeDashboard({ branch: req.userBranch, company: companyScope(req) }),
    getRuntimeReadiness({ includeDetails: true }),
  ]);
  res.json({ ok: true, data: { ...dashboard, readiness } });
}));

router.post('/runtime/admin/flags', ...adminAuth, requirePermission('runtime.manage'), route(async (req, res) => {
  const flag = await saveFeatureFlag({
    actorId: req.userId,
    body: req.body || {},
    branchScope: req.userBranch,
    company: companyScope(req),
  });
  await audit({
    userIdentity: req.userId,
    userRole: 'Admin',
    action: 'CREATE_PLATFORM_FEATURE_FLAG',
    module: 'PlatformRuntime',
    referenceId: flag.flagId,
    newValue: flag,
  });
  res.status(201).json({ ok: true, message: 'Rollout control created.', data: flag });
}));

router.put('/runtime/admin/flags/:flagId', ...adminAuth, requirePermission('runtime.manage'), route(async (req, res) => {
  const flag = await saveFeatureFlag({
    flagId: req.params.flagId,
    actorId: req.userId,
    body: req.body || {},
    branchScope: req.userBranch,
    company: companyScope(req),
  });
  await audit({
    userIdentity: req.userId,
    userRole: 'Admin',
    action: flag.killSwitch ? 'ACTIVATE_PLATFORM_KILL_SWITCH' : 'UPDATE_PLATFORM_FEATURE_FLAG',
    module: 'PlatformRuntime',
    referenceId: flag.flagId,
    newValue: flag,
  });
  res.json({ ok: true, message: flag.killSwitch ? 'Kill switch activated.' : 'Rollout control updated.', data: flag });
}));

router.post('/runtime/admin/leases/:leaseKey/release', ...adminAuth, requirePermission('runtime.manage'), route(async (req, res) => {
  if (!companyScope(req)) return res.status(403).json({ ok: false, message: 'Lease intervention requires company scope.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 20) return res.status(400).json({ ok: false, message: 'Provide an intervention reason of at least 20 characters.' });
  const ownerId = String(req.body?.ownerId || '').trim();
  if (!ownerId) return res.status(400).json({ ok: false, message: 'Current lease owner is required.' });
  const result = await releaseRuntimeLease(req.params.leaseKey, ownerId);
  if (!result.released) return res.status(409).json({ ok: false, message: 'Lease owner changed or the lease is already released.' });
  await audit({
    userIdentity: req.userId,
    userRole: 'Admin',
    action: 'RELEASE_PLATFORM_RUNTIME_LEASE',
    module: 'PlatformRuntime',
    referenceId: req.params.leaseKey,
    newValue: { ownerId, reason },
  });
  res.json({ ok: true, message: 'Runtime lease released.', data: result });
}));

router.post('/runtime/admin/heartbeat', ...adminAuth, requirePermission('runtime.view'), route(async (req, res) => {
  const data = await heartbeatRuntime({ status: 'HEALTHY', metadata: { manual: true, actorId: req.userId } });
  res.json({ ok: true, message: 'Runtime heartbeat recorded.', data });
}));

export default router;
