import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const stagingCompose = read('deploy/docker-compose.staging.yml');
const productionCompose = read('deploy/docker-compose.production.yml');
const entrypoint = read('deploy/scripts/container-entrypoint.sh');
const backup = read('deploy/scripts/backup.sh');
const restore = read('deploy/scripts/restore-rehearsal.sh');
const smoke = read('deploy/scripts/smoke-test.sh');
const loadSmoke = read('deploy/scripts/load-smoke.mjs');
const release = read('deploy/scripts/release.sh');
const rollback = read('deploy/scripts/rollback.sh');
const runbook = read('docs/RELEASE_CANDIDATE_RUNBOOK.md');
const stagingEnv = read('deploy/.env.staging.example');
const productionEnv = read('deploy/.env.production.example');
const migrations = read('deploy/migrations.expected').trim().split(/\r?\n/);
const manifest = JSON.parse(read('deploy/release-manifest.example.json'));

test('release image is immutable multi-stage and non-root', () => {
  assert.match(dockerfile, /FROM node:25-bookworm-slim AS frontend-build/);
  assert.match(dockerfile, /FROM node:25-bookworm-slim AS backend-build/);
  assert.match(dockerfile, /FROM node:25-bookworm-slim AS runtime/);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /prisma generate/);
  assert.match(dockerfile, /COPY --chown=lms:lms --from=frontend-build/);
  assert.match(dockerfile, /USER lms/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.doesNotMatch(dockerfile, /node:latest|npm install\b/);
  assert.match(dockerignore, /\*\*\/\.env/);
  assert.match(dockerignore, /backend\/uploads/);
});

test('container entrypoint fails fast and migrations are explicit', () => {
  for (const name of [
    'DATABASE_URL', 'FRONTEND_URL', 'SESSION_SECRET', 'CSRF_SECRET',
    'SESSION_FINGERPRINT_SECRET', 'OAUTH_STATE_SECRET', 'HRMS_ASSERTION_SECRET',
    'HRMS_ASSERTION_ISSUER', 'HRMS_ASSERTION_AUDIENCE', 'HR_API_KEY',
    'GOOGLE_TOKEN_ENCRYPTION_KEY',
  ]) {
    assert.match(entrypoint, new RegExp(name));
  }
  assert.match(entrypoint, /BRIDGE_ALLOW_LEGACY_SECRET/);
  assert.match(entrypoint, /LMS_RUN_MIGRATIONS/);
  assert.match(entrypoint, /prisma migrate deploy/);
  assert.match(entrypoint, /exec "\$@"/);
  assert.doesNotMatch(entrypoint, /\beval\b/);
});

test('staging topology separates database migration web and worker responsibilities', () => {
  for (const service of ['mysql:', 'migrate:', 'app:', 'worker:']) assert.match(stagingCompose, new RegExp(`^  ${service}`, 'm'));
  assert.match(stagingCompose, /condition: service_completed_successfully/);
  assert.match(stagingCompose, /LMS_INSTANCE_ROLE: WEB/);
  assert.match(stagingCompose, /LMS_INSTANCE_ROLE: WORKER/);
  assert.match(stagingCompose, /LMS_RUN_SCHEDULERS: "true"/);
  assert.match(stagingCompose, /LMS_SERVICE_ENV_FILE/);
  assert.match(stagingCompose, /platform\/health\/ready|runtime\/health\/ready/);
  assert.doesNotMatch(stagingCompose, /CHANGE_ME/);
});

test('production topology uses external database and hardened least privilege containers', () => {
  for (const service of ['migrate:', 'app:', 'worker:']) assert.match(productionCompose, new RegExp(`^  ${service}`, 'm'));
  assert.doesNotMatch(productionCompose, /^  mysql:/m);
  assert.match(productionCompose, /read_only: true/g);
  assert.match(productionCompose, /no-new-privileges:true/g);
  assert.match(productionCompose, /cap_drop:[\s\S]*- ALL/);
  assert.match(productionCompose, /127\.0\.0\.1:\$\{LMS_HTTP_PORT:-4000\}:4000/);
  assert.match(productionCompose, /DRIVE_TOKEN_FILE: runtime\/drive-token\.enc/);
  assert.match(productionCompose, /runtime_data:\/app\/backend\/runtime/);
  assert.match(productionCompose, /condition: service_healthy/);
  assert.doesNotMatch(productionCompose, /CHANGE_ME|latest/);
});

test('backup and restore rehearsal are non-destructive checksum verified and remote capable', () => {
  assert.match(backup, /--single-transaction/);
  assert.match(backup, /--routines --triggers --events/);
  assert.match(backup, /--hex-blob/);
  assert.match(backup, /LMS_BACKUP_MODE/);
  assert.match(backup, /MYSQL_BACKUP_SSL_MODE/);
  assert.match(backup, /mysql-backup\.cnf/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /gzip -t/);
  assert.doesNotMatch(backup, /MYSQL_BACKUP_PASSWORD.*docker run/);
  assert.match(restore, /lms_restore_/);
  assert.match(restore, /trap cleanup EXIT/);
  assert.match(restore, /DROP DATABASE IF EXISTS/);
  assert.match(restore, /sha256sum --check/);
  assert.match(restore, /CHECK TABLE/);
  assert.doesNotMatch(restore, /DROP DATABASE.*MYSQL_DATABASE/);
});

