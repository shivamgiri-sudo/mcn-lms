import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const migrationPath = 'backend/prisma/migrations/20260727120000_assessment_intelligence/migration.sql';

test('assessment intelligence migration is additive governed and registered', () => {
  const migration = read(migrationPath);
  const expected = read('deploy/migrations.expected').trim().split(/\r?\n/);

  assert.ok(expected.includes('20260727120000_assessment_intelligence'));
  assert.equal(expected.at(-7), '20260727120000_assessment_intelligence');
  assert.equal(expected.at(-6), '20260729100000_secure_browser_sessions');
  assert.equal(expected.at(-5), '20260729140000_mobile_accessibility_offline');
  assert.equal(expected.length, 22);
  for (const table of [
    'assessment_blueprint',
    'assessment_blueprint_rule',
    'assessment_question_metadata',
    'assessment_attempt_form',
    'assessment_question_response',
    'assessment_accommodation',
    'assessment_item_analytics',
    'assessment_quality_alert',
    'assessment_remedial_recommendation',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.match(migration, /published_assessment_key[\s\S]*?UNIQUE KEY uq_assessment_blueprint_published/);
  assert.match(migration, /active_employee_key[\s\S]*?UNIQUE KEY uq_assessment_accommodation_active/);
  assert.match(migration, /fk_assessment_blueprint_assessment[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /fk_assessment_quality_alert_assessment[\s\S]*?ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /fk_assessment_blueprint_assessment[\s\S]{0,160}?ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /fk_assessment_quality_alert_assessment[\s\S]{0,160}?ON DELETE CASCADE/);
  assert.match(migration, /INSERT IGNORE INTO assessment_question_metadata/);
  assert.match(migration, /assessment\.blueprint\.manage/);
  assert.match(migration, /assessment\.question\.review/);
  assert.match(migration, /assessment\.analytics\.view/);
  assert.match(migration, /assessment\.accommodation\.manage/);
});

test('attempt forms are immutable signed server snapshots', () => {
  const service = read('backend/src/services/assessmentIntelligence.js');

  assert.match(service, /createHmac\('sha256'/);
  assert.match(service, /APP_ENCRYPTION_KEY \|\| process\.env\.SESSION_SECRET/);
  assert.match(service, /signAttemptForm/);
  assert.match(service, /integrityHash/);
  assert.match(service, /ATTEMPT_FORM_INTEGRITY_FAILED/);
  assert.match(service, /INSERT IGNORE INTO assessment_attempt_form/);
  assert.match(service, /question_snapshot_json/);
  assert.match(service, /accommodation_snapshot_json/);
  assert.match(service, /effective_time_limit_seconds/);
  assert.match(service, /secureShuffle/);
  assert.match(service, /randomInt/);
  assert.doesNotMatch(service, /Math\.random/);
});

test('blueprint generation fails closed on supply or total mismatches', () => {
  const service = read('backend/src/services/assessmentIntelligence.js');
  const routes = read('backend/src/routes/assessmentIntelligence.js');

  assert.match(service, /BLUEPRINT_SUPPLY_SHORTAGE/);
  assert.match(service, /BLUEPRINT_TOTAL_MISMATCH/);
  assert.match(service, /review_status, 'APPROVED'/);
  assert.match(service, /max_exposure_count IS NULL/);
  assert.match(routes, /Blueprint rule counts must equal total questions/);
  assert.match(routes, /blueprintSupplyPreview/);
  assert.match(routes, /status = 'RETIRED'/);
  assert.match(routes, /status = 'PUBLISHED'/);
});

test('learner assessment never exposes protected answers before submission', () => {
  const service = read('backend/src/services/assessmentIntelligence.js');
  const route = read('backend/src/routes/assessmentIntelligence.js');

  assert.match(service, /function safeQuestionForLearner/);
  const learnerProjection = service.slice(service.indexOf('function safeQuestionForLearner'), service.indexOf('function mapDisplayedAnswer'));
  assert.doesNotMatch(learnerProjection, /correctOption/);
  assert.doesNotMatch(learnerProjection, /explanation/);
  assert.match(service, /revealAnswers = result === 'Pass' \|\| attemptsLeft === 0/);
  assert.match(service, /correctOption: revealAnswers \?/);
  assert.match(route, /router\.get\('\/learner\/assessment\/:assessmentId', \.\.\.learnerAuth/);
  assert.match(route, /router\.post\('\/learner\/assessment\/:assessmentId\/submit', \.\.\.learnerAuth/);
});

test('learner access accommodations timing and submission are server governed', () => {
  const service = read('backend/src/services/assessmentIntelligence.js');

  assert.match(service, /traineeClassroomMap/);
  assert.match(service, /ASSESSMENT_SCOPE_DENIED/);
  assert.match(service, /ASSESSMENT_PREREQUISITE_MISSING/);
  assert.match(service, /timeMultiplier/);
  assert.match(service, /extraBreakMinutes/);
  assert.match(service, /effectiveTimeLimitSeconds/);
  assert.match(service, /elapsedSeconds > form\.effectiveTimeLimitSeconds \+ 30/);
  assert.match(service, /updateMany\([\s\S]*?submittedAt: null/);
  assert.match(service, /ATTEMPT_ALREADY_SUBMITTED/);
  assert.match(service, /assessment_question_response/);
});

test('item analytics alerts and remediation use finalized response evidence', () => {
  const service = read('backend/src/services/assessmentIntelligence.js');

  assert.match(service, /a\.submitted_at IS NOT NULL/);
  assert.match(service, /a\.result IN \('Pass','Fail'\)/);
  assert.match(service, /discriminationIndex/);
  assert.match(service, /0\.27/);
  for (const status of ['TOO_EASY', 'TOO_HARD', 'LOW_DISCRIMINATION', 'HIGH_BLANK_RATE', 'INSUFFICIENT_DATA']) {
    assert.match(service, new RegExp(status));
  }
  assert.match(service, /assessment_quality_alert/);
  assert.match(service, /assessment_remedial_recommendation/);
  assert.match(service, /content_skill_map/);
});

test('administrator and coordinator APIs enforce role permission and scope', () => {
  const routes = read('backend/src/routes/assessmentIntelligence.js');
  const coordinator = read('backend/src/routes/assessmentIntelligenceCoordinator.js');
  const mount = read('backend/src/routes/passwordStability.js');
  const policy = JSON.parse(read('deploy/route-security-policy.json'));

  assert.match(routes, /requireSession/);
  assert.match(routes, /requireRole\('admin'\)/);
  assert.match(routes, /requireRole\('coordinator'\)/);
  assert.match(routes, /requirePermission\('assessment\.blueprint\.manage'\)/);
  assert.match(routes, /requirePermission\('assessment\.question\.review'\)/);
  assert.match(routes, /requirePermission\('assessment\.analytics\.view'\)/);
  assert.match(routes, /requirePermission\('assessment\.accommodation\.manage'\)/);
  assert.match(routes, /req\.userBranch/);
  assert.match(routes, /coordinatorLoginId: req\.userId/);
  assert.match(coordinator, /coordinator_login_id = \?/);
  assert.match(coordinator, /assessment_item_analytics/);
  assert.doesNotMatch(coordinator, /LEFT JOIN assessment_item_analytics/);
  assert.match(mount, /assessmentJsonSafe/);
  assert.match(mount, /typeof value === 'bigint'/);
  assert.ok(policy.requiredProtectedRoutes.includes('assessmentIntelligence.js'));
  assert.ok(policy.requiredProtectedRoutes.includes('assessmentIntelligenceCoordinator.js'));
});

test('learner UI uses attempt IDs server time live auto-submit and remediation', () => {
  const modal = read('frontend/src/pages/Trainee/AssessmentModal.jsx');

  assert.match(modal, /\/assessment-intelligence\/learner/);
  assert.match(modal, /attemptId: data\.assessment\.attemptId/);
  assert.match(modal, /timeLeftSeconds/);
  assert.match(modal, /autoSubmitRef/);
  assert.match(modal, /responseSeconds/);
  assert.match(modal, /flags/);
  assert.match(modal, /Accommodation applied/);
  assert.match(modal, /Recommended remediation/);
  assert.doesNotMatch(modal, /\/trainee\/assessment\/\$\{assessmentId\}/);
});

test('assessment workspace exposes governed authoring and scoped coordinator evidence', () => {
  const page = read('frontend/src/pages/AssessmentIntelligence/AssessmentIntelligencePage.jsx');
  const app = read('frontend/src/App.jsx');
  const tools = read('frontend/src/components/LearningToolsDock.jsx');

  assert.match(app, /path="\/assessment-intelligence"/);
  assert.match(tools, /Assessment Intelligence/);
  assert.match(page, /\/admin\/assessments/);
  assert.match(page, /\/blueprints/);
  assert.match(page, /submit-review/);
  assert.match(page, /\/publish/);
  assert.match(page, /\/questions\/\$\{question\.questionId\}\/metadata/);
  assert.match(page, /recalculate-analytics/);
  assert.match(page, /quality-alerts/);
  assert.match(page, /\/admin\/accommodations/);
  assert.match(page, /\/coordinator\/summary/);
});
