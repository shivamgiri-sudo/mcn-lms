import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { awardTypingSession } from '../utils/leaderboardEngine.js';

// ── Scope helpers ─────────────────────────────────────────────────────────────
// Mirrors voiceAccent.js scopeWhere exactly.
async function scopeWhere(req) {
  if (req.userType === 'coordinator') {
    const owned = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: req.userId },
      select: { batchNo: true },
    });
    const batchNos = owned.map(b => b.batchNo);
    return { batchNo: { in: batchNos.length ? batchNos : ['__none__'] } };
  }
  if (req.userType === 'admin' && req.userBranch) {
    return { branch: req.userBranch };
  }
  return {};
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Trainee: list active prompts ─────────────────────────────────────────────
export async function listPrompts(req, res) {
  try {
    const q = req.query || {};
    const where = { isActive: true };
    if (q.mode && ['PASSAGE', 'TIMED_DRILL'].includes(q.mode.toUpperCase())) {
      where.mode = q.mode.toUpperCase();
    }
    if (q.difficulty && ['EASY', 'MEDIUM', 'HARD'].includes(q.difficulty.toUpperCase())) {
      where.difficulty = q.difficulty.toUpperCase();
    }
    const rows = await prisma.typingPrompt.findMany({ where, orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }] });
    return res.json({ ok: true, data: rows.map(p => ({
      id: p.id, title: p.title, mode: p.mode, durationSeconds: p.durationSeconds,
      difficulty: p.difficulty, tags: p.tags, wordCount: p.body.trim().split(/\s+/).length,
    })) });
  } catch (err) {
    console.error('[Typing] listPrompts failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load typing prompts.' });
  }
}

// ── Trainee: fetch prompt body (called on session start only) ─────────────────
export async function getPrompt(req, res) {
  try {
    const row = await prisma.typingPrompt.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!row) return res.status(404).json({ ok: false, message: 'Prompt not found.' });
    return res.json({ ok: true, data: { id: row.id, title: row.title, body: row.body, mode: row.mode, durationSeconds: row.durationSeconds, difficulty: row.difficulty, tags: row.tags } });
  } catch (err) {
    console.error('[Typing] getPrompt failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load prompt.' });
  }
}

