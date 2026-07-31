import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

async function source(relativePath, root = backendRoot) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('self-service password changes use one strong policy', async () => {
  const policy = await source('src/utils/passwordPolicy.js');
  const routes = await source('src/routes/browserAuth.js');
  assert.match(policy, /at least 10 characters/);
  assert.match(policy, /lowercase letter/);
  assert.match(policy, /uppercase letter/);
  assert.match(policy, /include a number/);
  assert.match(policy, /special character/);
  assert.match(policy, /identityValues/);
  assert.match(routes, /validateStrongPassword/);
  assert.match(routes, /New password must be different/);
});

test('trainee and admin changes require current credentials revoke sessions and establish a fresh cookie session', async () => {
  const routes = await source('src/routes/browserAuth.js');
  assert.match(routes, /verifyPassword\(currentPassword/);
  assert.match(routes, /deleteAllSessions\(user\.employeeId, 'Password changed'\)/);
  assert.match(routes, /deleteAllSessions\(admin\.adminId, 'Password changed'\)/);
  assert.match(routes, /establishBrowserSession\(req, res, user\.employeeId, 'trainee'/);
  assert.match(routes, /establishBrowserSession\(req, res, admin\.adminId, 'admin'/);
  assert.match(routes, /PASSWORD_CHANGED/);
  assert.doesNotMatch(routes, /return res\.json\([^\n]*token/);
});

test('secure browser auth routes override legacy password handlers by route order', async () => {
  const server = await source('src/server.js');
  const browser = server.indexOf("app.use('/api', browserAuthRoutes)");
  const stable = server.indexOf("app.use('/api', passwordStabilityRoutes)");
  const auth = server.indexOf("app.use('/api/auth', authRoutes)");
  const admin = server.indexOf("app.use('/api/admin', adminRoutes)");
  assert.ok(browser >= 0, 'secure browser-auth router is not mounted');
  assert.ok(browser < stable, 'secure browser password routes must precede compatibility routes');
  assert.ok(stable < auth, 'profile and CSRF routes must precede legacy auth routes');
  assert.ok(stable < admin, 'profile and CSRF routes must precede legacy admin routes');
});

test('password forms keep only a harmless session marker after cookie rotation', async () => {
  const trainee = await source('frontend/src/pages/Trainee/PasswordResetBox.jsx', repoRoot);
  const admin = await source('frontend/src/pages/Admin/AdminConsole.jsx', repoRoot);
  const api = await source('frontend/src/utils/api.js', repoRoot);
  assert.match(trainee, /setToken\('trainee'/);
  assert.match(admin, /setToken\('admin'/);
  assert.match(api, /SESSION_MARKER = 'cookie-session-v2'/);
  assert.match(api, /credentials:\s*'include'/);
  assert.doesNotMatch(api, /Authorization:\s*`Bearer/);
  assert.match(trainee, /10 characters/);
  assert.match(admin, /passwordPolicyError/);
  assert.match(admin, /currentPassword/);
});

test('coordinator profile is restored from a valid cookie session', async () => {
  const page = await source('frontend/src/pages/Coordinator/CoordinatorPage.jsx', repoRoot);
  assert.match(page, /api\.get\('\/auth\/me', 'coordinator'\)/);
  assert.match(page, /setUser\(res\.user\)/);
  assert.match(page, /setToken\('coordinator'\)/);
  assert.match(page, /session === 'checking' \|\| loading/);
});
