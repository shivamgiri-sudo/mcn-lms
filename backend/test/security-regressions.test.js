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

test('HRMS connector contains no embedded credentials or internal defaults', async () => {
  const text = await source('src/utils/hrmsDb.js');
  assert.doesNotMatch(text, /192\.168\./);
  assert.doesNotMatch(text, /qwersdfg/i);
  assert.doesNotMatch(text, /shivam_user/i);
  assert.match(text, /Missing required HRMS configuration/);
});

test('portal sessions are never accepted from URL query parameters', async () => {
  const text = await source('src/middleware/auth.js');
  const bootstrap = await source('frontend/src/utils/ssoBootstrap.js', repoRoot);
  assert.doesNotMatch(text, /req\.query\.token/);
  assert.match(text, /startsWith\('Bearer '\)/);
  assert.doesNotMatch(bootstrap, /window\.location\.search[\s\S]*hrms_lms_token/);
  assert.match(bootstrap, /window\.location\.hash/);
});

test('session tokens are fingerprinted before database storage', async () => {
  const text = await source('src/utils/session.js');
  assert.match(text, /hashSessionToken/);
  assert.match(text, /createHash\('sha256'\)/);
  assert.match(text, /token:\s*hashSessionToken\(token\)/);
  assert.doesNotMatch(text, /data:\s*\{\s*token,\s*userId/);
});

test('HRMS bridge fails closed when its secret is missing', async () => {
  const text = await source('src/controllers/bridgeController.js');
  assert.match(text, /HRMS SSO is not configured/);
  assert.match(text, /timingSafeEqual/);
  assert.match(text, /BRIDGE_ALLOW_PRIVILEGED/);
  assert.doesNotMatch(text, /mode:\s*'insensitive'/);
});

test('shared reports require explicit roles and super-admin summary access', async () => {
  const text = await source('src/routes/reports.js');
  assert.match(text, /requireRole\('admin', 'coordinator', 'management'\)/);
  assert.match(text, /requireSuperAdmin/);
  assert.doesNotMatch(text, /router\.get\('\/trainees\/export',\s*requireSession,\s*exportTraineesCsv/);
});

test('sensitive admin APIs use a server-side super-admin guard', async () => {
  const text = await source('src/routes/admin.js');
  assert.match(text, /const superAuth = \[requireSession, requireRole\('admin'\), requireSuperAdmin\]/);
  assert.match(text, /router\.get\('\/portal-users', \.\.\.superAuth/);
  assert.match(text, /router\.get\('\/hrms\/config', \.\.\.superAuth/);
  assert.match(text, /router\.get\('\/comm-config', \.\.\.superAuth/);
  assert.match(text, /router\.get\('\/audit-logs', \.\.\.superAuth/);
});

test('password recovery uses hashed single-use tokens with expiry and session revocation', async () => {
  const routes = await source('src/routes/auth.js');
  const controller = await source('src/controllers/secureRecovery.js');
  const migration = await source('prisma/migrations/20260724090000_secure_password_recovery/migration.sql');
  const resetPage = await source('frontend/src/pages/Auth/PasswordResetPage.jsx', repoRoot);

  assert.match(routes, /completePasswordRecovery/);
  assert.match(routes, /\/recovery\/complete/);
  assert.match(controller, /randomBytes\(32\)/);
  assert.match(controller, /tokenHash = sha256/);
  assert.match(controller, /expires_at > NOW\(3\)/);
  assert.match(controller, /used_at = NOW\(3\)/);
  assert.match(controller, /portalSession\.deleteMany/);
  assert.match(controller, /PASSWORD_RECOVERY_COMPLETED/);
  assert.match(migration, /CREATE TABLE `password_reset_tokens`/);
  assert.match(migration, /UNIQUE INDEX `password_reset_tokens_token_hash_key`/);
  assert.match(resetPage, /window\.history\.replaceState/);
  assert.match(resetPage, /auth\/recovery\/complete/);
  assert.doesNotMatch(controller, /tempPassword/);
});

test('insecure legacy password mutation handlers are not mounted', async () => {
  const text = await source('src/routes/auth.js');
  assert.match(text, /requestTraineeRecovery/);
  assert.match(text, /requestAdminRecovery/);
  assert.match(text, /requestCoordinatorRecovery/);
  assert.doesNotMatch(text, /traineeForgotPassword/);
  assert.doesNotMatch(text, /adminForgotPassword/);
});

test('coordinator onboarding is scoped and uses random forced-reset credentials', async () => {
  const text = await source('src/routes/coordinatorStability.js');
  assert.match(text, /getOwnedBatch/);
  assert.match(text, /temporaryCredential/);
  assert.match(text, /randomBytes\(12\)/);
  assert.match(text, /forcePasswordReset: true/);
  assert.match(text, /credentialDelivered/);
  assert.match(text, /Maximum 500 trainees per bulk request/);
  assert.doesNotMatch(text, /slice\(-4\)/);
  assert.doesNotMatch(text, /or 1234 if no mobile/);
});

test('login pages do not publish or recommend predictable credentials', async () => {
  const management = await source('frontend/src/pages/Management/MgmtLogin.jsx', repoRoot);
  const admin = await source('frontend/src/pages/Admin/AdminLogin.jsx', repoRoot);
  const trainee = await source('frontend/src/pages/Trainee/LoginView.jsx', repoRoot);
  assert.doesNotMatch(management, /ceo123/i);
  assert.doesNotMatch(management, /Demo:\s*/);
  assert.doesNotMatch(admin, /admin1234/i);
  assert.doesNotMatch(admin, /Temporary Password:/i);
  assert.doesNotMatch(trainee, /last 4 digits/i);
  assert.match(trainee, /one-time credential/i);
});

test('uploads require matching extension and MIME and reject generic octet streams', async () => {
  const text = await source('src/utils/upload.js');
  assert.match(text, /MIME_BY_EXTENSION/);
  assert.match(text, /hasMatchingType/);
  assert.doesNotMatch(text, /application\/octet-stream/);
});

test('seed is disabled by default and never embeds known passwords', async () => {
  const text = await source('prisma/seed.js');
  assert.match(text, /LMS_ALLOW_DEMO_SEED/);
  assert.match(text, /NODE_ENV === 'production'/);
  assert.doesNotMatch(text, /admin1234/);
  assert.doesNotMatch(text, /pin:\s*'1234'/);
});

test('certification and handover routes enforce lifecycle gates', async () => {
  const text = await source('src/routes/coordinatorStability.js');
  assert.match(text, /evaluateCertification/);
  assert.match(text, /Trainee does not meet certification requirements/);
  assert.match(text, /Only certified trainees can be handed over to operations/);
});

test('learner content and assessments require classroom assignment', async () => {
  const text = await source('src/routes/traineeStability.js');
  assert.match(text, /hasClassroomAccess/);
  assert.match(text, /This content is not assigned to your classroom/);
  assert.match(text, /This assessment is not assigned to your classroom/);
  assert.match(text, /acceptedElapsedDelta/);
  assert.match(text, /No active assessment attempt found/);
  assert.match(text, /This attempt was already submitted/);
  assert.doesNotMatch(text, /completedExplicitly \? 100/);
});

test('attendance requires a verified activity threshold', async () => {
  const text = await source('src/routes/traineeStability.js');
  assert.match(text, /LMS_ATTENDANCE_MIN_ACTIVITY_SECONDS/);
  assert.match(text, /LMS Verified Activity/);
  assert.match(text, /LMS Activity Pending Threshold/);
});

test('SCORM requires isolated content origin and validates archives', async () => {
  const controller = await source('src/controllers/scorm.js');
  const server = await source('src/server.js');
  assert.match(controller, /SCORM_CONTENT_ORIGIN/);
  assert.match(controller, /validateAndExtract/);
  assert.match(controller, /SCORM archive contains an unsafe path/);
  assert.match(controller, /employeeId_contentId/);
  assert.match(controller, /This SCORM package is not assigned to you/);
  assert.doesNotMatch(server, /app\.use\('\/uploads',\s*express\.static/);
});

test('Google Drive OAuth and proxy are protected', async () => {
  const controller = await source('src/controllers/drive.js');
  const service = await source('src/services/drive.js');
  assert.match(controller, /signState/);
  assert.match(controller, /verifyState/);
  assert.match(controller, /This file is not assigned to your LMS scope/);
  assert.match(service, /aes-256-gcm/);
  assert.match(service, /GOOGLE_TOKEN_ENCRYPTION_KEY/);
});

test('server separates liveness, readiness, and designated worker execution', async () => {
  const text = await source('src/server.js');
  assert.match(text, /\/api\/health\/live/);
  assert.match(text, /\/api\/health\/ready/);
  assert.match(text, /LMS_RUN_SCHEDULERS/);
  assert.match(text, /startBackgroundWork/);
});
