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
