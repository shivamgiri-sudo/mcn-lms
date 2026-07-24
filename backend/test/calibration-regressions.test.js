import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260724233000_evaluator_calibration_reliability/migration.sql', import.meta.url), 'utf8');
const historyGuard = readFileSync(new URL('../prisma/migrations/20260724233500_calibration_program_history_guard/migration.sql', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../src/services/calibrationGovernance.js', import.meta.url), 'utf8');
const reliability = readFileSync(new URL('../src/services/calibrationReliability.js', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../src/middleware/evaluatorAuthorizationGate.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/middleware/calibrationRuntime.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/calibration.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../src/routes/calibrationCatalog.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../src/middleware/permissions.js', import.meta.url), 'utf8');

const tables = [
  'evaluator_calibration_program',
  'evaluator_calibration_anchor',
  'evaluator_calibration_expected_score',
  'evaluator_calibration_assignment',
  'evaluator_calibration_response',
  'evaluator_authorization',
  'evaluator_reliability_snapshot',
  'evaluator_reliability_pair',
  'evaluator_quality_action',
];

test('Phase 7 migration defines the full evaluator-quality evidence model', () => {
  for (const table of tables) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(migration, /uq_calibration_assignment_attempt/);
  assert.match(migration, /uq_calibration_response/);
  assert.match(migration, /uq_evaluator_authorization/);
  assert.match(migration, /uq_evaluator_reliability_period/);
  assert.match(migration, /uq_evaluator_reliability_pair/);
});

test('program history guard permits historical records but only one active program', () => {
  assert.match(historyGuard, /DROP INDEX uq_calibration_program_template_active/);
  assert.match(historyGuard, /active_template_key/);
  assert.match(historyGuard, /GENERATED ALWAYS AS/);
  assert.match(historyGuard, /status IN \('DRAFT','PUBLISHED'\)/);
  assert.match(historyGuard, /UNIQUE KEY uq_calibration_program_template_active/);
});

test('calibration permissions are database backed and scope aware', () => {
  for (const permission of [
    'calibration.view_self',
    'calibration.submit_self',
    'calibration.manage',
    'calibration.authorize',
    'calibration.report',
    'calibration.action',
  ]) assert.match(migration, new RegExp(permission.replace('.', '\\.')));
  assert.match(migration, /'coordinator', '\*', 'calibration\.submit_self', 1, 'self'/);
  assert.match(migration, /'admin', '\*', 'calibration\.manage', 1, 'branch'/);
  assert.match(migration, /'Super Admin', 'calibration\.report', 1, 'company'/);
  assert.match(permissions, /'calibration\.'/);
});

test('publishing requires complete protected anchor coverage', () => {
  assert.match(governance, /Calibration requires a published practical rubric version/);
  assert.match(governance, /Add at least .* active anchor cases before publishing/);
  assert.match(governance, /is missing an expected score/);
  assert.match(governance, /exceeds the rubric maximum/);
  assert.match(governance, /Only draft calibration programs can be published/);
  assert.match(routes, /Published calibration programs are immutable/);
});

test('calibration scoring enforces complete criterion responses and tolerance', () => {
  assert.match(governance, /Score every criterion for anchor/);
  assert.match(governance, /CALIBRATION_SCORE_RANGE/);
  assert.match(governance, /absoluteDeviation <= tolerance/);
  assert.match(governance, /agreementPct \* 0\.75 \+ criticalAgreementPct \* 0\.25/);
  assert.match(governance, /scorePct >= number\(program\.passingPct/);
  assert.match(governance, /agreementPct >= number\(program\.minimumAgreementPct/);
  assert.match(governance, /This calibration attempt is already locked/);
});

test('passing calibration creates time-limited template authorization', () => {
  assert.match(governance, /INSERT INTO evaluator_authorization/);
  assert.match(governance, /ON DUPLICATE KEY UPDATE/);
  assert.match(governance, /status = 'ACTIVE'/);
  assert.match(governance, /authorizationValidDays/);
  assert.match(governance, /valid_until <= UTC_TIMESTAMP/);
  assert.match(governance, /Complete the published calibration program before evaluating/);
});

test('evaluator gate is backward compatible and fails closed when required', () => {
  assert.match(gate, /checkEvaluatorAuthorization/);
  assert.match(gate, /if \(authorization\.allowed\)/);
  assert.match(gate, /EVALUATOR_CALIBRATION_REQUIRED/);
  assert.match(gate, /\/evaluator-quality\?role=/);
  assert.match(governance, /if \(!programs\.length\) return \{ required: false, allowed: true/);
});

test('reliability calculations use actual paired submitted evaluations', () => {
  assert.match(reliability, /e\.status = 'SUBMITTED'/);
  assert.match(reliability, /if \(rows\.length !== 2\) continue/);
  assert.match(reliability, /difference <= 5\.00001/);
  assert.match(reliability, /Boolean\(left\.criticalFail\) === Boolean\(right\.criticalFail\)/);
  assert.match(reliability, /severityIndex = averageScore - templateAverage/);
  assert.match(reliability, /RECALIBRATION_REQUIRED/);
  assert.match(reliability, /INSUFFICIENT_DATA/);
});

test('snapshot and pair primary keys remain stable during recalculation', () => {
  assert.match(reliability, /SELECT snapshot_id AS snapshotId/);
  assert.match(reliability, /existing\[0\]\?\.snapshotId \|\| randomUUID\(\)/);
  assert.doesNotMatch(reliability, /snapshot_id = VALUES\(snapshot_id\)/);
  assert.match(reliability, /SELECT pair_id AS pairId/);
  assert.match(reliability, /existing\[0\]\?\.pairId \|\| randomUUID\(\)/);
  assert.doesNotMatch(reliability, /pair_id = VALUES\(pair_id\)/);
});

test('severe reliability automatically opens one recalibration action', () => {
  assert.match(reliability, /action_type = 'RECALIBRATION'/);
  assert.match(reliability, /status IN \('OPEN','IN_PROGRESS'\)/);
  assert.match(reliability, /DATE_ADD\(UTC_TIMESTAMP\(3\), INTERVAL 14 DAY\)/);
  assert.match(reliability, /Reliability requires recalibration/);
});

test('admin APIs govern programs assignments reliability authorization and actions', () => {
  assert.match(routes, /\/admin\/programs/);
  assert.match(routes, /\/admin\/assignments/);
  assert.match(routes, /\/admin\/reliability\/run/);
  assert.match(routes, /\/admin\/authorizations\/.*\/suspend/);
  assert.match(routes, /\/admin\/authorizations\/.*\/restore/);
  assert.match(routes, /\/admin\/actions\/.*\/complete/);
  assert.match(routes, /Provide an audited reason of at least 20 characters/);
  assert.match(routes, /Completion notes must contain at least 20 characters/);
  assert.match(catalog, /templates\/:templateId\/criteria/);
});

test('runtime and route order preserve identity before authorization checks', () => {
  assert.match(runtime, /LMS_RUN_SCHEDULERS/);
  assert.match(runtime, /6 \* 60 \* 60 \* 1000/);
  assert.match(runtime, /calculateReliabilitySnapshots/);
  assert.match(runtime, /expireEvaluatorAuthorizations/);
  const runtimeMount = integration.indexOf('router.use(calibrationRuntime)');
  const calibrationMount = integration.indexOf("router.use('/calibration', calibrationRoutes)");
  const preflightMount = integration.indexOf("router.post('/practical/coordinator/assignments/:assignmentId/claim', requireSession, evaluatorAuthorizationGate)");
  const practicalMount = integration.indexOf("router.use('/practical', practicalRoutes)");
  assert.ok(runtimeMount > 0);
  assert.ok(calibrationMount > runtimeMount);
  assert.ok(preflightMount > calibrationMount);
  assert.ok(practicalMount > preflightMount);
});
