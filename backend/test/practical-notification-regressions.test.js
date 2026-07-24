import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const templates = readFileSync(new URL('../prisma/migrations/20260724231000_practical_notification_templates/migration.sql', import.meta.url), 'utf8');
const hooks = readFileSync(new URL('../src/middleware/practicalNotificationHooks.js', import.meta.url), 'utf8');
const campaigns = readFileSync(new URL('../src/services/practicalNotificationCampaigns.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/middleware/notificationRuntime.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/routes/certificationHooks.js', import.meta.url), 'utf8');

test('practical lifecycle notification templates cover every governed event', () => {
  for (const eventType of [
    'PRACTICAL_ASSIGNED',
    'PRACTICAL_SUBMITTED',
    'PRACTICAL_DUE_REMINDER',
    'PRACTICAL_OVERDUE',
    'PRACTICAL_MODERATION_REQUIRED',
    'PRACTICAL_RESULT',
  ]) assert.match(templates, new RegExp(`'${eventType}'`));
  assert.equal((templates.match(/UUID\(\), 'PRACTICAL_/g) || []).length, 15);
  assert.match(templates, /\/practical-assessments\?role=trainee/);
  assert.match(templates, /\/practical-assessments\?role=coordinator/);
  assert.match(templates, /\/practical-assessments\?role=admin/);
});

test('lifecycle hooks emit only after successful responses with deterministic keys', () => {
  assert.match(hooks, /setImmediate\(\(\) => capture/);
  assert.match(hooks, /practical-assigned:/);
  assert.match(hooks, /practical-submitted:/);
  assert.match(hooks, /practical-moderation:/);
  assert.match(hooks, /practical-result:/);
  assert.match(hooks, /payload\?\.ok !== false/);
  assert.match(hooks, /return originalJson\(payload\)/);
});

test('moderation notices resolve only actual administrator accounts', () => {
  assert.match(hooks, /portalAccess: 'Admin'/);
  assert.match(hooks, /role: \{ in: \['Super Admin', 'SuperAdmin'\] \}/);
  assert.match(hooks, /userType: 'admin'/);
});

test('submission alerts prefer the owned-batch coordinator and use admin fallback', () => {
  assert.match(hooks, /coordinatorForBatch/);
  assert.match(hooks, /coordinatorLoginId/);
  assert.match(hooks, /userType: 'coordinator'/);
  assert.match(hooks, /branchAdministrators/);
});

test('practical reminders use bounded milestones and deterministic event keys', () => {
  assert.match(campaigns, /\[3, 1, 0\]\.includes\(daysRemaining\)/);
  assert.match(campaigns, /\[-1, -3, -7, -14, -30\]\.includes\(daysRemaining\)/);
  assert.match(campaigns, /practical-due:/);
  assert.match(campaigns, /practical-overdue:/);
  assert.match(campaigns, /DATEDIFF\(DATE\(a\.due_at\), UTC_DATE\(\)\)/);
  assert.match(campaigns, /userType: 'coordinator'/);
});

test('the designated notification worker generates practical campaigns before delivery', () => {
  assert.match(runtime, /generatePracticalAssessmentReminders/);
  const practicalRun = runtime.indexOf('generatePracticalAssessmentReminders()');
  const campaignRun = runtime.indexOf('runNotificationCampaignCycle');
  assert.ok(practicalRun > 0);
  assert.ok(campaignRun > practicalRun);
  assert.match(runtime, /Number\(practical\.generated \|\| 0\)/);
  assert.match(runtime, /return \{ \.\.\.result, practical \}/);
});

test('practical notification hooks are mounted before practical routes', () => {
  assert.match(integration, /import \{ practicalNotificationHooks \}/);
  const hookMount = integration.indexOf('router.use(practicalNotificationHooks)');
  const catalogMount = integration.indexOf("router.use('/practical', practicalCatalogRoutes)");
  const routeMount = integration.indexOf("router.use('/practical', practicalRoutes)");
  assert.ok(hookMount > 0);
  assert.ok(catalogMount > hookMount);
  assert.ok(routeMount > catalogMount);
});
