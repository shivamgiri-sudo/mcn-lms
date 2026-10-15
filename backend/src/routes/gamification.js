/**
 * Gamification API Routes — Phase 2
 * /api/gamification/*
 */
import express from 'express';
import { requireSession } from '../middleware/auth.js';
import { prisma } from '../utils/db.js';
import {
  getGamificationDashboard,
  getXPStatus,
  getOrCreateStreak,
  getAchievements,
} from '../services/gamification.js';

const router = express.Router();
router.use(requireSession);

// ─── TRAINEE ENDPOINTS ──────────────────────────────────────────────────────────

// Get full gamification dashboard for current trainee
router.get('/dashboard', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'] || req.user?.employeeId;
    if (!employeeId) return res.status(401).json({ error: 'Employee ID required' });

    const dashboard = await getGamificationDashboard(employeeId);
    res.json(dashboard);
  } catch (err) {
    console.error('[Gamification] Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load gamification data' });
  }
});

// Get XP status only
router.get('/xp', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'] || req.user?.employeeId;
    if (!employeeId) return res.status(401).json({ error: 'Employee ID required' });

    const xp = await getXPStatus(employeeId);
    res.json(xp);
  } catch (err) {
    console.error('[Gamification] XP error:', err);
    res.status(500).json({ error: 'Failed to load XP data' });
  }
});

// Get streak status only
router.get('/streak', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'] || req.user?.employeeId;
    if (!employeeId) return res.status(401).json({ error: 'Employee ID required' });

    const streak = await getOrCreateStreak(employeeId);
    res.json({
      current: streak.currentStreak,
      longest: streak.longestStreak,
      lastActivity: streak.lastActivityDate,
      freezeTokens: streak.freezeTokens,
    });
  } catch (err) {
    console.error('[Gamification] Streak error:', err);
    res.status(500).json({ error: 'Failed to load streak data' });
  }
});

// Get achievements
router.get('/achievements', async (req, res) => {
  try {
    const employeeId = req.headers['x-employee-id'] || req.user?.employeeId;
    if (!employeeId) return res.status(401).json({ error: 'Employee ID required' });

    const achievements = await getAchievements(employeeId);
    res.json(achievements);
  } catch (err) {
    console.error('[Gamification] Achievements error:', err);
    res.status(500).json({ error: 'Failed to load achievements' });
  }
});

// ─── LEADERBOARD ────────────────────────────────────────────────────────────────

// Get XP leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { scope, value, limit = 20 } = req.query;
    const limitNum = parseInt(limit, 10);

    // Build raw query based on scope
    let query = `
      SELECT
        x.employee_id,
        x.total_xp,
        x.level,
        t.trainee_name,
        t.batch_no,
        t.branch,
        t.process
      FROM trainee_xp x
      LEFT JOIN trainee_master t ON t.employee_id = x.employee_id
    `;

    const params = [];
    if (scope === 'batch' && value) {
      query += ` WHERE t.batch_no = ?`;
      params.push(value);
    } else if (scope === 'branch' && value) {
      query += ` WHERE t.branch = ?`;
      params.push(value);
    } else if (scope === 'process' && value) {
      query += ` WHERE t.process = ?`;
      params.push(value);
    }

    query += ` ORDER BY x.total_xp DESC LIMIT ?`;
    params.push(limitNum);

    const leaders = await prisma.$queryRawUnsafe(query, ...params);

    res.json(leaders.map((l, i) => ({
      rank: i + 1,
      employeeId: l.employee_id,
      name: l.trainee_name || 'Unknown',
      totalXp: Number(l.total_xp),
      level: Number(l.level),
      batchNo: l.batch_no,
      branch: l.branch,
      process: l.process,
    })));
  } catch (err) {
    console.error('[Gamification] Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ─── ADMIN/COORDINATOR ENDPOINTS ────────────────────────────────────────────────

// Get all achievements catalog
router.get('/admin/achievements', async (req, res) => {
  try {
    const achievements = await prisma.achievementCatalog.findMany({
      orderBy: [{ criteriaType: 'asc' }, { criteriaValue: 'asc' }],
    });
    res.json(achievements);
  } catch (err) {
    console.error('[Gamification] Admin achievements error:', err);
    res.status(500).json({ error: 'Failed to load achievements catalog' });
  }
});

// Get gamification stats for a batch/branch/process
router.get('/admin/stats', async (req, res) => {
  try {
    const { scope, value } = req.query;

    let scopeFilter = '';
    const params = [];
    if (scope === 'batch' && value) {
      scopeFilter = `AND t.batch_no = ?`;
      params.push(value);
    } else if (scope === 'branch' && value) {
      scopeFilter = `AND t.branch = ?`;
      params.push(value);
    } else if (scope === 'process' && value) {
      scopeFilter = `AND t.process = ?`;
      params.push(value);
    }

    const stats = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(DISTINCT x.employee_id) as trainees_with_xp,
        COALESCE(SUM(x.total_xp), 0) as total_xp_awarded,
        COALESCE(AVG(x.total_xp), 0) as avg_xp,
        COALESCE(MAX(x.level), 1) as highest_level,
        COALESCE(AVG(x.level), 1) as avg_level
      FROM trainee_xp x
      LEFT JOIN trainee_master t ON t.employee_id = x.employee_id
      WHERE 1=1 ${scopeFilter}
    `, ...params);

    const streakCount = await prisma.traineeStreak.count({
      where: { currentStreak: { gte: 7 } },
    });

    const achievementCount = await prisma.traineeAchievement.count();

    res.json({
      ...stats[0],
      activeStreakers: streakCount,
      totalAchievementsEarned: achievementCount,
    });
  } catch (err) {
    console.error('[Gamification] Admin stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
