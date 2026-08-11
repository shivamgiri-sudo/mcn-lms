import { createHash, randomUUID } from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../utils/db.js';
import {
  requireRole,
  requireSession,
  requireSuperAdmin,
  requireTrustedOrigin,
} from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  clearBrowserSessionCookies,
  deleteAllSessions,
  elevateSession,
  establishBrowserSession,
  listUserSessions,
  normalizeSessionRole,
  recordSecurityEvent,
  revokeSessionById,
} from '../utils/session.js';
import {
  generateSalt,
  hashCredential,
  hashPassword,
  isHashedCredential,
  normalize,
  verifyCredential,
  verifyPassword,
} from '../utils/hash.js';
import { validateStrongPassword } from '../utils/passwordPolicy.js';
import { audit } from '../utils/audit.js';

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, message: 'Too many login attempts. Try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const exchangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { ok: false, message: 'Too many SSO exchange attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { ok: false, message: 'Too many sensitive account actions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function codeHash(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function sessionResponse(session, user, extras = {}) {
  return {
    ok: true,
    sessionEstablished: true,
    session: {
      id: session.id,
      role: session.userType,
      authMethod: session.authMethod,
      deviceLabel: session.deviceLabel,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    },
    user,
    ...extras,
  };
}

async function resolveTraineeIdentifier(identifier) {
  const raw = text(identifier, 191);
  if (!raw) return null;
  const normalized = normalize(raw);
  const lower = raw.toLowerCase();
  const direct = await prisma.userMaster.findFirst({
    where: { active: true, OR: [{ employeeId: raw }, { employeeId: normalized }] },
    select: { employeeId: true },
  });
  if (direct) return direct.employeeId;

  const byLms = await prisma.traineeMaster.findFirst({
    where: { status: { not: 'Deleted' }, OR: [{ lmsId: raw }, { lmsId: lower }] },
    select: { employeeId: true },
  });
  if (byLms) return byLms.employeeId;

  if (raw.includes('@')) {
    const byEmail = await prisma.userMaster.findFirst({
      where: { active: true, OR: [{ email: raw }, { email: lower }] },
      select: { employeeId: true },
    });
    if (byEmail) return byEmail.employeeId;
  }

  const mobile = raw.replace(/\D/g, '').slice(-10);
  if (mobile.length === 10) {
    const byMobile = await prisma.userMaster.findFirst({
      where: { active: true, mobile: { endsWith: mobile } },
      select: { employeeId: true },
    });
    if (byMobile) return byMobile.employeeId;
  }
  return null;
}

async function failedLogin(req, userType, userId, message) {
  await recordSecurityEvent({
    eventType: 'LOGIN_FAILED', severity: 'WATCH', actorUserId: userId || null,
    actorUserType: userType, subjectUserId: userId || null, subjectUserType: userType,
    requestId: req.requestId, req, details: { reason: message },
  });
  try {
    await prisma.loginSessionLog.create({
      data: { userType, userId: userId || 'unknown', action: 'FAILED', status: 'Failed', message },
    });
  } catch {
    // Security event remains the authoritative failure evidence.
  }
}

router.post('/auth/trainee/login', requireTrustedOrigin, loginLimiter, async (req, res) => {
  try {
    const identifier = text(req.body?.employeeId, 191);
    const password = String(req.body?.password || '');
    if (!identifier || !password) return res.status(400).json({ ok: false, message: 'Employee ID / LMS ID and password required.' });
    const employeeId = await resolveTraineeIdentifier(identifier);
    if (!employeeId) {
      await failedLogin(req, 'trainee', identifier, 'Identity not found');
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }
    const user = await prisma.userMaster.findFirst({ where: { employeeId, active: true } });
    if (!user || user.locked) {
      await failedLogin(req, 'trainee', employeeId, user?.locked ? 'Account locked' : 'Account inactive');
      return res.status(user?.locked ? 403 : 401).json({ ok: false, message: user?.locked ? 'Account locked. Contact your coordinator.' : 'Invalid credentials.' });
    }
    if (!await verifyPassword(password, user.salt, user.passwordHash)) {
      const failed = Number(user.failedAttempts || 0) + 1;
      await prisma.userMaster.update({ where: { id: user.id }, data: { failedAttempts: failed, locked: failed >= 5 } });
      await failedLogin(req, 'trainee', employeeId, 'Invalid password');
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }
    await prisma.userMaster.update({ where: { id: user.id }, data: { failedAttempts: 0, lastLogin: new Date() } });
    const session = await establishBrowserSession(req, res, user.employeeId, 'trainee', { authMethod: 'PASSWORD' });
    await prisma.loginSessionLog.create({ data: { userType: 'trainee', userId: user.employeeId, action: 'LOGIN', status: 'Success' } });
    await audit({ userIdentity: user.employeeId, userRole: 'Trainee', action: 'LOGIN', module: 'Auth', source: 'Trainee Portal' });
    return res.json(sessionResponse(session, {
      employeeId: user.employeeId,
      name: user.traineeName,
      batchNo: user.batchNo,
      classroomId: user.classroomId,
      branch: user.branch,
      process: user.process,
      lob: user.lob,
    }, { forcePasswordReset: Boolean(user.forcePasswordReset) }));
  } catch (error) {
    console.error('[BROWSER_AUTH] trainee login failed:', error);
    return res.status(500).json({ ok: false, message: 'Authentication service unavailable.' });
  }
});

