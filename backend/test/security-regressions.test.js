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

test('HRMS employee sync provisions LMS users and applies independent module rules', async () => {
  const controller = await source('src/controllers/hrmsSeed.js');
  const routes = await source('src/routes/admin.js');
  const server = await source('src/server.js');
  const config = await source('src/utils/hrmsConfig.js');
  const independentModules = await source('src/services/independentModules.js');

  assert.match(config, /employee:\s*{/);
  assert.match(config, /employeeId:\s*'employee_id'/);
  assert.match(routes, /router\.post\('\/hrms\/sync\/employees', \.\.\.superElevatedAuth, syncEmployees\)/);
  assert.match(controller, /export async function syncEmployees/);
  assert.match(controller, /dryRun/);
  assert.match(controller, /traineeMaster\.create/);
  assert.match(controller, /userMaster\.create/);
  assert.match(controller, /forcePasswordReset:\s*true/);
  assert.match(controller, /autoAssignModulesForNewUser/);
  assert.match(controller, /HRMS_EMPLOYEE_PROVISION/);
  assert.match(controller, /export async function provisionHrmsEmployees/);
  assert.match(server, /runHrmsEmployeeProvisioning/);
  assert.match(server, /HRMS_EMPLOYEE_SYNC_INTERVAL_MINUTES/);
  assert.match(independentModules, /scope_type = 'Designation'/);
  assert.match(independentModules, /assignedModule\.create/);
  assert.doesNotMatch(controller, /slice\(-4\)/);
  assert.doesNotMatch(controller, /1234/);
});

test('portal sessions are cookie-first and never accepted from URL query parameters', async () => {
  const middleware = await source('src/middleware/auth.js');
  const session = await source('src/utils/session.js');
  const bootstrap = await source('frontend/src/utils/ssoBootstrap.js', repoRoot);
  const api = await source('frontend/src/utils/api.js', repoRoot);
  assert.doesNotMatch(middleware, /req\.query\.token/);
  assert.match(session, /ROLE_COOKIE/);
  assert.match(session, /LMS_ALLOW_BEARER_SESSION_COMPAT/);
  assert.match(session, /mode:\s*'cookie'/);
  assert.match(bootstrap, /hrms_lms_code/);
  assert.match(bootstrap, /window\.location\.hash/);
  assert.doesNotMatch(bootstrap, /localStorage\.setItem\([^\n]*(?:code|token)/i);
  assert.doesNotMatch(api, /Authorization:\s*`Bearer/);
});

test('session tokens are fingerprinted before database storage', async () => {
  const text = await source('src/utils/session.js');
  assert.match(text, /hashSessionToken/);
  assert.match(text, /createHash\('sha256'\)/);
  assert.match(text, /INSERT INTO portal_sessions/);
  assert.match(text, /INSERT INTO portal_sessions[\s\S]*?hashSessionToken\(rawToken\)/);
  assert.doesNotMatch(text, /INSERT INTO portal_sessions[\s\S]{0,1200}?\n\s*rawToken,\n\s*String\(userId\)/);
});

test('HRMS bridge verifies signed assertions and issues only replay-safe handoff codes', async () => {
  const text = await source('src/controllers/bridgeController.js');
  assert.match(text, /HRMS_ASSERTION_SECRET/);
  assert.match(text, /timingSafeEqual/);
  assert.match(text, /sso_replay_nonce/);
  assert.match(text, /sso_handoff_code/);
  assert.match(text, /BRIDGE_ALLOW_PRIVILEGED/);
  assert.match(text, /BRIDGE_ALLOW_LEGACY_SECRET/);
  assert.doesNotMatch(text, /createSession/);
  assert.doesNotMatch(text, /lms_token\s*:/);
  assert.doesNotMatch(text, /mode:\s*'insensitive'/);
});

test('shared reports require explicit roles and super-admin summary access', async () => {
  const text = await source('src/routes/reports.js');
  assert.match(text, /requireRole\('admin', 'coordinator', 'management'\)/);
  assert.match(text, /requireSuperAdmin/);
  assert.doesNotMatch(text, /router\.get\('\/trainees\/export',\s*requireSession,\s*exportTraineesCsv/);
});

test('sensitive admin mutations require super-admin scope and recent elevation', async () => {
  const text = await source('src/routes/admin.js');
  assert.match(text, /const superAuth = \[requireSession, requireRole\('admin'\), requireSuperAdmin\]/);
  assert.match(text, /const superElevatedAuth = \[requireSession, requireRole\('admin'\), requireSuperAdmin, requireRecentElevation\]/);
  // Visibility and PIN/password reset are intentionally open to any Admin (parity with
  // Coordinators access) — only account creation/deletion/role-change/bulk-import stay
  // super-admin + elevation-gated.
  assert.match(text, /router\.get\('\/portal-users', \.\.\.auth/);
  assert.match(text, /router\.post\('\/portal-users\/:id\/reset-pin', \.\.\.auth/);
  assert.match(text, /router\.post\('\/portal-users', \.\.\.superElevatedAuth/);
  assert.match(text, /router\.put\('\/hrms\/config', \.\.\.superElevatedAuth/);
  assert.match(text, /router\.post\('\/comm-config', \.\.\.superElevatedAuth/);
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
  assert.match(controller, /UPDATE portal_sessions/);
  assert.match(controller, /revoked_at/);
  assert.doesNotMatch(controller, /portalSession\.deleteMany/);
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

// Credential policy changed deliberately: the random credential was only ever delivered
// over email/SMS, so 98 of 316 coordinator-onboarded trainees could never log in when
// delivery was not configured. Every creation path now derives the same predictable
// first-time password, still behind a forced reset at first login.
test('coordinator onboarding is scoped and issues a forced-reset first credential', async () => {
  const text = await source('src/routes/coordinatorStability.js');
  assert.match(text, /getOwnedBatch/);
  assert.match(text, /firstTimePassword\(mobile\)/);
  assert.doesNotMatch(text, /temporaryCredential/);
  assert.match(text, /forcePasswordReset: true/);
  assert.match(text, /credentialDelivered/);
  assert.match(text, /Maximum 500 trainees per bulk request/);
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

test('granular permissions use role grants, expiring user overrides and data scopes', async () => {
  const middleware = await source('src/middleware/permissions.js');
  const migration = await source('prisma/migrations/20260724110000_talent_and_permissions_foundation/migration.sql');
  assert.match(middleware, /user_permission_override/);
  assert.match(middleware, /expires_at IS NULL OR expires_at > UTC_TIMESTAMP\(3\)/);
  assert.match(middleware, /role_key IN \(\?, '\*'\)/);
  assert.match(middleware, /dataScope/);
  assert.match(middleware, /DATABASE_PERMISSION_PREFIXES/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS permission_master/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS role_permission/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_permission_override/);
  assert.match(migration, /access\.permissions\.manage/);
  assert.match(migration, /talent\.paths\.assign/);
});

test('skills and competency evidence are normalized and derived from LMS records', async () => {
  const service = await source('src/services/talent.js');
  const migration = await source('prisma/migrations/20260724110000_talent_and_permissions_foundation/migration.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS skill_master/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS role_skill_requirement/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS employee_skill_profile/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS skill_evidence/);
  assert.match(service, /content_skill_map/);
  assert.match(service, /assessment_skill_map/);
  assert.match(service, /completion_status = 'Completed'/);
  assert.match(service, /ar\.result = 'Pass'/);
  assert.match(service, /verifiedAndCurrent/);
  assert.match(service, /currentLevel >= targetLevel \? 'READY' : 'GAP'/);
});

test('learning paths are versioned, prerequisite-aware and evidence-backed', async () => {
  const service = await source('src/services/talent.js');
  const routes = await source('src/routes/talent.js');
  const migration = await source('prisma/migrations/20260724110000_talent_and_permissions_foundation/migration.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS learning_path_master/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS learning_path_step/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS learning_path_enrollment/);
  assert.match(migration, /uq_learning_path_code_version/);
  assert.match(service, /prerequisiteComplete/);
  assert.match(service, /CONTENT/);
  assert.match(service, /ASSESSMENT/);
  assert.match(service, /SKILL/);
  assert.match(routes, /\/admin\/paths\/:pathId\/publish/);
  assert.match(routes, /Add at least one step before publishing/);
  assert.match(routes, /Prerequisite must be an earlier step/);
});

test('talent APIs enforce role permission and owned-batch or branch scope', async () => {
  const routes = await source('src/routes/talent.js');
  const server = await source('src/server.js');
  assert.match(routes, /requirePermission\('access\.permissions\.manage'\)/);
  assert.match(routes, /requirePermission\('talent\.skills\.manage'\)/);
  assert.match(routes, /requirePermission\('talent\.paths\.assign'\)/);
  assert.match(routes, /branchAllowed/);
  assert.match(routes, /coordinatorLoginId: req\.userId/);
  assert.match(routes, /Maximum|slice\(0, 1000\)/);
  assert.match(server, /app\.use\('\/api\/talent', talentRoutes\)/);
});
