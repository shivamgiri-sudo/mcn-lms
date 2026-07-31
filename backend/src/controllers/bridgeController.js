import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { prisma } from '../utils/db.js';
import { normalizeSessionRole, recordSecurityEvent } from '../utils/session.js';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function base64urlJson(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function normalizedEmail(value) {
  return clean(value, 191).toLowerCase();
}

function redirectPath(value) {
  const path = clean(value || '/', 500);
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return '/';
  return path;
}

function privilegedBridgeEnabled() {
  return process.env.BRIDGE_ALLOW_PRIVILEGED === 'true';
}

function verifyAssertion(compact) {
  const secret = String(process.env.HRMS_ASSERTION_SECRET || '').trim();
  if (secret.length < 32) throw new Error('HRMS_ASSERTION_SECRET is not configured securely.');
  const parts = String(compact || '').split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const header = base64urlJson(encodedHeader);
  const payload = base64urlJson(encodedPayload);
  if (!header || !payload || header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`, 'utf8').digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  const now = Math.floor(Date.now() / 1000);
  const iat = Number(payload.iat);
  const exp = Number(payload.exp);
  const maxLifetime = Math.max(30, Math.min(300, Number(process.env.HRMS_ASSERTION_MAX_TTL_SECONDS || 120)));
  const skew = Math.max(0, Math.min(120, Number(process.env.HRMS_ASSERTION_CLOCK_SKEW_SECONDS || 30)));
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || !clean(payload.jti, 200)) return null;
  if (iat > now + skew || exp < now - skew || exp <= iat || exp - iat > maxLifetime) return null;
  if (clean(payload.iss, 160) !== clean(process.env.HRMS_ASSERTION_ISSUER, 160)) return null;
  if (clean(payload.aud, 160) !== clean(process.env.HRMS_ASSERTION_AUDIENCE, 160)) return null;
  return { header, payload, iat, exp };
}

async function resolveIdentity(claims) {
  const requestedType = normalizeSessionRole(claims.user_type || claims.userType || 'trainee');
  const employeeId = clean(claims.employee_id || claims.employeeId || claims.sub, 191);
  const email = normalizedEmail(claims.email);
  const mobile = String(claims.mobile || '').replace(/\D/g, '').slice(-10);

  if (requestedType === 'trainee') {
    const user = await prisma.userMaster.findFirst({
      where: {
        active: true,
        locked: false,
        OR: [
          ...(employeeId ? [{ employeeId }] : []),
          ...(email ? [{ email }] : []),
          ...(mobile.length === 10 ? [{ mobile: { endsWith: mobile } }] : []),
        ],
      },
      select: { employeeId: true },
    });
    return user ? { userId: user.employeeId, userType: 'trainee' } : null;
  }

  if (!privilegedBridgeEnabled()) return null;
  if (requestedType === 'coordinator') {
    const loginId = employeeId || email;
    if (!loginId) return null;
    const user = await prisma.roleAccessMatrix.findFirst({
      where: { loginId, active: true, locked: false },
      select: { loginId: true },
    });
    return user ? { userId: user.loginId, userType: 'coordinator' } : null;
  }
  if (requestedType === 'admin') {
    const adminId = employeeId || email;
    if (!adminId) return null;
    const user = await prisma.adminUserMaster.findFirst({
      where: { adminId, active: true, locked: false },
      select: { adminId: true },
    });
    return user ? { userId: user.adminId, userType: 'admin' } : null;
  }
  return null;
}

async function issueHandoff(req, identity, options = {}) {
  const rawCode = randomBytes(32).toString('base64url');
  const ttlSeconds = Math.max(30, Math.min(300, Number(process.env.SSO_HANDOFF_TTL_SECONDS || 90)));
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const ua = clean(req.headers['user-agent'], 1000);
  const ip = clean(String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '', 200);
  await prisma.$executeRawUnsafe(
    `INSERT INTO sso_handoff_code
       (handoff_id, code_hash, user_id, user_type, auth_method,
        assertion_jti_hash, redirect_path, expires_at, request_ip_hash, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    sha256(rawCode),
    identity.userId,
    identity.userType,
    options.authMethod || 'HRMS_ASSERTION',
    options.jtiHash || null,
    redirectPath(options.redirectPath),
    expiresAt,
    ip ? sha256(ip) : null,
    ua ? sha256(ua) : null,
  );
  return { rawCode, expiresAt };
}

async function consumeAssertionNonce(req, verified, identity) {
  const jtiHash = sha256(verified.payload.jti);
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO sso_replay_nonce
         (nonce_id, jti_hash, issuer, audience, subject_id, subject_type,
          issued_at, expires_at, request_ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?)`,
      randomUUID(),
      jtiHash,
      clean(verified.payload.iss, 160),
      clean(verified.payload.aud, 160),
      identity.userId,
      identity.userType,
      verified.iat,
      verified.exp,
      sha256(String(req.headers['x-forwarded-for'] || req.ip || '')),
    );
    return jtiHash;
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('duplicate')) return null;
    throw error;
  }
}

/**
 * Trusted HRMS SSO bridge.
 *
 * Preferred contract: signed HS256 assertion with iss/aud/sub/jti/iat/exp.
 * Compatibility: the previous shared bridge secret can issue only a one-time
 * handoff code and is disabled unless BRIDGE_ALLOW_LEGACY_SECRET=true.
 */
export async function bridgeAuth(req, res) {
  try {
    let identity = null;
    let jtiHash = null;
    let authMethod = 'HRMS_ASSERTION';
    let claims = null;

    const assertion = req.body?.assertion;
    if (!assertion) {
      return res.status(401).json({ ok: false, message: 'Signed HRMS assertion required.' });
    }

    const verified = verifyAssertion(assertion);
    if (!verified) {
      await recordSecurityEvent({ eventType: 'HRMS_ASSERTION_REJECTED', severity: 'CRITICAL', actorUserType: 'hrms', requestId: req.requestId, req });
      return res.status(401).json({ ok: false, message: 'Invalid or expired HRMS assertion.' });
    }
    claims = verified.payload;
    identity = await resolveIdentity(claims);
    if (!identity) return res.status(404).json({ ok: false, message: 'No active LMS account found for the trusted identity.' });
    jtiHash = await consumeAssertionNonce(req, verified, identity);
    if (!jtiHash) {
      await recordSecurityEvent({
        eventType: 'HRMS_ASSERTION_REPLAYED', severity: 'CRITICAL', actorUserId: identity.userId,
        actorUserType: 'hrms', subjectUserId: identity.userId, subjectUserType: identity.userType,
        requestId: req.requestId, req,
      });
      return res.status(409).json({ ok: false, message: 'This HRMS assertion has already been used.' });
    }

    const handoff = await issueHandoff(req, identity, {
      authMethod,
      jtiHash,
      redirectPath: claims.redirect_path || req.body?.redirect_path || '/',
    });
    await recordSecurityEvent({
      eventType: 'SSO_HANDOFF_ISSUED', severity: authMethod === 'HRMS_ASSERTION' ? 'HIGH' : 'CRITICAL',
      actorUserId: identity.userId, actorUserType: 'hrms', subjectUserId: identity.userId,
      subjectUserType: identity.userType, requestId: req.requestId, req,
      details: { authMethod, expiresAt: handoff.expiresAt },
    });
    return res.json({
      ok: true,
      handoff_code: handoff.rawCode,
      userType: identity.userType,
      userId: identity.userId,
      expiresAt: handoff.expiresAt,
      fragment: `#hrms_lms_code=${encodeURIComponent(handoff.rawCode)}&lms_user_type=${encodeURIComponent(identity.userType)}`,
    });
  } catch (error) {
    console.error('[Bridge] Unexpected error:', error.message);
    return res.status(500).json({ ok: false, message: 'HRMS SSO service unavailable.' });
  }
}
