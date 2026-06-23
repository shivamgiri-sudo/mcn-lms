import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';

/**
 * POST /api/auth/bridge
 * SSO bridge: validates a token from an external system (HRMS) and returns
 * an LMS session token.
 *
 * Lookup priority (first match wins):
 *   1. mobile  → TraineeMaster.mobile / UserMaster.mobile  (trainee only)
 *   2. email   → UserMaster.email (trainee) → RoleAccessMatrix.loginId (coordinator) → AdminUserMaster.adminId (admin)
 *   3. employee_id → UserMaster.employeeId (trainee) → RoleAccessMatrix.loginId (coordinator)
 *
 * Request body: { bridge_token, mobile?, email?, employee_id? }
 * Legacy field 'supabase_token' is accepted as an alias for bridge_token.
 */
export async function bridgeAuth(req, res) {
  try {
    const bridgeSecret = process.env.BRIDGE_SECRET;
    const { supabase_token, bridge_token, mobile: reqMobile, employee_id, email: reqEmail } = req.body;

    // Validate bridge secret if configured
    if (bridgeSecret) {
      const supplied = bridge_token || supabase_token;
      if (!supplied || supplied !== bridgeSecret) {
        return res.status(401).json({ ok: false, message: 'Invalid bridge token.' });
      }
    }

    // Require at least one lookup field
    if (!reqMobile && !reqEmail && !employee_id) {
      return res.status(400).json({ ok: false, message: 'Provide mobile, email, or employee_id.' });
    }

    let lmsUserId = null;
    let userType = 'hrms_guest';

    // ── Priority 1: mobile (last 10 digits, trainees only) ──────────────────
    if (!lmsUserId && reqMobile) {
      const cleanMobile = String(reqMobile).replace(/\D/g, '').slice(-10);
      if (cleanMobile.length === 10) {
        // Check UserMaster first (has auth account), then TraineeMaster
        const userByMobile = await prisma.userMaster.findFirst({
          where: { mobile: { endsWith: cleanMobile } },
          select: { employeeId: true },
        });
        if (userByMobile) {
          lmsUserId = userByMobile.employeeId;
          userType = 'trainee';
        } else {
          const traineeByMobile = await prisma.traineeMaster.findFirst({
            where: { mobile: { endsWith: cleanMobile } },
            select: { employeeId: true },
          });
          if (traineeByMobile) {
            lmsUserId = traineeByMobile.employeeId;
            userType = 'trainee';
          }
        }
      }
    }

    // ── Priority 2: email ────────────────────────────────────────────────────
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

    // ── Priority 3: employee_id ──────────────────────────────────────────────
    if (!lmsUserId && employee_id) {
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
