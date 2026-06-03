import { prisma } from '../utils/db.js';

const ROLE_PERMISSIONS = {
  admin: ['*'],
  management: ['management.view'],
  trainee: ['trainee.view'],
};

export async function getUserPermissions(req) {
  if (!req.userType) return [];
  const base = ROLE_PERMISSIONS[req.userType] || [];
  if (req.userType !== 'coordinator') return base;

  const user = await prisma.roleAccessMatrix.findFirst({
    where: { loginId: req.userId, active: true },
    select: {
      role: true,
      canCreateBatch: true,
      canOnboardTrainee: true,
      canUploadLmsReport: true,
      canOverrideAttendance: true,
      canCloseBatch: true,
      canViewManagementDashboard: true,
    },
  });

  if (!user) return [];
  if (['CEO', 'Super Admin'].includes(user.role)) return ['*'];

  const permissions = ['coordinator.view'];
  if (user.canCreateBatch) permissions.push('batch.create');
  if (user.canOnboardTrainee) permissions.push('trainee.onboard');
  if (user.canUploadLmsReport) permissions.push('report.upload');
  if (user.canOverrideAttendance) permissions.push('attendance.override');
  if (user.canCloseBatch) permissions.push('batch.close');
  if (user.canViewManagementDashboard) permissions.push('management.view');
  return permissions;
}

export function requirePermission(permission) {
  return async (req, res, next) => {
    const permissions = await getUserPermissions(req);
    if (permissions.includes('*') || permissions.includes(permission)) return next();
    return res.status(403).json({ ok: false, message: 'Access denied.' });
  };
}