router.post('/auth/coordinator/login', requireTrustedOrigin, loginLimiter, async (req, res) => {
  try {
    const loginId = text(req.body?.loginId, 191);
    const pin = String(req.body?.pin || '');
    if (!loginId || !pin) return res.status(400).json({ ok: false, message: 'Login ID and PIN required.' });
    const user = await prisma.roleAccessMatrix.findFirst({ where: { loginId, active: true } });
    if (!user || user.locked) {
      await failedLogin(req, 'coordinator', loginId, user?.locked ? 'Account locked' : 'Identity not found');
      return res.status(user?.locked ? 403 : 401).json({ ok: false, message: user?.locked ? 'Account locked. Contact admin.' : 'Invalid login ID or PIN.' });
    }
    if (!await verifyCredential(pin, user.pin)) {
      const failed = Number(user.failedAttempts || 0) + 1;
      await prisma.roleAccessMatrix.update({ where: { id: user.id }, data: { failedAttempts: failed, locked: failed >= 5 } });
      await failedLogin(req, 'coordinator', loginId, 'Invalid PIN');
      return res.status(401).json({ ok: false, message: 'Invalid login ID or PIN.' });
    }
    const update = { failedAttempts: 0, lastLogin: new Date() };
    if (!isHashedCredential(user.pin)) update.pin = await hashCredential(pin);
    await prisma.roleAccessMatrix.update({ where: { id: user.id }, data: update });
    const session = await establishBrowserSession(req, res, user.loginId, 'coordinator', { authMethod: 'PIN' });
    await prisma.loginSessionLog.create({ data: { userType: 'coordinator', userId: user.loginId, action: 'LOGIN', status: 'Success' } });
    await audit({ userIdentity: user.loginId, userRole: user.role, action: 'LOGIN', module: 'Auth', source: 'Coordinator Portal' });
    return res.json(sessionResponse(session, {
      loginId: user.loginId,
      name: user.name,
      role: user.role,
      branch: user.branch,
      process: user.process,
      lob: user.lob,
      permissions: {
        canCreateBatch: user.canCreateBatch,
        canOnboardTrainee: user.canOnboardTrainee,
        canUploadLmsReport: user.canUploadLmsReport,
        canOverrideAttendance: user.canOverrideAttendance,
        canCloseBatch: user.canCloseBatch,
        canViewManagementDashboard: user.canViewManagementDashboard,
      },
    }));
  } catch (error) {
    console.error('[BROWSER_AUTH] coordinator login failed:', error);
    return res.status(500).json({ ok: false, message: 'Authentication service unavailable.' });
  }
});

router.post('/auth/admin/login', requireTrustedOrigin, loginLimiter, async (req, res) => {
  try {
    const adminId = text(req.body?.adminId, 191);
    const password = String(req.body?.password || '');
    if (!adminId || !password) return res.status(400).json({ ok: false, message: 'Admin ID and password required.' });
    const admin = await prisma.adminUserMaster.findFirst({ where: { adminId, active: true } });
    if (!admin || admin.locked) {
      await failedLogin(req, 'admin', adminId, admin?.locked ? 'Account locked' : 'Identity not found');
      return res.status(admin?.locked ? 403 : 401).json({ ok: false, message: admin?.locked ? 'Account locked.' : 'Invalid credentials.' });
    }
    if (!await verifyPassword(password, admin.salt, admin.passwordHash)) {
      const failed = Number(admin.failedAttempts || 0) + 1;
      await prisma.adminUserMaster.update({ where: { id: admin.id }, data: { failedAttempts: failed, locked: failed >= 5 } });
      await failedLogin(req, 'admin', adminId, 'Invalid password');
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }
    await prisma.adminUserMaster.update({ where: { id: admin.id }, data: { failedAttempts: 0, lastLogin: new Date() } });
    const session = await establishBrowserSession(req, res, admin.adminId, 'admin', { authMethod: 'PASSWORD' });
    await audit({ userIdentity: admin.adminId, userRole: admin.role, action: 'LOGIN', module: 'Auth', source: 'Admin Portal' });
    return res.json(sessionResponse(session, {
      adminId: admin.adminId,
      name: admin.adminName,
      role: admin.role,
      branch: admin.branch || null,
    }));
  } catch (error) {
    console.error('[BROWSER_AUTH] admin login failed:', error);
    return res.status(500).json({ ok: false, message: 'Authentication service unavailable.' });
  }
});

