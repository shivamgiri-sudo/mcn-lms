import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { generateSalt, hashPassword, verifyPassword } from '../utils/hash.js';
import { createSession, deleteAllSessions } from '../utils/session.js';
import { validateStrongPassword } from '../utils/passwordPolicy.js';
import { audit } from '../utils/audit.js';
import { deriveCsrfToken } from '../security/csrf.js';
import assessmentIntelligenceRoutes from './assessmentIntelligence.js';
import assessmentIntelligenceCoordinatorRoutes from './assessmentIntelligenceCoordinator.js';
import mobileLearningRoutes from './mobileLearning.js';

const router = Router();

function assessmentJsonSafe(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = body => originalJson(JSON.parse(JSON.stringify(body, (_key, value) => {
    if (typeof value === 'bigint') return Number(value);
    return value;
  })));
  next();
}

// Product domains are mounted through the platform router already registered at /api.
// Every endpoint keeps its own session, role, permission and data-scope guard.
router.use('/assessment-intelligence/coordinator', assessmentJsonSafe, assessmentIntelligenceCoordinatorRoutes);
router.use('/assessment-intelligence', assessmentJsonSafe, assessmentIntelligenceRoutes);
router.use('/mobile', assessmentJsonSafe, mobileLearningRoutes);

// Safe double-submit-token bootstrap for deployments where the frontend and API
// use separate origins. The token is bound to the HttpOnly session credential,
// role and CSRF version, but does not reveal the session credential itself.
router.get('/auth/csrf', requireSession, (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({
    ok: true,
    role: req.userType,
    csrfToken: deriveCsrfToken(req.sessionToken, req.userType, req.session.csrfVersion),
    expiresAt: req.session.expiresAt,
  });
});

// Complete role-safe profile response for cookie-session bootstrap. This route
// is mounted before the legacy auth router and therefore owns /api/auth/me.
router.get('/auth/me', requireSession, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.userType === 'coordinator') {
      const user = await prisma.roleAccessMatrix.findFirst({
        where: { loginId: req.userId, active: true, locked: false },
        select: {
          loginId: true,
          name: true,
          role: true,
          branch: true,
          process: true,
          lob: true,
          email: true,
          mobile: true,
          lastLogin: true,
          canCreateBatch: true,
          canOnboardTrainee: true,
          canUploadLmsReport: true,
          canOverrideAttendance: true,
          canCloseBatch: true,
          canViewManagementDashboard: true,
        },
      });
      return user ? res.json({ ok: true, user, session: { id: req.session.id, role: req.userType, expiresAt: req.session.expiresAt } }) : res.status(404).json({ ok: false, message: 'Account not found.' });
    }
    if (req.userType === 'admin') {
      const user = await prisma.adminUserMaster.findFirst({
        where: { adminId: req.userId, active: true, locked: false },
        select: { adminId: true, adminName: true, role: true, branch: true, lastLogin: true },
      });
      return user ? res.json({ ok: true, user, session: { id: req.session.id, role: req.userType, expiresAt: req.session.expiresAt } }) : res.status(404).json({ ok: false, message: 'Account not found.' });
    }
    if (req.userType === 'trainee') {
      const user = await prisma.userMaster.findUnique({
        where: { employeeId: req.userId },
        select: { employeeId: true, traineeName: true, branch: true, process: true, lob: true, batchNo: true, classroomId: true, lastLogin: true, forcePasswordReset: true },
      });
      return user ? res.json({ ok: true, user, session: { id: req.session.id, role: req.userType, expiresAt: req.session.expiresAt } }) : res.status(404).json({ ok: false, message: 'Account not found.' });
    }
    return res.status(403).json({ ok: false, message: 'Unsupported session role.' });
  } catch (error) {
    console.error('[SESSION_PROFILE] load failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load session profile.' });
  }
});

// Legacy password handlers remain as compatibility fallbacks only. The secure
// browser-auth router is mounted first and owns these exact paths in production.
router.post(
  '/auth/trainee/change-password',
  requireSession,
  requireRole('trainee'),
  async (req, res) => {
    try {
      const oldPassword = String(req.body?.oldPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, message: 'Current and new passwords are required.' });

      const user = await prisma.userMaster.findUnique({ where: { employeeId: req.userId } });
      if (!user || !user.active) return res.status(404).json({ ok: false, message: 'Active trainee account not found.' });
      const validCurrent = await verifyPassword(oldPassword, user.salt, user.passwordHash);
      if (!validCurrent) return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });
      const samePassword = await verifyPassword(newPassword, user.salt, user.passwordHash);
      if (samePassword) return res.status(409).json({ ok: false, message: 'New password must be different from the current password.' });

      const policyError = validateStrongPassword(newPassword, [user.employeeId, user.email, user.mobile]);
      if (policyError) return res.status(400).json({ ok: false, message: policyError });

      const salt = generateSalt();
      const passwordHash = await hashPassword(newPassword, salt);
      await prisma.userMaster.update({
        where: { id: user.id },
        data: {
          passwordHash,
          salt,
          forcePasswordReset: false,
          failedAttempts: 0,
          locked: false,
        },
      });
      await deleteAllSessions(user.employeeId);
      const token = await createSession(user.employeeId, 'trainee');
      await audit({
        userIdentity: user.employeeId,
        userRole: 'Trainee',
        action: 'CHANGE_PASSWORD',
        module: 'Auth',
        referenceId: user.employeeId,
        source: 'Trainee Portal',
      });
      return res.json({ ok: true, token, message: 'Password changed. Other sessions were signed out.' });
    } catch (error) {
      console.error('[PASSWORD] Trainee change failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not change password.' });
    }
  },
);

router.post(
  '/admin/reset-password',
  requireSession,
  requireRole('admin'),
  async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.password || req.body?.newPassword || '');
      if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, message: 'Current and new passwords are required.' });

      const admin = await prisma.adminUserMaster.findUnique({ where: { adminId: req.userId } });
      if (!admin || !admin.active) return res.status(404).json({ ok: false, message: 'Active administrator account not found.' });
      const validCurrent = await verifyPassword(currentPassword, admin.salt, admin.passwordHash);
      if (!validCurrent) return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });
      const samePassword = await verifyPassword(newPassword, admin.salt, admin.passwordHash);
      if (samePassword) return res.status(409).json({ ok: false, message: 'New password must be different from the current password.' });

      const policyError = validateStrongPassword(newPassword, [admin.adminId, admin.adminName]);
      if (policyError) return res.status(400).json({ ok: false, message: policyError });

      const salt = generateSalt();
      const passwordHash = await hashPassword(newPassword, salt);
      await prisma.adminUserMaster.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          salt,
          failedAttempts: 0,
          locked: false,
        },
      });
      await deleteAllSessions(admin.adminId);
      const token = await createSession(admin.adminId, 'admin');
      await audit({
        userIdentity: admin.adminId,
        userRole: admin.role,
        action: 'CHANGE_PASSWORD',
        module: 'Auth',
        referenceId: admin.adminId,
        source: 'Admin Portal',
      });
      return res.json({ ok: true, token, message: 'Password changed. Other sessions were signed out.' });
    } catch (error) {
      console.error('[PASSWORD] Admin change failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Could not change password.' });
    }
  },
);

export default router;
