import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';
import { verifyPassword, normalize } from '../utils/hash.js';

function clean(value) {
  return String(value || '').trim();
}

export async function traineeLoginStable(req, res) {
  try {
    const { employeeId, password } = req.body;
    if (!employeeId || !password) return res.status(400).json({ ok: false, message: 'Employee ID / LMS ID and password required.' });

    const identifier = clean(employeeId);
    const normalizedIdentifier = normalize(identifier);
    const lowerIdentifier = identifier.toLowerCase();
    let resolvedEmployeeId = null;

    const directMatch = await prisma.userMaster.findFirst({
      where: {
        active: true,
        OR: [
          { employeeId: identifier },
          { employeeId: normalizedIdentifier },
        ],
      },
      select: { employeeId: true },
    });
    if (directMatch) resolvedEmployeeId = directMatch.employeeId;

    if (!resolvedEmployeeId) {
      const byLmsId = await prisma.traineeMaster.findFirst({
        where: {
          status: { not: 'Deleted' },
          OR: [
            { lmsId: identifier },
            { lmsId: lowerIdentifier },
          ],
        },
        select: { employeeId: true },
      });
      if (byLmsId) resolvedEmployeeId = byLmsId.employeeId;
    }

    if (!resolvedEmployeeId && identifier.includes('@')) {
      const byEmail = await prisma.userMaster.findFirst({
        where: {
          active: true,
          OR: [
            { email: identifier },
            { email: lowerIdentifier },
          ],
        },
        select: { employeeId: true },
      });
      if (byEmail) resolvedEmployeeId = byEmail.employeeId;
    }

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

    const user = await prisma.userMaster.findFirst({ where: { employeeId: resolvedEmployeeId, active: true } });
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
    console.error('[authStability] trainee login failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
