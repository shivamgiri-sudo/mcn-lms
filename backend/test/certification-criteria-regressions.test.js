import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCriterion, evaluateCriteria, describeShortfall,
  parseEvidenceType, buildEvidenceType, formatValue,
} from '../src/services/certificationCriteria.js';

// These functions decide whether a person may be certified, so each measure and both
// comparison directions are asserted directly.

const crit = over => ({
  criterionKey: 'k', label: 'Gate', measure: 'single', direction: 'at_least',
  targetValue: 80, unit: 'percent', days: 0, blocks: true, sortOrder: 0, active: true, ...over,
});
const ev = (evidenceType, scorePct, conductedAt = '2026-09-01T00:00:00Z', result = 'Pass') =>
  ({ evidenceType, scorePct, conductedAt, result });

test('evidence types round-trip, and the pre-criteria pq spelling still parses', () => {
  assert.deepEqual(parseEvidenceType('email_audit'), { key: 'email_audit', day: null });
  assert.deepEqual(parseEvidenceType('pq#3'), { key: 'pq', day: 3 });
  assert.deepEqual(parseEvidenceType('pq_day3'), { key: 'pq', day: 3 });
  assert.equal(parseEvidenceType(''), null);
  assert.equal(buildEvidenceType('pq', 2), 'pq#2');
  assert.equal(buildEvidenceType('mock_call'), 'mock_call');
});

test('a key containing a hash-like name is not mistaken for a day', () => {
  assert.deepEqual(parseEvidenceType('client_round_2'), { key: 'client_round_2', day: null });
});

// ── single ───────────────────────────────────────────────────────────────────
test('single: at_least passes on or above target', () => {
  assert.equal(evaluateCriterion(crit(), [ev('k', 80)]).met, true);
  assert.equal(evaluateCriterion(crit(), [ev('k', 79.99)]).met, false);
});

test('single: the most recent entry stands, so a re-test replaces a failed attempt', () => {
  const result = evaluateCriterion(crit(), [
    ev('k', 40, '2026-09-01T09:00:00Z'),
    ev('k', 95, '2026-09-05T09:00:00Z'),
  ]);
  assert.equal(result.value, 95);
  assert.equal(result.met, true);
});

test('single: nothing recorded is never a pass', () => {
  const result = evaluateCriterion(crit(), []);
  assert.equal(result.value, null);
  assert.equal(result.met, false);
});

// ── at_most (error rates) ────────────────────────────────────────────────────
test('at_most: lower wins and the direction is not inverted', () => {
  const errorRate = crit({ direction: 'at_most', targetValue: 2.5 });
  assert.equal(evaluateCriterion(errorRate, [ev('k', 1.2)]).met, true);
  assert.equal(evaluateCriterion(errorRate, [ev('k', 2.5)]).met, true);
  assert.equal(evaluateCriterion(errorRate, [ev('k', 2.51)]).met, false);
  assert.equal(evaluateCriterion(errorRate, [ev('k', 9)]).met, false, 'a 9% error rate must never certify against a 2.5% limit');
});

// ── daily_average ────────────────────────────────────────────────────────────
const daily = crit({ measure: 'daily_average', direction: 'at_most', targetValue: 2.5, days: 5 });

test('daily_average: averages only the days recorded', () => {
  const result = evaluateCriterion(daily, [ev('k#1', 1), ev('k#2', 2), ev('k#3', 3)]);
  assert.equal(result.entries, 3);
  assert.equal(result.value, 2);
  assert.equal(result.met, true);
});

test('daily_average: a day re-scored later supersedes the earlier attempt', () => {
  const result = evaluateCriterion(daily, [
    ev('k#1', 9, '2026-09-01T09:00:00Z'),
    ev('k#1', 1, '2026-09-02T09:00:00Z'),
    ev('k#2', 1),
  ]);
  assert.equal(result.entries, 2);
  assert.equal(result.value, 1);
});

test('daily_average: days beyond the configured count are ignored', () => {
  const result = evaluateCriterion(daily, [ev('k#1', 1), ev('k#9', 99)]);
  assert.equal(result.entries, 1);
  assert.equal(result.value, 1);
});

