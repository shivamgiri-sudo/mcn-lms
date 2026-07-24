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
  const routes = await source('src/routes/passwordStability.js');
  assert.match(policy, /at least 10 characters/);
  assert.match(policy, /lowercase letter/);
  assert.match(policy, /uppercase letter/);
  assert.match(policy, /include a number/);
  assert.match(policy, /special character/);
  assert.match(policy, /identityValues/);
  assert.match(routes, /validateStrongPassword/);
  assert.match(routes, /New password must be different/);
});

test('trainee and admin changes require current credentials and revoke sessions', async () => {
  const routes = await source('src/routes/passwordStability.js');
  assert.match(routes, /verifyPassword\(oldPassword/);
  assert.match(routes, /verifyPassword\(currentPassword/);
  assert.match(routes, /deleteAllSessions\(user\.employeeId\)/);
  assert.match(routes, /deleteAllSessions\(admin\.adminId\)/);
  assert.match(routes, /createSession\(user\.employeeId, 'trainee'\)/);
  assert.match(routes, /createSession\(admin\.adminId, 'admin'\)/);
  assert.match(routes, /CHANGE_PASSWORD/);
});

test('strong password routes override legacy handlers by route order', async () => {
  const server = await source('src/server.js');
  const stable = server.indexOf("app.use('/api', passwordStabilityRoutes)");
  const auth = server.indexOf("app.use('/api/auth', authRoutes)");
  const admin = server.indexOf("app.use('/api/admin', adminRoutes)");
  assert.ok(stable >= 0, 'strong password router is not mounted');
  assert.ok(stable < auth, 'strong trainee password route must precede legacy auth routes');
  assert.ok(stable < admin, 'strong admin password route must precede legacy admin routes');
});

test('password forms store the fresh replacement session token', async () => {
  const trainee = await source('frontend/src/pages/Trainee/PasswordResetBox.jsx', repoRoot);
  const admin = await source('frontend/src/pages/Admin/AdminConsole.jsx', repoRoot);
  assert.match(trainee, /setToken\('trainee', res\.token\)/);
  assert.match(admin, /setToken\('admin', res\.token\)/);
  assert.match(trainee, /10 characters/);
  assert.match(admin, /passwordPolicyError/);
  assert.match(admin, /currentPassword/);
});

test('coordinator profile is restored after a valid persisted session', async () => {
  const page = await source('frontend/src/pages/Coordinator/CoordinatorPage.jsx', repoRoot);
  assert.match(page, /setUser\(res\.user\)/);
  assert.match(page, /setLoading\(true\)/);
  assert.match(page, /if \(loading\)/);
});
