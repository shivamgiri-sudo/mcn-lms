import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requireAssessmentSequence } from '../middleware/learningAccess.js';
import { detectAndSyncRisks } from '../utils/riskEngine.js';

const router = Router();
const auth = [requireSession, requireRole('trainee')];

function isTrue(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'Completed';
}

function parsePositiveInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function capSeconds(value, max = 120) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), max);
}

async function syncCourseAndTraineeStats(employeeId, classroomId) {
  if (!employeeId || !classroomId) return;

  const [totalContent, progressRows, totalAssessments, assessmentResults, trainee] = await Promise.all([
    prisma.contentMaster.count({ where: { module: { classroomId }, active: true } }),
    prisma.contentProgress.findMany({ where: { employeeId, classroomId } }),
    prisma.assessmentMaster.count({ where: { classroomId, active: true } }),
    prisma.assessmentResult.findMany({ where: { employeeId, classroomId } }),
    prisma.traineeMaster.findUnique({ where: { employeeId } }),
  ]);

  const openedContents = progressRows.filter(p => p.opened).length;
  const completedContents = progressRows.filter(p => p.completionStatus === 'Completed' || Number(p.completionPct || 0) >= 100).length;
  const completionPct = totalContent > 0 ? Math.round((completedContents / totalContent) * 100) : 0;
  const totalSecondsSpent = progressRows.reduce((sum, p) => sum + Number(p.totalSecondsSpent || 0), 0);

  const passedAssessments = assessmentResults.filter(r => r.result === 'Pass').length;
  const assessmentAttemptPct = totalAssessments > 0 ? Math.round((assessmentResults.length / totalAssessments) * 100) : 0;
  const assessmentPassPct = totalAssessments > 0 ? Math.round((passedAssessments / totalAssessments) * 100) : 0;

  await prisma.$transaction([
    prisma.courseCompletionReport.upsert({
      where: { employeeId_classroomId: { employeeId, classroomId } },
      create: {
        employeeId,
        batchNo: trainee?.batchNo || null,
        classroomId,
        totalContents: totalContent,
        openedContents,
        completionPct,
        totalSecondsSpent,
        status: completionPct >= 100 ? 'Completed' : 'In Progress',
      },
      update: {
        totalContents: totalContent,
        openedContents,
        completionPct,
        totalSecondsSpent,
        status: completionPct >= 100 ? 'Completed' : 'In Progress',
      },
    }),
    prisma.traineeMaster.update({
      where: { employeeId },
      data: { courseCompletionPct: completionPct, assessmentAttemptPct, assessmentPassPct },
    }),
  ]);

  await detectAndSyncRisks(employeeId).catch(err => {
    console.error('[traineeStability] risk sync failed:', err.message);
  });
}

