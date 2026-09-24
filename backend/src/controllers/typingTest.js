// Daily Typing Test v1 — a trainee types a randomly-selected paragraph against a
// server-enforced countdown; the server (never the client) is authoritative for
// start time, elapsed time, the daily attempt cap, and the scored result. This
// follows the same server-authoritative pattern as the governed assessment engine
// (services/assessmentIntelligence.js): startedAt is stamped by the server when an
// attempt is created, and at submit time the server recomputes elapsed time from
// that stored timestamp instead of trusting anything the client reports.
//
// Standalone controller + route file, denormalized traineeName/branch/process on
// the attempt row — same convention as voiceAccent.js/mentorPairing.js on this
// branch, so admin report/dashboard queries never need a join back to
// trainee_master.
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { scoreTypingAttempt, alignTypedText, normalizeTypingText } from '../utils/typingAccuracy.js';

const GRACE_SECONDS = 30; // network-latency buffer between the client's timer hitting 0 and the submit request arriving
const STALE_SECONDS_BEFORE_FORCE_EXPIRE = 15 * 60; // an abandoned in-progress attempt is force-closed after this long, freeing the trainee to start a fresh one
const IST_OFFSET_MS = 330 * 60 * 1000; // same idiom as routes/traineeStability.js's istDayBounds()

function istDayBounds(now = new Date()) {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const startLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocalMs - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function branchScope(req) {
  return req.userBranch ? { branch: req.userBranch } : {};
}

async function getSettings() {
  const settings = await prisma.typingTestSettings.findUnique({ where: { id: 'default' } });
  // The seed migration always inserts this row, but fall back defensively in case
  // it was ever deleted by hand.
  return settings || {
    id: 'default', durationSeconds: 300, attemptsPerDay: 1, wpmTarget: 35,
    accuracyTarget: 95, minWords: 150, maxWords: 250, allowRetest: false,
  };
}

function attemptDto(row, { includeText = false } = {}) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    traineeName: row.traineeName,
    branch: row.branch,
    process: row.process,
    paragraphId: row.paragraphId,
    attemptDate: row.attemptDate,
    attemptNumber: row.attemptNumber,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    durationSeconds: row.durationSeconds,
    timeTakenSeconds: row.timeTakenSeconds,
    totalChars: row.totalChars,
    correctChars: row.correctChars,
    incorrectChars: row.incorrectChars,
    errorCount: row.errorCount,
    totalWords: row.totalWords,
    grossWpm: row.grossWpm,
    netWpm: row.netWpm,
    accuracyPct: row.accuracyPct,
    status: row.status,
    ...(includeText ? { originalText: row.originalText, typedText: row.typedText } : {}),
  };
}

// ─── Trainee-facing ─────────────────────────────────────────────────────────

