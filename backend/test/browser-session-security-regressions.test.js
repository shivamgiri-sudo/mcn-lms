import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveCsrfToken, csrfTokensEqual } from '../src/security/csrf.js';

process.env.DATABASE_URL ||= 'mysql://test:test@127.0.0.1:3306/test';
const { validateSessionSecurityConfig } = await import('../src/utils/session.js');

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const migration = read('backend/prisma/migrations/20260729100000_secure_browser_sessions/migration.sql');
const session = read('backend/src/utils/session.js');
const middleware = read('backend/src/middleware/auth.js');
const browserAuth = read('backend/src/routes/browserAuth.js');
const bridge = read('backend/src/controllers/bridgeController.js');
const secureRecovery = read('backend/src/controllers/secureRecovery.js');
const adminRoutes = read('backend/src/routes/admin.js');
const server = read('backend/src/server.js');
const api = read('frontend/src/utils/api.js');
const sso = read('frontend/src/utils/ssoBootstrap.js');
const sessionPage = read('frontend/src/pages/SessionSecurity/SessionSecurityPage.jsx');
const app = read('frontend/src/App.jsx');
const launcher = read('frontend/src/components/LearningToolsDock.jsx');

test('CSRF tokens are deterministic role-bound and timing-safe comparable', () => {
  const previous = process.env.CSRF_SECRET;
  process.env.CSRF_SECRET = 'test-csrf-secret-with-more-than-32-characters';
  try {
    const trainee = deriveCsrfToken('raw-session-value', 'trainee', 1);
    const coordinator = deriveCsrfToken('raw-session-value', 'coordinator', 1);
    const rotated = deriveCsrfToken('raw-session-value', 'trainee', 2);
    assert.equal(trainee, deriveCsrfToken('raw-session-value', 'trainee', 1));
    assert.notEqual(trainee, coordinator);
    assert.notEqual(trainee, rotated);
    assert.equal(csrfTokensEqual(trainee, trainee), true);
    assert.equal(csrfTokensEqual(trainee, coordinator), false);
  } finally {
    if (previous === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = previous;
  }
});

test('production session configuration fails closed', () => {
  assert.throws(() => validateSessionSecurityConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  assert.throws(() => validateSessionSecurityConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'x'.repeat(32),
    CSRF_SECRET: 'y'.repeat(32),
    SESSION_FINGERPRINT_SECRET: 'z'.repeat(32),
    SESSION_COOKIE_SAME_SITE: 'none',
    SESSION_COOKIE_SECURE: 'false',
  }), /SameSite=None/);
  assert.equal(validateSessionSecurityConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'x'.repeat(32),
    CSRF_SECRET: 'y'.repeat(32),
    SESSION_FINGERPRINT_SECRET: 'z'.repeat(32),
    SESSION_COOKIE_SAME_SITE: 'lax',
    SESSION_COOKIE_SECURE: 'true',
  }), true);
});