// Stabilized assessment loader: keeps existing sequence gate but returns both field names
// expected by different frontend builds: totalAttempts and attemptsUsed.
router.get('/assessment/:assessmentId', ...auth, requireAssessmentSequence, async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const employeeId = req.userId;

    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment || !assessment.active) {
      return res.status(404).json({ ok: false, message: 'Assessment not found.' });
    }

    const attemptsUsed = await prisma.assessmentAttempt.count({ where: { employeeId, assessmentId } });
    if (attemptsUsed >= assessment.attemptLimit) {
      return res.json({
        ok: false,
        message: `Max attempts (${assessment.attemptLimit}) reached.`,
        attempts: attemptsUsed,
        attemptsUsed,
      });
    }

    const questions = await prisma.questionBank.findMany({
      where: { assessmentId, active: true },
      select: {
        questionId: true,
        questionText: true,
        optionA: true,
        optionB: true,
        optionC: true,
        optionD: true,
        marks: true,
        difficulty: true,
      },
    });

    questions.sort(() => Math.random() - 0.5);

    const bestResult = await prisma.assessmentResult.findUnique({
      where: { employeeId_assessmentId: { employeeId, assessmentId } },
    });

    return res.json({
      ok: true,
      data: {
        assessment: {
          assessmentId: assessment.assessmentId,
          assessmentName: assessment.assessmentName,
          passingPct: assessment.passingPct,
          attemptLimit: assessment.attemptLimit,
          timeLimitMins: assessment.timeLimitMins,
          instructions: assessment.instructions,
          totalAttempts: attemptsUsed,
          attemptsUsed,
        },
        questions,
        bestResult,
      },
    });
  } catch (err) {
    console.error('[traineeStability] assessment load failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Stabilized close endpoint: supports explicit completion for documents/downloads.
router.post('/content/:contentId/close', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const { contentId } = req.params;
    const completedExplicitly = isTrue(req.body?.completed) || isTrue(req.body?.completionStatus);
    const secondsDelta = capSeconds(req.body?.secondsDelta, 120);
    const positionSeconds = parsePositiveInt(req.body?.positionSeconds, 0);
    const durationSeconds = parsePositiveInt(req.body?.durationSeconds, 0);

    const content = await prisma.contentMaster.findUnique({
      where: { contentId },
      include: { module: true },
    });
    if (!content || !content.active) {
      return res.status(404).json({ ok: false, message: 'Content not found.' });
    }

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    const classroomId = content.module?.classroomId || trainee?.classroomId || '';
    const dayNo = content.module?.dayNo || 0;
    const moduleId = content.moduleId;

    const existing = await prisma.contentProgress.findUnique({
      where: { employeeId_contentId: { employeeId, contentId } },
    });

    const now = new Date();
    const requiredSeconds = existing?.requiredSeconds
      || (durationSeconds > 0 ? Math.round(durationSeconds * ((content.completionRulePct || 80) / 100)) : 0)
      || (content.estimatedMins > 0 ? Math.round((content.estimatedMins * 60) * ((content.completionRulePct || 80) / 100)) : 0);

    if (!existing) {
      await prisma.contentProgress.create({
        data: {
          employeeId,
          classroomId,
          dayNo,
          moduleId,
          contentId,
          opened: true,
          openCount: 1,
          firstOpenedAt: now,
          lastOpenedAt: now,
          totalSecondsSpent: secondsDelta,
          lastPositionSeconds: positionSeconds,
          mediaDurationSeconds: durationSeconds,
          requiredSeconds,
          completionPct: completedExplicitly ? 100 : 0,
          completionStatus: completedExplicitly ? 'Completed' : 'In Progress',
          completedAt: completedExplicitly ? now : null,
          playerMode: content.playerMode || 'Auto',
        },
      });
    } else {
      const newTotal = Number(existing.totalSecondsSpent || 0) + secondsDelta;
      const completionPct = completedExplicitly
        ? 100
        : requiredSeconds > 0
          ? Math.min(100, Math.round((newTotal / requiredSeconds) * 100))
          : Number(existing.completionPct || 0);
      const completed = completionPct >= 100;

      await prisma.contentProgress.update({
        where: { id: existing.id },
        data: {
          opened: true,
          lastOpenedAt: now,
          totalSecondsSpent: newTotal,
          lastPositionSeconds: positionSeconds || existing.lastPositionSeconds,
          mediaDurationSeconds: durationSeconds || existing.mediaDurationSeconds,
          requiredSeconds,
          completionPct,
          completionStatus: completed ? 'Completed' : 'In Progress',
          completedAt: completed && !existing.completedAt ? now : existing.completedAt,
          playerMode: content.playerMode || existing.playerMode || 'Auto',
        },
      });
    }

    await prisma.videoWatchLog.create({
      data: {
        employeeId,
        batchNo: trainee?.batchNo || null,
        classroomId,
        dayNo,
        moduleId,
        contentId,
        event: completedExplicitly ? 'COMPLETE' : 'CLOSE',
        secondsDelta,
        positionSeconds,
        durationSeconds,
        completionPct: completedExplicitly ? 100 : 0,
        playerMode: content.playerMode || 'Auto',
        details: completedExplicitly ? 'Explicit completion from document/download viewer' : null,
      },
    });

    await syncCourseAndTraineeStats(employeeId, classroomId);

    return res.json({ ok: true, completed: completedExplicitly });
  } catch (err) {
    console.error('[traineeStability] content close failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Stabilized profile update: keep trainee_master and user_master aligned.
router.patch('/profile', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const data = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'traineeName')) data.traineeName = String(req.body.traineeName || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'email')) data.email = String(req.body.email || '').trim().toLowerCase() || null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'mobile')) data.mobile = String(req.body.mobile || '').replace(/\D/g, '').slice(-10) || null;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ ok: false, message: 'No profile fields provided.' });
    }

    const existing = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    await prisma.$transaction([
      prisma.traineeMaster.update({ where: { employeeId }, data }),
      prisma.userMaster.updateMany({ where: { employeeId }, data }),
    ]);

    return res.json({ ok: true, message: 'Profile updated.' });
  } catch (err) {
    console.error('[traineeStability] profile update failed:', err);
    return res.status(500).json({ ok: false, message: 'Update failed.' });
  }
});

export default router;