async function logout(req, res) {
  await revokeSessionById(req.session.id, 'User logout');
  clearBrowserSessionCookies(res, req.userType);
  await recordSecurityEvent({
    eventType: 'SESSION_LOGOUT', actorUserId: req.userId, actorUserType: req.userType,
    subjectUserId: req.userId, subjectUserType: req.userType, sessionId: req.session.id,
    requestId: req.requestId, req,
  });
  return res.json({ ok: true, sessionCleared: true });
}

router.post('/auth/trainee/logout', requireSession, requireRole('trainee'), logout);
router.post('/auth/coordinator/logout', requireSession, requireRole('coordinator'), logout);
router.post('/auth/admin/logout', requireSession, requireRole('admin'), logout);

router.post('/auth/trainee/change-password', sensitiveActionLimiter, requireSession, requireRole('trainee'), async (req, res) => {
  try {
    const currentPassword = String(req.body?.oldPassword || req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const user = await prisma.userMaster.findUnique({ where: { employeeId: req.userId } });
    if (!user || !user.active) return res.status(404).json({ ok: false, message: 'Active trainee account not found.' });
    if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, message: 'Current and new passwords are required.' });
    if (!await verifyPassword(currentPassword, user.salt, user.passwordHash)) return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });
    if (await verifyPassword(newPassword, user.salt, user.passwordHash)) return res.status(409).json({ ok: false, message: 'New password must be different from the current password.' });
    const policyError = validateStrongPassword(newPassword, [user.employeeId, user.email, user.mobile]);
    if (policyError) return res.status(400).json({ ok: false, message: policyError });
    const salt = generateSalt();
    await prisma.userMaster.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword, salt), salt, forcePasswordReset: false, failedAttempts: 0, locked: false },
    });
    await deleteAllSessions(user.employeeId, 'Password changed');
    const session = await establishBrowserSession(req, res, user.employeeId, 'trainee', { authMethod: 'PASSWORD_CHANGE' });
    await recordSecurityEvent({
      eventType: 'PASSWORD_CHANGED', severity: 'HIGH', actorUserId: user.employeeId,
      actorUserType: 'trainee', subjectUserId: user.employeeId, subjectUserType: 'trainee',
      sessionId: session.id, requestId: req.requestId, req,
    });
    return res.json(sessionResponse(session, null, { message: 'Password changed. Other sessions were signed out.' }));
  } catch (error) {
    console.error('[BROWSER_AUTH] trainee password change failed:', error);
    return res.status(500).json({ ok: false, message: 'Could not change password.' });
  }
});

router.post('/admin/reset-password', sensitiveActionLimiter, requireSession, requireRole('admin'), async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.password || req.body?.newPassword || '');
    const admin = await prisma.adminUserMaster.findUnique({ where: { adminId: req.userId } });
    if (!admin || !admin.active) return res.status(404).json({ ok: false, message: 'Active administrator account not found.' });
    if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, message: 'Current and new passwords are required.' });
    if (!await verifyPassword(currentPassword, admin.salt, admin.passwordHash)) return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });
    if (await verifyPassword(newPassword, admin.salt, admin.passwordHash)) return res.status(409).json({ ok: false, message: 'New password must be different from the current password.' });
    const policyError = validateStrongPassword(newPassword, [admin.adminId, admin.adminName]);
    if (policyError) return res.status(400).json({ ok: false, message: policyError });
    const salt = generateSalt();
    await prisma.adminUserMaster.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(newPassword, salt), salt, failedAttempts: 0, locked: false },
    });
    await deleteAllSessions(admin.adminId, 'Password changed');
    const session = await establishBrowserSession(req, res, admin.adminId, 'admin', { authMethod: 'PASSWORD_CHANGE' });
    await recordSecurityEvent({
      eventType: 'PASSWORD_CHANGED', severity: 'CRITICAL', actorUserId: admin.adminId,
      actorUserType: 'admin', subjectUserId: admin.adminId, subjectUserType: 'admin',
      sessionId: session.id, requestId: req.requestId, req,
    });
    return res.json(sessionResponse(session, null, { message: 'Password changed. Other sessions were signed out.' }));
  } catch (error) {
    console.error('[BROWSER_AUTH] admin password change failed:', error);
    return res.status(500).json({ ok: false, message: 'Could not change password.' });
  }
});

