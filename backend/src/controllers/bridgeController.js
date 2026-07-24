import { timingSafeEqual } from 'crypto';
import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedId(value) {
  return String(value || '').trim();
}

function privilegedBridgeEnabled() {
  return process.env.BRIDGE_ALLOW_PRIVILEGED === 'true';
}

/**
 * Compatibility bridge for a trusted HRMS service.
 *
 * This endpoint intentionally fails closed. Identity attributes are lookup hints,
 * never authentication proof. BRIDGE_SECRET should be replaced by signed,
 * short-lived HRMS assertions in the next SSO phase.
 */
export async function bridgeAuth(req, res) {
  try {
    const bridgeSecret = String(process.env.BRIDGE_SECRET || '').trim();
    if (!bridgeSecret) {
      console.error('[Bridge] Refused request because BRIDGE_SECRET is not configured.');
      return res.status(503).json({ ok: false, message: 'HRMS SSO is not configured.' });
    }

    const supplied = req.body?.bridge_token || req.body?.supabase_token;
    if (!safeEqual(supplied, bridgeSecret)) {
      return res.status(401).json({ ok: false, message: 'Invalid bridge token.' });
    }

    const reqMobile = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
    const reqEmail = normalizedEmail(req.body?.email);
    const employeeId = normalizedId(req.body?.employee_id);

    if (!reqMobile && !reqEmail && !employeeId) {
      return res.status(400).json({ ok: false, message: 'Provide mobile, email, or employee_id.' });
    }

    let lmsUserId = null;
    let userType = null;

    // Trainee lookup is the default bridge capability.
    if (reqMobile.length === 10) {
      const trainee = await prisma.userMaster.findFirst({
        where: { mobile: { endsWith: reqMobile }, active: true, locked: false },
        select: { employeeId: true },
      });
      if (trainee) {
        lmsUserId = trainee.employeeId;
        userType = 'trainee';
      }
    }

    if (!lmsUserId && reqEmail) {
      const trainee = await prisma.userMaster.findFirst({
        where: { email: reqEmail, active: true, locked: false },
        select: { employeeId: true },
      });
      if (trainee) {
        lmsUserId = trainee.employeeId;
        userType = 'trainee';
      }
    }

    if (!lmsUserId && employeeId) {
      const trainee = await prisma.userMaster.findFirst({
        where: { employeeId, active: true, locked: false },
        select: { employeeId: true },
      });
      if (trainee) {
        lmsUserId = trainee.employeeId;
        userType = 'trainee';
      }
    }

    // Privileged SSO is disabled unless deliberately enabled in production.
    if (!lmsUserId && privilegedBridgeEnabled()) {
      const coordinatorLookup = employeeId || reqEmail;
      if (coordinatorLookup) {
        const coordinator = await prisma.roleAccessMatrix.findFirst({
          where: { loginId: coordinatorLookup, active: true, locked: false },
          select: { loginId: true },
        });
        if (coordinator) {
          lmsUserId = coordinator.loginId;
          userType = 'coordinator';
        }
      }

      if (!lmsUserId && reqEmail) {
        const admin = await prisma.adminUserMaster.findFirst({
          where: { adminId: reqEmail, active: true, locked: false },
          select: { adminId: true },
        });
        if (admin) {
          lmsUserId = admin.adminId;
          userType = 'admin';
        }
      }
    }

    if (!lmsUserId) {
      return res.status(404).json({ ok: false, message: 'No active LMS account found for the trusted identity.' });
    }

    const token = await createSession(lmsUserId, userType);
    return res.json({ ok: true, lms_token: token, userType, userId: lmsUserId });
  } catch (err) {
    console.error('[Bridge] Unexpected error:', err.message);
    return res.status(500).json({ ok: false, message: 'Internal server error.' });
  }
}
