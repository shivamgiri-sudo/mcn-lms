import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorQualityPage.jsx', import.meta.url), 'utf8');
const selfView = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorSelfView.jsx', import.meta.url), 'utf8');
const adminView = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorQualityAdminView.jsx', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../../frontend/src/components/LearningToolsDock.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/evaluatorQuality.css', import.meta.url), 'utf8');

test('evaluator quality route reuses existing coordinator and admin sessions', () => {
  assert.match(app, /import EvaluatorQualityPage/);
  assert.match(app, /path="\/evaluator-quality"/);
  assert.match(shell, /lms_token_coordinator/);
  assert.match(shell, /lms_token_admin/);
  assert.doesNotMatch(shell, /lms_token_trainee/);
  assert.match(shell, /Calibration · Authorization · Reliability/);
});

test('evaluator self-service covers calibration attempts and authorization status', () => {
  assert.match(selfView, /\/calibration\/coordinator/);
  assert.match(selfView, /\/calibration\/admin/);
  assert.match(selfView, /Calibration attempts/);
  assert.match(selfView, /Protected anchor standards/);
  assert.match(selfView, /Submit calibration/);
  assert.match(selfView, /Evaluator authorizations/);
  assert.match(selfView, /Reliability & actions/);
  assert.match(selfView, /Mean deviation/);
});

test('anchor scoring includes critical judgement and protected standard feedback', () => {
  assert.match(selfView, /Mark critical fail/);
  assert.match(selfView, /submittedCriticalFail/);
  assert.match(selfView, /submittedScore/);
  assert.match(selfView, /Anchor standard/);
  assert.match(selfView, /expected\.expectedScore/);
  assert.match(selfView, /expected\.tolerance/);
  assert.match(selfView, /Submit and lock this calibration attempt/);
});

test('administrator console governs programs assignments and protected anchors', () => {
  assert.match(adminView, /Calibration programs/);
  assert.match(adminView, /Assign calibration/);
  assert.match(adminView, /Protected anchor cases/);
  assert.match(adminView, /Every active anchor must define an expected score for every rubric criterion/);
  assert.match(adminView, /Publish & lock/);
  assert.match(adminView, /Expected score/);
  assert.match(adminView, /Tolerance/);
  assert.match(adminView, /Expected critical fail/);
});

test('administrator console exposes reliability pairs authorizations and actions', () => {
  assert.match(adminView, /Reliability snapshots/);
  assert.match(adminView, /Evaluator pairs/);
  assert.match(adminView, /Corrective actions/);
  assert.match(adminView, /\/calibration\/admin\/reliability\/run/);
  assert.match(adminView, /\/calibration\/admin\/authorizations/);
  assert.match(adminView, /Suspend/);
  assert.match(adminView, /Revoke/);
  assert.match(adminView, /Restore/);
  assert.match(adminView, /Complete action/);
});

test('learning tools launcher exposes evaluator quality only to evaluator roles', () => {
  assert.match(launcher, /title: 'Evaluator Quality'/);
  assert.match(launcher, /roles: \['coordinator', 'admin'\]/);
  assert.match(launcher, /\/evaluator-quality\?role=/);
  assert.match(launcher, /visibleTools = TOOLS\.filter/);
});

test('evaluator quality layouts support desktop tablet and mobile screens', () => {
  assert.match(styles, /quality-self-grid/);
  assert.match(styles, /quality-builder-layout/);
  assert.match(styles, /quality-table\.reliability/);
  assert.match(styles, /@media\(max-width:1150px\)/);
  assert.match(styles, /@media\(max-width:720px\)/);
  assert.match(styles, /grid-template-columns:1fr/);
});