// ── Trainee: save completed session ──────────────────────────────────────────
export async function saveSession(req, res) {
  try {
    const b = req.body || {};

    // Sanity checks — reject impossible values
    const rawWpmInput = Number(b.wpm);
    if (!Number.isFinite(rawWpmInput) || rawWpmInput < 0) return res.status(400).json({ ok: false, message: 'wpm must be a non-negative number.' });
    if (rawWpmInput > 250) return res.status(400).json({ ok: false, message: 'wpm exceeds maximum (250). Session rejected.' });
    const wpm = Math.round(rawWpmInput);

    const durationSeconds = clampInt(b.durationSeconds, 0, 7200, -1);
    if (durationSeconds < 5) return res.status(400).json({ ok: false, message: 'Session too short (minimum 5 seconds).' });

    const rawWpm = clampInt(b.rawWpm, 0, 400, wpm);
    const accuracy = clampFloat(b.accuracy, 0, 100, 0);
    const errorCount = clampInt(b.errorCount, 0, 99999, 0);
    const pasteEventCount = clampInt(b.pasteEventCount, 0, 999, 0);
    const focusLostCount = clampInt(b.focusLostCount, 0, 999, 0);
    const mode = ['PASSAGE', 'TIMED_DRILL'].includes(String(b.mode || '').toUpperCase())
      ? String(b.mode).toUpperCase() : 'PASSAGE';
    const promptId = String(b.promptId || '').trim();
    if (!promptId) return res.status(400).json({ ok: false, message: 'promptId is required.' });

    const prompt = await prisma.typingPrompt.findFirst({ where: { id: promptId, isActive: true } });
    if (!prompt) return res.status(404).json({ ok: false, message: 'Prompt not found.' });

    const trainee = await prisma.traineeMaster.findFirst({
      where: { employeeId: req.userId, status: 'Active' },
      select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, lob: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Active trainee record not found.' });

    // Cheat detection
    let isVoided = false;
    let voidReason = null;
    if (pasteEventCount >= 3) { isVoided = true; voidReason = 'paste_attempts'; }
    else if (focusLostCount >= 5) { isVoided = true; voidReason = 'focus_lost'; }

    // Keystroke log — stored as-is, max 50KB of chars
    let keystrokeLog = [];
    if (Array.isArray(b.keystrokeLog)) {
      keystrokeLog = b.keystrokeLog.slice(0, 5000).map(k => ({
        t: Number(k.t) || 0, k: String(k.k || '').slice(0, 8), correct: Boolean(k.correct),
      }));
    }

    const session = await prisma.typingSession.create({
      data: {
        traineeId: trainee.employeeId,
        traineeName: trainee.traineeName,
        batchNo: trainee.batchNo,
        branch: trainee.branch,
        process: trainee.process,
        lob: trainee.lob,
        promptId,
        mode,
        wpm,
        rawWpm,
        accuracy,
        errorCount,
        durationSeconds,
        pasteEventCount,
        focusLostCount,
        isVoided,
        voidReason,
        keystrokeLog,
        leaderboardPts: 0,
      },
    });

    let streakDay = 0;
    let isPersonalBest = false;
    let newStreak = 0;

    if (!isVoided) {
      // Personal best check
      const best = await prisma.typingSession.findFirst({
        where: { traineeId: trainee.employeeId, isVoided: false, id: { not: session.id } },
        orderBy: { wpm: 'desc' },
        select: { wpm: true },
      });
      isPersonalBest = !best || wpm > best.wpm;

      // Streak update
      const streak = await prisma.typingStreak.findUnique({ where: { traineeId: trainee.employeeId } });
      const today = todayStr();
      if (!streak) {
        await prisma.typingStreak.create({ data: { traineeId: trainee.employeeId, currentStreak: 1, longestStreak: 1, lastPracticedDate: today } });
        newStreak = 1;
      } else {
        const last = streak.lastPracticedDate;
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let current;
        if (last === today) {
          current = streak.currentStreak; // already practiced today
        } else if (last === yesterday) {
          current = streak.currentStreak + 1; // extending streak
        } else {
          current = 1; // streak broken
        }
        const longest = Math.max(current, streak.longestStreak);
        await prisma.typingStreak.update({ where: { traineeId: trainee.employeeId }, data: { currentStreak: current, longestStreak: longest, lastPracticedDate: today } });
        newStreak = current;
      }
      streakDay = newStreak;

      // Calculate leaderboard points
      const basePts = (wpm >= 60 && accuracy >= 95) ? 50 : (wpm >= 40 && accuracy >= 85) ? 30 : 10;
      const pbPts = isPersonalBest ? 15 : 0;
      const streakPts = streakDay >= 7 ? 25 : 0;
      const totalPts = basePts + pbPts + streakPts;

      await prisma.typingSession.update({ where: { id: session.id }, data: { leaderboardPts: totalPts } });

      // Fire leaderboard award fire-and-forget
      awardTypingSession(trainee.employeeId, session.id, wpm, accuracy, isPersonalBest, streakDay).catch(console.error);
    }

    await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'SAVE_TYPING_SESSION', module: 'TypingPractice', referenceId: session.id, newValue: { wpm, accuracy, isVoided } });

    return res.status(201).json({ ok: true, data: {
      id: session.id, wpm, accuracy, errorCount, durationSeconds, isVoided, voidReason,
      leaderboardPts: isVoided ? 0 : totalPts, isPersonalBest, streak: streakDay,
    }});
  } catch (err) {
    console.error('[Typing] saveSession failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not save typing session.' });
  }
}

// ── Trainee: my session history ───────────────────────────────────────────────
export async function getMySessions(req, res) {
  try {
    const take = Math.min(parseInt(req.query?.limit || '50', 10), 200);
    const rows = await prisma.typingSession.findMany({
      where: { traineeId: req.userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, promptId: true, mode: true, wpm: true, accuracy: true,
        errorCount: true, durationSeconds: true, isVoided: true, voidReason: true,
        leaderboardPts: true, createdAt: true,
      },
    });
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[Typing] getMySessions failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load sessions.' });
  }
}

