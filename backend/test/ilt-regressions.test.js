import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260724170000_instructor_led_training/migration.sql', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../src/middleware/permissions.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/iltGovernance.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/ilt.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

const expectedTables = [
  'ilt_policy',
  'ilt_venue',
  'ilt_instructor',
  'ilt_session',
  'ilt_session_instructor',
  'ilt_session_prerequisite',
  'ilt_session_skill_map',
  'ilt_session_enrollment',
  'ilt_enrollment_event',
  'ilt_session_attendance',
  'ilt_session_resource',
  'ilt_session_feedback',
];

test('phase 4 migration defines the complete ILT relational lifecycle', () => {
  for (const table of expectedTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /UNIQUE KEY uq_ilt_session_employee \(session_id, employee_id\)/);
  assert.match(migration, /CONSTRAINT chk_ilt_session_time CHECK \(end_at > start_at\)/);
  assert.match(migration, /CONSTRAINT chk_ilt_feedback_rating CHECK \(rating BETWEEN 1 AND 5\)/);
});

test('ILT permissions are database-backed and scoped by role', () => {
  assert.match(permissions, /'ilt\.'/);
  for (const permission of [
    'ilt.view_self',
    'ilt.enroll_self',
    'ilt.manage_owned',
    'ilt.attendance_owned',
    'ilt.view_scope',
    'ilt.manage_scope',
    'ilt.configure',
    'ilt.report',
  ]) {
    assert.match(migration, new RegExp(permission.replace('.', '\\.')));
  }
  assert.match(migration, /'coordinator', '\*', 'ilt\.manage_owned', 1, 'own_batch'/);
  assert.match(migration, /'trainee', '\*', 'ilt\.enroll_self', 1, 'self'/);
  assert.match(migration, /'Super Admin', 'ilt\.manage_scope', 1, 'company'/);
});

test('seat assignment is concurrency-safe and promotes the waitlist FIFO', () => {
  assert.match(service, /prisma\.\$transaction\(async tx =>/);
  assert.match(service, /status IN \('CONFIRMED', 'ATTENDED'\) FOR UPDATE/);
  assert.match(service, /ORDER BY waitlist_position, enrolled_at[\s\S]*LIMIT 1 FOR UPDATE/);
  assert.match(service, /WAITLIST_PROMOTED/);
  assert.match(service, /SESSION_FULL/);
});

test('publication blocks venue, batch and instructor conflicts', () => {
  assert.match(service, /validateScheduleConflicts/);
  assert.match(service, /s\.venue_id = \?/);
  assert.match(service, /s\.batch_no = \?/);
  assert.match(service, /ilt_session_instructor/);
  assert.match(service, /LEAD_INSTRUCTOR_REQUIRED/);
  assert.match(service, /SCHEDULE_CONFLICT/);
});

test('check-in codes are hashed and constrained to a time window', () => {
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /checkin_code_hash/);
  assert.match(service, /CHECKIN_WINDOW_CLOSED/);
  assert.match(service, /INVALID_CHECKIN_CODE/);
  assert.doesNotMatch(migration, /checkin_code\s+VARCHAR/i);
});

test('attendance finalization preserves stronger HR attendance sources', () => {
  assert.match(service, /attendance_source IN \('Biometric', 'Manual', 'HRMS'\)/);
  assert.match(service, /ILT_ATTENDANCE/);
  assert.match(service, /locked_at = UTC_TIMESTAMP\(3\)/);
  assert.match(service, /syncEmployeeSkills/);
  assert.match(service, /syncLearningPaths/);
});

test('role routes enforce server-side permissions and ownership', () => {
  assert.match(routes, /requirePermission\('ilt\.view_self'\)/);
  assert.match(routes, /requirePermission\('ilt\.manage_owned'\)/);
  assert.match(routes, /requirePermission\('ilt\.attendance_owned'\)/);
  assert.match(routes, /requirePermission\('ilt\.manage_scope'\)/);
  assert.match(routes, /ownedBatch/);
  assert.match(routes, /ensureSessionScope/);
  assert.match(routes, /Coordinators must select an owned batch/);
});

test('ILT routes are mounted before the SPA fallback', () => {
  const mount = server.indexOf("app.use('/api/ilt', iltRoutes)");
  const fallback = server.indexOf('app.get(/^(?!\\/api\\/)');
  assert.ok(mount > 0, 'ILT route mount is missing');
  assert.ok(fallback > mount, 'ILT routes must be mounted before the SPA fallback');
});

test('bulk enrolment and recurring creation have explicit safety caps', () => {
  assert.match(routes, /repeatCount, 1, 1, 60/);
  assert.match(routes, /slice\(0, 1000\)/);
  assert.match(routes, /take: 1000/);
});
