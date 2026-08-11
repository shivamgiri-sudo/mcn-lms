import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { prisma } from './db.js';

const IDLE_TTL_SECONDS = Number.parseInt(process.env.SESSION_TTL_SECONDS || '21600', 10);
const ABSOLUTE_TTL_SECONDS = Number.parseInt(process.env.SESSION_ABSOLUTE_TTL_SECONDS || '43200', 10);
const TOUCH_INTERVAL_SECONDS = Number.parseInt(process.env.SESSION_TOUCH_INTERVAL_SECONDS || '300', 10);
const ROLE_COOKIE = {
  trainee: 'lms_trainee_session',
  coordinator: 'lms_coordinator_session',
  admin: 'lms_admin_session',
};
const ROLE_CSRF_COOKIE = {
  trainee: 'lms_trainee_csrf',
  coordinator: 'lms_coordinator_csrf',
  admin: 'lms_admin_csrf',
};
const ALLOWED_COOKIE_NAMES = new Set([...Object.values(ROLE_COOKIE), ...Object.values(ROLE_CSRF_COOKIE)]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function normalizeSessionRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === 'management' ? 'coordinator' : value;
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function keyedHash(value) {
  const secret = String(process.env.SESSION_FINGERPRINT_SECRET || process.env.SESSION_SECRET || '');
  if (!secret || !value) return null;
  return createHmac('sha256', secret).update(String(value), 'utf8').digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(req) {
  const cookies = Object.create(null);
  for (const item of String(req?.headers?.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 1) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (!ALLOWED_COOKIE_NAMES.has(key)) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function requestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req?.headers?.['user-agent'] || '').slice(0, 1000);
}

function deviceLabel(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  const platform = ua.includes('android') ? 'Android'
    : ua.includes('iphone') || ua.includes('ipad') ? 'iOS'
      : ua.includes('windows') ? 'Windows'
        : ua.includes('mac os') ? 'macOS'
          : ua.includes('linux') ? 'Linux'
            : 'Unknown device';
  const browser = ua.includes('edg/') ? 'Edge'
    : ua.includes('chrome/') ? 'Chrome'
      : ua.includes('firefox/') ? 'Firefox'
        : ua.includes('safari/') ? 'Safari'
          : 'Browser';
  return `${browser} on ${platform}`;
}

function cookieSettings(maxAgeMs, httpOnly) {
  const production = process.env.NODE_ENV === 'production';
  const configured = String(process.env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(configured) ? configured : 'lax';
  const secure = process.env.SESSION_COOKIE_SECURE === 'true' || production || sameSite === 'none';
  return {
    httpOnly,
    secure,
    sameSite,
    path: '/',
    maxAge: Math.max(0, maxAgeMs),
    ...(String(process.env.SESSION_COOKIE_DOMAIN || '').trim()
      ? { domain: String(process.env.SESSION_COOKIE_DOMAIN).trim() }
      : {}),
  };
}

function csrfSecret() {
  return String(process.env.CSRF_SECRET || process.env.SESSION_SECRET || '');
}

function csrfToken(rawToken, role, csrfVersion = 1) {
  return createHmac('sha256', csrfSecret())
    .update(`${rawToken}:${role}:${csrfVersion}`, 'utf8')
    .digest('base64url');
}

export function validateSessionSecurityConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  for (const key of ['SESSION_SECRET', 'CSRF_SECRET', 'SESSION_FINGERPRINT_SECRET']) {
    const value = String(env[key] || '').trim();
    if (value.length < 32) throw new Error(`${key} must be configured with at least 32 characters in production.`);
  }
  if (String(env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase() === 'none' && env.SESSION_COOKIE_SECURE === 'false') {
    throw new Error('SameSite=None session cookies must be Secure.');
  }
  return true;
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionFamilyId: row.sessionFamilyId,
    token: row.token,
    userId: row.userId,
    userType: row.userType,
    authMethod: row.authMethod,
    deviceLabel: row.deviceLabel,
    userAgentHash: row.userAgentHash,
    ipHash: row.ipHash,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    rotatedFromId: row.rotatedFromId,
    csrfVersion: Number(row.csrfVersion || 1),
    elevationAuthenticatedAt: row.elevationAuthenticatedAt,
    elevationExpiresAt: row.elevationExpiresAt,
    elevationReason: row.elevationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findSessionByToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const fingerprint = hashSessionToken(raw);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, session_family_id AS sessionFamilyId, token,
            user_id AS userId, user_type AS userType, auth_method AS authMethod,
            device_label AS deviceLabel, user_agent_hash AS userAgentHash,
            ip_hash AS ipHash, last_seen_at AS lastSeenAt, expires_at AS expiresAt,
            absolute_expires_at AS absoluteExpiresAt, revoked_at AS revokedAt,
            revoked_reason AS revokedReason, rotated_from_id AS rotatedFromId,
            csrf_version AS csrfVersion,
            elevation_authenticated_at AS elevationAuthenticatedAt,
            elevation_expires_at AS elevationExpiresAt,
            elevation_reason AS elevationReason, created_at AS createdAt,
            updated_at AS updatedAt
       FROM portal_sessions
      WHERE token IN (?, ?)
      LIMIT 1`,
    fingerprint,
    raw,
  );
  const session = mapSession(rows[0]);
  if (!session) return null;
  if (session.revokedAt || new Date(session.expiresAt) <= new Date() || new Date(session.absoluteExpiresAt) <= new Date()) return null;

  if (session.token === raw) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE portal_sessions SET token = ?, auth_method = 'LEGACY_BEARER', updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND token = ?`,
        fingerprint,
        session.id,
        raw,
      );
      session.token = fingerprint;
    } catch {
      return null;
    }
  }
  return session;
}

