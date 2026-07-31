import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260725120000_evaluator_appeals_governance/migration.sql', import.meta.url), 'utf8');
const supplement = readFileSync(new URL('../prisma/migrations/20260725121000_evaluator_appeal_notification_supplement/migration.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/calibrationAppeals.js', import.meta.url), 'utf8');
const evidenceService = readFileSync(new URL('../src/services/calibrationAppealEvidence.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/calibrationAppeals.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/middleware/calibrationRuntime.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorQualityPage.jsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorGovernancePanel.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/evaluatorGovernance.css', import.meta.url), 'utf8');

const tables = [
  'evaluator_calibration_appeal',
  'evaluator_calibration_appeal_event',
  'evaluator_governance_evidence_pack',
];

const notificationEvents = [
  'CALIBRATION_APPEAL_SUBMITTED',
  'CALIBRATION_APPEAL_ACKNOWLEDGED',
  'CALIBRATION_APPEAL_INFORMATION_REQUESTED',
  'CALIBRATION_APPEAL_INFORMATION_PROVIDED',
  'CALIBRATION_APPEAL_RESOLVED',
  'CALIBRATION_APPEAL_SLA_BREACHED',
  'CALIBRATION_EVIDENCE_PACK_READY',
];

test('Phase 9 migration defines appeals hash-chain events and evidence packs', () => {
  for (const table of tables) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(migration, /uq_evaluator_appeal_assignment/);
  assert.match(migration, /uq_evaluator_appeal_event_sequence/);
  assert.match(migration, /uq_evaluator_appeal_event_hash/);
  assert.match(migration, /uq_evaluator_governance_pack_version/);
  assert.match(migration, /chk_evaluator_appeal_statement/);
  assert.match(migration, /chk_evaluator_appeal_resolution/);
  assert.match(migration, /chk_evaluator_appeal_event_hash/);
  assert.match(migration, /chk_evaluator_governance_pack_hash/);
});

test('appeal and evidence export permissions are explicit and scoped', () => {
  for (const permission of ['calibration.appeal_self', 'calibration.appeal_manage', 'calibration.evidence_export']) {
    assert.match(migration, new RegExp(permission.replaceAll('.', '\\.')));
  }
  assert.match(migration, /'coordinator', '\*', 'calibration\.appeal_self', 1, 'self'/);
  assert.match(migration, /'admin', '\*', 'calibration\.appeal_manage', 1, 'branch'/);
  assert.match(migration, /'Super Admin', 'calibration\.appeal_manage', 1, 'company'/);
});

test('every Phase 9 lifecycle notification has in-app and email delivery', () => {
  const combined = `${migration}\n${supplement}`;
  for (const eventType of notificationEvents) {
    const matches = combined.match(new RegExp(`'${eventType}'`, 'g')) || [];
    assert.equal(matches.length, 2, `${eventType} should have exactly IN_APP and EMAIL templates`);
  }
});

test('appeal timeline is SHA-256 chained and verified on read', () => {
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /previous_hash AS previousHash/);
  assert.match(service, /previousHash/);
  assert.match(service, /eventHash/);
  assert.match(service, /verifyTimeline/);
  assert.match(service, /integrityVerified/);
});

test('one appeal per finalized assignment and the configured appeal window are enforced', () => {
  assert.match(service, /Only a finalized calibration result may be appealed/);
  assert.match(service, /LMS_CALIBRATION_APPEAL_WINDOW_DAYS/);
  assert.match(service, /An appeal already exists for this calibration attempt/);
  assert.match(service, /appealWindowEndsAt\.getTime\(\) < Date\.now\(\)/);
});

test('appeal resolution preserves original evidence and creates a new reassessment attempt', () => {
  assert.match(evidenceService, /normalizedAction === 'REASSESSMENT'/);
  assert.match(evidenceService, /INSERT INTO evaluator_calibration_assignment/);
  assert.match(evidenceService, /attemptNo = Number\(attempts\[0\]\?\.lastAttempt \|\| 0\) \+ 1/);
  assert.doesNotMatch(evidenceService, /UPDATE evaluator_calibration_response/);
  assert.doesNotMatch(evidenceService, /SET score_pct =/);
  assert.match(routes, /resolveCalibrationAppeal/);
  assert.match(routes, /without altering the original calibration evidence/);
});

test('evidence packs are canonical hash-verified private exports', () => {
  assert.match(evidenceService, /canonicalize/);
  assert.match(evidenceService, /manifestHash = sha256\(manifest\)/);
  assert.match(evidenceService, /integrityVerified: sha256\(json\(pack\.manifestJson\)\) === pack\.manifestHash/);
  assert.match(evidenceService, /evaluator_authorization_certificate/);
  assert.match(evidenceService, /evaluator_reliability_snapshot/);
  assert.match(evidenceService, /audit_log/);
  assert.match(evidenceService, /created_at AS createdAt/);
  assert.doesNotMatch(evidenceService, /timestamp\s+FROM audit_log/);
  assert.match(routes, /from '\.\.\/services\/calibrationAppealEvidence\.js'/);
  assert.match(routes, /Content-Disposition/);
  assert.match(routes, /calibration\.evidence_export/);
});

test('self-service and administrative governance routes cannot shadow one another', () => {
  assert.match(routes, /const selfPrefix = `\$\{prefix\}\/governance\/self`/);
  assert.match(routes, /\/admin\/governance\/dashboard/);
  assert.match(routes, /\/admin\/governance\/appeals\/:appealId/);
  assert.match(routes, /\/admin\/governance\/packs\/:packId/);
  assert.doesNotMatch(routes, /`\$\{prefix\}\/governance\/appeals\/:appealId`/);
});

test('appeal SLA lifecycle is idempotent and owned by the calibration worker', () => {
  assert.match(service, /NOT EXISTS \([\s\S]*event_type = 'SLA_BREACHED'/);
  assert.match(service, /calibration-appeal-sla-breached:\$\{item\.appealId\}/);
  assert.match(runtime, /runAppealGovernanceCycle/);
  const operationsCall = runtime.indexOf('await runEvaluatorQualityOperationsCycle(source)');
  const governanceCall = runtime.indexOf('await runAppealGovernanceCycle(source)');
  assert.ok(operationsCall > 0 && governanceCall > operationsCall);
  assert.match(runtime, /LMS_RUN_SCHEDULERS/);
  assert.match(runtime, /6 \* 60 \* 60 \* 1000/);
});

test('Phase 9 routes are mounted before older calibration routers', () => {
  const appealsMount = integration.indexOf("router.use('/calibration', calibrationAppealRoutes)");
  const operationsMount = integration.indexOf("router.use('/calibration', calibrationOperationsRoutes)");
  const catalogMount = integration.indexOf("router.use('/calibration', calibrationCatalogRoutes)");
  assert.ok(appealsMount > 0);
  assert.ok(operationsMount > appealsMount);
  assert.ok(catalogMount > operationsMount);
});

test('Phase 9 UI exposes appeal SLA timeline evidence and admin resolution controls', () => {
  assert.match(page, /EvaluatorGovernancePanel/);
  assert.match(panel, /Raise a calibration appeal/);
  assert.match(panel, /My appeal register/);
  assert.match(panel, /Timeline verified/);
  assert.match(panel, /governance evidence packs/i);
  assert.match(panel, /Appeal governance control centre/);
  assert.match(panel, /Resolve and seal evidence/);
  assert.match(panel, /downloadCsv/);
  assert.match(styles, /@media\(max-width:720px\)/);
});
