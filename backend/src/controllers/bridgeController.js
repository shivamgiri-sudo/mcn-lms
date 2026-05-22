import { prisma } from '../utils/db.js';
import { createSession } from '../utils/session.js';

/**
 * POST /api/auth/bridge
 * Accepts a Supabase access_token from the HRMS frontend,
 * verifies it against the Supabase Auth API, then returns
 * an LMS PortalSession token.
 */
export async function bridgeAuth(req, res) {
  try {
    const { supabase_token } = req.body;

    if (!supabase_token) {
      return res.status(400).json({ ok: false, message: 'supabase_token is required.' });
    }

    // ── 1. Verify token against Supabase Auth API ──────────────────────────────
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Bridge] SUPABASE_URL or SUPABASE_ANON_KEY env vars not set.');
      return res.status(500).json({ ok: false, message: 'Bridge not configured on server.' });
    }

    let supabaseUser;
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${supabase_token}`,
          apikey: supabaseAnonKey,
        },
      });

      if (!response.ok) {
        return res.status(401).json({ ok: false, message: 'Invalid HRMS session token.' });
      }

      supabaseUser = await response.json();
    } catch (fetchErr) {
      console.error('[Bridge] Supabase verification failed:', fetchErr.message);
      return res.status(401).json({ ok: false, message: 'Invalid HRMS session token.' });
    }

    if (!supabaseUser || !supabaseUser.id) {
      return res.status(401).json({ ok: false, message: 'Invalid HRMS session token.' });
    }

    const email = supabaseUser.email || null;

    // ── 2. Find matching LMS user by email ────────────────────────────────────
    let lmsUserId = null;
    let userType = 'hrms_guest';

    if (email) {
      // Check trainee (UserMaster) first
      const traineeUser = await prisma.userMaster.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { employeeId: true },
      });

      if (traineeUser) {
        lmsUserId = traineeUser.employeeId;
        userType = 'trainee';
      } else {
        // Check coordinator (RoleAccessMatrix) — loginId is typically email-like
        const coordinator = await prisma.roleAccessMatrix.findFirst({
          where: { loginId: { equals: email, mode: 'insensitive' } },
          select: { loginId: true },
        });

        if (coordinator) {
          lmsUserId = coordinator.loginId;
          userType = 'coordinator';
        } else {
          // Check admin (AdminUserMaster) — adminId is typically email-like
          const admin = await prisma.adminUserMaster.findFirst({
            where: { adminId: { equals: email, mode: 'insensitive' } },
            select: { adminId: true },
          });

          if (admin) {
            lmsUserId = admin.adminId;
            userType = 'admin';
          }
        }
      }
    }

    // ── 3. Fall back to Supabase UID for unmatched users ──────────────────────
    if (!lmsUserId) {
      lmsUserId = supabaseUser.id;
      userType = 'hrms_guest';
    }

    // ── 4. Create LMS PortalSession ───────────────────────────────────────────
    const token = await createSession(lmsUserId, userType);

    return res.json({
      ok: true,
      lms_token: token,
      userType,
      userId: lmsUserId,
      email,
    });
  } catch (err) {
    console.error('[Bridge] Unexpected error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error.' });
  }
}
