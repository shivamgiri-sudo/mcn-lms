import { prisma } from '../utils/db.js';
import { createSession, deleteSession, deleteAllSessions } from '../utils/session.js';
import { hashPassword, verifyPassword, generateSalt, normalize, verifyCredential, hashCredential, isHashedCredential } from '../utils/hash.js';
import { audit } from '../utils/audit.js';

// ── Coordinator Login (PIN-based, no Google required) ─────────────────────────
export async function coordinatorLogin(req, res) {
  try {
    const { loginId, pin } = req.body;
    if (!loginId || !pin) return res.status(400).json({ ok: false, message: 'Login ID and PIN required.' });

    const user = await prisma.roleAccessMatrix.findFirst({
      where: { loginId: { equals: loginId }, active: true },
    });

    if (!user) {
      await prisma.loginSessionLog.create({ data: { userType: 'coordinator', userId: loginId, action: 'FAILED', status: 'Failed', message: 'User not found' } });
      return res.status(401).json({ ok: false, message: 'Invalid login ID or PIN.' });
    }

    if (user.locked) {
      return res.status(403).json({ ok: false, message: 'Account locked. Contact admin.' });
    }

    const pinValid = await verifyCredential(pin, user.pin);
    if (!pinValid) {
      const failed = user.failedAttempts + 1;
      await prisma.roleAccessMatrix.update({
        where: { id: user.id },
        data: { failedAttempts: failed, locked: failed >= 5 },
      });
      await prisma.loginSessionLog.create({ data: { userType: 'coordinator', userId: loginId, action: 'FAILED', status: 'Failed', message: 'Wrong PIN' } });
      return res.status(401).json({ ok: false, message: 'Invalid login ID or PIN.' });
    }

    let updateData = { failedAttempts: 0, lastLogin: new Date() };
    if (!isHashedCredential(user.pin)) {
      updateData.pin = await hashCredential(pin);
    }
    await prisma.roleAccessMatrix.update({
      where: { id: user.id },
      data: updateData,
    });

    const token = await createSession(user.loginId, 'coordinator');

    await prisma.loginSessionLog.create({ data: { userType: 'coordinator', userId: user.loginId, action: 'LOGIN', status: 'Success' } });
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
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function coordinatorLogout(req, res) {
  await deleteSession(req.headers.authorization?.replace('Bearer ', '').trim());
  res.json({ ok: true });
}

export async function adminLogout(req, res) {
  await deleteSession(req.headers.authorization?.replace('Bearer ', '').trim());
  res.json({ ok: true });
}

export async function traineeLogout(req, res) {
  await deleteSession(req.headers.authorization?.replace('Bearer ', '').trim());
  res.json({ ok: true });
}

// ── Admin Login ───────────────────────────────────────────────────────────────
export async function adminLogin(req, res) {
  try {
    const { adminId, password } = req.body;
    if (!adminId || !password) return res.status(400).json({ ok: false, message: 'Admin ID and password required.' });

    const admin = await prisma.adminUserMaster.findFirst({
      where: { adminId: { equals: adminId }, active: true },
    });

    if (!admin) return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    if (admin.locked) return res.status(403).json({ ok: false, message: 'Account locked.' });

    const valid = await verifyPassword(password, admin.salt, admin.passwordHash);
    if (!valid) {
      const failed = admin.failedAttempts + 1;
      await prisma.adminUserMaster.update({ where: { id: admin.id }, data: { failedAttempts: failed, locked: failed >= 5 } });
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }

    await prisma.adminUserMaster.update({ where: { id: admin.id }, data: { failedAttempts: 0, lastLogin: new Date() } });
    const token = await createSession(admin.adminId, 'admin');

    return res.json({
      ok: true,
      token,
      user: { adminId: admin.adminId, name: admin.adminName, role: admin.role, branch: admin.branch || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Trainee Login ─────────────────────────────────────────────────────────────
// Accepts: Employee ID, LMS ID (LMSxxxxxx), Email, or Mobile number
export async function traineeLogin(req, res) {
  try {
    const { employeeId, password } = req.body;
    if (!employeeId || !password) return res.status(400).json({ ok: false, message: 'Employee ID and password required.' });

    const identifier = employeeId.trim();

    // Resolve employeeId from any supported identifier
    let resolvedEmployeeId = null;

    // 1. Try direct employeeId match in UserMaster
    const directMatch = await prisma.userMaster.findFirst({
      where: { employeeId: normalize(identifier), active: true },
      select: { employeeId: true },
    });
    if (directMatch) resolvedEmployeeId = directMatch.employeeId;

    // 2. Try LMS ID (format: LMSxxxxxx) — look up in TraineeMaster
    if (!resolvedEmployeeId && /^LMS/i.test(identifier)) {
      const byLmsId = await prisma.traineeMaster.findFirst({
        where: { lmsId: identifier },
        select: { employeeId: true },
      });
      if (byLmsId) resolvedEmployeeId = byLmsId.employeeId;
    }

    // 3. Try Email — look up in UserMaster
    if (!resolvedEmployeeId && identifier.includes('@')) {
      const byEmail = await prisma.userMaster.findFirst({
        where: { email: identifier, active: true },
        select: { employeeId: true },
      });
      if (byEmail) resolvedEmployeeId = byEmail.employeeId;
    }

    // 4. Try Mobile (10-digit number) — look up in UserMaster
    if (!resolvedEmployeeId) {
      const cleanMobile = identifier.replace(/\D/g, '').slice(-10);
      if (cleanMobile.length === 10) {
        const byMobile = await prisma.userMaster.findFirst({
          where: { mobile: { endsWith: cleanMobile }, active: true },
          select: { employeeId: true },
        });
        if (byMobile) resolvedEmployeeId = byMobile.employeeId;
      }
    }

    if (!resolvedEmployeeId) return res.status(401).json({ ok: false, message: 'Invalid credentials.' });

    const user = await prisma.userMaster.findFirst({
      where: { employeeId: resolvedEmployeeId, active: true },
    });

    if (!user) return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    if (user.locked) return res.status(403).json({ ok: false, message: 'Account locked. Contact your coordinator.' });

    const valid = await verifyPassword(password, user.salt, user.passwordHash);
    if (!valid) {
      const failed = user.failedAttempts + 1;
      await prisma.userMaster.update({ where: { id: user.id }, data: { failedAttempts: failed, locked: failed >= 5 } });
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }

    await prisma.userMaster.update({ where: { id: user.id }, data: { failedAttempts: 0, lastLogin: new Date() } });
    const token = await createSession(user.employeeId, 'trainee');

    await prisma.loginSessionLog.create({ data: { userType: 'trainee', userId: user.employeeId, action: 'LOGIN', status: 'Success' } });

    return res.json({
      ok: true,
      token,
      forcePasswordReset: user.forcePasswordReset,
      user: {
        employeeId: user.employeeId,
        name: user.traineeName,
        batchNo: user.batchNo,
        classroomId: user.classroomId,
        branch: user.branch,
        process: user.process,
        lob: user.lob,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function traineeChangePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, message: 'Both passwords required.' });
    if (newPassword.length < 4) return res.status(400).json({ ok: false, message: 'New password must be at least 4 characters.' });

    const user = await prisma.userMaster.findUnique({ where: { employeeId: req.userId } });
    if (!user) return res.status(404).json({ ok: false, message: 'User not found.' });

    const valid = await verifyPassword(oldPassword, user.salt, user.passwordHash);
    if (!valid) return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    await prisma.userMaster.update({
      where: { id: user.id },
      data: { passwordHash, salt, forcePasswordReset: false },
    });

    await deleteAllSessions(user.employeeId);

    const newToken = await createSession(user.employeeId, 'trainee');

    res.json({ ok: true, token: newToken, message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getMyProfile(req, res) {
  try {
    if (req.userType === 'coordinator') {
      const user = await prisma.roleAccessMatrix.findFirst({
        where: { loginId: req.userId },
        select: { loginId: true, name: true, role: true, branch: true, process: true, lob: true, email: true, mobile: true, lastLogin: true },
      });
      return res.json({ ok: true, user });
    }
    if (req.userType === 'admin') {
      const user = await prisma.adminUserMaster.findFirst({
        where: { adminId: req.userId },
        select: { adminId: true, adminName: true, role: true, lastLogin: true },
      });
      return res.json({ ok: true, user });
    }
    if (req.userType === 'trainee') {
      const user = await prisma.userMaster.findUnique({
        where: { employeeId: req.userId },
        select: { employeeId: true, lastLogin: true, forcePasswordReset: true },
      });
      return res.json({ ok: true, user });
    }
    res.status(403).json({ ok: false });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Self-service password recovery for trainee/admin/coordinator now lives entirely in
// secureRecovery.js (token-based, assisted-verification flow — see routes/auth.js).
// The three legacy handlers that used to live here (traineeForgotPassword,
// adminForgotPassword, coordinatorForgotPassword) generated and returned a temp
// credential directly in the API response to an unauthenticated caller — an
// account-takeover vector for anyone who knew/guessed a login ID. They were never
// wired to a route, but dead insecure code is a landmine for a future accidental
// wire-up, so removed rather than left in place.
