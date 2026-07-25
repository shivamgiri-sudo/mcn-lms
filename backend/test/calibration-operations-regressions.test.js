import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260725090000_evaluator_quality_operations/migration.sql', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../src/services/calibrationOperations.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/calibrationOperations.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/middleware/calibrationRuntime.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorQualityPage.jsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorOperationsPanel.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/evaluatorOperations.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const operationTables = [
  'evaluator_authorization_certificate',
  'evaluator_calibration_anchor_evidence',
  'evaluator_reliability_cohort_snapshot',
];

const eventTypes = [
  'CALIBRATION_ASSIGNED',
  'CALIBRATION_DUE_REMINDER',
  'CALIBRATION_OVERDUE',
  'EVALUATOR_AUTHORIZATION_EXPIRING',
  'EVALUATOR_AUTHORIZATION_EXPIRED',
  'EVALUATOR_RELIABILITY_WATCH',
  'EVALUATOR_RECALIBRATION_REQUIRED',
  'EVALUATOR_CERTIFICATE_ISSUED',
];

test('Phase 8 migration defines credentials evidence and cohort snapshots', () => {
  for (const table of operationTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /uq_evaluator_certificate_authorization/);
  assert.match(migration, /uq_calibration_anchor_evidence_version/);
  assert.match(migration, /uq_evaluator_cohort_period/);
  assert.match(migration, /chk_calibration_anchor_evidence_source/);
  assert.match(migration, /chk_evaluator_certificate_validity/);
  assert.match(migration, /chk_evaluator_cohort_agreement/);
});

test('all evaluator-quality lifecycle events have in-app and email templates', () => {
  for (const eventType of eventTypes) {
    const matches = migration.match(new RegExp(`'${eventType}'`, 'g')) || [];
    assert.equal(matches.length, 2, `${eventType} should have exactly IN_APP and EMAIL templates`);
  }
  assert.match(migration, /\/evaluator-quality\?role=\{\{recipientType\}\}/);
});

test('certificate issuance is deterministic idempotent and preserves authorization state', () => {
  assert.match(operations, /createHash\('sha256'\)/);
  assert.match(operations, /MCN-EVAL-/);
  assert.match(operations, /ON DUPLICATE KEY UPDATE/);
  assert.match(operations, /authorization_id = \?/);
  assert.match(operations, /certificateStatus\(row\)/);
  assert.match(operations, /EVALUATOR_CERTIFICATE_ISSUED/);
  assert.match(operations, /evaluator-certificate-issued:\$\{certificateId\}/);
});

test('calibration campaigns use deterministic due expiry and reliability keys', () => {
  assert.match(operations, /\[3, 1, 0\]\.includes\(daysRemaining\)/);
  assert.match(operations, /\[-1, -3, -7, -14, -30\]\.includes\(daysRemaining\)/);
  assert.match(operations, /\[30, 14, 7, 3, 1, 0\]\.includes\(daysRemaining\)/);
  assert.match(operations, /calibration-assigned:\$\{row\.assignmentId\}/);
  assert.match(operations, /evaluator-authorization-expiring:/);
  assert.match(operations, /evaluator-reliability:\$\{row\.snapshotId\}/);
});

test('cohort benchmarking covers company branch process and LOB with stable IDs', () => {
  for (const scope of ['COMPANY', 'BRANCH', 'PROCESS', 'LOB']) {
    assert.match(operations, new RegExp(scope));
  }
  assert.match(operations, /SELECT cohort_snapshot_id AS cohortSnapshotId/);
  assert.match(operations, /existing\[0\]\?\.cohortSnapshotId \|\| randomUUID\(\)/);
  assert.match(operations, /AVG\(ABS\(s\.severity_index\)\)/);
  assert.match(operations, /recalibration_required_count/);
});

test('public certificate verification is minimal and omits direct account identifiers', () => {
  const publicStart = routes.indexOf("router.get('/certificates/verify/:certificateCode'");
  const publicEnd = routes.indexOf("router.get('/coordinator/operations'", publicStart);
  const publicRoute = routes.slice(publicStart, publicEnd);
  assert.ok(publicStart > 0 && publicEnd > publicStart);
  assert.match(publicRoute, /evaluatorName/);
  assert.match(publicRoute, /verificationHash/);
  assert.doesNotMatch(publicRoute, /evaluatorId:/);
  assert.doesNotMatch(publicRoute, /email/);
  assert.doesNotMatch(publicRoute, /mobile/);
});

test('governed evidence enforces scope lifecycle visibility retention and SHA-256 validation', () => {
  assert.match(routes, /Published calibration evidence is version-locked/);
  assert.match(routes, /Only evidence in a draft calibration programme may be edited/);
  assert.match(routes, /Only draft evidence in a draft programme may be approved/);
  assert.match(routes, /Provide a retirement reason of at least 20 characters/);
  assert.match(routes, /AFTER_SUBMISSION/);
  assert.match(routes, /ADMIN_ONLY/);
  assert.match(routes, /retention_until > UTC_TIMESTAMP/);
  assert.match(routes, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(routes, /https:\\\/\\\//);
});

test('operations APIs are permissioned and mounted before calibration role routes', () => {
  assert.match(routes, /requirePermission\('calibration\.view_self'\)/);
  assert.match(routes, /requirePermission\('calibration\.report'\)/);
  assert.match(routes, /requirePermission\('calibration\.manage'\)/);
  const operationsMount = integration.indexOf("router.use('/calibration', calibrationOperationsRoutes)");
  const catalogMount = integration.indexOf("router.use('/calibration', calibrationCatalogRoutes)");
  const calibrationMount = integration.indexOf("router.use('/calibration', calibrationRoutes)");
  assert.ok(operationsMount > 0);
  assert.ok(catalogMount > operationsMount);
  assert.ok(calibrationMount > catalogMount);
});

test('designated calibration worker runs operations after expiry and reliability', () => {
  assert.match(runtime, /runEvaluatorQualityOperationsCycle/);
  const expiry = runtime.indexOf('expireEvaluatorAuthorizations');
  const reliability = runtime.indexOf('calculateReliabilitySnapshots');
  const operationsCycle = runtime.lastIndexOf('runEvaluatorQualityOperationsCycle(source)');
  assert.ok(expiry > 0);
  assert.ok(reliability > expiry);
  assert.ok(operationsCycle > reliability);
  assert.match(runtime, /LMS_RUN_SCHEDULERS/);
  assert.match(runtime, /6 \* 60 \* 60 \* 1000/);
});

test('Phase 8 UI exposes credentials trends benchmarks operations and evidence governance', () => {
  assert.match(page, /EvaluatorOperationsPanel/);
  assert.match(panel, /Digital authorization certificates/);
  assert.match(panel, /Reliability trend/);
  assert.match(panel, /Reliability cohort benchmarks/);
  assert.match(panel, /Operations control centre/);
  assert.match(panel, /Governed anchor evidence/);
  assert.match(panel, /Verify certificate/);
  assert.match(panel, /Run operations now/);
  assert.match(styles, /@media\(max-width:720px\)/);
});

test('production dependency override protecting the Google API chain remains pinned', () => {
  assert.equal(packageJson.overrides?.['googleapis-common']?.gaxios, '7.3.0');
});