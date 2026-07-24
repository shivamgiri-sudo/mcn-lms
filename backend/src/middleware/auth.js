import { prisma } from '../utils/db.js';

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

export async function requireSession(req, res, next) {
  try {
    // Never accept session tokens from query strings. URLs are routinely stored in
    // browser history, reverse-proxy logs, analytics systems and referrer headers.
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    const session = await prisma.portalSession.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ ok: false, message: 'Session expired. Please login again.' });
    }

    req.session = session;
    req.userId = session.userId;
    req.userType = session.userType;
    req.userBranch = null;
    req.adminInfo = null;
    req.coordinator = null;

    if (session.userType === 'admin') {
      const admin = await prisma.adminUserMaster.findFirst({
        where: { adminId: session.userId, active: true, locked: false },
        select: { branch: true, adminName: true, role: true },
      });
      if (!admin) return res.status(401).json({ ok: false, message: 'Account is inactive or locked.' });
      req.userBranch = admin.branch || null;
      req.adminInfo = admin;
    } else if (session.userType === 'coordinator') {
      const coord = await prisma.roleAccessMatrix.findFirst({
        where: { loginId: session.userId, active: true, locked: false },
        select: {
          branch: true,
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
      if (!coord) return res.status(401).json({ ok: false, message: 'Account is inactive or locked.' });
      req.userBranch = coord.branch || null;
      req.coordinator = coord;
    } else if (session.userType === 'trainee') {
      const trainee = await prisma.userMaster.findFirst({
        where: { employeeId: session.userId, active: true, locked: false },
        select: { employeeId: true },
      });
      if (!trainee) return res.status(401).json({ ok: false, message: 'Account is inactive or locked.' });
    }

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

  // In the existing data model a branch-less administrator is the company-level
  // administrator. This is enforced on the server, not only through hidden menus.
  if (req.userBranch || (req.adminInfo?.role && !['Super Admin', 'SuperAdmin'].includes(req.adminInfo.role))) {
    return res.status(403).json({ ok: false, message: 'Super administrator access required.' });
  }

  return next();
}
