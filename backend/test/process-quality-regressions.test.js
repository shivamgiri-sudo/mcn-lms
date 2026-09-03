import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Process Quality is an ERROR RATE: lower is better, and the average must land at or
// below the configured ceiling. That is the opposite direction to every other
// certification gate, so the comparison is tested directly rather than through the
// route. The two helpers are sliced out of the source and evaluated, so no database.
const src = readFileSync(new URL('../src/routes/coordinatorStability.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function pick(name) {
  const start = src.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `${name} must stay exported for this test`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `could not find the end of ${name}`);
  return src.slice(start, end + 2).replace(/^export /, '');
}

const { summarisePq, pqDayNumber } = new Function(
  `${pick('pqDayNumber')}\n${pick('summarisePq')}\nreturn { summarisePq, pqDayNumber };`,
)();

// Onfido: no more than a 2.5% error rate, averaged over a 5-day window.
const rule = { pqRequired: true, pqMaxErrorPct: 2.5, pqDays: 5 };
const day = (n, errorPct, conductedAt = '2026-09-01T00:00:00Z') => ({ evidenceType: `pq_day${n}`, scorePct: errorPct, conductedAt });

test('day numbers are parsed only from well-formed pq types', () => {
  assert.equal(pqDayNumber('pq_day1'), 1);
  assert.equal(pqDayNumber('pq_day12'), 12);
  assert.equal(pqDayNumber('mock_call'), null);
  assert.equal(pqDayNumber('pq_day'), null);
  assert.equal(pqDayNumber(''), null);
});

test('LOWER error rate passes — a clean week is certifiable', () => {
  const pq = summarisePq([day(1, 1.2), day(2, 0.8), day(3, 2.0)], rule);
  assert.equal(pq.recordedCount, 3);
  assert.equal(pq.average, 1.33);
  assert.equal(pq.meetsTarget, true);
});

test('HIGHER error rate fails — the direction is not inverted', () => {
  const pq = summarisePq([day(1, 4.0), day(2, 3.5), day(3, 5.0)], rule);
  assert.equal(pq.average, 4.17);
  assert.equal(pq.meetsTarget, false, 'a 4.17% error rate must never certify against a 2.5% ceiling');
});

test('exactly on the ceiling passes', () => {
  assert.equal(summarisePq([day(1, 2.5), day(2, 2.5)], rule).meetsTarget, true);
});

test('a hair over the ceiling fails', () => {
  assert.equal(summarisePq([day(1, 2.51)], rule).meetsTarget, false);
});

test('a zero error rate is the best possible result, not the worst', () => {
  const pq = summarisePq([day(1, 0), day(2, 0)], rule);
  assert.equal(pq.average, 0);
  assert.equal(pq.meetsTarget, true);
});

test('average is taken across the days actually recorded, not all configured days', () => {
  // 3 of 5 days recorded: a trainee mid-week is judged on what exists.
  const pq = summarisePq([day(1, 1.0), day(2, 2.0), day(3, 3.0)], rule);
  assert.equal(pq.recordedCount, 3);
  assert.equal(pq.average, 2);
  assert.equal(pq.meetsTarget, true);
});

test('one bad day can be carried by the rest of the week', () => {
  const pq = summarisePq([day(1, 6.0), day(2, 1.0), day(3, 1.0), day(4, 1.0), day(5, 1.0)], rule);
  assert.equal(pq.average, 2);
  assert.equal(pq.meetsTarget, true);
});

test('no scores recorded is not a pass', () => {
  const pq = summarisePq([], rule);
  assert.equal(pq.average, null);
  assert.equal(pq.recordedCount, 0);
  assert.equal(pq.meetsTarget, false);
});

test('a day re-scored later supersedes the earlier attempt instead of averaging both', () => {
  const pq = summarisePq([
    day(1, 9.0, '2026-09-01T10:00:00Z'),
    day(1, 1.0, '2026-09-02T10:00:00Z'),
    day(2, 1.0),
  ], rule);
  assert.equal(pq.recordedCount, 2, 'day 1 must count once');
  assert.equal(pq.average, 1);
  assert.equal(pq.meetsTarget, true);
});

test('days beyond the configured count are ignored', () => {
  const pq = summarisePq([day(1, 1.0), day(9, 90)], { ...rule, pqDays: 5 });
  assert.equal(pq.recordedCount, 1);
  assert.equal(pq.average, 1);
});

test('other evidence types never leak into the PQ average', () => {
  const pq = summarisePq([
    { evidenceType: 'mock_call', scorePct: 95 },
    { evidenceType: 'internal', scorePct: 88 },
    day(1, 1.0),
  ], rule);
  assert.equal(pq.recordedCount, 1, 'a 95% mock-call score must not be read as a 95% error rate');
  assert.equal(pq.average, 1);
});

test('the ceiling is configurable per process', () => {
  const scores = [day(1, 4.0)];
  assert.equal(summarisePq(scores, { ...rule, pqMaxErrorPct: 2.5 }).meetsTarget, false);
  assert.equal(summarisePq(scores, { ...rule, pqMaxErrorPct: 5 }).meetsTarget, true);
});

test('a process with PQ switched off reports required false', () => {
  assert.equal(summarisePq([day(1, 90)], { pqRequired: false, pqMaxErrorPct: 2.5, pqDays: 5 }).required, false);
});

test('recorded days come back in day order for display', () => {
  const pq = summarisePq([day(3, 3), day(1, 1), day(2, 2)], rule);
  assert.deepEqual(pq.recorded.map(r => r.day), [1, 2, 3]);
});

test('the evaluator blocks on PQ and words it as an error rate, not a score', () => {
  assert.match(src, /if \(pq\.required\)/);
  assert.match(src, /No Process Quality scores recorded yet/);
  assert.match(src, /Process Quality error rate \$\{pq\.average\}% across/);
  assert.match(src, /exceeds the \$\{pq\.maxError\}% limit/);
  // The summary must reach the client so the coordinator can see the day figures.
  assert.match(src, /thresholds, pq, ruleId/);
});