router.get('/auth/sessions', requireSession, async (req, res) => {
  const sessions = await listUserSessions(req.userId, req.userType, req.session.id);
  return res.json({ ok: true, data: sessions });
});

router.delete('/auth/sessions/:sessionId', requireSession, async (req, res) => {
  const sessions = await listUserSessions(req.userId, req.userType, req.session.id);
  const target = sessions.find(item => String(item.id) === text(req.params.sessionId, 191));
  if (!target) return res.status(404).json({ ok: false, message: 'Session not found.' });
  await revokeSessionById(target.id, target.current ? 'Current session revoked by user' : 'Session revoked by user');
  if (target.current) clearBrowserSessionCookies(res, req.userType);
  await recordSecurityEvent({
    eventType: 'SESSION_REVOKED', severity: target.current ? 'HIGH' : 'INFO',
    actorUserId: req.userId, actorUserType: req.userType,
    subjectUserId: req.userId, subjectUserType: req.userType,
    sessionId: target.id, requestId: req.requestId, req,
    details: { current: target.current, deviceLabel: target.deviceLabel },
  });
  return res.json({ ok: true, currentSessionRevoked: target.current });
});

router.post('/auth/sessions/revoke-others', requireSession, async (req, res) => {
  const sessions = await listUserSessions(req.userId, req.userType, req.session.id);
  const activeOthers = sessions.filter(item => item.active && !item.current);
  for (const session of activeOthers) await revokeSessionById(session.id, 'Other sessions revoked by user');
  await recordSecurityEvent({
    eventType: 'OTHER_SESSIONS_REVOKED', severity: 'HIGH', actorUserId: req.userId,
    actorUserType: req.userType, subjectUserId: req.userId, subjectUserType: req.userType,
    sessionId: req.session.id, requestId: req.requestId, req, details: { revokedCount: activeOthers.length },
  });
  return res.json({ ok: true, revokedCount: activeOthers.length });
});

router.post(
  '/auth/security/elevate',
  sensitiveActionLimiter,
  requireSession,
  requireRole('admin'),
  requireSuperAdmin,
  requirePermission('security.elevation.use'),
  async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      const reason = text(req.body?.reason, 4000);
      if (!password || reason.length < 20) return res.status(400).json({ ok: false, message: 'Current password and a detailed security justification are required.' });
      const admin = await prisma.adminUserMaster.findUnique({ where: { adminId: req.userId } });
      if (!admin || !await verifyPassword(password, admin.salt, admin.passwordHash)) {
        await recordSecurityEvent({
          eventType: 'ELEVATION_FAILED', severity: 'CRITICAL', actorUserId: req.userId,
          actorUserType: 'admin', subjectUserId: req.userId, subjectUserType: 'admin',
          sessionId: req.session.id, requestId: req.requestId, req,
        });
        return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });
      }
      const expiresAt = await elevateSession(req.session.id, reason, Number(process.env.SECURITY_ELEVATION_MINUTES || 15));
      await recordSecurityEvent({
        eventType: 'SESSION_ELEVATED', severity: 'CRITICAL', actorUserId: req.userId,
        actorUserType: 'admin', subjectUserId: req.userId, subjectUserType: 'admin',
        sessionId: req.session.id, requestId: req.requestId, req,
        details: { reason, expiresAt },
      });
      return res.json({ ok: true, elevatedUntil: expiresAt });
    } catch (error) {
      console.error('[BROWSER_AUTH] elevation failed:', error);
      return res.status(500).json({ ok: false, message: 'Could not elevate this session.' });
    }
  },
);

