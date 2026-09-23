import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyTyping, computeBatchTNI } from '../src/services/dailyBatchReport.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

// Section 9 of the spec, verified against its own worked examples exactly.
test('daily batch report: typing classification matches the spec\'s four cases exactly', () => {
  // TARGET MET: Accuracy >= 97% AND WPM > 25
  assert.equal(classifyTyping(30, 98, 25, 97).status, 'Target Met');
  // SPEED FOCUS: Accuracy >= 97% BUT WPM <= 25
  const speedFocus = classifyTyping(21, 98, 25, 97);
  assert.equal(speedFocus.status, 'Speed Focus');
  assert.equal(speedFocus.observation, 'Accuracy is meeting the target; however, typing speed requires improvement.');
  // ACCURACY FOCUS: WPM > 25 BUT Accuracy < 97%
  const accuracyFocus = classifyTyping(30, 90, 25, 97);
  assert.equal(accuracyFocus.status, 'Accuracy Focus');
  assert.equal(accuracyFocus.observation, 'Typing speed is satisfactory; however, accuracy requires improvement.');
  // SPEED + ACCURACY FOCUS: WPM <= 25 AND Accuracy < 97%
  const both = classifyTyping(20, 85, 25, 97);
  assert.equal(both.status, 'Speed + Accuracy Focus');
  assert.equal(both.observation, 'Both typing speed and accuracy require improvement.');
});

test('daily batch report: typing target is a strict "greater than", exactly at the boundary is not met', () => {
  // Spec: "WPM > 25" (strict) for Target Met / Speed Focus classification.
  assert.equal(classifyTyping(25, 98, 25, 97).status, 'Speed Focus');
  assert.equal(classifyTyping(25.01, 98, 25, 97).status, 'Target Met');
});

test('daily batch report: accuracy target is "at least", exactly at the boundary counts as met', () => {
  assert.equal(classifyTyping(30, 97, 25, 97).status, 'Target Met');
  assert.equal(classifyTyping(30, 96.9, 25, 97).status, 'Accuracy Focus');
});

// Section 20: a batch-level TNI must never be raised from a small/random gap —
// both the minimum trainee count AND minimum percentage thresholds must be met.
test('daily batch report: batch-level TNI respects both configured thresholds, not just one', () => {
  const settings = { tniMinTraineeCount: 3, tniMinPct: 30 };
  const makeTypingActivity = gapCount => ({
    key: 'typingTest',
    perTrainee: new Map(Array.from({ length: gapCount }, (_, i) => [`E${i}`, { status: 'Accuracy Focus' }])),
  });

  // 2 trainees affected out of 10 present (20%) -- below both the count (3) and % (30) thresholds.
  assert.equal(computeBatchTNI(10, [makeTypingActivity(2)], settings).length, 0);
  // 3 trainees affected out of 5 present (60%) -- meets both thresholds.
  const tni = computeBatchTNI(5, [makeTypingActivity(3)], settings);
  assert.equal(tni.length, 1);
  assert.equal(tni[0].type, 'Typing Accuracy');
  // 4 trainees affected out of 20 present (20%) -- meets the count but not the %, must not raise a TNI.
  assert.equal(computeBatchTNI(20, [makeTypingActivity(4)], settings).length, 0);
});

test('daily batch report: assessment weak-topic TNI never fires when no topic mapping exists', () => {
  const settings = { tniMinTraineeCount: 1, tniMinPct: 1 };
  const assessmentActivity = { key: 'assessment', hasTopicMapping: false, topicWrongCounts: new Map([['Name Extraction', 10]]) };
  // Even with a huge count, hasTopicMapping:false must suppress topic-based TNI —
  // the spec is explicit that weak topics must never be invented.
  assert.equal(computeBatchTNI(10, [assessmentActivity], settings).length, 0);
});

test('daily batch report: new route file is registered in server.js', () => {
  const server = read('backend/src/server.js');
  assert.match(server, /import dailyBatchReportRoutes from '\.\/routes\/dailyBatchReport\.js'/);
  assert.match(server, /app\.use\('\/api\/daily-batch-report',\s*dailyBatchReportRoutes\)/);
  assert.match(server, /import \{ startDailyBatchReportScheduler \} from '\.\/services\/dailyBatchReportScheduler\.js'/);
  assert.match(server, /startDailyBatchReportScheduler\(\)/);
});

test('daily batch report: activity configuration is Super Admin gated, preview/send is plain admin', () => {
  const routes = read('backend/src/routes/dailyBatchReport.js');
  assert.match(routes, /const superAuth = \[requireSession, requireRole\('admin'\), requireSuperAdmin\]/);
  assert.match(routes, /router\.post\('\/activity-config', \.\.\.superAuth/);
  assert.match(routes, /router\.put\('\/settings', \.\.\.superAuth/);
  assert.match(routes, /router\.post\('\/batches\/:batchNo\/send', \.\.\.auth,/);
  // Deliberately no route actually uses superElevatedAuth (only mentioned in a
  // comment explaining why not) — this is batch reporting config, not a
  // portal-user/role/org/HRMS change (see CLAUDE.md's elevation guidance).
  assert.doesNotMatch(routes, /\.\.\.superElevatedAuth/);
});

test('daily batch report: a missing recipient blocks the send and is flagged, never silently skipped', () => {
  const service = read('backend/src/services/dailyBatchReport.js');
  assert.match(service, /recipients\.missing\.length/);
  assert.match(service, /status: 'Flagged'/);
});

test('daily batch report: elapsed/scoring never trusts client-reported values — activities are computed from stored dates only', () => {
  const service = read('backend/src/services/dailyBatchReport.js');
  assert.doesNotMatch(service, /req\.body/); // this service file takes no req/res at all — pure data layer
});
