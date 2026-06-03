import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';

/**
 * POST /api/auth/bridge
 * SSO bridge: validates a token from an external system (HRMS) and returns
 * an LMS session token.
 *
 * MySQL-only setup: looks up the user directly by employee_id or email.
 * Set BRIDGE_SECRET in .env to protect the endpoint from unauthenticated calls.
 *
 * Request body: { bridge_token, employee_id?, email? }
 * Legacy field 'supabase_token' is accepted as an alias for bridge_token.
 */
export async function bridgeAuth(req, res) {
  try {
    const bridgeSecret = process.env.BRIDGE_SECRET;
    const { supabase_token, bridge_token, employee_id, email: reqEmail } = req.body;

    // If a BRIDGE_SECRET is configured, validate the supplied token against it
    if (bridgeSecret) {
      const supplied = bridge_token || supabase_token;
      if (!supplied || supplied !== bridgeSecret) {
        return res.status(401).json({ ok: false, message: 'Invalid bridge token.' });
      }
    }

    // Require at least one lookup field
    if (!employee_id && !reqEmail) {
      return res.status(400).json({ ok: false, message: 'Provide employee_id or email.' });
    }

    let lmsUserId = null;
    let userType = 'hrms_guest';

    // Look up by employee_id first (fastest path)
    if (employee_id) {
      const trainee = await prisma.userMaster.findUnique({
        where: { employeeId: employee_id },
        select: { employeeId: true },
      });
      if (trainee) {
        lmsUserId = trainee.employeeId;
        userType = 'trainee';
      } else {
        const coord = await prisma.roleAccessMatrix.findFirst({
          where: { loginId: employee_id },
          select: { loginId: true },
        });
        if (coord) { lmsUserId = coord.loginId; userType = 'coordinator'; }
      }
    }

    // Fall back to email lookup
    if (!lmsUserId && reqEmail) {
      const traineeByEmail = await prisma.userMaster.findFirst({
        where: { email: { equals: reqEmail, mode: 'insensitive' } },
        select: { employeeId: true },
      });
      if (traineeByEmail) {
        lmsUserId = traineeByEmail.employeeId;
        userType = 'trainee';
      } else {
        const coordByEmail = await prisma.roleAccessMatrix.findFirst({
          where: { loginId: { equals: reqEmail, mode: 'insensitive' } },
          select: { loginId: true },
        });
        if (coordByEmail) {
          lmsUserId = coordByEmail.loginId;
          userType = 'coordinator';
        } else {
          const admin = await prisma.adminUserMaster.findFirst({
            where: { adminId: { equals: reqEmail, mode: 'insensitive' } },
            select: { adminId: true },
          });
          if (admin) { lmsUserId = admin.adminId; userType = 'admin'; }
        }
      }
    }

    if (!lmsUserId) {
      return res.status(404).json({ ok: false, message: 'No matching LMS account found.' });
    }

    const token = await createSession(lmsUserId, userType);
    return res.json({ ok: true, lms_token: token, userType, userId: lmsUserId });
  } catch (err) {
    console.error('[Bridge] Unexpected error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error.' });
  }
}
