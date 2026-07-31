import { prisma } from '../utils/db.js';
import {
  clearBrowserSessionCookies,
  getSession,
  hasRecentElevation,
  normalizeSessionRole,
  recordSecurityEvent,
  resolveSessionCredential,
  revokeSessionById,
  touchSession,
  validateCsrfRequest,
} from '../utils/session.js';

function allowedOrigins() {
  return new Set(String(process.env.FRONTEND_URL || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean));
}

export function requireTrustedOrigin(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    if (process.env.NODE_ENV !== 'production' || process.env.LMS_ALLOW_ORIGINLESS_AUTH === 'true') return next();
    return res.status(403).json({ ok: false, code: 'ORIGIN_REQUIRED', message: 'Trusted browser origin required.' });
  }
  if (!allowedOrigins().has(origin)) {
    return res.status(403).json({ ok: false, code: 'ORIGIN_REJECTED', message: 'Request origin is not trusted.' });
  }
  return next();
}

export async function requireSession(req, res, next) {
  try {
    // Session credentials are accepted only from role-specific HttpOnly cookies.
    // A temporary Bearer compatibility path is available outside production or
    // when LMS_ALLOW_BEARER_SESSION_COMPAT=true is deliberately configured.
    const credential = resolveSessionCredential(req);
    if (!credential.token) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    const session = await getSession(credential.token);
    if (!session) {
      if (credential.role) clearBrowserSessionCookies(res, credential.role);
      return res.status(401).json({ ok: false, message: 'Session expired. Please login again.' });
    }

    if (credential.role && normalizeSessionRole(credential.role) !== normalizeSessionRole(session.userType)) {
      await recordSecurityEvent({
        eventType: 'SESSION_ROLE_MISMATCH', severity: 'HIGH',
        actorUserId: session.userId, actorUserType: session.userType,
        sessionId: session.id, requestId: req.requestId, req,
        details: { requestedRole: credential.role },
      });
      return res.status(403).json({ ok: false, code: 'SESSION_ROLE_MISMATCH', message: 'Session role does not match this request.' });
    }

    if (!validateCsrfRequest(req, credential, session)) {
      await recordSecurityEvent({
        eventType: 'CSRF_REJECTED', severity: 'HIGH',
        actorUserId: session.userId, actorUserType: session.userType,
        sessionId: session.id, requestId: req.requestId, req,
        details: { method: req.method, path: req.path },
      });
      return res.status(403).json({ ok: false, code: 'CSRF_REJECTED', message: 'Security token validation failed. Refresh and try again.' });
    }

    await touchSession(session, req);
    req.session = session;
    req.sessionToken = credential.token;
    req.sessionMode = credential.mode;
    req.userId = session.userId;
    req.userType = session.userType;
    req.userBranch = null;
    req.userProcess = null;
    req.userLob = null;
    req.adminInfo = null;
    req.coordinator = null;

    if (session.userType === 'admin') {
      const admin = await prisma.adminUserMaster.findFirst({
        where: { adminId: session.userId, active: true, locked: false },
        select: { branch: true, adminName: true, role: true },
      });
      if (!admin) {
        await revokeSessionById(session.id, 'Account inactive or locked');
        clearBrowserSessionCookies(res, session.userType);
        return res.status(401).json({ ok: false, message: 'Account is inactive or locked.' });
      }
      req.userBranch = admin.branch || null;
      req.adminInfo = admin;
    } else if (session.userType === 'coordinator') {
      const coord = await prisma.roleAccessMatrix.findFirst({
        where: { loginId: session.userId, active: true, locked: false },
        select: {
          branch: true,
          process: true,
          lob: true,
          name: true,
          role: true,
          canCreateBatch: true,
          canOnboardTrainee: true,
          canUploadLmsReport: true,
          canOverrideAttendance: true,
          canCloseBatch: true,
          canViewManagementDashboard: true,
        },
      });
      if (!coord) {
        await revokeSessionById(session.id, 'Account inactive or locked');
        clearBrowserSessionCookies(res, session.userType);
        return res.status(401).json({ ok: false, message: 'Account is inactive or locked.' });
      }
      req.userBranch = coord.branch || null;
      req.userProcess = coord.process || null;
      req.userLob = coord.lob || null;
      req.coordinator = coord;
    } else if (session.userType === 'trainee') {
      const trainee = await prisma.userMaster.findFirst({
        where: { employeeId: session.userId, active: true, locked: false },
        select: { employeeId: true, branch: true, process: true, lob: true },
      });
      if (!trainee) {
        await revokeSessionById(session.id, 'Account inactive or locked');
        clearBrowserSessionCookies(res, session.userType);
        return res.status(401).json({ ok: false, message: 'Account is inactive or locked.' });
      }
      req.userBranch = trainee.branch || null;
      req.userProcess = trainee.process || null;
      req.userLob = trainee.lob || null;
    }

    res.setHeader('X-LMS-Session-Role', session.userType);
    res.setHeader('X-LMS-Session-Expires-At', new Date(session.expiresAt).toISOString());
    return next();
  } catch (err) {
    console.error('[AUTH] Session validation failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Authentication service unavailable.' });
  }
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    if (roles.includes(req.userType)) return next();

    // Management routes accept coordinator sessions that have the management permission.
    if (roles.includes('management') && req.userType === 'coordinator') {
      const user = await prisma.roleAccessMatrix.findFirst({
        where: { loginId: req.userId, active: true, locked: false },
        select: { canViewManagementDashboard: true, role: true },
      });
      if (user && (user.canViewManagementDashboard || user.role === 'CEO' || user.role === 'Super Admin')) {
        return next();
      }
    }

    return res.status(403).json({ ok: false, message: 'Access denied.' });
  };
}

export function requireSuperAdmin(req, res, next) {
  if (req.userType !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Super administrator access required.' });
  }

  if (req.userBranch || (req.adminInfo?.role && !['Super Admin', 'SuperAdmin'].includes(req.adminInfo.role))) {
    return res.status(403).json({ ok: false, message: 'Super administrator access required.' });
  }

  return next();
}

export function requireRecentElevation(req, res, next) {
  if (req.userType !== 'admin' || !hasRecentElevation(req.session)) {
    return res.status(403).json({
      ok: false,
      code: 'ELEVATION_REQUIRED',
      message: 'Re-authenticate with a security justification before this sensitive action.',
    });
  }
  res.setHeader('X-LMS-Elevated-Until', new Date(req.session.elevationExpiresAt).toISOString());
  return next();
}