router.get(
  '/auth/security/events',
  requireSession,
  requireRole('admin'),
  requireSuperAdmin,
  requirePermission('security.sessions.audit'),
  async (_req, res) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT event_id AS eventId, event_type AS eventType, severity,
              actor_user_id AS actorUserId, actor_user_type AS actorUserType,
              subject_user_id AS subjectUserId, subject_user_type AS subjectUserType,
              session_id AS sessionId, request_id AS requestId,
              details_json AS details, created_at AS createdAt
         FROM security_event
        ORDER BY created_at DESC
        LIMIT 500`,
    );
    return res.json({ ok: true, data: rows });
  },
);

router.post('/auth/sso/exchange', requireTrustedOrigin, exchangeLimiter, async (req, res) => {
  const rawCode = text(req.body?.code, 512);
  const requestedRole = normalizeSessionRole(req.body?.userType);
  if (!rawCode) return res.status(400).json({ ok: false, message: 'Single-use handoff code required.' });
  try {
    const claimed = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT handoff_id AS handoffId, user_id AS userId, user_type AS userType,
                auth_method AS authMethod, redirect_path AS redirectPath,
                expires_at AS expiresAt, used_at AS usedAt
           FROM sso_handoff_code
          WHERE code_hash = ?
          FOR UPDATE`,
        codeHash(rawCode),
      );
      const row = rows[0];
      if (!row || row.usedAt || new Date(row.expiresAt) <= new Date()) return null;
      if (requestedRole && requestedRole !== normalizeSessionRole(row.userType)) return null;
      const result = await tx.$executeRawUnsafe(
        `UPDATE sso_handoff_code SET used_at = CURRENT_TIMESTAMP(3)
          WHERE handoff_id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)`,
        row.handoffId,
      );
      return Number(result) === 1 ? row : null;
    });
    if (!claimed) {
      await recordSecurityEvent({ eventType: 'SSO_HANDOFF_REJECTED', severity: 'HIGH', actorUserType: 'system', requestId: req.requestId, req });
      return res.status(401).json({ ok: false, message: 'This SSO handoff is invalid, expired, or already used.' });
    }
    const session = await establishBrowserSession(req, res, claimed.userId, claimed.userType, { authMethod: claimed.authMethod || 'HRMS_ASSERTION' });
    await recordSecurityEvent({
      eventType: 'SSO_HANDOFF_EXCHANGED', severity: 'HIGH', actorUserId: claimed.userId,
      actorUserType: claimed.userType, subjectUserId: claimed.userId,
      subjectUserType: claimed.userType, sessionId: session.id, requestId: req.requestId, req,
    });
    return res.json(sessionResponse(session, { userId: claimed.userId, userType: claimed.userType }, { redirectPath: claimed.redirectPath }));
  } catch (error) {
    console.error('[BROWSER_AUTH] SSO exchange failed:', error);
    return res.status(500).json({ ok: false, message: 'SSO exchange service unavailable.' });
  }
});

// Explicitly document the route layer version for diagnostics and contract tests.
// An administrator may also hold a coordinator identity, and through it a
// learner record. Session cookies are role scoped, so switching opens that view
// alongside the admin session instead of replacing it. Only identities linked to
// the signed in admin can be reached.
router.post('/auth/role-switch', requireTrustedOrigin, requireSession, requireRole('admin'), async (req, res) => {
  try {
    const role = normalizeSessionRole(req.body?.role);
    if (!['coordinator', 'trainee'].includes(role)) {
      return res.status(400).json({ ok: false, message: 'Choose either the coordinator or the learner view.' });
    }

    const linked = await prisma.roleAccessMatrix.findFirst({ where: { loginId: req.userId, active: true } });
    if (!linked || linked.locked) {
      return res.status(404).json({ ok: false, message: 'No coordinator identity is linked to this admin account.' });
    }

    let targetId = linked.loginId;
    if (role === 'trainee') {
      const employeeCode = String(linked.employeeCode || '').trim();
      if (!employeeCode) {
        return res.status(404).json({ ok: false, message: 'No learner record is linked to this admin account.' });
      }
      const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: employeeCode } });
      if (!trainee || trainee.status !== 'Active') {
        return res.status(404).json({ ok: false, message: 'The linked learner record is not active.' });
      }
      targetId = trainee.employeeId;
    }

    const session = await establishBrowserSession(req, res, targetId, role, { authMethod: 'ROLE_SWITCH' });
    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'ROLE_SWITCH',
      module: 'Auth',
      referenceId: targetId,
      newValue: { role },
      source: 'Admin Console',
    });
    return res.json({
      ok: true,
      role,
      userId: targetId,
      sessionId: session.id,
      redirectPath: role === 'coordinator' ? '/coordinator' : '/lms',
    });
  } catch (error) {
    console.error('[BROWSER_AUTH] role switch failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not open that view.' });
  }
});

router.get('/auth/session-capabilities', (_req, res) => res.json({
  ok: true,
  version: 2,
  cookieSessions: true,
  csrfBound: true,
  bearerCompatibility: process.env.NODE_ENV !== 'production' || process.env.LMS_ALLOW_BEARER_SESSION_COMPAT === 'true',
  ssoHandoff: 'single-use-code',
}));

export default router;
