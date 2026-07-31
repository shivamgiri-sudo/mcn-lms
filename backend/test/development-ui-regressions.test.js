import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

async function frontend(relativePath) {
  return readFile(path.join(repoRoot, 'frontend', 'src', relativePath), 'utf8');
}

test('development hub reuses existing role sessions without a second login', async () => {
  const hub = await frontend('pages/Development/DevelopmentHubPage.jsx');
  const app = await frontend('App.jsx');
  assert.match(hub, /lms_token_trainee/);
  assert.match(hub, /lms_token_coordinator/);
  assert.match(hub, /lms_token_admin/);
  assert.match(hub, /never asks for separate credentials/);
  assert.match(app, /development-hub/);
  assert.match(app, /DevelopmentHubRoute/);
});

test('learner view exposes coaching evidence certification validity and blockers', async () => {
  const component = await frontend('pages/Development/LearnerDevelopmentView.jsx');
  assert.match(component, /\/development\/me/);
  assert.match(component, /Coaching & Credentials/);
  assert.match(component, /Credential history/);
  assert.match(component, /Certification renewal/);
  assert.match(component, /blockerReason/);
  assert.match(component, /learnerCommitment/);
});

test('coordinator view creates plans goals sessions signoff and renewal', async () => {
  const component = await frontend('pages/Development/CoordinatorDevelopmentView.jsx');
  assert.match(component, /\/development\/coordinator\/batches\//);
  assert.match(component, /Create coaching plan/);
  assert.match(component, /Add measurable goal/);
  assert.match(component, /Schedule coaching session/);
  assert.match(component, /Manager sign-off/);
  assert.match(component, /Issue renewal/);
});

test('admin view manages rules waivers revocation and coaching scope', async () => {
  const component = await frontend('pages/Development/AdminDevelopmentView.jsx');
  assert.match(component, /\/development\/admin\/dashboard/);
  assert.match(component, /\/development\/admin\/renewal-rules/);
  assert.match(component, /Waive renewal requirements/);
  assert.match(component, /Revoke credential/);
  assert.match(component, /detailed waiver reason/);
  assert.match(component, /Create scoped coaching plan/);
});

test('development layouts include desktop tablet and mobile breakpoints', async () => {
  const core = await readFile(path.join(repoRoot, 'frontend', 'src', 'pages', 'Development', 'developmentHub.css'), 'utf8');
  const operations = await readFile(path.join(repoRoot, 'frontend', 'src', 'pages', 'Development', 'developmentOperations.css'), 'utf8');
  const shell = await readFile(path.join(repoRoot, 'frontend', 'src', 'pages', 'Development', 'developmentShell.css'), 'utf8');
  assert.match(core, /@media\(max-width:850px\)/);
  assert.match(core, /@media\(max-width:600px\)/);
  assert.match(operations, /@media\(max-width:1050px\)/);
  assert.match(operations, /@media\(max-width:700px\)/);
  assert.match(shell, /@media\(max-width:460px\)/);
});