async function insertSession(userId, userType, options = {}) {
  const role = normalizeSessionRole(userType);
  if (!ROLE_COOKIE[role]) throw new Error('Unsupported session role.');
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + Math.max(IDLE_TTL_SECONDS, ABSOLUTE_TTL_SECONDS) * 1000);
  const expiresAt = new Date(Math.min(absoluteExpiresAt.getTime(), now.getTime() + IDLE_TTL_SECONDS * 1000));
  const rawToken = randomBytes(48).toString('base64url');
  const id = randomUUID();
  const familyId = options.sessionFamilyId || id;
  const ua = options.userAgent || '';
  const ip = options.ip || '';
  await prisma.$executeRawUnsafe(
    `INSERT INTO portal_sessions
       (id, session_family_id, token, user_id, user_type, auth_method,
        device_label, user_agent_hash, ip_hash, last_seen_at, expires_at,
        absolute_expires_at, rotated_from_id, csrf_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, ?, ?, 1,
             CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    id,
    familyId,
    hashSessionToken(rawToken),
    String(userId),
    role,
    String(options.authMethod || 'PASSWORD').slice(0, 40),
    String(options.deviceLabel || deviceLabel(ua)).slice(0, 160),
    keyedHash(ua),
    keyedHash(ip),
    expiresAt,
    absoluteExpiresAt,
    options.rotatedFromId || null,
  );
  return {
    token: rawToken,
    session: {
      id,
      sessionFamilyId: familyId,
      userId: String(userId),
      userType: role,
      authMethod: String(options.authMethod || 'PASSWORD').slice(0, 40),
      deviceLabel: String(options.deviceLabel || deviceLabel(ua)).slice(0, 160),
      expiresAt,
      absoluteExpiresAt,
      csrfVersion: 1,
      createdAt: now,
    },
  };
}

export async function recordSecurityEvent({
  eventType,
  severity = 'INFO',
  actorUserId = null,
  actorUserType = null,
  subjectUserId = null,
  subjectUserType = null,
  sessionId = null,
  requestId = null,
  req = null,
  details = null,
}) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO security_event
         (event_id, event_type, severity, actor_user_id, actor_user_type,
          subject_user_id, subject_user_type, session_id, request_id,
          ip_hash, user_agent_hash, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      randomUUID(),
      String(eventType || 'UNKNOWN').slice(0, 80),
      String(severity || 'INFO').toUpperCase(),
      actorUserId ? String(actorUserId) : null,
      actorUserType ? normalizeSessionRole(actorUserType) : null,
      subjectUserId ? String(subjectUserId) : null,
      subjectUserType ? normalizeSessionRole(subjectUserType) : null,
      sessionId ? String(sessionId) : null,
      requestId ? String(requestId).slice(0, 120) : null,
      req ? keyedHash(requestIp(req)) : null,
      req ? keyedHash(requestUserAgent(req)) : null,
      JSON.stringify(details || {}),
    );
  } catch (error) {
    console.warn('[SECURITY_EVENT] write failed:', error.message);
  }
}

export async function createSession(userId, userType, options = {}) {
  const created = await insertSession(userId, userType, options);
  return created.token;
}

export function setBrowserSessionCookies(res, rawToken, userType, session) {
  const role = normalizeSessionRole(userType);
  const maxAge = Math.max(0, new Date(session.absoluteExpiresAt).getTime() - Date.now());
  res.cookie(ROLE_COOKIE[role], rawToken, cookieSettings(maxAge, true));
  res.cookie(ROLE_CSRF_COOKIE[role], csrfToken(rawToken, role, session.csrfVersion), cookieSettings(maxAge, false));
}

export function clearBrowserSessionCookies(res, userType) {
  const role = normalizeSessionRole(userType);
  if (!ROLE_COOKIE[role]) return;
  const settings = cookieSettings(0, true);
  delete settings.maxAge;
  res.clearCookie(ROLE_COOKIE[role], settings);
  const csrfSettings = cookieSettings(0, false);
  delete csrfSettings.maxAge;
  res.clearCookie(ROLE_CSRF_COOKIE[role], csrfSettings);
}

export async function establishBrowserSession(req, res, userId, userType, options = {}) {
  const role = normalizeSessionRole(userType);
  const created = await insertSession(userId, role, {
    ...options,
    userAgent: requestUserAgent(req),
    ip: requestIp(req),
  });
  setBrowserSessionCookies(res, created.token, role, created.session);
  await recordSecurityEvent({
    eventType: 'SESSION_CREATED',
    actorUserId: userId,
    actorUserType: role,
    subjectUserId: userId,
    subjectUserType: role,
    sessionId: created.session.id,
    requestId: req.requestId,
    req,
    details: { authMethod: created.session.authMethod, deviceLabel: created.session.deviceLabel },
  });
  return created.session;
}

export function resolveSessionCredential(req) {
  // A link opened in a new tab cannot send X-LMS-Role, so a role hint is also
  // accepted from the query string. The hint only chooses which cookie to read
  // among those the browser already sent; it never grants access by itself.
  const roleHeader = normalizeSessionRole(req.headers['x-lms-role'] || req.query?.role || '');
  const cookies = parseCookies(req);
  if (ROLE_COOKIE[roleHeader] && cookies[ROLE_COOKIE[roleHeader]]) {
    return { token: cookies[ROLE_COOKIE[roleHeader]], role: roleHeader, mode: 'cookie', cookies };
  }

  const available = Object.entries(ROLE_COOKIE)
    .filter(([, name]) => Boolean(cookies[name]))
    .map(([role, name]) => ({ role, token: cookies[name] }));
  if (!roleHeader && available.length === 1) return { ...available[0], mode: 'cookie', cookies };

  const header = String(req.headers.authorization || '');
  const allowBearer = process.env.NODE_ENV !== 'production' || process.env.LMS_ALLOW_BEARER_SESSION_COMPAT === 'true';
  if (allowBearer && header.startsWith('Bearer ')) {
    return { token: header.slice(7).trim(), role: roleHeader || null, mode: 'bearer', cookies };
  }
  return { token: '', role: roleHeader || null, mode: 'none', cookies };
}

export async function getSession(token) {
  return findSessionByToken(token);
}

export async function touchSession(session, req) {
  if (!session?.id) return session;
  const lastSeen = new Date(session.lastSeenAt || session.createdAt || 0).getTime();
  if (Date.now() - lastSeen < TOUCH_INTERVAL_SECONDS * 1000) return session;
  const absolute = new Date(session.absoluteExpiresAt).getTime();
  const nextExpiry = new Date(Math.min(absolute, Date.now() + IDLE_TTL_SECONDS * 1000));
  await prisma.$executeRawUnsafe(
    `UPDATE portal_sessions
        SET last_seen_at = CURRENT_TIMESTAMP(3), expires_at = ?,
            ip_hash = COALESCE(ip_hash, ?), user_agent_hash = COALESCE(user_agent_hash, ?),
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND revoked_at IS NULL`,
    nextExpiry,
    keyedHash(requestIp(req)),
    keyedHash(requestUserAgent(req)),
    session.id,
  );
  session.lastSeenAt = new Date();
  session.expiresAt = nextExpiry;
  return session;
}

export function validateCsrfRequest(req, credential, session) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase()) || credential.mode !== 'cookie') return true;
  const role = normalizeSessionRole(session.userType);
  const header = String(req.headers['x-csrf-token'] || '');
  const cookie = String(credential.cookies?.[ROLE_CSRF_COOKIE[role]] || '');
  const expected = csrfToken(credential.token, role, session.csrfVersion);
  return safeEqual(header, expected) && safeEqual(cookie, expected);
}

export async function revokeSessionById(sessionId, reason = 'Revoked') {
  await prisma.$executeRawUnsafe(
    `UPDATE portal_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)),
            revoked_reason = COALESCE(revoked_reason, ?),
            elevation_authenticated_at = NULL, elevation_expires_at = NULL,
            elevation_reason = NULL, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
    String(reason).slice(0, 500),
    String(sessionId),
  );
}

