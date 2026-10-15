import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// Source-text checks (see CLAUDE.md): they prove wiring, not behaviour.
test('learner assessment engine scopes ISMS attempts, grants and best result to the current quarter', () => {
  const src = read('../src/services/assessmentIntelligence.js');
  assert.match(src, /import \{[^}]*currentCycleStart[^}]*\} from '\.\/ismsCycle\.js'/);
  // start-attempt limit, load, and submit all use the cycle filters
  assert.equal((src.match(/attemptCycleFilter\(cycleStart\)/g) || []).length, 3);
  assert.equal((src.match(/grantCycleFilter\(cycleStart\)/g) || []).length, 3);
  assert.match(src, /cycleBestResult\(employeeId, assessmentId, cycleStart\)/);
  assert.match(src, /carriedFromEarlierCycle/);
});

test('assigned-assessment status ignores a result from an earlier quarter', () => {
  const src = read('../src/controllers/trainee.js');
  assert.match(src, /resultInCycle\(r, cycleStarts\.get\(r\.assessmentId\)\)/);
});

test('cycle helper never deletes history', () => {
  const src = read('../src/services/ismsCycle.js');
  assert.doesNotMatch(src, /\.(delete|deleteMany|update|updateMany|upsert)\(/);
});

test('new quarter retires only earlier active ISMS assignment rows, and never for a back-filled past quarter', () => {
  const src = read('../src/services/ismsQuarterlyAssessment.js');
  assert.match(src, /if \(q\.key === getFinancialQuarter\(\)\.key\) await prisma\.assignedModule\.updateMany/);
  assert.match(src, /data: \{ active: false \}/);
  assert.doesNotMatch(src, /prisma\.(ismsQuarterlyAssignment|assessmentAttempt|assessmentResult)\.(delete|deleteMany)/);
});

test('report supports FY, quarter, employee, status and score filters with a Completed status', () => {
  const svc = read('../src/services/ismsQuarterlyAssessment.js');
  assert.match(svc, /ISMS_COMPLETION_STATUSES = \['Completed', 'Attempted', 'Not Attempted'\]/);
  assert.match(svc, /completionStatus = passed \? 'Completed' : 'Attempted'/);
  const ctl = read('../src/controllers/ismsQuarterlyReport.js');
  for (const f of ['q.fy', 'q.quarter', 'q.employeeId', 'q.status', 'q.minScore', 'q.maxScore']) assert.ok(ctl.includes(f), f);
  assert.match(ctl, /format === 'json'/);
  assert.match(ctl, /format === 'xlsx'/);
  const ui = read('../../frontend/src/pages/Admin/IsmsQuarterlyReport.jsx');
  assert.match(ui, /previewQuery="format=json"/);
  assert.match(read('../../frontend/src/pages/Admin/ReportsTab.jsx'), /<IsmsQuarterlyReport \/>/);
});

test('reassign restarts the current quarter without deleting history', () => {
  const svc = read('../src/services/ismsQuarterlyAssessment.js');
  const fn = svc.slice(svc.indexOf('export async function reassignCurrentQuarter'), svc.indexOf('// Reporting: because the same assessmentId'));
  assert.match(fn, /assignedModule\.createMany/);
  assert.match(fn, /data: \{ active: false \}/);
  assert.match(fn, /isExcludedDesignation/);
  assert.doesNotMatch(fn, /\.(delete|deleteMany)\(/);
  assert.doesNotMatch(fn, /prisma\.(ismsQuarterlyAssignment|assessmentAttempt|assessmentResult)\.(update|updateMany|upsert)/);
  // the cycle helper treats a Reassigned/new ISMS assignment row as the cycle start
  const cyc = read('../src/services/ismsCycle.js');
  assert.match(cyc, /assignedModule\.findFirst/);
  assert.match(read('../src/routes/ismsQuarterly.js'), /router\.post\('\/reassign-now', \.\.\.superAuth, reassignIsmsQuarterly\)/);
  assert.match(read('../../frontend/src/pages/Admin/IsmsQuarterlyTab.jsx'), /\/isms-quarterly\/reassign-now/);
});
