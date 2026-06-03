import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';
import { audit } from '../utils/audit.js';
import { hashCredential, verifyCredential, isHashedCredential } from '../utils/hash.js';

export async function coordinatorLogin(req, res) {
  try {
    const { loginId, pin } = req.body;
    if (!loginId || !pin) {
      return res.status(400).json({ ok: false, message: 'Login ID and PIN required.' });
    }

    const user = await prisma.roleAccessMatrix.findFirst({
      where: { loginId: { equals: loginId, mode: 'insensitive' }, active: true },
    });

    if (!user) {
      await prisma.loginSessionLog.create({
        data: { userType: 'coordinator', userId: loginId, action: 'FAILED', status: 'Failed', message: 'User not found' },
      });
      return res.status(401).json({ ok: false, message: 'Invalid login ID or PIN.' });
    }

    if (user.locked) {
      return res.status(403).json({ ok: false, message: 'Account locked. Contact admin.' });
    }

    const validPin = await verifyCredential(pin, user.pin);
    if (!validPin) {
      const failed = user.failedAttempts + 1;
      await prisma.roleAccessMatrix.update({
        where: { id: user.id },
        data: { failedAttempts: failed, locked: failed >= 5 },
      });
      await prisma.loginSessionLog.create({
        data: { userType: 'coordinator', userId: loginId, action: 'FAILED', status: 'Failed', message: 'Wrong PIN' },
      });
      return res.status(401).json({ ok: false, message: 'Invalid login ID or PIN.' });
    }

    const updateData = { failedAttempts: 0, lastLogin: new Date() };
    if (!isHashedCredential(user.pin)) {
      updateData.pin = await hashCredential(pin);
    }

    await prisma.roleAccessMatrix.update({ where: { id: user.id }, data: updateData });

    const token = await createSession(user.loginId, 'coordinator');

    await prisma.loginSessionLog.create({
      data: { userType: 'coordinator', userId: user.loginId, action: 'LOGIN', status: 'Success' },
    });
    await audit({ userIdentity: user.loginId, userRole: user.role, action: 'LOGIN', module: 'Auth', source: 'Coordinator Portal' });

    return res.json({
      ok: true,
      token,
      user: {
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
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
