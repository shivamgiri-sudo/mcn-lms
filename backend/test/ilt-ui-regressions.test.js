import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../frontend/src/pages/TrainingCalendar/TrainingCalendarPage.jsx', import.meta.url), 'utf8');
const learner = readFileSync(new URL('../../frontend/src/pages/TrainingCalendar/LearnerCalendarView.jsx', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../../frontend/src/pages/TrainingCalendar/OperationsCalendarView.jsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../../frontend/src/pages/TrainingCalendar/TrainingCalendarEntryCard.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/pages/TrainingCalendar/trainingCalendar.css', import.meta.url), 'utf8');
const traineePortal = readFileSync(new URL('../../frontend/src/pages/Trainee/DashboardView.jsx', import.meta.url), 'utf8');
const coordinatorPortal = readFileSync(new URL('../../frontend/src/pages/Coordinator/CoordDashboard.jsx', import.meta.url), 'utf8');
const adminPortal = readFileSync(new URL('../../frontend/src/pages/Admin/AdminConsole.jsx', import.meta.url), 'utf8');
const attendanceStability = readFileSync(new URL('../src/middleware/iltAttendanceStability.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('the live training calendar is registered as an authenticated application route', () => {
  assert.match(app, /import TrainingCalendarPage/);
  assert.match(app, /path="\/training-calendar"/);
  assert.match(shell, /lms_token_trainee/);
  assert.match(shell, /lms_token_coordinator/);
  assert.match(shell, /lms_token_admin/);
  assert.match(shell, /Back to portal/);
});

test('learner calendar covers enrolment, waitlist, check-in, cancellation and feedback', () => {
  assert.match(learner, /\/ilt\/trainee\/calendar/);
  assert.match(learner, /\/enroll/);
  assert.match(learner, /\/cancel/);
  assert.match(learner, /\/check-in/);
  assert.match(learner, /\/feedback/);
  assert.match(learner, /Waitlist position/);
  assert.match(learner, /pattern="\[0-9\]\{6\}"/);
  assert.match(learner, /Prerequisites pending/);
});

test('coordinator and admin operations expose the governed session lifecycle', () => {
  assert.match(operations, /Create live session/);
  assert.match(operations, /Publish/);
  assert.match(operations, /Enrol batch/);
  assert.match(operations, /Generate check-in code/);
  assert.match(operations, /Finalize attendance/);
  assert.match(operations, /Create venue/);
  assert.match(operations, /Instructor profile/);
  assert.match(operations, /Capacity and attendance policy/);
  assert.match(operations, /repeatCount/);
});

test('all primary portals expose role-aware live training entry points', () => {
  assert.match(entry, /training-calendar\?role=\$\{role\}/);
  assert.match(traineePortal, /Live Training/);
  assert.match(traineePortal, /TrainingCalendarEntryCard role="trainee"/);
  assert.match(coordinatorPortal, /TrainingCalendarEntryCard role="coordinator"/);
  assert.match(adminPortal, /Live Training Calendar/);
  assert.match(adminPortal, /TrainingCalendarEntryCard role="admin"/);
});

test('training calendar has explicit tablet and mobile layouts', () => {
  assert.match(styles, /@media\(max-width:1080px\)/);
  assert.match(styles, /@media\(max-width:720px\)/);
  assert.match(styles, /@media\(max-width:440px\)/);
  assert.match(styles, /ilt-modal-backdrop/);
  assert.match(styles, /ilt-operations-grid/);
});

test('explicit absent attendance is normalized before the ILT routes', () => {
  assert.match(attendanceStability, /attendanceStatus/);
  assert.match(attendanceStability, /attendedMinutes: 0/);
  const normalizerMount = server.indexOf("app.use('/api/ilt', normalizeIltAttendanceRequest)");
  const routesMount = server.indexOf("app.use('/api/ilt', iltRoutes)");
  assert.ok(normalizerMount > 0, 'ILT attendance normalizer is not mounted');
  assert.ok(routesMount > normalizerMount, 'attendance normalization must run before ILT route handlers');
});
