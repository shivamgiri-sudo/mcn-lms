import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guard = readFileSync(new URL('../src/middleware/calibrationStandardsGuard.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');
const selfView = readFileSync(new URL('../../frontend/src/pages/EvaluatorQuality/EvaluatorSelfView.jsx', import.meta.url), 'utf8');

test('evaluator self responses redact protected anchor standards while editable', () => {
  assert.match(guard, /\['ASSIGNED', 'IN_PROGRESS'\]/);
  assert.match(guard, /expectedScores: .*map/);
  assert.match(guard, /criterionId: expected\.criterionId/);
  assert.doesNotMatch(guard, /expectedScore: expected\.expectedScore/);
  assert.doesNotMatch(guard, /tolerance: expected\.tolerance/);
  assert.match(guard, /evaluatorNotes: null/);
});

test('redaction applies only to evaluator self endpoints', () => {
  assert.ok(guard.includes('^\\/api\\/calibration\\/coordinator\\/assignments'));
  assert.ok(guard.includes('^\\/api\\/calibration\\/admin\\/assignments'));
  assert.ok(guard.includes('\\/self'));
  assert.match(guard, /if \(!isEvaluatorSelfPath\(req\)\) return next\(\)/);
});

test('the standards guard is mounted before calibration role routes', () => {
  assert.match(integration, /import \{ calibrationStandardsGuard \}/);
  const guardMount = integration.indexOf('router.use(calibrationStandardsGuard)');
  const catalogMount = integration.indexOf("router.use('/calibration', calibrationCatalogRoutes)");
  const routeMount = integration.indexOf("router.use('/calibration', calibrationRoutes)");
  assert.ok(guardMount > 0);
  assert.ok(catalogMount > guardMount);
  assert.ok(routeMount > catalogMount);
});

test('protected standards appear in the UI only after the editable state closes', () => {
  assert.match(selfView, /const editable = detail && \['ASSIGNED', 'IN_PROGRESS'\]\.includes\(detail\.status\)/);
  assert.match(selfView, /!editable && detail\.status !== 'ASSIGNED'/);
  assert.match(selfView, /Anchor standard/);
  assert.match(selfView, /expected\.expectedScore/);
  assert.match(selfView, /expected\.tolerance/);
});
