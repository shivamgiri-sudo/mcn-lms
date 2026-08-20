import { prisma } from '../utils/db.js';
import { badgeCatalog } from '../utils/leaderboardEngine.js';

const BADGES_BY_ID = new Map(badgeCatalog().map(badge => [badge.id, badge]));

function decorateBadges(badgesJson) {
  const ids = Array.isArray(badgesJson) ? badgesJson : [];
  return ids.map(id => BADGES_BY_ID.get(id) || { id, label: id, description: '' });
}

function toRankedRow(row, rank) {
  return {
    rank,
    employeeId: row.employeeId,
    traineeName: row.traineeName,
    batchNo: row.batchNo,
    branch: row.branch,
    process: row.process,
    lob: row.lob,
    totalPoints: row.totalPoints,
    coursePoints: row.coursePoints,
    assessmentPoints: row.assessmentPoints,
    attendancePoints: row.attendancePoints,
    certificationPoints: row.certificationPoints,
    badges: decorateBadges(row.badgesJson),
  };
}

// ── Trainee: my rank + points + badges + scoped top-N ──────────────────────────
export async function getMyLeaderboard(req, res) {
  try {
    const empId = req.userId;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: empId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    // Scope: batch first, falling back to branch, then process, then company-wide —
    // whichever is the narrowest group this trainee actually belongs to.
    const scopeWhere = trainee.batchNo
      ? { batchNo: trainee.batchNo }
      : trainee.branch
        ? { branch: trainee.branch }
        : trainee.process
          ? { process: trainee.process }
          : {};
    const scopeLabel = trainee.batchNo ? 'batch' : trainee.branch ? 'branch' : trainee.process ? 'process' : 'company';

    const [myScore, scopedRows, myRankAbove] = await Promise.all([
      prisma.traineeLeaderboardScore.findUnique({ where: { employeeId: empId } }),
      prisma.traineeLeaderboardScore.findMany({
        where: scopeWhere,
        orderBy: { totalPoints: 'desc' },
        take: 10,
      }),
      prisma.traineeLeaderboardScore.count({
        where: { ...scopeWhere, totalPoints: { gt: 0 } },
      }),
    ]);

    const myPoints = myScore?.totalPoints || 0;
    const rankAheadOfMe = myPoints > 0
      ? await prisma.traineeLeaderboardScore.count({ where: { ...scopeWhere, totalPoints: { gt: myPoints } } })
      : null;
    const myRank = rankAheadOfMe != null ? rankAheadOfMe + 1 : null;

    res.json({
      ok: true,
      data: {
        me: {
          employeeId: empId,
          totalPoints: myPoints,
          coursePoints: myScore?.coursePoints || 0,
          assessmentPoints: myScore?.assessmentPoints || 0,
          attendancePoints: myScore?.attendancePoints || 0,
          certificationPoints: myScore?.certificationPoints || 0,
          badges: decorateBadges(myScore?.badgesJson),
          rank: myRank,
        },
        scope: scopeLabel,
        top: scopedRows.map((row, index) => toRankedRow(row, index + 1)),
        totalRanked: myRankAbove,
      },
    });
  } catch (err) {
    console.error('[Leaderboard] getMyLeaderboard failed:', err.message);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

function buildFilterWhere(query) {
  const where = {};
  if (query.batchNo) where.batchNo = query.batchNo;
  if (query.branch) where.branch = query.branch;
  if (query.process) where.process = query.process;
  if (query.lob) where.lob = query.lob;
  return where;
}

// ── Admin: full filterable/sortable leaderboard ─────────────────────────────────
export async function getLeaderboardAdmin(req, res) {
  try {
    const where = buildFilterWhere(req.query || {});
    const take = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const skip = Math.max(parseInt(req.query?.offset, 10) || 0, 0);

    const [rows, total] = await Promise.all([
      prisma.traineeLeaderboardScore.findMany({ where, orderBy: { totalPoints: 'desc' }, take, skip }),
      prisma.traineeLeaderboardScore.count({ where }),
    ]);

    res.json({
      ok: true,
      data: {
        rows: rows.map((row, index) => toRankedRow(row, skip + index + 1)),
        total,
        limit: take,
        offset: skip,
      },
    });
  } catch (err) {
    console.error('[Leaderboard] getLeaderboardAdmin failed:', err.message);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Coordinator: filterable leaderboard scoped to their own batches ────────────
export async function getLeaderboardCoordinator(req, res) {
  try {
    const ownedBatches = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: req.userId },
      select: { batchNo: true },
    });
    const ownedBatchNos = ownedBatches.map(b => b.batchNo);
    if (!ownedBatchNos.length) return res.json({ ok: true, data: { rows: [], total: 0, limit: 50, offset: 0 } });

    const where = { ...buildFilterWhere(req.query || {}), batchNo: { in: ownedBatchNos } };
    if (req.query?.batchNo && !ownedBatchNos.includes(req.query.batchNo)) {
      return res.status(403).json({ ok: false, message: 'Access denied.' });
    }
    const take = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const skip = Math.max(parseInt(req.query?.offset, 10) || 0, 0);

    const [rows, total] = await Promise.all([
      prisma.traineeLeaderboardScore.findMany({ where, orderBy: { totalPoints: 'desc' }, take, skip }),
      prisma.traineeLeaderboardScore.count({ where }),
    ]);

    res.json({
      ok: true,
      data: {
        rows: rows.map((row, index) => toRankedRow(row, skip + index + 1)),
        total,
        limit: take,
        offset: skip,
      },
    });
  } catch (err) {
    console.error('[Leaderboard] getLeaderboardCoordinator failed:', err.message);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
