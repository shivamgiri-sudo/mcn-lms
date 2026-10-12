import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// Source-text checks (see CLAUDE.md): they prove wiring, not behaviour.
test('journey is derived from assigned classrooms only', () => {
  const src = read('../src/controllers/traineeJourney.js');
  for (const used of ['traineeClassroomMap', 'moduleMaster', 'contentProgress', 'assessmentMaster', 'assessmentResult']) {
    assert.match(src, new RegExp(`prisma\.${used}\.`), used);
  }
  for (const unrelated of ['attendancePct', 'ojtReady', 'handoverToOps', 'typing', 'forcePasswordReset']) {
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), new RegExp(unrelated), unrelated);
  }
  assert.match(src, /ids\.length > 0 && done === ids\.length && assess\.allPassed/);
});

test('journey tab shows the process certification layout, not the 8-stage cards', () => {
  const ui = read('../../frontend/src/pages/Trainee/LearningJourneyTab.jsx');
  assert.match(ui, /My Process Certification Journey/);
  assert.match(ui, /100% – Certified/);
  assert.doesNotMatch(ui, /Personal capability journey|Recommended next action|stages complete/i);
});
