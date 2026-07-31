import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hooks = readFileSync(new URL('../src/middleware/calibrationOperationsHooks.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');

test('calibration assignments emit immediately with the scheduled-cycle idempotency key', () => {
  assert.match(hooks, /successful\(res, payload\)/);
  assert.match(hooks, /path === '\/api\/calibration\/admin\/assignments'/);
  assert.match(hooks, /eventType: 'CALIBRATION_ASSIGNED'/);
  assert.match(hooks, /calibration-assigned:\$\{detail\.assignmentId\}/);
  assert.match(hooks, /recipientType: detail\.evaluatorType/);
  assert.match(hooks, /recipientId: detail\.evaluatorId/);
});

test('passed calibration synchronizes the digital certificate immediately', () => {
  assert.match(hooks, /detail\?\.result === 'PASS'/);
  assert.match(hooks, /syncEvaluatorAuthorizationCertificates/);
  assert.match(hooks, /coordinator\\\/assignments/);
  assert.match(hooks, /admin\\\/assignments/);
  assert.match(hooks, /setImmediate/);
});

test('immediate lifecycle capture is mounted before standards filtering and role routes', () => {
  const hookMount = integration.indexOf('router.use(calibrationOperationsHooks)');
  const standardsMount = integration.indexOf('router.use(calibrationStandardsGuard)');
  const operationsRoutes = integration.indexOf("router.use('/calibration', calibrationOperationsRoutes)");
  const roleRoutes = integration.indexOf("router.use('/calibration', calibrationRoutes)");
  assert.ok(hookMount > 0);
  assert.ok(standardsMount > hookMount);
  assert.ok(operationsRoutes > standardsMount);
  assert.ok(roleRoutes > operationsRoutes);
});