import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const dock = readFileSync(new URL('../../frontend/src/components/LearningToolsDock.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../frontend/src/components/learningToolsDock.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../frontend/src/utils/api.js', import.meta.url), 'utf8');

test('authenticated learning tools launcher is mounted beside notifications', () => {
  assert.match(app, /import LearningToolsDock/);
  assert.match(app, /<LearningToolsDock \/>/);
  assert.match(app, /<NotificationDock \/>/);
});

test('launcher resolves existing learner coordinator and admin sessions', () => {
  assert.match(dock, /lms_token_trainee/);
  assert.match(dock, /lms_token_coordinator/);
  assert.match(dock, /lms_token_admin/);
  assert.match(dock, /roleFromPath/);
  assert.match(dock, /No separate sign-in/);
});

test('launcher refreshes immediately when LMS tokens change', () => {
  assert.match(api, /lms:token-changed/);
  assert.match(api, /announceTokenChange\(type, Boolean\(token\)\)/);
  assert.match(api, /announceTokenChange\(type, false\)/);
  assert.match(dock, /window\.addEventListener\('lms:token-changed'/);
  assert.match(dock, /window\.addEventListener\('storage'/);
  assert.match(dock, /setSessionVersion\(value => value \+ 1\)/);
});

test('launcher links all three governed learning workspaces', () => {
  assert.match(dock, /\/training-calendar\?role=/);
  assert.match(dock, /\/development-hub\?role=/);
  assert.match(dock, /\/practical-assessments\?role=/);
  assert.match(dock, /Live Training/);
  assert.match(dock, /Development Hub/);
  assert.match(dock, /Practical Assessments/);
});

test('launcher closes accessibly and does not appear on password recovery', () => {
  assert.match(dock, /event\.key === 'Escape'/);
  assert.match(dock, /document\.addEventListener\('pointerdown'/);
  assert.match(dock, /location\.pathname === '\/reset-password'/);
  assert.match(dock, /aria-expanded=/);
});

test('launcher remains separate from the lower-right notification button on mobile', () => {
  assert.match(styles, /position:fixed/);
  assert.match(styles, /left:20px/);
  assert.match(styles, /bottom:20px/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.match(styles, /left:14px/);
});