test('daily_average: exposes each day in order for display', () => {
  const result = evaluateCriterion(daily, [ev('k#3', 3), ev('k#1', 1), ev('k#2', 2)]);
  assert.deepEqual(result.days_recorded.map(d => d.day), [1, 2, 3]);
});

// ── cumulative ───────────────────────────────────────────────────────────────
const sales = crit({ measure: 'cumulative', direction: 'at_least', targetValue: 50, unit: 'number' });

test('cumulative: entries add up towards the target', () => {
  const result = evaluateCriterion(sales, [ev('k', 20), ev('k', 15), ev('k', 20)]);
  assert.equal(result.value, 55);
  assert.equal(result.met, true);
});

test('cumulative: short of target fails, and does not use only the latest entry', () => {
  const result = evaluateCriterion(sales, [ev('k', 20), ev('k', 20)]);
  assert.equal(result.value, 40);
  assert.equal(result.met, false);
});

// ── completion ───────────────────────────────────────────────────────────────
const signoff = crit({ measure: 'completion', label: 'Client sign-off' });

test('completion: cleared by a passing entry, not by a failed one', () => {
  assert.equal(evaluateCriterion(signoff, [ev('k', 0, '2026-09-01T00:00:00Z', 'Pass')]).met, true);
  assert.equal(evaluateCriterion(signoff, [ev('k', 0, '2026-09-01T00:00:00Z', 'Fail')]).met, false);
  assert.equal(evaluateCriterion(signoff, []).met, false);
});

// ── blocking vs tracking ─────────────────────────────────────────────────────
test('only blocking criteria stop certification; tracked ones are still reported', () => {
  const criteria = [
    crit({ criterionKey: 'blocking', label: 'Client round', blocks: true, targetValue: 80 }),
    crit({ criterionKey: 'tracked', label: 'Email audit', blocks: false, targetValue: 90 }),
  ];
  const evidence = [ev('blocking', 50), ev('tracked', 10)];
  const { results, blockers } = evaluateCriteria(criteria, evidence);
  assert.equal(results.length, 2, 'both are evaluated and shown');
  assert.equal(blockers.length, 1, 'only the blocking one stops certification');
  assert.match(blockers[0], /Client round/);
});

test('inactive criteria are ignored entirely', () => {
  const { results, blockers } = evaluateCriteria([crit({ active: false })], []);
  assert.deepEqual(results, []);
  assert.deepEqual(blockers, []);
});

test('criteria are evaluated in the configured display order', () => {
  const { results } = evaluateCriteria([
    crit({ criterionKey: 'b', sortOrder: 2 }),
    crit({ criterionKey: 'a', sortOrder: 1 }),
  ], []);
  assert.deepEqual(results.map(r => r.criterionKey), ['a', 'b']);
});

test('evidence for one criterion never leaks into another', () => {
  const { results } = evaluateCriteria([
    crit({ criterionKey: 'mock_call', targetValue: 60 }),
    crit({ criterionKey: 'email_audit', targetValue: 90 }),
  ], [ev('mock_call', 95)]);
  assert.equal(results[0].met, true);
  assert.equal(results[1].met, false, 'the mock-call score must not satisfy the email audit');
});

// ── wording ──────────────────────────────────────────────────────────────────
test('shortfalls read correctly for each unit and direction', () => {
  assert.match(describeShortfall(evaluateCriterion(crit({ label: 'Email audit', targetValue: 90 }), [ev('k', 70)])),
    /Email audit 70% is below 90%/);
  assert.match(describeShortfall(evaluateCriterion(crit({ label: 'PQ', direction: 'at_most', targetValue: 2.5 }), [ev('k', 4)])),
    /PQ 4% exceeds the limit of 2.5%/);
  assert.match(describeShortfall(evaluateCriterion(sales, [ev('k', 10)])), /10 from 1 entry is below 50/);
  assert.match(describeShortfall(evaluateCriterion(signoff, [])), /Client sign-off is not marked complete/);
  assert.match(describeShortfall(evaluateCriterion(crit({ label: 'Mock call' }), [])), /No Mock call recorded yet \(min 80%\)/);
});

test('currency renders with a rupee symbol and Indian grouping', () => {
  assert.equal(formatValue(250000, 'currency'), '₹2,50,000');
  assert.equal(formatValue(12, 'number'), '12');
  assert.equal(formatValue(87.5, 'percent'), '87.5%');
});