// ── Trainee: dashboard widget stats ──────────────────────────────────────────
export async function getMyStats(req, res) {
  try {
    const traineeId = req.userId;
    const today = todayStr();

    const [streak, todaySessions, last7Sessions] = await Promise.all([
      prisma.typingStreak.findUnique({ where: { traineeId } }),
      prisma.typingSession.findMany({
        where: { traineeId, isVoided: false, createdAt: { gte: new Date(today) } },
        orderBy: { wpm: 'desc' }, take: 1,
        select: { wpm: true },
      }),
      prisma.typingSession.findMany({
        where: { traineeId, isVoided: false },
        orderBy: { createdAt: 'desc' }, take: 7,
        select: { wpm: true, createdAt: true },
      }),
    ]);

    const weekStart = new Date(Date.now() - 7 * 86400000);
    const weekCount = await prisma.typingSession.count({
      where: { traineeId, isVoided: false, createdAt: { gte: weekStart } },
    });

    return res.json({ ok: true, data: {
      todayBestWpm: todaySessions[0]?.wpm ?? null,
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      sessionsThisWeek: weekCount,
      sparkline: last7Sessions.reverse().map(s => ({ wpm: s.wpm, date: s.createdAt.toISOString().slice(0, 10) })),
    }});
  } catch (err) {
    console.error('[Typing] getMyStats failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load stats.' });
  }
}

// ── Analytics: summary (coordinator/admin/superAdmin) ────────────────────────
export async function getAnalytics(req, res) {
  try {
    const scope = await scopeWhere(req);
    const baseWhere = { ...scope, isVoided: false };
    const q = req.query || {};
    if (q.batchNo) baseWhere.batchNo = q.batchNo;
    if (q.branch) baseWhere.branch = q.branch;
    if (q.process) baseWhere.process = q.process;

    const [sessions, voidCount, total] = await Promise.all([
      prisma.typingSession.findMany({ where: baseWhere, select: { wpm: true, accuracy: true, traineeId: true, batchNo: true, branch: true, process: true } }),
      prisma.typingSession.count({ where: { ...scope, isVoided: true } }),
      prisma.typingSession.count({ where: scope }),
    ]);

    const todayStr_ = todayStr();
    const todayCount = await prisma.typingSession.count({ where: { ...baseWhere, createdAt: { gte: new Date(todayStr_) } } });

    const avgWpm = sessions.length ? Math.round(sessions.reduce((s, r) => s + r.wpm, 0) / sessions.length) : 0;
    const avgAccuracy = sessions.length ? parseFloat((sessions.reduce((s, r) => s + r.accuracy, 0) / sessions.length).toFixed(1)) : 0;
    const voidRate = total > 0 ? parseFloat(((voidCount / total) * 100).toFixed(1)) : 0;

    const dist = { '<20': 0, '20-40': 0, '40-60': 0, '60+': 0 };
    for (const s of sessions) {
      if (s.wpm < 20) dist['<20']++;
      else if (s.wpm < 40) dist['20-40']++;
      else if (s.wpm < 60) dist['40-60']++;
      else dist['60+']++;
    }

    return res.json({ ok: true, data: { avgWpm, avgAccuracy, totalSessions: sessions.length, sessionsToday: todayCount, voidRate, wpmDistribution: dist } });
  } catch (err) {
    console.error('[Typing] getAnalytics failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load analytics.' });
  }
}

// ── Analytics: per-trainee table ─────────────────────────────────────────────
export async function getAnalyticsTrainees(req, res) {
  try {
    const scope = await scopeWhere(req);
    const q = req.query || {};
    const where = { ...scope, isVoided: false };
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.branch) where.branch = q.branch;

    const rows = await prisma.typingSession.findMany({
      where,
      select: { traineeId: true, traineeName: true, batchNo: true, wpm: true, accuracy: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    // Group by traineeId
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.traineeId)) map.set(r.traineeId, { traineeId: r.traineeId, traineeName: r.traineeName, batchNo: r.batchNo, sessions: [] });
      map.get(r.traineeId).sessions.push(r);
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const result = [...map.values()].map(t => {
      const wpms = t.sessions.map(s => s.wpm);
      const bestWpm = Math.max(...wpms);
      const avgWpm = Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length);
      const avgAcc = parseFloat((t.sessions.reduce((a, s) => a + s.accuracy, 0) / t.sessions.length).toFixed(1));
      const lastPracticed = t.sessions[0]?.createdAt || null;
      const recent7 = t.sessions.filter(s => new Date(s.createdAt) >= sevenDaysAgo).map(s => s.wpm);
      const older7 = t.sessions.filter(s => new Date(s.createdAt) < sevenDaysAgo).slice(0, 7).map(s => s.wpm);
      const recentAvg = recent7.length ? recent7.reduce((a, b) => a + b, 0) / recent7.length : 0;
      const olderAvg = older7.length ? older7.reduce((a, b) => a + b, 0) / older7.length : recentAvg;
      const trend = recentAvg > olderAvg ? 'up' : recentAvg < olderAvg ? 'down' : 'flat';
      return { traineeId: t.traineeId, traineeName: t.traineeName, batchNo: t.batchNo, bestWpm, avgWpm, avgAccuracy: avgAcc, totalSessions: t.sessions.length, lastPracticed, trend };
    });

    result.sort((a, b) => b.bestWpm - a.bestWpm);
    return res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[Typing] getAnalyticsTrainees failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load trainee analytics.' });
  }
}

