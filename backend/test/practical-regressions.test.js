import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260724230000_practical_assessment_rubrics/migration.sql', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../src/services/practicalGovernance.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/practical.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../src/routes/practicalCatalog.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../src/middleware/permissions.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');

const tables = [
  'practical_assessment_template',
  'practical_rubric_section',
  'practical_rubric_criterion',
  'practical_assessment_assignment',
  'practical_assessment_submission',
  'practical_submission_evidence',
  'practical_evaluation',
  'practical_criterion_score',
  'practical_moderation_case',
  'practical_assessment_event',
];

test('Phase 6 migration defines the complete governed rubric model', () => {
  for (const table of tables) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(migration, /uq_practical_template_code_version/);
  assert.match(migration, /uq_practical_assignment_attempt/);
  assert.match(migration, /uq_practical_evaluator_slot/);
  assert.match(migration, /uq_practical_evaluator_identity/);
  assert.match(migration, /uq_practical_criterion_score/);
  assert.match(migration, /uq_practical_moderation_assignment/);
});

test('practical permissions preserve self owned-batch branch and company scopes', () => {
  for (const permission of [
    'practical.view_self',
    'practical.submit_self',
    'practical.evaluate_owned',
    'practical.manage_scope',
    'practical.configure',
    'practical.moderate',
    'practical.report',
  ]) assert.match(migration, new RegExp(permission.replace('.', '\\.')));
  assert.match(migration, /'trainee', '\*', 'practical\.submit_self', 1, 'self'/);
  assert.match(migration, /'coordinator', '\*', 'practical\.evaluate_owned', 1, 'own_batch'/);
  assert.match(migration, /'admin', '\*', 'practical\.moderate', 1, 'branch'/);
  assert.match(migration, /'Super Admin', 'practical\.moderate', 1, 'company'/);
  assert.match(permissions, /'practical\.'/);
});

test('published rubric validation requires complete 100 percent weighting', () => {
  assert.match(governance, /Rubric section weights must total exactly 100%/);
  assert.match(governance, /Criterion weights in/);
  assert.match(governance, /Add at least one rubric section before publishing/);
  assert.match(governance, /has no criteria/);
  assert.match(governance, /Critical criterion/);
  assert.match(governance, /requires a minimum score/);
  assert.match(routes, /Published rubric versions are immutable\. Create a new version instead/);
  assert.match(governance, /Only published templates can be versioned/);
});

test('learner submissions are evidence-bearing and become locked for evaluation', () => {
  assert.match(governance, /Provide a learner statement of at least 20 characters or attach evidence references/);
  assert.match(governance, /practical_submission_evidence/);
  assert.match(governance, /SUBMISSION_SUBMITTED/);
  assert.match(governance, /This assignment no longer accepts learner submissions/);
  assert.match(routes, /practical\.submit_self/);
  assert.match(routes, /detail\.employeeId !== String\(req\.userId\)/);
});

test('evaluator slots are independent, bounded and cannot be self-claimed', () => {
  assert.match(governance, /Learners cannot evaluate their own practical assessment/);
  assert.match(governance, /All evaluator slots are already assigned/);
  assert.match(governance, /while \(used\.has\(slot\)\) slot \+= 1/);
  assert.match(governance, /EVALUATION_CLAIMED/);
  assert.match(catalog, /my-evaluation/);
  assert.match(routes, /Blind review safeguards/);
});

test('server calculates every criterion and enforces critical and evidence gates', () => {
  assert.match(governance, /Score every criterion before submitting/);
  assert.match(governance, /CRITERION_SCORE_RANGE/);
  assert.match(governance, /Evidence is required for/);
  assert.match(governance, /criterionCriticalFail/);
  assert.match(governance, /percentage >= numeric\(template\.passingPct/);
  assert.match(governance, /Submitted evaluations are locked and cannot be edited/);
  assert.match(governance, /Evaluator summary must contain at least 20 characters/);
});

test('double evaluation opens moderation on variance or critical disagreement', () => {
  assert.match(governance, /SCORE_VARIANCE/);
  assert.match(governance, /CRITICAL_DISAGREEMENT/);
  assert.match(governance, /MODERATION_REQUIRED/);
  assert.match(governance, /variance > numeric\(assignment\.moderationThresholdPct/);
  assert.match(governance, /criticalDisagreement/);
  assert.match(governance, /Moderation resolution summary must contain at least 30 characters/);
  assert.match(routes, /practical\.moderate/);
});

test('finalized practical results create durable skill evidence and refresh paths', () => {
  assert.match(governance, /'PRACTICAL_ASSESSMENT'/);
  assert.match(governance, /ON DUPLICATE KEY UPDATE/);
  assert.match(governance, /syncEmployeeSkills/);
  assert.match(governance, /syncLearningPaths/);
  assert.match(governance, /ASSESSMENT_FINALIZED/);
  assert.match(governance, /MODERATION_RESOLVED/);
});

test('coordinator and administrator assignment scope is enforced server-side', () => {
  assert.match(routes, /b\.coordinator_login_id = \?/);
  assert.match(routes, /outside your owned-batch scope/);
  assert.match(routes, /outside your branch scope/);
  assert.match(routes, /coordinatorOwnsEmployee/);
  assert.match(catalog, /WHERE b\.coordinator_login_id = \?/);
  assert.match(catalog, /AND t\.branch = \?/);
});

test('practical routes are mounted on the early authenticated platform router', () => {
  assert.match(integration, /import practicalRoutes/);
  assert.match(integration, /import practicalCatalogRoutes/);
  const catalogMount = integration.indexOf("router.use('/practical', practicalCatalogRoutes)");
  const routeMount = integration.indexOf("router.use('/practical', practicalRoutes)");
  assert.ok(catalogMount > 0);
  assert.ok(routeMount > catalogMount);
});