export async function deleteSession(token, reason = 'Logout') {
  const session = await findSessionByToken(token);
  if (!session) return;
  await revokeSessionById(session.id, reason);
}

export async function deleteAllSessions(userId, reason = 'All sessions revoked') {
  await prisma.$executeRawUnsafe(
    `UPDATE portal_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)),
            revoked_reason = COALESCE(revoked_reason, ?),
            elevation_authenticated_at = NULL, elevation_expires_at = NULL,
            elevation_reason = NULL, updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ? AND revoked_at IS NULL`,
    String(reason).slice(0, 500),
    String(userId),
  );
}

export async function listUserSessions(userId, userType, currentSessionId = null) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, session_family_id AS sessionFamilyId, user_id AS userId,
            user_type AS userType, auth_method AS authMethod, device_label AS deviceLabel,
            last_seen_at AS lastSeenAt, expires_at AS expiresAt,
            absolute_expires_at AS absoluteExpiresAt, revoked_at AS revokedAt,
            revoked_reason AS revokedReason, elevation_expires_at AS elevationExpiresAt,
            created_at AS createdAt
       FROM portal_sessions
      WHERE user_id = ? AND user_type = ?
      ORDER BY created_at DESC
      LIMIT 100`,
    String(userId),
    normalizeSessionRole(userType),
  );
  return rows.map(row => ({
    ...row,
    current: String(row.id) === String(currentSessionId || ''),
    active: !row.revokedAt && new Date(row.expiresAt) > new Date() && new Date(row.absoluteExpiresAt) > new Date(),
  }));
}

export async function elevateSession(sessionId, reason, minutes = 15) {
  const expiresAt = new Date(Date.now() + Math.max(5, Math.min(30, Number(minutes || 15))) * 60 * 1000);
  await prisma.$executeRawUnsafe(
    `UPDATE portal_sessions
        SET elevation_authenticated_at = CURRENT_TIMESTAMP(3),
            elevation_expires_at = ?, elevation_reason = ?,
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND revoked_at IS NULL`,
    expiresAt,
    String(reason),
    String(sessionId),
  );
  return expiresAt;
}

export function hasRecentElevation(session) {
  return Boolean(session?.elevationExpiresAt && new Date(session.elevationExpiresAt) > new Date());
}

export async function cleanExpiredSessions() {
  await prisma.$executeRawUnsafe(
    `UPDATE portal_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)),
            revoked_reason = COALESCE(revoked_reason, 'Expired'),
            elevation_authenticated_at = NULL, elevation_expires_at = NULL,
            elevation_reason = NULL, updated_at = CURRENT_TIMESTAMP(3)
      WHERE revoked_at IS NULL AND (expires_at < CURRENT_TIMESTAMP(3) OR absolute_expires_at < CURRENT_TIMESTAMP(3))`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM sso_handoff_code WHERE expires_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)`);
  await prisma.$executeRawUnsafe(`DELETE FROM sso_replay_nonce WHERE expires_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)`);
}