// ── Analytics: trainee drill-down ────────────────────────────────────────────
export async function getAnalyticsTrainee(req, res) {
  try {
    const scope = await scopeWhere(req);
    const traineeId = req.params.traineeId;

    const [sessions, streak] = await Promise.all([
      prisma.typingSession.findMany({
        where: { ...scope, traineeId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, mode: true, wpm: true, rawWpm: true, accuracy: true, errorCount: true, durationSeconds: true, isVoided: true, voidReason: true, leaderboardPts: true, createdAt: true },
      }),
      prisma.typingStreak.findUnique({ where: { traineeId } }),
    ]);

    // Day-wise aggregation for chart
    const dayMap = new Map();
    for (const s of sessions.filter(s => !s.isVoided)) {
      const d = s.createdAt.toISOString().slice(0, 10);
      if (!dayMap.has(d)) dayMap.set(d, { wpms: [], accs: [] });
      dayMap.get(d).wpms.push(s.wpm);
      dayMap.get(d).accs.push(s.accuracy);
    }
    const dayTrend = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date,
      avgWpm: Math.round(v.wpms.reduce((a, b) => a + b, 0) / v.wpms.length),
      avgAccuracy: parseFloat((v.accs.reduce((a, b) => a + b, 0) / v.accs.length).toFixed(1)),
    }));

    return res.json({ ok: true, data: { sessions, streak, dayTrend } });
  } catch (err) {
    console.error('[Typing] getAnalyticsTrainee failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load trainee drill-down.' });
  }
}

// ── Analytics: character error heatmap ───────────────────────────────────────
export async function getHeatmap(req, res) {
  try {
    const scope = await scopeWhere(req);
    const q = req.query || {};
    const where = { ...scope, isVoided: false };
    if (q.batchNo) where.batchNo = q.batchNo;

    // Only fetch the keystroke log — can be large; limit to recent 500 sessions
    const rows = await prisma.typingSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { keystrokeLog: true },
    });

    // Aggregate per character: total attempts and error count
    const charStats = new Map();
    for (const row of rows) {
      const log = Array.isArray(row.keystrokeLog) ? row.keystrokeLog : [];
      for (const entry of log) {
        const ch = String(entry.k || '').slice(0, 1).toLowerCase();
        if (!ch) continue;
        if (!charStats.has(ch)) charStats.set(ch, { total: 0, errors: 0 });
        const stat = charStats.get(ch);
        stat.total++;
        if (!entry.correct) stat.errors++;
      }
    }

    const heatmap = {};
    for (const [ch, stat] of charStats.entries()) {
      heatmap[ch] = { total: stat.total, errors: stat.errors, errorRate: stat.total > 0 ? parseFloat(((stat.errors / stat.total) * 100).toFixed(1)) : 0 };
    }

    return res.json({ ok: true, data: heatmap });
  } catch (err) {
    console.error('[Typing] getHeatmap failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not compute heatmap.' });
  }
}

// ── Analytics: 30-day trend ───────────────────────────────────────────────────
export async function getTrend(req, res) {
  try {
    const scope = await scopeWhere(req);
    const q = req.query || {};
    const where = { ...scope, isVoided: false, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } };
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.traineeId) where.traineeId = q.traineeId;

    const rows = await prisma.typingSession.findMany({ where, select: { wpm: true, accuracy: true, createdAt: true } });

    const dayMap = new Map();
    for (const r of rows) {
      const d = r.createdAt.toISOString().slice(0, 10);
      if (!dayMap.has(d)) dayMap.set(d, { wpms: [], accs: [] });
      dayMap.get(d).wpms.push(r.wpm);
      dayMap.get(d).accs.push(r.accuracy);
    }

    const trend = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date,
      avgWpm: Math.round(v.wpms.reduce((a, b) => a + b, 0) / v.wpms.length),
      avgAccuracy: parseFloat((v.accs.reduce((a, b) => a + b, 0) / v.accs.length).toFixed(1)),
    }));

    return res.json({ ok: true, data: trend });
  } catch (err) {
    console.error('[Typing] getTrend failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load trend data.' });
  }
}
