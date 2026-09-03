import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// summarisePq decides whether an analyst may be certified, so its arithmetic is
// tested directly rather than through the route. The two helpers are sliced out of
// the source and evaluated, so the test needs no database.
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

const rule = { pqRequired: true, pqTargetPct: 85, pqDays: 5 };
const day = (n, scorePct, conductedAt = '2026-09-01T00:00:00Z') => ({ evidenceType: `pq_day${n}`, scorePct, conductedAt });

test('day numbers are parsed only from well-formed pq types', () => {
  assert.equal(pqDayNumber('pq_day1'), 1);
  assert.equal(pqDayNumber('pq_day12'), 12);
  assert.equal(pqDayNumber('mock_call'), null);
  assert.equal(pqDayNumber('pq_day'), null);
  assert.equal(pqDayNumber(''), null);
});

test('average is taken across the days actually recorded, not all configured days', () => {
  // 3 of 5 days recorded: a trainee mid-week is judged on what exists.
  const pq = summarisePq([day(1, 90), day(2, 80), day(3, 88)], rule);
  assert.equal(pq.recordedCount, 3);
  assert.equal(pq.average, 86);
  assert.equal(pq.meetsTarget, true);
});

test('an average below target fails and is reported to two decimals', () => {
  const pq = summarisePq([day(1, 78), day(2, 88), day(3, 84)], rule);
  assert.equal(pq.average, 83.33);
  assert.equal(pq.meetsTarget, false);
});

test('exactly on target passes', () => {
  assert.equal(summarisePq([day(1, 85), day(2, 85)], rule).meetsTarget, true);
});

test('no scores recorded is not a pass', () => {
  const pq = summarisePq([], rule);
  assert.equal(pq.average, null);
  assert.equal(pq.recordedCount, 0);
  assert.equal(pq.meetsTarget, false);
});

test('a day re-scored later supersedes the earlier attempt instead of averaging both', () => {
  const pq = summarisePq([
    day(1, 40, '2026-09-01T10:00:00Z'),
    day(1, 90, '2026-09-02T10:00:00Z'),
    day(2, 90),
  ], rule);
  assert.equal(pq.recordedCount, 2, 'day 1 must count once');
  assert.equal(pq.average, 90);
});

test('days beyond the configured count are ignored', () => {
  const pq = summarisePq([day(1, 90), day(9, 10)], { ...rule, pqDays: 5 });
  assert.equal(pq.recordedCount, 1);
  assert.equal(pq.average, 90);
});

test('other evidence types never leak into the PQ average', () => {
  const pq = summarisePq([
    { evidenceType: 'mock_call', scorePct: 10 },
    { evidenceType: 'internal', scorePct: 20 },
    day(1, 90),
  ], rule);
  assert.equal(pq.recordedCount, 1);
  assert.equal(pq.average, 90);
});

test('a process with PQ switched off reports required false', () => {
  const pq = summarisePq([day(1, 10)], { pqRequired: false, pqTargetPct: 85, pqDays: 5 });
  assert.equal(pq.required, false);
});

test('recorded days come back in day order for display', () => {
  const pq = summarisePq([day(3, 70), day(1, 90), day(2, 80)], rule);
  assert.deepEqual(pq.recorded.map(r => r.day), [1, 2, 3]);
});

test('the certification evaluator blocks on PQ and reports the shortfall', () => {
  assert.match(src, /if \(pq\.required\)/);
  assert.match(src, /No Process Quality scores recorded yet/);
  assert.match(src, /Process Quality average \$\{pq\.average\}% across/);
  // The summary must reach the client so the coordinator can see the day scores.
  assert.match(src, /thresholds, pq, ruleId/);
});
