import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreTypingAttempt, alignTypedText } from '../src/utils/typingAccuracy.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('typing test: Gross/Net WPM match the spec\'s own worked example exactly', () => {
  // Spec: "If the user types 1,000 characters in 5 minutes: 1000/5=200 words,
  // 200/5 minutes = 40 WPM." A perfect (error-free) attempt of that shape should
  // score Gross WPM 40, Accuracy 100%, Net WPM 40.
  const text = 'x'.repeat(1000);
  const result = scoreTypingAttempt({ original: text, typed: text, elapsedSeconds: 300 });
  assert.equal(result.grossWpm, 40);
  assert.equal(result.accuracyPct, 100);
  assert.equal(result.netWpm, 40);
});

test('typing test: Net WPM = Gross WPM * (Accuracy / 100), per the spec\'s example', () => {
  // Spec: Gross 40, Accuracy 95% => Net 38.
  const original = 'a'.repeat(1000);
  const typed = original.split('');
  for (let i = 0; i < 50; i++) typed[i * 20] = 'b'; // exactly 50 substitutions => 95% accuracy against 1000 expected chars
  const result = scoreTypingAttempt({ original, typed: typed.join(''), elapsedSeconds: 300 });
  assert.equal(result.accuracyPct, 95);
  assert.equal(result.grossWpm, 40);
  assert.equal(result.netWpm, 38);
});

test('typing test: a single missing character does not cascade into the rest of the paragraph being marked wrong', () => {
  // This is the specific failure mode Levenshtein alignment exists to avoid: a
  // same-index comparison would treat every character after the dropped 'o' as
  // shifted and therefore wrong. Edit-distance alignment must count exactly one
  // error here.
  const original = 'The quick brown fox jumps over the lazy dog and runs away quickly into the forest.';
  const typed = 'The quick brown fx jumps over the lazy dog and runs away quickly into the forest.';
  const { editDistance } = alignTypedText(original, typed);
  assert.equal(editDistance, 1);
  const result = scoreTypingAttempt({ original, typed, elapsedSeconds: 60 });
  assert.equal(result.incorrectChars, 1);
  assert.ok(result.accuracyPct > 95, `expected high accuracy for a single dropped character, got ${result.accuracyPct}`);
});

test('typing test: capitalization and punctuation differences count as errors', () => {
  const original = 'Hello, World.';
  const typed = 'hello world';
  const { ops } = alignTypedText(original, typed);
  const substitutions = ops.filter(o => o.type === 'substitute').length;
  const missing = ops.filter(o => o.type === 'missing').length;
  assert.ok(substitutions >= 1, 'capitalization difference (H vs h) must be a substitution');
  assert.ok(missing >= 1, 'dropped comma/full stop must count as a missing character');
});

test('typing test: accuracy is always clamped between 0 and 100', () => {
  const wildlyWrong = scoreTypingAttempt({ original: 'short', typed: 'a'.repeat(500), elapsedSeconds: 60 });
  assert.ok(wildlyWrong.accuracyPct >= 0 && wildlyWrong.accuracyPct <= 100);
  const nothingTyped = scoreTypingAttempt({ original: 'hello world', typed: '', elapsedSeconds: 60 });
  assert.equal(nothingTyped.accuracyPct, 0);
  assert.equal(nothingTyped.grossWpm, 0);
  assert.equal(nothingTyped.netWpm, 0);
});

test('typing test: extremely long typed input is truncated before the O(n*m) alignment runs', () => {
  // Defends the Levenshtein DP matrix against an oversized payload — a 5-minute
  // test cannot legitimately produce more than a few thousand characters.
  const huge = 'z'.repeat(50000);
  const result = scoreTypingAttempt({ original: 'short paragraph', typed: huge, elapsedSeconds: 300 });
  assert.ok(result.totalChars <= 8000, `expected typed text to be capped, got ${result.totalChars} chars`);
});

test('typing test: new route file is registered in server.js', () => {
  const server = read('backend/src/server.js');
  assert.match(server, /import typingTestRoutes from '\.\/routes\/typingTest\.js'/);
  assert.match(server, /app\.use\('\/api\/typing-test',\s*typingTestRoutes\)/);
});

test('typing test: trainee endpoints never trust client-reported timing for scoring', () => {
  const controller = read('backend/src/controllers/typingTest.js');
  // The attempt's elapsed time must be derived from the server-stored startedAt,
  // not from any client-supplied duration/elapsed field.
  assert.match(controller, /Date\.now\(\)\s*-\s*new Date\(attempt\.startedAt\)\.getTime\(\)/);
  assert.doesNotMatch(controller, /req\.body\?\.(elapsedSeconds|durationSeconds|timeTakenSeconds)/);
});

test('typing test: admin-only routes require admin role, trainee-only routes require trainee role', () => {
  const routes = read('backend/src/routes/typingTest.js');
  assert.match(routes, /const traineeAuth = \[requireSession, requireRole\('trainee'\)\]/);
  assert.match(routes, /const adminAuth = \[requireSession, requireRole\('admin'\)\]/);
  assert.match(routes, /router\.post\('\/start', \.\.\.traineeAuth/);
  assert.match(routes, /router\.put\('\/admin\/settings', \.\.\.adminAuth/);
});
