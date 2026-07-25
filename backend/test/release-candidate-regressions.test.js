import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const compose = read('deploy/docker-compose.staging.yml');
const entrypoint = read('deploy/scripts/container-entrypoint.sh');
const backup = read('deploy/scripts/backup.sh');
const restore = read('deploy/scripts/restore-rehearsal.sh');
const smoke = read('deploy/scripts/smoke-test.sh');
const release = read('deploy/scripts/release.sh');
const rollback = read('deploy/scripts/rollback.sh');
const runbook = read('docs/RELEASE_CANDIDATE_RUNBOOK.md');
const envExample = read('deploy/.env.staging.example');
const migrations = read('deploy/migrations.expected').trim().split('\n');
const manifest = JSON.parse(read('deploy/release-manifest.example.json'));

test('release image is immutable multi-stage and non-root', () => {
  assert.match(dockerfile, /FROM node:20-bookworm-slim AS frontend-build/);
  assert.match(dockerfile, /FROM node:20-bookworm-slim AS backend-build/);
  assert.match(dockerfile, /FROM node:20-bookworm-slim AS runtime/);
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
  for (const name of ['DATABASE_URL', 'FRONTEND_URL', 'SESSION_SECRET', 'OAUTH_STATE_SECRET', 'BRIDGE_SECRET', 'HR_API_KEY', 'GOOGLE_TOKEN_ENCRYPTION_KEY']) {
    assert.match(entrypoint, new RegExp(name));
  }
  assert.match(entrypoint, /LMS_RUN_MIGRATIONS/);
  assert.match(entrypoint, /prisma migrate deploy/);
  assert.match(entrypoint, /exec "\$@"/);
  assert.doesNotMatch(entrypoint, /\beval\b/);
});

test('staging topology separates database migration web and worker responsibilities', () => {
  for (const service of ['mysql:', 'migrate:', 'app:', 'worker:']) assert.match(compose, new RegExp(`^  ${service}`, 'm'));
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /LMS_INSTANCE_ROLE: WEB/);
  assert.match(compose, /LMS_INSTANCE_ROLE: WORKER/);
  assert.match(compose, /LMS_RUN_SCHEDULERS: "true"/);
  assert.match(compose, /platform\/health\/ready|runtime\/health\/ready/);
  assert.doesNotMatch(compose, /CHANGE_ME/);
});

test('backup and restore rehearsal are non-destructive and checksum verified', () => {
  assert.match(backup, /--single-transaction/);
  assert.match(backup, /--routines --triggers --events/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /gzip -t/);
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

test('release and rollback scripts preserve forward-only database policy', () => {
  assert.match(release, /backup\.sh/);
  assert.match(release, /run --rm migrate/);
  assert.match(release, /smoke-test\.sh/);
  assert.match(release, /PREVIOUS_IMAGE/);
  assert.match(rollback, /ALLOW_APPLICATION_ROLLBACK/);
  assert.match(rollback, /MIGRATION_COMPATIBILITY/);
  assert.match(rollback, /backward-compatible/);
  assert.match(rollback, /Database migrations remain forward-only/);
  assert.doesNotMatch(rollback, /migrate.*down|DROP TABLE|DROP DATABASE/);
});

test('release manifest and migration chain are machine readable and complete', () => {
  assert.equal(manifest.migrationCount, 15);
  assert.equal(migrations.length, 15);
  assert.equal(migrations[0], '20260630053213_init');
  assert.equal(migrations.at(-1), '20260725150000_production_runtime_governance');
  assert.equal(manifest.databaseRollbackSupported, false);
  assert.equal(manifest.applicationRollbackSupported, true);
  assert.equal(manifest.healthEndpoints.liveness, '/api/runtime/health/live');
  assert.equal(manifest.healthEndpoints.readiness, '/api/runtime/health/ready');
  assert.deepEqual(manifest.rollout.map(item => item.percentage), [100, 10, 25, 50, 100]);
  assert.ok(manifest.requiredEnvironment.includes('DEPLOYMENT_ID'));
  assert.match(envExample, /LMS_READINESS_BACKLOG_LIMIT/);
  assert.doesNotMatch(envExample, /LMS_READINESS_BACKLOG_THRESHOLD/);
});

test('runbook fixes stack order and blocks destructive database rollback', () => {
  for (let pr = 4; pr <= 12; pr += 1) assert.match(runbook, new RegExp(`PR #${pr}`));
  assert.match(runbook, /Do not squash or reorder database migrations/);
  assert.match(runbook, /Database migrations are never automatically reversed/);
  assert.match(runbook, /feature flags and kill switches/);
  assert.match(runbook, /10% deterministic user rollout/);
});
