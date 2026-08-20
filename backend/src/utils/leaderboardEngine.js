import { prisma } from './db.js';

// ─── Leaderboard v1 point/badge catalog ────────────────────────────────────────
// Hardcoded rule table — no admin UI to author new points/badges yet. Points are
// awarded off signals that already exist elsewhere (content completion %,
// assessment pass %, attendance %, certification) rather than new tracking.
// Every award is idempotent: it upserts a row in TraineeLeaderboardEvent keyed
// by (employeeId, eventType, refId), then the score row is fully re-derived by
// summing that ledger — so a retried heartbeat or a duplicate call never
// double-counts.

export const LEADERBOARD_POINTS = {
  CONTENT_COMPLETE: 10,
  ASSESSMENT_PASS_BASE: 15,
  // Extra bonus on top of the base, tiered by the best percentage scored.
  ASSESSMENT_BONUS_TIERS: [
    { min: 95, bonus: 40 },
    { min: 85, bonus: 25 },
    { min: 75, bonus: 10 },
  ],
  // Milestone points for a consecutive-day attendance streak. Every milestone
  // reached is recorded as its own ledger row (refId = milestone day count),
  // so streaks award incrementally as they grow rather than all at once.
  ATTENDANCE_STREAK_MILESTONES: [
    { days: 3, points: 15 },
    { days: 7, points: 35 },
    { days: 14, points: 75 },
    { days: 30, points: 150 },
  ],
  CERTIFICATION: 150,
};

const FAST_STARTER_WINDOW_DAYS = 3;

// v1 badge catalog — fixed set, evaluated fresh on every recompute from the
// ledger + trainee record rather than stored as a one-way flag, so a badge
// can never be "stuck" out of sync with the data behind it.
export const LEADERBOARD_BADGES = [
  {
    id: 'FAST_STARTER',
    label: 'Fast Starter',
    description: `Completed a module within ${FAST_STARTER_WINDOW_DAYS} days of onboarding`,
    check: ctx => ctx.fastStarter,
  },
  {
    id: 'PERFECT_SCORE',
    label: 'Perfect Score',
    description: 'Scored 100% on an assessment',
    check: ctx => ctx.perfectScore,
  },
  {
    id: 'CONSISTENT_LEARNER',
    label: 'Consistent Learner',
    description: '7+ day attendance streak',
    check: ctx => ctx.maxStreak >= 7,
  },
];

function assessmentPoints(percentage) {
  const tier = LEADERBOARD_POINTS.ASSESSMENT_BONUS_TIERS.find(t => percentage >= t.min);
  return LEADERBOARD_POINTS.ASSESSMENT_PASS_BASE + (tier ? tier.bonus : 0);
}

// Upserts one ledger row. Points are set to the max of the existing and new
// value so a later, better attempt can raise a score but a re-fired identical
// (or worse) event never lowers or duplicates it.
async function recordEvent(employeeId, eventType, refId, points, meta) {
  if (!employeeId || !refId || !Number.isFinite(points) || points <= 0) return;
  const existing = await prisma.traineeLeaderboardEvent.findUnique({
    where: { employeeId_eventType_refId: { employeeId, eventType, refId } },
  });
  if (existing && existing.points >= points) return;
  await prisma.traineeLeaderboardEvent.upsert({
    where: { employeeId_eventType_refId: { employeeId, eventType, refId } },
    create: { employeeId, eventType, refId, points, meta: meta ?? undefined },
    update: { points, meta: meta ?? undefined },
  });
}

function categoryFor(eventType) {
  if (eventType === 'CONTENT_COMPLETE') return 'coursePoints';
  if (eventType === 'ASSESSMENT_PASS') return 'assessmentPoints';
  if (eventType === 'ATTENDANCE_STREAK') return 'attendancePoints';
  if (eventType === 'CERTIFICATION') return 'certificationPoints';
  return null;
}

