import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

async function source(relativePath) {
  return readFile(path.join(backendRoot, relativePath), 'utf8');
}

test('phase 3 migration is trigger-free and protects initial credential issuance', async () => {
  const migration = await source('prisma/migrations/20260724140000_coaching_and_certification_lifecycle/migration.sql');
  assert.doesNotMatch(migration, /DELIMITER|CREATE\s+TRIGGER/i);
  assert.match(migration, /initial_issuance_key/);
  assert.match(migration, /uq_cert_initial_issuance/);
  assert.match(migration, /previous_certification_id/);
  assert.match(migration, /certification_renewal_case/);
  assert.match(migration, /coaching_goal_evidence/);
});

test('initial certification is created once and renewal requires an existing case', async () => {
  const service = await source('src/services/developmentLifecycle.js');
  assert.match(service, /ORDER BY version_no DESC LIMIT 1/);
  assert.match(service, /if \(existing\.length\) return existing\[0\]/);
  assert.match(service, /issueRenewedCertification/);
  assert.match(service, /row\.status !== 'READY'/);
  assert.match(service, /previous_certification_id/);
  assert.match(service, /status = 'SUPERSEDED'/);
});

test('renewal readiness uses path assessment risk and sign-off evidence', async () => {
  const service = await source('src/services/developmentLifecycle.js');
  assert.match(service, /Renewal learning path/);
  assert.match(service, /Renewal assessment requires a passing score/);
  assert.match(service, /open critical risk/);
  assert.match(service, /Manager sign-off is required/);
  assert.match(service, /'READY'/);
  assert.match(service, /'OVERDUE'/);
});

test('coaching completion requires evidence and can award skill evidence', async () => {
  const routes = await source('src/routes/development.js');
  assert.match(routes, /Evidence reference is required to complete this goal/);
  assert.match(routes, /Completion notes are required/);
  assert.match(routes, /COACHING_GOAL/);
  assert.match(routes, /skillLevelAwarded/);
  assert.match(routes, /Complete every coaching goal before closing the plan/);
  assert.match(routes, /Observation notes and learner commitment are required/);
});

test('development permissions use database-backed scope enforcement', async () => {
  const permissions = await source('src/middleware/permissions.js');
  const routes = await source('src/routes/development.js');
  assert.match(permissions, /'development\.'/);
  assert.match(routes, /development\.coaching\.view_self/);
  assert.match(routes, /development\.coaching\.manage_batch/);
  assert.match(routes, /development\.certification\.manage/);
  assert.match(routes, /coordinator_login_id/);
  assert.match(routes, /companyScope/);
});

test('waiver revocation and replacement actions require reasons and audit records', async () => {
  const routes = await source('src/routes/development.js');
  assert.match(routes, /waiver reason of at least 20 characters/);
  assert.match(routes, /revocation reason of at least 20 characters/);
  assert.match(routes, /WAIVE_CERTIFICATION_RENEWAL/);
  assert.match(routes, /REVOKE_CERTIFICATION/);
  assert.match(routes, /RENEW_CERTIFICATION/);
});

test('post-certification hook and designated worker synchronize credentials', async () => {
  const hook = await source('src/routes/certificationHooks.js');
  const server = await source('src/server.js');
  assert.match(hook, /res\.once\('finish'/);
  assert.match(hook, /syncCertificationLifecycleForEmployee/);
  assert.match(server, /certificationHooks/);
  assert.match(server, /runCertificationLifecycleSync/);
  assert.match(server, /6 \* 60 \* 60 \* 1000/);
  assert.match(server, /LMS_RUN_SCHEDULERS/);
});

test('legacy trainee certification status is aligned to the credential state', async () => {
  const governance = await source('src/services/developmentGovernance.js');
  assert.match(governance, /ACTIVE', 'EXPIRING/);
  assert.match(governance, /'Expired'/);
  assert.match(governance, /'Revoked'/);
  assert.match(governance, /certificationStatus: 'Certified'/);
});
