import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Acknowledgement is a non-repudiation feature: a learner attests to having read
// content, and that attestation must be impossible to fake, impossible to skip
// past, and impossible to retroactively strip from people who already finished
// content before this existed. Each of those properties is asserted directly
// against the source, the same pattern route-mounting-regressions.test.js and
// process-quality-regressions.test.js use for behaviour that needs a live server
// or database to exercise end to end.

const routes = readFileSync(new URL('../src/routes/traineeStability.js', import.meta.url), 'utf8');
const schemaSvc = readFileSync(new URL('../src/services/contentProgressSchema.js', import.meta.url), 'utf8');
const prismaSchema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('isComplete requires both time-completion AND an explicit acknowledgement', () => {
  const fn = routes.match(/function isComplete\(row\) \{[\s\S]*?\n\}/)[0];
  assert.match(fn, /completionStatus === 'Completed'/);
  assert.match(fn, /completionPct[\s\S]{0,40}>= 100/);
  assert.match(fn, /timeComplete && Boolean\(row\?\.acknowledgedAt\)/, 'a purely time-based completion must not satisfy isComplete on its own');
});

test('the acknowledge route requires the content to be opened and time-complete first', () => {
  const start = routes.indexOf("router.post('/content/:contentId/acknowledge'");
  assert.notEqual(start, -1, 'the acknowledge route must exist');
  const end = routes.indexOf("router.post('/assessment", start) > -1 ? routes.indexOf('\nasync function getOrCreateAttempt', start) : routes.length;
  const block = routes.slice(start, end);
  assert.match(block, /if \(!progress\?\.opened\)/, 'must not allow acknowledging content that was never opened');
  assert.match(block, /Finish the content before you can acknowledge it/, 'must require time-completion before acknowledgement is accepted');
});

test('the acknowledgement text is built server-side, never taken from the client', () => {
  const start = routes.indexOf("router.post('/content/:contentId/acknowledge'");
  const end = routes.indexOf('\nasync function getOrCreateAttempt', start);
  const block = routes.slice(start, end);
  assert.doesNotMatch(block, /req\.body\?\.acknowledgementText/, 'a client-supplied attestation sentence could be tampered with');
  assert.match(block, /acknowledgementText = `I acknowledge that I have read and understood/, 'the sentence must be generated from the resolved content, not trusted input');
});

test('acknowledgement captures IP and user agent, and is idempotent once set', () => {
  const start = routes.indexOf("router.post('/content/:contentId/acknowledge'");
  const end = routes.indexOf('\nasync function getOrCreateAttempt', start);
  const block = routes.slice(start, end);
  assert.match(block, /acknowledgedIp = String\(req\.ip/);
  assert.match(block, /acknowledgedUserAgent = String\(req\.headers\['user-agent'\]/);
  assert.match(block, /if \(progress\.acknowledgedAt\) \{/, 'a repeat acknowledgement must not overwrite the original timestamp/IP');
});

test('acknowledgement is written to the audit trail', () => {
  const start = routes.indexOf("router.post('/content/:contentId/acknowledge'");
  const end = routes.indexOf('\nasync function getOrCreateAttempt', start);
  const block = routes.slice(start, end);
  assert.match(block, /action: 'ACKNOWLEDGE_CONTENT'/);
});

test('sequential unlock and assessment submission route through the same gate, unmodified', () => {
  // These call sites existed before acknowledgement was added; the guarantee is
  // that isComplete() changing underneath them is what makes the gate apply
  // everywhere at once, not that they were rewritten. Four sites: the content
  // lock map, the assessment lock meta, the assessment prerequisite blocker used
  // server-side at submit time, and the sequential-unlock check on /open.
  const callSites = [...routes.matchAll(/!isComplete\(progressMap[^)]*\)\)/g)];
  assert.equal(callSites.length, 4, `expected 4 isComplete() gate call sites, found ${callSites.length}`);
});

test('a pre-existing completion is grandfathered rather than retroactively locked', () => {
  // Acknowledgement did not exist before this feature. Without a backfill, every
  // trainee who had already finished content would suddenly fail isComplete() the
  // moment this deployed, locking sequential unlock and assessment submission
  // platform-wide for people who did nothing wrong.
  assert.match(schemaSvc, /UPDATE content_progress/);
  assert.match(schemaSvc, /SET acknowledged_at = COALESCE\(completed_at, updated_at\)/);
  assert.match(schemaSvc, /WHERE acknowledged_at IS NULL/, 'the backfill must only touch rows with no acknowledgement, so it is a no-op after the first boot');
  assert.match(schemaSvc, /completion_status = 'Completed' OR completion_pct >= 100/);
});

test('the acknowledgement columns are idempotently added, matching the project convention', () => {
  assert.match(schemaSvc, /information_schema\.columns/);
  assert.match(schemaSvc, /ALTER TABLE content_progress ADD COLUMN/);
});

test('acknowledgedAt is a real Prisma field, so findMany() call sites pick it up with no select changes', () => {
  const model = prismaSchema.match(/model ContentProgress \{[\s\S]*?\n\}/)[0];
  assert.match(model, /acknowledgedAt\s+DateTime\?\s+@map\("acknowledged_at"\)/);
  assert.match(model, /acknowledgedIp\s+String\?\s+@map\("acknowledged_ip"\)/);
  assert.match(model, /acknowledgementText\s+String\?\s+@db\.Text\s+@map\("acknowledgement_text"\)/);
});