// Re-derives the full score row (per-category totals, grand total, badges)
// from the event ledger. Safe to call as often as needed — pure re-aggregation.
export async function recomputeLeaderboardScore(employeeId) {
  const [trainee, events] = await Promise.all([
    prisma.traineeMaster.findUnique({ where: { employeeId } }),
    prisma.traineeLeaderboardEvent.findMany({ where: { employeeId } }),
  ]);
  if (!trainee) return null;

  const totals = { coursePoints: 0, assessmentPoints: 0, attendancePoints: 0, certificationPoints: 0 };
  let perfectScore = false;
  let fastStarter = false;
  let maxStreak = 0;

  for (const event of events) {
    const category = categoryFor(event.eventType);
    if (category) totals[category] += event.points;

    if (event.eventType === 'ASSESSMENT_PASS' && Number(event.meta?.percentage) >= 100) perfectScore = true;

    if (event.eventType === 'CONTENT_COMPLETE' && trainee.onboardingDate) {
      const ageDays = (event.createdAt.getTime() - new Date(trainee.onboardingDate).getTime()) / 86400000;
      if (ageDays >= 0 && ageDays <= FAST_STARTER_WINDOW_DAYS) fastStarter = true;
    }

    if (event.eventType === 'ATTENDANCE_STREAK') {
      const days = Number.parseInt(event.refId, 10);
      if (Number.isFinite(days) && days > maxStreak) maxStreak = days;
    }
  }

  const totalPoints = totals.coursePoints + totals.assessmentPoints + totals.attendancePoints + totals.certificationPoints;
  const context = { perfectScore, fastStarter, maxStreak };
  const badges = LEADERBOARD_BADGES.filter(badge => badge.check(context)).map(badge => badge.id);

  return prisma.traineeLeaderboardScore.upsert({
    where: { employeeId },
    create: {
      employeeId,
      traineeName: trainee.traineeName,
      batchNo: trainee.batchNo,
      branch: trainee.branch,
      process: trainee.process,
      lob: trainee.lob,
      totalPoints,
      ...totals,
      badgesJson: badges,
    },
    update: {
      traineeName: trainee.traineeName,
      batchNo: trainee.batchNo,
      branch: trainee.branch,
      process: trainee.process,
      lob: trainee.lob,
      totalPoints,
      ...totals,
      badgesJson: badges,
    },
  });
}

// ── Award hooks — called as side effects from existing trigger points ─────────
// Every function below is meant to be called fire-and-forget (`.catch(...)`)
// from the controller that already performs the underlying action, so a
// leaderboard failure can never break content playback, an assessment submit,
// attendance sync or certification.

export async function awardContentCompletion(employeeId, contentId) {
  await recordEvent(employeeId, 'CONTENT_COMPLETE', contentId, LEADERBOARD_POINTS.CONTENT_COMPLETE);
  await recomputeLeaderboardScore(employeeId);
}

export async function awardAssessmentPass(employeeId, assessmentId, percentage, attemptId) {
  if (!(percentage >= 0)) return;
  const points = assessmentPoints(percentage);
  await recordEvent(employeeId, 'ASSESSMENT_PASS', assessmentId, points, { percentage, attemptId });
  await recomputeLeaderboardScore(employeeId);
}

export async function awardCertification(employeeId) {
  await recordEvent(employeeId, 'CERTIFICATION', 'CERTIFICATION', LEADERBOARD_POINTS.CERTIFICATION);
  await recomputeLeaderboardScore(employeeId);
}

// Walks AttendanceInference backward day-by-day from today counting an
// unbroken run of Present days, then awards every streak milestone reached.
export async function awardAttendanceStreak(employeeId, batchNo) {
  if (!batchNo) return;
  const presentDates = await prisma.attendanceInference.findMany({
    where: { employeeId, batchNo, finalAttendance: 'Present' },
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
  });
  const presentDaySet = new Set(presentDates.map(row => new Date(row.date).setHours(0, 0, 0, 0)));

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (presentDaySet.has(cursor.getTime())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  if (streak <= 0) return;

  const reached = LEADERBOARD_POINTS.ATTENDANCE_STREAK_MILESTONES.filter(m => streak >= m.days);
  for (const milestone of reached) {
    await recordEvent(employeeId, 'ATTENDANCE_STREAK', String(milestone.days), milestone.points, { streak });
  }
  if (reached.length) await recomputeLeaderboardScore(employeeId);
}

export function badgeCatalog() {
  return LEADERBOARD_BADGES.map(({ id, label, description }) => ({ id, label, description }));
}
