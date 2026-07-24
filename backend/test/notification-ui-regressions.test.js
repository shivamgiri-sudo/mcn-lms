import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const dock = readFileSync(new URL('../../frontend/src/pages/Notifications/NotificationDock.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/Notifications/notificationDock.css', import.meta.url), 'utf8');

test('notification center is mounted across the application shell', () => {
  assert.match(app, /import NotificationDock/);
  assert.match(app, /<NotificationDock \/>/);
});

test('the dock resolves existing learner, coordinator and admin sessions', () => {
  assert.match(dock, /lms_token_trainee/);
  assert.match(dock, /lms_token_coordinator/);
  assert.match(dock, /lms_token_admin/);
  assert.match(dock, /useLocation/);
});

test('notification center covers inbox, preferences, calendar and delivery health', () => {
  assert.match(dock, /\/notifications\/self\/inbox/);
  assert.match(dock, /\/notifications\/self\/preferences/);
  assert.match(dock, /\/calendar\/self\/tokens/);
  assert.match(dock, /\/notifications\/scope\/health/);
  assert.match(dock, /\/notifications\/scope\/outbox\?status=FAILED/);
  assert.match(dock, /Create and copy feed URL/);
  assert.match(dock, /Mandatory operational notices remain enabled/);
});

test('calendar feed secret is only shown from the create response', () => {
  assert.match(dock, /result\.data\.feedUrl/);
  assert.match(dock, /navigator\.clipboard\.writeText/);
  assert.match(dock, /The secret URL is shown only when created/);
  assert.doesNotMatch(dock, /item\.token\b/);
});

test('delivery failures are visible and explicitly retryable', () => {
  assert.match(dock, /Only failed deliveries/);
  assert.match(dock, /Delivery reset for the next worker cycle/);
  assert.match(dock, /attemptCount/);
  assert.match(dock, /maxAttempts/);
});

test('the notification center has responsive mobile behavior', () => {
  assert.match(styles, /position:fixed/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.match(styles, /width:100%/);
  assert.match(styles, /notify-fab/);
  assert.match(styles, /notify-panel/);
});
