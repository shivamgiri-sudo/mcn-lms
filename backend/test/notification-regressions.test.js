import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260724200000_notification_outbox_calendar_feeds/migration.sql', import.meta.url), 'utf8');
const supplement = readFileSync(new URL('../prisma/migrations/20260724201000_notification_template_supplement/migration.sql', import.meta.url), 'utf8');
const outbox = readFileSync(new URL('../src/services/notificationOutbox.js', import.meta.url), 'utf8');
const campaigns = readFileSync(new URL('../src/services/notificationCampaigns.js', import.meta.url), 'utf8');
const feeds = readFileSync(new URL('../src/services/calendarFeeds.js', import.meta.url), 'utf8');
const hooks = readFileSync(new URL('../src/middleware/notificationHooks.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/middleware/notificationRuntime.js', import.meta.url), 'utf8');
const notificationRoutes = readFileSync(new URL('../src/routes/notifications.js', import.meta.url), 'utf8');
const calendarRoutes = readFileSync(new URL('../src/routes/calendar.js', import.meta.url), 'utf8');
const notify = readFileSync(new URL('../src/utils/notify.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

const expectedTables = [
  'notification_event',
  'notification_template',
  'notification_preference',
  'notification_outbox',
  'notification_inbox',
  'notification_escalation_rule',
  'notification_escalation_instance',
  'calendar_feed_token',
  'calendar_feed_access_log',
  'meeting_provider_config',
];

test('Phase 5 migration defines the durable notification and calendar model', () => {
  for (const table of expectedTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /UNIQUE KEY uq_notification_event_idempotency \(idempotency_key\)/);
  assert.match(migration, /UNIQUE KEY uq_notification_outbox_idempotency \(idempotency_key\)/);
  assert.match(migration, /UNIQUE KEY uq_notification_inbox_idempotency \(idempotency_key\)/);
  assert.match(migration, /UNIQUE KEY uq_calendar_feed_token_hash \(token_hash\)/);
  assert.match(migration, /token_hash CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(migration, /calendar_feed_token[\s\S]{0,500}\btoken\s+(VARCHAR|TEXT)/i);
});

test('notification and calendar permissions are database-backed and scoped', () => {
  for (const permission of [
    'notify.view_self',
    'notify.manage_scope',
    'notify.configure',
    'notify.audit',
    'calendar.feed_self',
    'calendar.manage_scope',
  ]) {
    assert.match(migration, new RegExp(permission.replace('.', '\\.')));
  }
  assert.match(migration, /'trainee', '\*', 'notify\.view_self', 1, 'self'/);
  assert.match(migration, /'coordinator', '\*', 'notify\.manage_scope', 1, 'own_batch'/);
  assert.match(migration, /'admin', '\*', 'notify\.audit', 1, 'branch'/);
  assert.match(migration, /'Super Admin', 'calendar\.manage_scope', 1, 'company'/);
});

test('event and delivery workers use transactional leases and skip locked rows', () => {
  assert.match(outbox, /prisma\.\$transaction\(async tx =>/);
  assert.match(outbox, /FOR UPDATE SKIP LOCKED/);
  assert.match(outbox, /status = 'PROCESSING'/);
  assert.match(outbox, /locked_at < DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 10 MINUTE\)/);
  assert.match(outbox, /attempt_count = attempt_count \+ 1/);
  assert.match(outbox, /Math\.min\(24 \* 60/);
  assert.match(outbox, /status = \?, next_attempt_at = \?/);
});

test('template resolution honors mandatory delivery and optional preferences', () => {
  assert.match(outbox, /if \(!template\.mandatory && \(!preference\.enabled \|\| preference\.digestMode === 'OFF'\)\)/);
  assert.match(outbox, /event_type IN \(\?, '\*'\)/);
  assert.match(outbox, /ORDER BY CASE WHEN event_type = \? THEN 0 ELSE 1 END/);
  assert.match(outbox, /quietUntil/);
  assert.match(outbox, /digestMode === 'DAILY'/);
  assert.match(outbox, /digestMode === 'WEEKLY'/);
});

test('SMS and WhatsApp keep legacy mobile callers and support outbox addresses', () => {
  assert.match(notify, /sendSms\(\{ mobile, to, message \}\)/);
  assert.match(notify, /sendWhatsApp\(\{ mobile, to, message \}\)/);
  assert.match(notify, /mobile \|\| to/);
});

test('product hooks use deterministic keys and never replace API responses', () => {
  assert.match(hooks, /setImmediate\(\(\) =>/);
  assert.match(hooks, /ilt-enrol:/);
  assert.match(hooks, /ilt-promoted:/);
  assert.match(hooks, /ilt-cancelled:/);
  assert.match(hooks, /ilt-no-show:/);
  assert.match(hooks, /coaching-scheduled:/);
  assert.match(hooks, /cert-renewed:/);
  assert.match(hooks, /return originalJson\(payload\)/);
});

test('campaigns use milestone keys and bounded escalation repeats', () => {
  assert.match(campaigns, /ILT_REMINDER_24H/);
  assert.match(campaigns, /ILT_REMINDER_2H/);
  assert.match(campaigns, /DATEDIFF\(DATE\(crc\.due_at\), UTC_DATE\(\)\) IN \(30,14,7,3,1,0\)/);
  assert.match(campaigns, /cert-reminder:/);
  assert.match(campaigns, /maxEscalations/);
  assert.match(campaigns, /nextNo <= Number\(row\.maxEscalations\)/);
  assert.match(supplement, /ILT_NO_SHOW_TO_BATCH_COORDINATOR/);
  assert.match(supplement, /CERT_OVERDUE_TO_BATCH_COORDINATOR/);
});

test('calendar feed secrets are returned once and stored only as SHA-256', () => {
  assert.match(feeds, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(feeds, /createHash\('sha256'\)/);
  assert.match(feeds, /token_hash/);
  assert.match(feeds, /token_prefix/);
  assert.match(feeds, /return \{ tokenId, token, tokenPrefix/);
  assert.match(feeds, /revokeCalendarFeedToken/);
  assert.match(feeds, /revoked_at IS NULL/);
  assert.match(feeds, /expires_at IS NULL OR expires_at > UTC_TIMESTAMP\(3\)/);
});

test('ICS output is escaped, UTC based, scoped and access audited', () => {
  assert.match(feeds, /BEGIN:VCALENDAR/);
  assert.match(feeds, /VERSION:2\.0/);
  assert.match(feeds, /METHOD:PUBLISH/);
  assert.match(feeds, /replaceAll\(',', '\\\\,'\)/);
  assert.match(feeds, /replaceAll\(';', '\\\\;'\)/);
  assert.match(feeds, /calendar_feed_access_log/);
  assert.match(feeds, /ip_hash/);
  assert.match(feeds, /user_agent_hash/);
  assert.match(feeds, /b\.coordinator_login_id = \?/);
  assert.match(feeds, /cp\.employee_id = \?/);
});

test('self-service and governance APIs enforce server-side permissions', () => {
  assert.match(notificationRoutes, /requirePermission\('notify\.view_self'\)/);
  assert.match(notificationRoutes, /requirePermission\('notify\.audit'\)/);
  assert.match(notificationRoutes, /requirePermission\('notify\.configure'\)/);
  assert.match(calendarRoutes, /requirePermission\('calendar\.feed_self'\)/);
  assert.match(calendarRoutes, /requirePermission\('calendar\.manage_scope'\)/);
  assert.match(calendarRoutes, /Provider secrets must be supplied through protected environment or OAuth connections/);
  assert.match(calendarRoutes, /Cache-Control', 'private, no-store/);
});

test('notification runtime and hooks are mounted before product routes and SPA fallback', () => {
  const runtimeMount = server.indexOf("app.use('/api', notificationRuntime)");
  const hookMount = server.indexOf("app.use('/api', notificationEventHooks)");
  const notificationMount = server.indexOf("app.use('/api/notifications', notificationRoutes)");
  const iltMount = server.indexOf("app.use('/api/ilt', iltRoutes)");
  const fallback = server.indexOf("app.get('*'");
  assert.ok(runtimeMount > 0);
  assert.ok(hookMount > runtimeMount);
  assert.ok(notificationMount > hookMount);
  assert.ok(iltMount > notificationMount);
  assert.ok(fallback > iltMount);
  assert.match(runtime, /LMS_RUN_SCHEDULERS === 'true'/);
  assert.match(runtime, /setInterval\(\(\) => runCycle\('worker'\), 60_000\)/);
  assert.match(runtime, /if \(running\) return null/);
});
