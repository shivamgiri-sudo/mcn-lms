import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\/.*$/gm, '');

// Source-text checks (see CLAUDE.md): they prove wiring, not behaviour.
test('classroom certification is derived from assigned classrooms only', () => {
  const src = read('../src/services/classroomCertification.js');
  for (const used of ['traineeClassroomMap', 'moduleMaster', 'contentProgress', 'assessmentMaster', 'assessmentResult']) {
    assert.match(src, new RegExp(`prisma\.${used}\.`), used);
  }
  for (const unrelated of ['attendancePct', 'ojtReady', 'handoverToOps', 'typing', 'forcePasswordReset']) {
    assert.doesNotMatch(stripComments(src), new RegExp(unrelated), unrelated);
  }
  assert.match(src, /ids\.length > 0 && done === ids\.length && assess\.allPassed/);
});

test('My Journey and the coordinator certify check share the same calculation', () => {
  assert.match(read('../src/controllers/traineeJourney.js'), /getClassroomCertification\(employeeId\)/);
  const coord = read('../src/routes/coordinatorStability.js');
  assert.match(coord, /getClassroomCertification\(trainee\.employeeId, trainee\.process\)/);
  assert.doesNotMatch(coord, /Course completion \$\{Number\(trainee\.courseCompletionPct/);
});

test('journey tab shows the process certification layout, not the 8-stage cards', () => {
  const ui = read('../../frontend/src/pages/Trainee/LearningJourneyTab.jsx');
  assert.match(ui, /My Process Certification Journey/);
  assert.match(ui, /100% – Certified/);
  assert.doesNotMatch(ui, /Personal capability journey|Recommended next action|stages complete/i);
});

test('a certification already on record (incl. bulk historical import) lifts the process result', () => {
  const src = read('../src/services/classroomCertification.js');
  assert.match(src, /\['Certified', 'HandedOver'\]\.includes\(trainee\?\.certificationStatus\)/);
  assert.match(src, /overallCertified: recordedCertified \|\|/);
  assert.match(read('../../frontend/src/pages/Trainee/LearningJourneyTab.jsx'), /Certification on record/);
});
