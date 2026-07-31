import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../frontend/src/pages/PracticalAssessments/PracticalAssessmentsPage.jsx', import.meta.url), 'utf8');
const learner = readFileSync(new URL('../../frontend/src/pages/PracticalAssessments/LearnerPracticalView.jsx', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../../frontend/src/pages/PracticalAssessments/OperationsPracticalView.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/PracticalAssessments/practicalAssessments.css', import.meta.url), 'utf8');

test('practical assessment route reuses existing role sessions', () => {
  assert.match(app, /PracticalAssessmentsPage/);
  assert.match(app, /path="\/practical-assessments"/);
  assert.match(shell, /lms_token_trainee/);
  assert.match(shell, /lms_token_coordinator/);
  assert.match(shell, /lms_token_admin/);
  assert.match(shell, /existing secure role session/);
});

test('learner experience exposes rubric, evidence, submission and final feedback', () => {
  assert.match(learner, /\/practical\/me/);
  assert.match(learner, /Scoring rubric/);
  assert.match(learner, /Critical criteria can force an overall fail/);
  assert.match(learner, /Save draft/);
  assert.match(learner, /Submit for evaluation/);
  assert.match(learner, /Submitted evidence/);
  assert.match(learner, /Final result/);
});

test('operations experience includes scoped assignment and independent scoring', () => {
  assert.match(operations, /\/queue/);
  assert.match(operations, /\/catalog/);
  assert.match(operations, /Claim evaluator slot/);
  assert.match(operations, /Peer scores remain hidden/);
  assert.match(operations, /Submit & lock evaluation/);
  assert.match(operations, /Scores are calculated on the server/);
  assert.match(operations, /Evidence reference/);
});

test('administrator experience includes versioned rubrics moderation and analytics', () => {
  assert.match(operations, /Rubric builder/);
  assert.match(operations, /Published versions are immutable/);
  assert.match(operations, /Publish & lock/);
  assert.match(operations, /Create new version/);
  assert.match(operations, /Moderation queue/);
  assert.match(operations, /Resolve and issue final result/);
  assert.match(operations, /Evaluator activity/);
});

test('practical layouts include desktop tablet and mobile behavior', () => {
  assert.match(styles, /grid-template-columns:minmax\(280px,350px\)/);
  assert.match(styles, /@media\(max-width:1100px\)/);
  assert.match(styles, /@media\(max-width:720px\)/);
  assert.match(styles, /practical-template-layout/);
  assert.match(styles, /practical-score-row/);
});