test('migration seventeen preserves sessions and adds identity assurance evidence', () => {
  for (const column of [
    'session_family_id', 'auth_method', 'device_label', 'user_agent_hash', 'ip_hash',
    'last_seen_at', 'absolute_expires_at', 'revoked_at', 'csrf_version', 'elevation_expires_at',
  ]) assert.match(migration, new RegExp(column));
  for (const table of ['sso_replay_nonce', 'sso_handoff_code', 'security_event']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(migration, /auth_method = 'LEGACY_BEARER'/);
  assert.match(migration, /UNIQUE KEY uq_sso_replay_jti/);
  assert.match(migration, /UNIQUE KEY uq_sso_handoff_code_hash/);
  assert.match(migration, /security\.sessions\.audit/);
  assert.match(migration, /security\.elevation\.use/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test('sessions use role-specific HttpOnly cookies and bounded lifecycle', () => {
  assert.match(session, /lms_trainee_session/);
  assert.match(session, /lms_coordinator_session/);
  assert.match(session, /lms_admin_session/);
  assert.match(session, /httpOnly/);
  assert.match(session, /sameSite/);
  assert.match(session, /secure/);
  assert.match(session, /SESSION_ABSOLUTE_TTL_SECONDS/);
  assert.match(session, /SESSION_TOUCH_INTERVAL_SECONDS/);
  assert.match(session, /revoked_at/);
  assert.match(session, /listUserSessions/);
  assert.match(session, /LMS_ALLOW_BEARER_SESSION_COMPAT/);
  assert.match(session, /process\.env\.NODE_ENV !== 'production'/);
  assert.doesNotMatch(session, /portalSession\.deleteMany/);
});

test('session middleware enforces role CSRF origin and recent elevation', () => {
  assert.match(middleware, /resolveSessionCredential/);
  assert.match(middleware, /validateCsrfRequest/);
  assert.match(middleware, /CSRF_REJECTED/);
  assert.match(middleware, /SESSION_ROLE_MISMATCH/);
  assert.match(middleware, /requireTrustedOrigin/);
  assert.match(middleware, /requireRecentElevation/);
  assert.match(middleware, /ELEVATION_REQUIRED/);
  assert.match(middleware, /revokeSessionById/);
});

test('browser authentication never returns a raw session credential', () => {
  assert.match(browserAuth, /establishBrowserSession/);
  assert.match(browserAuth, /sessionEstablished:\s*true/);
  assert.match(browserAuth, /\/auth\/sessions/);
  assert.match(browserAuth, /\/auth\/security\/elevate/);
  assert.match(browserAuth, /\/auth\/sso\/exchange/);
  assert.match(browserAuth, /FOR UPDATE/);
  assert.doesNotMatch(browserAuth, /return res\.json\([^\n]*token/);
  assert.doesNotMatch(browserAuth, /Authorization:\s*Bearer/);
});

test('HRMS assertion uses issuer audience expiry and replay protection', () => {
  for (const contract of [
    'HRMS_ASSERTION_SECRET', 'HRMS_ASSERTION_ISSUER', 'HRMS_ASSERTION_AUDIENCE',
    'HRMS_ASSERTION_MAX_TTL_SECONDS', 'HRMS_ASSERTION_CLOCK_SKEW_SECONDS',
    'sso_replay_nonce', 'sso_handoff_code', 'jti', 'iat', 'exp',
  ]) assert.match(bridge, new RegExp(contract));
  assert.match(bridge, /createHmac\('sha256'/);
  assert.match(bridge, /timingSafeEqual/);
  assert.match(bridge, /HRMS_ASSERTION_REPLAYED/);
  assert.match(bridge, /BRIDGE_ALLOW_LEGACY_SECRET/);
  assert.doesNotMatch(bridge, /createSession/);
  assert.doesNotMatch(bridge, /lms_token\s*:/);
  assert.match(bridge, /Signed HRMS assertion required/);
  assert.doesNotMatch(bridge, /authMethod = 'LEGACY_BRIDGE'/);
});

test('password recovery revokes sessions without deleting security evidence', () => {
  assert.match(secureRecovery, /UPDATE portal_sessions/);
  assert.match(secureRecovery, /revoked_at/);
  assert.match(secureRecovery, /Password recovery completed/);
  assert.doesNotMatch(secureRecovery, /portalSession\.deleteMany/);
});

test('critical admin mutations require recent elevation', () => {
  assert.match(adminRoutes, /superElevatedAuth/);
  for (const pattern of [
    /router\.post\('\/portal-users', \.\.\.superElevatedAuth/,
    /router\.post\('\/process-lob', \.\.\.superElevatedAuth/,
    /router\.post\('\/notif-config', \.\.\.superElevatedAuth/,
    /router\.post\('\/comm-config', \.\.\.superElevatedAuth/,
    /router\.put\('\/hrms\/config', \.\.\.superElevatedAuth/,
  ]) assert.match(adminRoutes, pattern);
});

test('server mounts secure auth first and accepts cookie security headers', () => {
  assert.match(server, /validateSessionSecurityConfig\(process\.env\)/);
  assert.match(server, /X-LMS-Role/);
  assert.match(server, /X-CSRF-Token/);
  const secureIndex = server.indexOf("app.use('/api', browserAuthRoutes)");
  const legacyIndex = server.indexOf("app.use('/api/auth', authRoutes)");
  assert.ok(secureIndex >= 0 && legacyIndex > secureIndex);
});

test('frontend retains only harmless markers and sends cookies plus CSRF', () => {
  assert.match(api, /SESSION_MARKER = 'cookie-session-v2'/);
  assert.match(api, /credentials:\s*'include'/);
  assert.match(api, /X-LMS-Role/);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /sessionStorage/);
  assert.match(api, /refreshCsrfToken/);
  assert.doesNotMatch(api, /Authorization:\s*`Bearer/);
  assert.doesNotMatch(api, /localStorage\.setItem\([^\n]*_ignoredCredential/);
});

test('browser SSO consumes one-time code and rejects legacy token handoff', () => {
  assert.match(sso, /hrms_lms_code/);
  assert.match(sso, /Legacy token handoff is no longer accepted/);
  assert.match(sso, /window\.history\.replaceState/);
  assert.match(sso, /credentials:\s*'include'/);
  assert.match(sso, /auth\/sso\/exchange/);
  assert.doesNotMatch(sso, /localStorage\.setItem/);
});

test('session security workspace is routed and available to every portal role', () => {
  assert.match(app, /SessionSecurityPage/);
  assert.match(app, /path="\/session-security"/);
  assert.match(launcher, /Sessions & Security/);
  assert.match(launcher, /roles:\s*\['trainee', 'coordinator', 'admin'\]/);
  assert.match(sessionPage, /\/auth\/sessions/);
  assert.match(sessionPage, /revoke-others/);
  assert.match(sessionPage, /\/auth\/security\/elevate/);
  assert.match(sessionPage, /Recent security events/);
});

test('all deployment templates expose the secure browser session contract', () => {
  const required = [
    'SESSION_ABSOLUTE_TTL_SECONDS=', 'SESSION_TOUCH_INTERVAL_SECONDS=',
    'CSRF_SECRET=', 'SESSION_FINGERPRINT_SECRET=', 'SESSION_COOKIE_SAME_SITE=',
    'SESSION_COOKIE_SECURE=', 'LMS_ALLOW_BEARER_SESSION_COMPAT=false',
    'LMS_ALLOW_ORIGINLESS_AUTH=false', 'SECURITY_ELEVATION_MINUTES=',
    'HRMS_ASSERTION_SECRET=', 'HRMS_ASSERTION_ISSUER=', 'HRMS_ASSERTION_AUDIENCE=',
    'SSO_HANDOFF_TTL_SECONDS=', 'BRIDGE_ALLOW_LEGACY_SECRET=false',
  ];
  for (const path of ['backend/.env.example', 'deploy/.env.staging.example', 'deploy/.env.production.example']) {
    const text = read(path);
    for (const key of required) assert.ok(text.includes(key), `${path} missing ${key}`);
  }
});
