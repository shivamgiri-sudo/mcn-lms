import { prisma } from '../utils/db.js';

// The quarterly ISMS test reuses ONE assessment (same assessmentId) every quarter, so
// anything keyed on (employee, assessment) -- the attempt count, extra-attempt grants
// and the single running-best assessment_results row -- would carry last quarter into
// this one. A "cycle" is the window that opens when the employee's latest quarterly
// assignment (isms_quarterly_assignment.assigned_at) was made. Callers scope their
// reads to it; nothing is ever deleted, so every earlier quarter stays in
// assessment_attempts and the ledger.
//
// Only the quarterly ISMS assessment has ledger rows, so for every other assessment
// these return null / empty and callers fall back to their existing behaviour.

export async function currentCycleStart(employeeId, assessmentId) {
  const row = await prisma.ismsQuarterlyAssignment.findFirst({
    where: { employeeId, assessmentId },
    orderBy: { assignedAt: 'desc' },
    select: { assignedAt: true },
  });
  return row?.assignedAt || null;
}

// assessmentId -> cycle start, for a list of assessments in one query.
export async function cycleStartsFor(employeeId, assessmentIds) {
  const starts = new Map();
  if (!assessmentIds?.length) return starts;
  const rows = await prisma.ismsQuarterlyAssignment.findMany({
    where: { employeeId, assessmentId: { in: assessmentIds } },
    select: { assessmentId: true, assignedAt: true },
  });
  for (const row of rows) {
    const seen = starts.get(row.assessmentId);
    if (!seen || row.assignedAt > seen) starts.set(row.assessmentId, row.assignedAt);
  }
  return starts;
}

// An assessment_results row is "this cycle's" only if its last attempt falls inside the cycle.
export function resultInCycle(result, cycleStart) {
  if (!result || !cycleStart) return result || null;
  return result.lastAttemptAt && new Date(result.lastAttemptAt) >= new Date(cycleStart) ? result : null;
}

// Where-clause fragments that confine attempt / grant counts to the cycle.
export const attemptCycleFilter = (cycleStart) => (cycleStart ? { startedAt: { gte: cycleStart } } : {});
export const grantCycleFilter = (cycleStart) => (cycleStart ? { createdAt: { gte: cycleStart } } : {});

// Best submitted attempt inside the cycle, shaped like an assessment_results row.
export async function cycleBestResult(employeeId, assessmentId, cycleStart) {
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { employeeId, assessmentId, submittedAt: { not: null }, result: { in: ['Pass', 'Fail'] }, startedAt: { gte: cycleStart } },
    orderBy: { startedAt: 'asc' },
  });
  if (!attempts.length) return null;
  const best = attempts.reduce((b, a) => (!b || a.percentage > b.percentage ? a : b), null);
  return {
    employeeId, assessmentId,
    bestScore: best.score, bestPercentage: best.percentage,
    result: attempts.some(a => a.result === 'Pass') ? 'Pass' : 'Fail',
    totalAttempts: attempts.length,
    lastAttemptAt: attempts[attempts.length - 1].submittedAt,
  };
}