test('smoke gate verifies readiness security headers and authorization boundaries', () => {
  assert.match(smoke, /runtime\/health\/live/);
  assert.match(smoke, /runtime\/health\/ready/);
  assert.match(smoke, /api\/auth\/me/);
  assert.match(smoke, /runtime\/admin\/dashboard/);
  assert.match(smoke, /unauth_status.*401/s);
  assert.match(smoke, /x-content-type-options: nosniff/i);
  assert.match(smoke, /x-request-id/);
});

test('bounded load smoke enforces error rate latency timeout and concurrency limits', () => {
  assert.match(loadSmoke, /LOAD_CONCURRENCY/);
  assert.match(loadSmoke, /LOAD_REQUESTS/);
  assert.match(loadSmoke, /LOAD_P95_LIMIT_MS/);
  assert.match(loadSmoke, /LOAD_MAX_ERROR_PCT/);
  assert.match(loadSmoke, /LOAD_REQUEST_TIMEOUT_MS/);
  assert.match(loadSmoke, /p95Ms/);
  assert.match(loadSmoke, /process\.exit\(1\)/);
  assert.match(loadSmoke, /Math\.min\(200/);
});

test('release and rollback scripts preserve environment and forward-only database policy', () => {
  assert.match(release, /source "\$ENV_FILE"/);
  assert.match(release, /LMS_SERVICE_ENV_FILE/);
  assert.match(release, /LMS_RELEASE_BASE_URL/);
  assert.match(release, /backup\.sh/);
  assert.match(release, /run --rm migrate/);
  assert.match(release, /smoke-test\.sh/);
  assert.match(release, /load-smoke\.mjs/);
  assert.match(release, /PREVIOUS_IMAGE/);
  assert.match(rollback, /source "\$ENV_FILE"/);
  assert.match(rollback, /ALLOW_APPLICATION_ROLLBACK/);
  assert.match(rollback, /MIGRATION_COMPATIBILITY/);
  assert.match(rollback, /backward-compatible/);
  assert.match(rollback, /LMS_RELEASE_BASE_URL/);
  assert.match(rollback, /Database migrations remain forward-only/);
  assert.doesNotMatch(rollback, /migrate.*down|DROP TABLE|DROP DATABASE/);
});

test('release manifests and environment contracts are machine readable and complete', () => {
  assert.equal(manifest.migrationCount, 26);
  assert.equal(migrations.length, 26);
  assert.equal(migrations[0], '20260630053213_init');
  assert.equal(migrations.at(-1), '20260821090000_standalone_assessments');
  assert.equal(manifest.databaseRollbackSupported, false);
  assert.equal(manifest.applicationRollbackSupported, true);
  assert.equal(manifest.healthEndpoints.liveness, '/api/runtime/health/live');
  assert.equal(manifest.healthEndpoints.readiness, '/api/runtime/health/ready');
  assert.deepEqual(manifest.rollout.map(item => item.percentage), [100, 10, 25, 50, 100]);
  for (const name of ['DEPLOYMENT_ID', 'CSRF_SECRET', 'SESSION_FINGERPRINT_SECRET', 'HRMS_ASSERTION_SECRET', 'HRMS_ASSERTION_ISSUER', 'HRMS_ASSERTION_AUDIENCE']) {
    assert.ok(manifest.requiredEnvironment.includes(name));
  }
  assert.match(stagingEnv, /LMS_SERVICE_ENV_FILE=\.env\.staging/);
  assert.match(stagingEnv, /LMS_BACKUP_MODE=compose/);
  assert.match(productionEnv, /LMS_SERVICE_ENV_FILE=\.env\.production/);
  assert.match(productionEnv, /LMS_BACKUP_MODE=remote/);
  assert.match(productionEnv, /MYSQL_BACKUP_SSL_MODE=REQUIRED/);
  assert.match(productionEnv, /ALLOW_APPLICATION_ROLLBACK=false/);
  assert.match(productionEnv, /LMS_RUN_LOAD_SMOKE=true/);
  assert.match(stagingEnv, /LMS_READINESS_BACKLOG_LIMIT/);
  assert.doesNotMatch(`${stagingEnv}\n${productionEnv}`, /LMS_READINESS_BACKLOG_THRESHOLD/);
});

test('runbook fixes stack order and blocks destructive database rollback', () => {
  for (let pr = 4; pr <= 12; pr += 1) assert.match(runbook, new RegExp(`PR #${pr}`));
  assert.match(runbook, /17 migrations/);
  assert.match(runbook, /Do not squash or reorder database migrations/);
  assert.match(runbook, /Database migrations are never automatically reversed/);
  assert.match(runbook, /feature flags and kill switches/);
  assert.match(runbook, /10% deterministic user rollout/);
  assert.match(runbook, /LOAD_CONCURRENCY=25/);
});
