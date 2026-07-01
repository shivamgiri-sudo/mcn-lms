import { prisma } from '../utils/db.js';

export async function requireSession(req, res, next) {
  const token = (req.headers.authorization?.replace('Bearer ', '') || req.query.token || '').trim();
  if (!token) return res.status(401).json({ ok: false, message: 'Unauthorized' });

  const session = await prisma.portalSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ ok: false, message: 'Session expired. Please login again.' });
  }

  req.session = session;
  req.userId = session.userId;
  req.userType = session.userType;
  req.userBranch = null;

  if (session.userType === 'admin') {
    const admin = await prisma.adminUserMaster.findUnique({ where: { adminId: session.userId }, select: { branch: true, adminName: true, role: true } });
    if (admin) {
      req.userBranch = admin.branch || null;
      req.adminInfo = admin;
    }
  } else if (session.userType === 'coordinator') {
    const coord = await prisma.roleAccessMatrix.findFirst({
      where: { loginId: session.userId, active: true },
      select: { branch: true, name: true, role: true, canCreateBatch: true, canOnboardTrainee: true, canUploadLmsReport: true, canOverrideAttendance: true, canCloseBatch: true, canViewManagementDashboard: true },
    });
    if (coord) {
      req.userBranch = coord.branch || null;
      req.coordinator = coord;
    }
  }

  next();
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    if (roles.includes(req.userType)) return next();

    // Management routes accept coordinator sessions that have the management permission
    if (roles.includes('management') && req.userType === 'coordinator') {
      const user = await prisma.roleAccessMatrix.findFirst({
        where: { loginId: req.userId, active: true },
        select: { canViewManagementDashboard: true, role: true },
      });
      if (user && (user.canViewManagementDashboard || user.role === 'CEO' || user.role === 'Super Admin')) {
        return next();
      }
    }

    return res.status(403).json({ ok: false, message: 'Access denied.' });
  };
}
