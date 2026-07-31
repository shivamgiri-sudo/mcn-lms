import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260725150000_production_runtime_governance/migration.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/runtimeGovernance.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/runtimeGovernance.js', import.meta.url), 'utf8');
const featureGate = readFileSync(new URL('../src/middleware/runtimeFeatureGate.js', import.meta.url), 'utf8');
const notificationRuntime = readFileSync(new URL('../src/middleware/notificationRuntime.js', import.meta.url), 'utf8');
const calibrationRuntime = readFileSync(new URL('../src/middleware/calibrationRuntime.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');
const adminConsole = readFileSync(new URL('../../frontend/src/pages/Admin/AdminConsole.jsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../frontend/src/pages/Admin/RuntimeOperationsTab.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/Admin/runtimeOperations.css', import.meta.url), 'utf8');

const tables = ['platform_runtime_lease', 'platform_runtime_instance', 'platform_feature_flag'];

test('Phase 10 migration defines leases instances and feature rollout controls', () => {
  for (const table of tables) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(migration, /uq_platform_feature_scope/);
  assert.match(migration, /chk_platform_runtime_lease_generation/);
  assert.match(migration, /chk_platform_runtime_instance_status/);
  assert.match(migration, /chk_platform_feature_scope_value/);
  assert.match(migration, /chk_platform_feature_rollout/);
  assert.match(migration, /chk_platform_feature_window/);
});

test('runtime permissions and default non-breaking feature flags are seeded', () => {
  assert.match(migration, /'runtime\.view'/);
  assert.match(migration, /'runtime\.manage'/);
  assert.match(migration, /'admin', '\*', 'runtime\.manage', 1, 'branch'/);
  assert.match(migration, /'Super Admin', 'runtime\.manage', 1, 'company'/);
  assert.match(migration, /'evaluator_quality'.*'GLOBAL'.*1, 0, 100\.00/s);
  assert.match(migration, /'calibration_appeals'.*'GLOBAL'.*1, 0, 100\.00/s);
});

test('distributed lease acquisition is transactional owner-aware and generation controlled', () => {
  assert.match(service, /INSERT IGNORE INTO platform_runtime_lease/);
  assert.match(service, /LIMIT 1 FOR UPDATE/);
  assert.match(service, /current\.ownerId !== owner && !expired/);
  assert.match(service, /generation = current\.ownerId === owner/);
  assert.match(service, /lease_until = DATE_ADD\(UTC_TIMESTAMP\(3\), INTERVAL \$\{ttl\} SECOND\)/);
  assert.match(service, /WHERE lease_key = \? AND owner_id = \?/);
  assert.match(service, /withRuntimeLease/);
});

test('notification and calibration cycles use distinct distributed leases', () => {
  assert.match(notificationRuntime, /withRuntimeLease/);
  assert.match(notificationRuntime, /notification-campaign-cycle/);
  assert.match(notificationRuntime, /ttlSeconds: 300/);
  assert.match(calibrationRuntime, /withRuntimeLease/);
  assert.match(calibrationRuntime, /calibration-governance-cycle/);
  assert.match(calibrationRuntime, /ttlSeconds: 3600/);
});

test('feature evaluation gives kill switches precedence and deterministic scoped rollout', () => {
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /deterministicBucket/);
  assert.match(service, /ORDER BY kill_switch DESC/);
  assert.match(service, /FIELD\(scope_type,'USER','LOB','PROCESS','BRANCH','GLOBAL'\)/);
  assert.match(service, /const kill = rows\.find/);
  assert.match(service, /reason: 'KILL_SWITCH'/);
  assert.match(service, /bucket < Number\(flag\.rolloutPercentage \|\| 0\)/);
});

test('branch rollout management is restricted while company scope retains emergency controls', () => {
  assert.match(routes, /Branch administrators may only manage rollout controls for their own branch/);
  assert.match(routes, /String\(req\.body\?\.scopeType \|\| ''\)\.toUpperCase\(\) !== 'BRANCH'/);
  assert.match(routes, /Lease intervention requires company scope/);
  assert.match(routes, /Provide an intervention reason of at least 20 characters/);
  assert.match(routes, /requirePermission\('runtime\.manage'\)/);
});

test('runtime health exposes minimal public data and protected detailed operations', () => {
  assert.match(routes, /\/runtime\/health\/live/);
  assert.match(routes, /\/runtime\/health\/ready/);
  assert.match(routes, /getRuntimeReadiness\(\{ includeDetails: false \}\)/);
  assert.match(routes, /\/runtime\/admin\/dashboard/);
  assert.match(routes, /requirePermission\('runtime\.view'\)/);
  assert.match(service, /database: \{ ok: false \}/);
  assert.match(service, /schema: \{ ok: false \}/);
  assert.match(service, /uploadStorage: \{ ok: false \}/);
  assert.match(service, /notificationBacklog: \{ ok: false \}/);
  assert.match(service, /runtimeInstances: \{ ok: false \}/);
  assert.match(service, /LMS_READINESS_BACKLOG_LIMIT/);
});

test('calibration APIs enforce feature decisions but public certificate verification remains available', () => {
  assert.match(featureGate, /evaluator_quality/);
  assert.match(featureGate, /calibration_appeals/);
  assert.match(featureGate, /FEATURE_UNAVAILABLE/);
  assert.match(featureGate, /FEATURE_DECISION_FAILED/);
  assert.match(featureGate, /\^\\\/certificates\\\/verify\\\//);
  const gateMount = integration.indexOf("router.use('/calibration', calibrationFeatureGate)");
  const appealMount = integration.indexOf("router.use('/calibration', calibrationAppealRoutes)");
  assert.ok(gateMount > 0 && appealMount > gateMount);
});

test('runtime heartbeats are mounted before recurring request fallbacks', () => {
  const heartbeat = integration.indexOf('router.use(runtimeHeartbeatMiddleware)');
  const notifications = integration.indexOf('router.use(notificationRuntime)');
  const calibration = integration.indexOf('router.use(calibrationRuntime)');
  assert.ok(heartbeat > 0);
  assert.ok(notifications > heartbeat);
  assert.ok(calibration > notifications);
  assert.match(service, /last_seen_at = UTC_TIMESTAMP\(3\)/);
  assert.match(service, /last_seen_at >= DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 5 MINUTE\)/);
});

test('Super Admin console exposes readiness leases instances backlog and rollout controls', () => {
  assert.match(adminConsole, /RuntimeOperationsTab/);
  assert.match(adminConsole, /Runtime & Rollout/);
  assert.match(adminConsole, /runtime-operations/);
  assert.match(panel, /Runtime & Release Operations/);
  assert.match(panel, /Distributed worker leases/);
  assert.match(panel, /Runtime instances/);
  assert.match(panel, /Operational backlog/);
  assert.match(panel, /Feature rollout register/);
  assert.match(panel, /Kill switch/);
  assert.match(styles, /@media\(max-width:720px\)/);
});