// Called on page load. Tells the trainee everything they need before deciding to
// start: today's configured duration/target, how many attempts they have left
// today, an in-progress attempt to resume (if the page was refreshed mid-test),
// and today's most recent completed result (if they've already finished).
export async function getTypingTestStatus(req, res) {
  try {
    const employeeId = req.userId;
    const settings = await getSettings();
    const { start, end } = istDayBounds();

    const [completedToday, inProgress, recentCompleted] = await Promise.all([
      prisma.typingTestAttempt.count({
        where: { employeeId, attemptDate: { gte: start, lt: end }, status: { in: ['Pass', 'Fail'] } },
      }),
      prisma.typingTestAttempt.findFirst({ where: { employeeId, submittedAt: null }, orderBy: { startedAt: 'desc' } }),
      prisma.typingTestAttempt.findFirst({
        where: { employeeId, attemptDate: { gte: start, lt: end }, status: { in: ['Pass', 'Fail'] } },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    let resumable = null;
    if (inProgress) {
      const elapsed = (Date.now() - new Date(inProgress.startedAt).getTime()) / 1000;
      if (elapsed <= inProgress.durationSeconds + GRACE_SECONDS) {
        resumable = {
          attemptId: inProgress.id,
          paragraphText: inProgress.originalText,
          durationSeconds: inProgress.durationSeconds,
          remainingSeconds: Math.max(0, Math.round(inProgress.durationSeconds - elapsed)),
          startedAt: inProgress.startedAt,
        };
      }
      // else: stale — left for startTypingTest to force-expire on next start, so
      // this read-only status call never mutates data.
    }

    const attemptsRemaining = Math.max(0, settings.attemptsPerDay - completedToday);
    res.json({
      ok: true,
      data: {
        settings: {
          durationSeconds: settings.durationSeconds,
          attemptsPerDay: settings.attemptsPerDay,
          wpmTarget: settings.wpmTarget,
          accuracyTarget: settings.accuracyTarget,
          allowRetest: settings.allowRetest,
        },
        completedToday,
        attemptsRemaining,
        canStart: attemptsRemaining > 0 && !resumable,
        resumable,
        alreadyCompletedMessage: attemptsRemaining === 0 ? 'You have already completed today\'s Daily Typing Test.' : null,
        todayResult: recentCompleted ? attemptDto(recentCompleted) : null,
      },
    });
  } catch (err) {
    console.error('[typingTest] status failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Server-authoritative attempt start. Enforces the daily cap and the "one active
// test at a time" rule inside a single transaction, exactly like the governed
// assessment engine's currentOrNewAttempt() — so a double-click or two browser
// tabs can never race past either limit. startedAt and the paragraph snapshot are
// fixed here, server-side, and never re-read from the client afterward.
export async function startTypingTest(req, res) {
  try {
    const employeeId = req.userId;
    const trainee = await prisma.traineeMaster.findFirst({
      where: { employeeId, status: 'Active' },
      select: { employeeId: true, traineeName: true, branch: true, process: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Active trainee record not found.' });

    const settings = await getSettings();
    const { start, end } = istDayBounds();

    const result = await prisma.$transaction(async tx => {
      // Force-close a stale in-progress attempt (abandoned tab, crashed browser)
      // before checking anything else, so it can't block a fresh start forever
      // and doesn't itself count against the daily cap.
      const stale = await tx.typingTestAttempt.findFirst({ where: { employeeId, submittedAt: null } });
      if (stale) {
        const elapsed = (Date.now() - new Date(stale.startedAt).getTime()) / 1000;
        if (elapsed <= stale.durationSeconds + GRACE_SECONDS) {
          return { resume: stale };
        }
        await tx.typingTestAttempt.update({
          where: { id: stale.id },
          data: { submittedAt: new Date(), timeTakenSeconds: stale.durationSeconds, status: 'Expired' },
        });
      }

      const completedToday = await tx.typingTestAttempt.count({
        where: { employeeId, attemptDate: { gte: start, lt: end }, status: { in: ['Pass', 'Fail'] } },
      });
      if (completedToday >= settings.attemptsPerDay) {
        return { blocked: true };
      }
      if (completedToday > 0 && !settings.allowRetest) {
        return { blocked: true };
      }

      const paragraphs = await tx.typingParagraph.findMany({ where: { active: true }, select: { id: true, text: true } });
      if (!paragraphs.length) return { noParagraphs: true };
      const paragraph = paragraphs[Math.floor(Math.random() * paragraphs.length)];

      const attempt = await tx.typingTestAttempt.create({
        data: {
          employeeId: trainee.employeeId,
          traineeName: trainee.traineeName,
          branch: trainee.branch,
          process: trainee.process,
          paragraphId: paragraph.id,
          originalText: normalizeTypingText(paragraph.text),
          attemptDate: start,
          attemptNumber: completedToday + 1,
          startedAt: new Date(),
          durationSeconds: settings.durationSeconds,
          status: 'InProgress',
        },
      });
      return { attempt };
    });

    if (result.blocked) {
      return res.status(409).json({ ok: false, message: 'You have already completed today\'s Daily Typing Test.' });
    }
    if (result.noParagraphs) {
      return res.status(503).json({ ok: false, message: 'No typing paragraphs are available. Please contact your administrator.' });
    }
    if (result.resume) {
      const stale = result.resume;
      const elapsed = (Date.now() - new Date(stale.startedAt).getTime()) / 1000;
      return res.json({
        ok: true,
        resumed: true,
        data: {
          attemptId: stale.id,
          paragraphText: stale.originalText,
          durationSeconds: stale.durationSeconds,
          remainingSeconds: Math.max(0, Math.round(stale.durationSeconds - elapsed)),
          startedAt: stale.startedAt,
        },
      });
    }

    const attempt = result.attempt;
    await audit({ userIdentity: employeeId, userRole: 'Trainee', action: 'START_TYPING_TEST', module: 'DailyTypingTest', referenceId: attempt.id, newValue: { paragraphId: attempt.paragraphId } });
    res.status(201).json({
      ok: true,
      data: {
        attemptId: attempt.id,
        paragraphText: attempt.originalText,
        durationSeconds: attempt.durationSeconds,
        remainingSeconds: attempt.durationSeconds,
        startedAt: attempt.startedAt,
      },
    });
  } catch (err) {
    console.error('[typingTest] start failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Submission — triggered either by the trainee clicking Submit or by the client
// timer reaching 00:00 (both call this same endpoint). Elapsed time is always
// recomputed server-side from the attempt's stored startedAt; the client never
// gets to assert how much time it thinks has passed.
export async function submitTypingTest(req, res) {
  try {
    const employeeId = req.userId;
    const { attemptId } = req.params;
    const typedText = String(req.body?.typedText ?? '');

    const attempt = await prisma.typingTestAttempt.findFirst({ where: { id: attemptId, employeeId, submittedAt: null } });
    if (!attempt) return res.status(404).json({ ok: false, message: 'No active test found for this attempt. It may have already been submitted.' });

    const elapsedSeconds = Math.max(0, (Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
    if (elapsedSeconds > attempt.durationSeconds + GRACE_SECONDS + STALE_SECONDS_BEFORE_FORCE_EXPIRE) {
      await prisma.typingTestAttempt.update({
        where: { id: attempt.id },
        data: { submittedAt: new Date(), timeTakenSeconds: attempt.durationSeconds, status: 'Expired' },
      });
      return res.status(409).json({ ok: false, message: 'This test has expired. Please start a new attempt.' });
    }
    // Clamp scoring time to the configured duration — a submission arriving a few
    // seconds late due to network latency (covered by GRACE_SECONDS above) is
    // still scored as if it took exactly the intended test duration, so latency
    // never inflates or deflates WPM.
    const timeTakenSeconds = Math.min(elapsedSeconds, attempt.durationSeconds);

    const settings = await getSettings();
    const scored = scoreTypingAttempt({ original: attempt.originalText, typed: typedText, elapsedSeconds: timeTakenSeconds });
    const status = (scored.netWpm >= settings.wpmTarget && scored.accuracyPct >= settings.accuracyTarget) ? 'Pass' : 'Fail';

    // updateMany + count guard is the same idempotency pattern the assessment
    // engine uses: if a duplicate submit races in (double-click, retried
    // request), only the first one that still finds submittedAt: null wins.
    const claimed = await prisma.typingTestAttempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: {
        typedText,
        submittedAt: new Date(),
        timeTakenSeconds: Math.round(timeTakenSeconds),
        totalChars: scored.totalChars,
        correctChars: scored.correctChars,
        incorrectChars: scored.incorrectChars,
        errorCount: scored.errorCount,
        totalWords: scored.totalWords,
        grossWpm: scored.grossWpm,
        netWpm: scored.netWpm,
        accuracyPct: scored.accuracyPct,
        status,
      },
    });
    if (claimed.count === 0) {
      return res.status(409).json({ ok: false, message: 'This test has already been submitted.' });
    }

    await audit({
      userIdentity: employeeId, userRole: 'Trainee', action: 'SUBMIT_TYPING_TEST', module: 'DailyTypingTest',
      referenceId: attempt.id, newValue: { netWpm: scored.netWpm, accuracyPct: scored.accuracyPct, status },
    });

    res.json({
      ok: true,
      data: {
        attemptId: attempt.id,
        timeTakenSeconds: Math.round(timeTakenSeconds),
        totalChars: scored.totalChars,
        correctChars: scored.correctChars,
        incorrectChars: scored.incorrectChars,
        errorCount: scored.errorCount,
        totalWords: scored.totalWords,
        grossWpm: scored.grossWpm,
        netWpm: scored.netWpm,
        accuracyPct: scored.accuracyPct,
        status,
        wpmTarget: settings.wpmTarget,
        accuracyTarget: settings.accuracyTarget,
        originalText: attempt.originalText,
        typedText,
        ops: scored.ops,
      },
    });
  } catch (err) {
    console.error('[typingTest] submit failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// "View Mistakes" for a past attempt — the character-level diff is cheap to
// recompute on demand from the stored original/typed text, so it is never stored
// itself.
export async function getTypingAttemptMistakes(req, res) {
  try {
    const employeeId = req.userId;
    const { attemptId } = req.params;
    const attempt = await prisma.typingTestAttempt.findFirst({ where: { id: attemptId, employeeId } });
    if (!attempt) return res.status(404).json({ ok: false, message: 'Attempt not found.' });
    const { ops } = alignTypedText(attempt.originalText, attempt.typedText || '');
    res.json({ ok: true, data: { originalText: attempt.originalText, typedText: attempt.typedText, ops, errorCount: attempt.errorCount } });
  } catch (err) {
    console.error('[typingTest] mistakes failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// "My Typing Performance" — history list + aggregates + a 30-day trend series for
// the WPM/accuracy line charts (last N calendar days, one point per day using
// that day's best attempt if more than one was taken).
export async function getMyTypingHistory(req, res) {
  try {
    const employeeId = req.userId;
    const attempts = await prisma.typingTestAttempt.findMany({
      where: { employeeId, status: { in: ['Pass', 'Fail'] } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    const count = attempts.length;
    const bestWpm = count ? Math.max(...attempts.map(a => a.netWpm || 0)) : 0;
    const avgWpm = count ? attempts.reduce((s, a) => s + (a.netWpm || 0), 0) / count : 0;
    const avgAccuracy = count ? attempts.reduce((s, a) => s + (a.accuracyPct || 0), 0) / count : 0;
    const passCount = attempts.filter(a => a.status === 'Pass').length;
    const passPct = count ? (passCount / count) * 100 : 0;

    const trendByDay = new Map();
    for (const a of attempts) {
      const day = new Date(a.attemptDate).toISOString().slice(0, 10);
      const existing = trendByDay.get(day);
      if (!existing || (a.netWpm || 0) > existing.netWpm) {
        trendByDay.set(day, { date: day, netWpm: a.netWpm || 0, accuracyPct: a.accuracyPct || 0 });
      }
    }
    const trend = [...trendByDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      ok: true,
      data: {
        history: attempts.map(a => attemptDto(a)),
        stats: {
          testsCompleted: count,
          bestWpm: Math.round(bestWpm * 10) / 10,
          avgWpm: Math.round(avgWpm * 10) / 10,
          avgAccuracy: Math.round(avgAccuracy * 10) / 10,
          passPct: Math.round(passPct * 10) / 10,
        },
        trend7: trend.slice(-7),
        trend30: trend.slice(-30),
      },
    });
  } catch (err) {
    console.error('[typingTest] history failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ─── Admin-facing: paragraph bank ────────────────────────────────────────────

export async function listTypingParagraphs(req, res) {
  try {
    const rows = await prisma.typingParagraph.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createTypingParagraph(req, res) {
  try {
    const text = normalizeTypingText(req.body?.text || '').trim();
    const category = req.body?.category ? String(req.body.category).trim() : null;
    if (!text) return res.status(400).json({ ok: false, message: 'Paragraph text is required.' });

    const settings = await getSettings();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < settings.minWords || wordCount > settings.maxWords) {
      return res.status(400).json({ ok: false, message: `Paragraph must be between ${settings.minWords} and ${settings.maxWords} words (currently ${wordCount}).` });
    }

    const row = await prisma.typingParagraph.create({ data: { text, wordCount, category, active: true, createdBy: req.userId } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_TYPING_PARAGRAPH', module: 'DailyTypingTest', referenceId: row.id, newValue: { wordCount, category } });
    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[typingTest] create paragraph failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateTypingParagraph(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.typingParagraph.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Paragraph not found.' });

    const data = {};
    if (req.body?.text !== undefined) {
      const text = normalizeTypingText(req.body.text).trim();
      if (!text) return res.status(400).json({ ok: false, message: 'Paragraph text cannot be empty.' });
      const settings = await getSettings();
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < settings.minWords || wordCount > settings.maxWords) {
        return res.status(400).json({ ok: false, message: `Paragraph must be between ${settings.minWords} and ${settings.maxWords} words (currently ${wordCount}).` });
      }
      data.text = text;
      data.wordCount = wordCount;
    }
    if (req.body?.category !== undefined) data.category = req.body.category ? String(req.body.category).trim() : null;
    if (req.body?.active !== undefined) data.active = !!req.body.active;

    const row = await prisma.typingParagraph.update({ where: { id }, data });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_TYPING_PARAGRAPH', module: 'DailyTypingTest', referenceId: id, oldValue: { active: existing.active }, newValue: data });
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[typingTest] update paragraph failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ─── Admin-facing: settings ──────────────────────────────────────────────────

export async function getTypingSettings(req, res) {
  try {
    res.json({ ok: true, data: await getSettings() });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateTypingSettings(req, res) {
  try {
    const body = req.body || {};
    const data = {};
    if (body.durationSeconds !== undefined) data.durationSeconds = Math.max(60, Math.round(Number(body.durationSeconds) || 300));
    if (body.attemptsPerDay !== undefined) data.attemptsPerDay = Math.max(1, Math.round(Number(body.attemptsPerDay) || 1));
    if (body.wpmTarget !== undefined) data.wpmTarget = Math.max(0, Math.round(Number(body.wpmTarget) || 0));
    if (body.accuracyTarget !== undefined) data.accuracyTarget = Math.max(0, Math.min(100, Number(body.accuracyTarget) || 0));
    if (body.minWords !== undefined) data.minWords = Math.max(1, Math.round(Number(body.minWords) || 150));
    if (body.maxWords !== undefined) data.maxWords = Math.max(data.minWords || 1, Math.round(Number(body.maxWords) || 250));
    if (body.allowRetest !== undefined) data.allowRetest = !!body.allowRetest;
    data.updatedBy = req.userId;

    const row = await prisma.typingTestSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_TYPING_TEST_SETTINGS', module: 'DailyTypingTest', referenceId: 'default', newValue: data });
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[typingTest] update settings failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ─── Admin-facing: dashboard + report ────────────────────────────────────────

function reportWhere(req) {
  const q = req.query || {};
  const where = { status: { in: ['Pass', 'Fail'] }, ...branchScope(req) };

  if (q.date) {
    const { start, end } = istDayBounds(new Date(q.date));
    where.attemptDate = { gte: start, lt: end };
  } else if (q.dateFrom || q.dateTo) {
    const range = {};
    if (q.dateFrom) range.gte = istDayBounds(new Date(q.dateFrom)).start;
    if (q.dateTo) range.lt = istDayBounds(new Date(q.dateTo)).end;
    where.attemptDate = range;
  }
  if (q.employeeId) where.employeeId = { contains: String(q.employeeId) };
  if (q.employeeName) where.traineeName = { contains: String(q.employeeName) };
  if (q.process) where.process = String(q.process);
  if (q.status && ['Pass', 'Fail'].includes(q.status)) where.status = q.status;
  if (q.wpmMin || q.wpmMax) {
    where.netWpm = {};
    if (q.wpmMin) where.netWpm.gte = Number(q.wpmMin);
    if (q.wpmMax) where.netWpm.lte = Number(q.wpmMax);
  }
  if (q.accuracyMin || q.accuracyMax) {
    where.accuracyPct = {};
    if (q.accuracyMin) where.accuracyPct.gte = Number(q.accuracyMin);
    if (q.accuracyMax) where.accuracyPct.lte = Number(q.accuracyMax);
  }
  return where;
}

export async function getTypingDashboard(req, res) {
  try {
    const { start, end } = istDayBounds();
    const scope = branchScope(req);

    const todayAttempts = await prisma.typingTestAttempt.findMany({
      where: { attemptDate: { gte: start, lt: end }, status: { in: ['Pass', 'Fail'] }, ...scope },
      select: { employeeId: true, netWpm: true, accuracyPct: true, status: true },
    });

    const totalAttempted = todayAttempts.length;
    const totalPassed = todayAttempts.filter(a => a.status === 'Pass').length;
    const totalFailed = totalAttempted - totalPassed;
    const avgWpm = totalAttempted ? todayAttempts.reduce((s, a) => s + (a.netWpm || 0), 0) / totalAttempted : 0;
    const avgAccuracy = totalAttempted ? todayAttempts.reduce((s, a) => s + (a.accuracyPct || 0), 0) / totalAttempted : 0;
    const highestWpm = totalAttempted ? Math.max(...todayAttempts.map(a => a.netWpm || 0)) : 0;
    const highestAccuracy = totalAttempted ? Math.max(...todayAttempts.map(a => a.accuracyPct || 0)) : 0;

    const attemptedIds = new Set(todayAttempts.map(a => a.employeeId));
    const activeTrainees = await prisma.traineeMaster.findMany({
      where: { status: 'Active', ...scope },
      select: { employeeId: true, traineeName: true, branch: true, process: true },
    });
    const notAttempted = activeTrainees.filter(t => !attemptedIds.has(t.employeeId));

    res.json({
      ok: true,
      data: {
        date: start.toISOString().slice(0, 10),
        totalAttempted,
        totalPassed,
        totalFailed,
        avgWpm: Math.round(avgWpm * 10) / 10,
        avgAccuracy: Math.round(avgAccuracy * 10) / 10,
        highestWpm: Math.round(highestWpm * 10) / 10,
        highestAccuracy: Math.round(highestAccuracy * 10) / 10,
        notAttempted: notAttempted.slice(0, 500),
        notAttemptedCount: notAttempted.length,
      },
    });
  } catch (err) {
    console.error('[typingTest] dashboard failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getTypingReport(req, res) {
  try {
    const rows = await prisma.typingTestAttempt.findMany({
      where: reportWhere(req),
      orderBy: { attemptDate: 'desc' },
      take: 2000,
    });
    res.json({ ok: true, data: rows.map(r => attemptDto(r)) });
  } catch (err) {
    console.error('[typingTest] report failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// CSV export — copies the private toCsv/csvRes/fmtDt/fmtDate idiom already used by
// exportBatchSummary/exportModuleCompletion etc. in controllers/admin.js. There is
// no shared export helper actually wired up anywhere in this codebase (utils/
// format.js's csvRes exists but is imported nowhere), so duplicating the small
// helper here matches the established convention rather than introducing a new one.
const IST_OFFSET_EXPORT_MS = 5.5 * 60 * 60 * 1000;
function toIST(v) { return new Date(new Date(v).getTime() + IST_OFFSET_EXPORT_MS); }
function fmtDate(v) { if (!v) return ''; return toIST(v).toISOString().slice(0, 10); }
function fmtDt(v) { if (!v) return ''; return toIST(v).toISOString().replace('T', ' ').slice(0, 19); }
function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
function csvRes(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

export async function exportTypingReport(req, res) {
  try {
    const rows = await prisma.typingTestAttempt.findMany({ where: reportWhere(req), orderBy: { attemptDate: 'desc' } });
    const headers = ['Date', 'Employee ID', 'Employee Name', 'Process', 'Gross WPM', 'Net WPM', 'Accuracy %', 'Total Chars', 'Errors', 'Time Taken (s)', 'Status', 'Submitted At'];
    const csvRows = rows.map(r => [
      fmtDate(r.attemptDate), r.employeeId, r.traineeName || '', r.process || '',
      r.grossWpm ?? '', r.netWpm ?? '', r.accuracyPct ?? '', r.totalChars ?? '', r.errorCount ?? '',
      r.timeTakenSeconds ?? '', r.status || '', fmtDt(r.submittedAt),
    ]);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'EXPORT_TYPING_TEST_REPORT', module: 'DailyTypingTest', newValue: { rowCount: rows.length } });
    csvRes(res, `daily-typing-test-report-${fmtDate(new Date())}.csv`, headers, csvRows);
  } catch (err) {
    console.error('[typingTest] export failed:', err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}
