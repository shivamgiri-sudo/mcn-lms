import { prisma } from '../utils/db.js';
import { detectAndSyncRisks } from '../utils/riskEngine.js';
import { v4 as uuidv4 } from 'uuid';

// ── Learner Dashboard ─────────────────────────────────────────────────────────
export async function getLearnerDashboard(req, res) {
  try {
    const empId = req.userId;

    const [user, trainee] = await Promise.all([
      prisma.userMaster.findUnique({ where: { employeeId: empId } }),
      prisma.traineeMaster.findUnique({ where: { employeeId: empId } }),
    ]);

    if (!user || !trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    const classroomId = trainee.classroomId || user.classroomId;
    if (!classroomId) {
      return res.json({
        ok: true,
        dashboard: {
          trainee: { employeeId: trainee.employeeId, name: trainee.traineeName, batchNo: trainee.batchNo, branch: trainee.branch, process: trainee.process, lob: trainee.lob },
          classroom: null,
          days: [],
          summary: {},
          directAssignments: [],
        },
      });
    }

    const [classroom, modules, allContent, allFaqs, allAssessments, progressRows, allAttemptResults] = await Promise.all([
      prisma.classroomMaster.findUnique({ where: { classroomId } }),
      prisma.moduleMaster.findMany({ where: { classroomId, active: true }, orderBy: [{ dayNo: 'asc' }, { moduleOrder: 'asc' }] }),
      prisma.contentMaster.findMany({ where: { module: { classroomId } }, orderBy: { contentOrder: 'asc' } }),
      prisma.faqMaster.findMany({ where: { module: { classroomId }, active: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.assessmentMaster.findMany({ where: { classroomId, active: true }, orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }] }),
      prisma.contentProgress.findMany({ where: { employeeId: empId, classroomId } }),
      prisma.assessmentResult.findMany({ where: { employeeId: empId, classroomId } }),
    ]);

    // Build progress map
    const progressMap = {};
    for (const p of progressRows) progressMap[p.contentId] = p;

    const resultMap = {};
    for (const r of allAttemptResults) resultMap[r.assessmentId] = r;

    // Group into days
    const dayMap = {};
    for (const mod of modules) {
      if (!dayMap[mod.dayNo]) dayMap[mod.dayNo] = { dayNo: mod.dayNo, modules: [] };
      const contents = allContent.filter(c => c.moduleId === mod.moduleId).map(c => ({
        ...c,
        progress: progressMap[c.contentId] || null,
      }));
      const faqs = allFaqs.filter(f => f.moduleId === mod.moduleId);
      // All assessments linked to this module, sorted by sortOrder — supports unlimited MCQs per module
      const moduleAssessments = allAssessments
        .filter(a => a.moduleId === mod.moduleId)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const moduleAssessmentResults = moduleAssessments.map(a => ({
        assessment: a,
        result: resultMap[a.assessmentId] || null,
      }));

      dayMap[mod.dayNo].modules.push({ ...mod, contents, faqs, assessments: moduleAssessments, assessmentResults: moduleAssessmentResults });
    }
    const days = Object.values(dayMap).sort((a, b) => a.dayNo - b.dayNo);

    // Summary
    const totalContents = allContent.filter(c => c.active).length;
    const openedContents = progressRows.filter(p => p.opened).length;
    const completedContents = progressRows.filter(p => p.completionStatus === 'Completed').length;
    const completionPercent = totalContents > 0 ? Math.round((completedContents / totalContents) * 100) : 0;
    const totalSecondsSpent = progressRows.reduce((s, p) => s + (p.totalSecondsSpent || 0), 0);
    const totalAssessments = allAssessments.length;
    const attemptedAssessments = allAttemptResults.length;
    const passedAssessments = allAttemptResults.filter(r => r.result === 'Pass').length;
    const mcqCompletionPercent = totalAssessments > 0 ? Math.round((attemptedAssessments / totalAssessments) * 100) : 0;
    const bestMcqScore = allAttemptResults.length > 0 ? Math.max(...allAttemptResults.map(r => r.bestPercentage)) : null;
    // Overall progress = video/content completion only.
    // MCQ attempt rate is shown separately — blending it inflates the number misleadingly.
    const overallTrainingProgress = completionPercent;

    const totalDays = days.length;
    const totalModules = modules.length;

    // Assigned modules
    const directAssignments = await prisma.assignedModule.findMany({
      where: {
        OR: [
          { assignedTo: empId, assignedToType: 'individual' },
          { assignedTo: trainee.batchNo || '', assignedToType: 'batch' },
          { assignedTo: trainee.process || '', assignedToType: 'process' },
          { assignedTo: trainee.branch || '', assignedToType: 'branch' },
          { assignedToType: 'company' },
        ],
        active: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      ok: true,
      dashboard: {
        trainee: { employeeId: trainee.employeeId, name: trainee.traineeName, batchNo: trainee.batchNo, branch: trainee.branch, process: trainee.process, lob: trainee.lob, lastLogin: user.lastLogin },
        classroom: { classroomId, classroomName: classroom?.classroomName, process: classroom?.process, lob: classroom?.lob },
        days,
        summary: { totalDays, totalModules, totalContents, openedContents, completedContents, completionPercent, totalSecondsSpent, totalAssessments, attemptedAssessments, passedAssessments, mcqCompletionPercent, bestMcqScore, overallTrainingProgress, riskStatus: trainee.riskStatus || null, courseCompletionPct: trainee.courseCompletionPct || 0, attendancePct: trainee.attendancePct || 0 },
        directAssignments,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Content Tracking ──────────────────────────────────────────────────────────
export async function logContentOpen(req, res) {
  try {
    const empId = req.userId;
    const { contentId } = req.params;

    const content = await prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } });
    if (!content) return res.status(404).json({ ok: false, message: 'Content not found.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: empId } });
    const classroomId = trainee?.classroomId;
    const dayNo = content.module.dayNo;
    const moduleId = content.moduleId;

    // Sequential lock check: if this content has contentOrder > 1, the previous content must be completed
    if (content.locked && content.contentOrder > 1) {
      const prevContent = await prisma.contentMaster.findFirst({
        where: { moduleId, contentOrder: content.contentOrder - 1, active: true },
      });
      if (prevContent) {
        const prevProgress = await prisma.contentProgress.findUnique({
          where: { employeeId_contentId: { employeeId: empId, contentId: prevContent.contentId } },
        });
        if (!prevProgress || prevProgress.completionStatus !== 'Completed') {
          return res.status(403).json({
            ok: false,
            locked: true,
            message: `Complete "${prevContent.contentTitle}" first to unlock this content.`,
            prerequisiteContentId: prevContent.contentId,
            prerequisiteTitle: prevContent.contentTitle,
          });
        }
      }
    }

    const existing = await prisma.contentProgress.findUnique({
      where: { employeeId_contentId: { employeeId: empId, contentId } },
    });

    const now = new Date();
    if (existing) {
      await prisma.contentProgress.update({
        where: { id: existing.id },
        data: { opened: true, openCount: { increment: 1 }, lastOpenedAt: now, updatedAt: now },
      });
    } else {
      const requiredSecs = content.completionRulePct > 0 && content.estimatedMins > 0
        ? Math.round((content.estimatedMins * 60) * (content.completionRulePct / 100))
        : 0;
      await prisma.contentProgress.create({
        data: {
          employeeId: empId,
          classroomId: classroomId || '',
          dayNo,
          moduleId,
          contentId,
          opened: true,
          openCount: 1,
          firstOpenedAt: now,
          lastOpenedAt: now,
          requiredSeconds: requiredSecs,
          completionStatus: 'In Progress',
          playerMode: content.playerMode,
        },
      });
    }

    await prisma.videoWatchLog.create({
      data: {
        employeeId: empId,
        batchNo: trainee?.batchNo,
        classroomId: classroomId || '',
        dayNo,
        moduleId,
        contentId,
        event: 'OPEN',
        playerMode: content.playerMode,
      },
    });

    // Sync today's attendance
    await syncAttendance(empId, trainee);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function logContentHeartbeat(req, res) {
  try {
    const empId = req.userId;
    const { contentId } = req.params;
    const { secondsDelta = 0, sessionSeconds = 0, positionSeconds = 0, durationSeconds = 0, playerMode = 'Auto' } = req.body;

    const cappedDelta = Math.min(Math.max(parseInt(secondsDelta, 10) || 0, 0), 30);
    const posSec = parseInt(positionSeconds, 10) || 0;
    const durSec = parseInt(durationSeconds, 10) || 0;

    const progress = await prisma.contentProgress.findUnique({
      where: { employeeId_contentId: { employeeId: empId, contentId } },
    });

    if (!progress) return res.json({ ok: true }); // OPEN not yet logged, ignore

    const newTotal = (progress.totalSecondsSpent || 0) + cappedDelta;
    const requiredSecs = progress.requiredSeconds || (durSec > 0 ? Math.round(durSec * 0.8) : 0);
    const completionPct = requiredSecs > 0 ? Math.min(100, Math.round((newTotal / requiredSecs) * 100)) : 0;
    const isCompleted = completionPct >= 100;

    await prisma.contentProgress.update({
      where: { id: progress.id },
      data: {
        totalSecondsSpent: newTotal,
        lastPositionSeconds: posSec,
        mediaDurationSeconds: durSec || progress.mediaDurationSeconds,
        requiredSeconds: requiredSecs,
        completionPct,
        completionStatus: isCompleted ? 'Completed' : 'In Progress',
        completedAt: isCompleted && !progress.completedAt ? new Date() : progress.completedAt,
        lastOpenedAt: new Date(),
        playerMode,
      },
    });

    if (cappedDelta > 0) {
      await prisma.videoWatchLog.create({
        data: {
          employeeId: empId,
          batchNo: null,
          classroomId: progress.classroomId,
          dayNo: progress.dayNo,
          moduleId: progress.moduleId,
          contentId,
          event: 'HEARTBEAT',
          secondsDelta: cappedDelta,
          positionSeconds: posSec,
          durationSeconds: durSec,
          completionPct,
          playerMode,
        },
      });
    }

    // Update course completion report
    await updateCourseReport(empId, progress.classroomId);

    // FIX 2: Sync TraineeMaster stats
    await syncTraineeMasterStats(empId, progress.classroomId);

    res.json({ ok: true, completionPct });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function logContentClose(req, res) {
  try {
    const empId = req.userId;
    const { contentId } = req.params;
    const { secondsDelta = 0, positionSeconds = 0 } = req.body;

    const cappedDelta = Math.min(Math.max(parseInt(secondsDelta, 10) || 0, 0), 30);
    const progress = await prisma.contentProgress.findUnique({
      where: { employeeId_contentId: { employeeId: empId, contentId } },
    });

    if (progress && cappedDelta > 0) {
      const newTotal = (progress.totalSecondsSpent || 0) + cappedDelta;
      const completionPct = progress.requiredSeconds > 0 ? Math.min(100, Math.round((newTotal / progress.requiredSeconds) * 100)) : progress.completionPct;
      const isCompleted = completionPct >= 100;

      await prisma.contentProgress.update({
        where: { id: progress.id },
        data: {
          totalSecondsSpent: newTotal,
          lastPositionSeconds: parseInt(positionSeconds, 10) || progress.lastPositionSeconds,
          completionPct,
          completionStatus: isCompleted ? 'Completed' : 'In Progress',
          completedAt: isCompleted && !progress.completedAt ? new Date() : progress.completedAt,
        },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

async function updateCourseReport(employeeId, classroomId) {
  const [allContent, progressRows] = await Promise.all([
    prisma.contentMaster.count({ where: { module: { classroomId }, active: true } }),
    prisma.contentProgress.findMany({ where: { employeeId, classroomId } }),
  ]);

  const opened = progressRows.filter(p => p.opened).length;
  const completed = progressRows.filter(p => p.completionStatus === 'Completed').length;
  const completionPct = allContent > 0 ? Math.round((completed / allContent) * 100) : 0;
  const totalSeconds = progressRows.reduce((s, p) => s + (p.totalSecondsSpent || 0), 0);

  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });

  await prisma.courseCompletionReport.upsert({
    where: { employeeId_classroomId: { employeeId, classroomId } },
    create: { employeeId, batchNo: trainee?.batchNo, classroomId, totalContents: allContent, openedContents: opened, completionPct, totalSecondsSpent: totalSeconds, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
    update: { totalContents: allContent, openedContents: opened, completionPct, totalSecondsSpent: totalSeconds, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
  });

  // Update trainee master
  await prisma.traineeMaster.update({
    where: { employeeId },
    data: { courseCompletionPct: completionPct },
  });

  // Detect risks
  await detectAndSyncRisks(employeeId);
}

// ── Assessment ────────────────────────────────────────────────────────────────
export async function getAssessment(req, res) {
  try {
    const { assessmentId } = req.params;
    const empId = req.userId;

    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found.' });

    const attempts = await prisma.assessmentAttempt.count({ where: { employeeId: empId, assessmentId } });
    if (attempts >= assessment.attemptLimit) {
      return res.json({ ok: false, message: `Max attempts (${assessment.attemptLimit}) reached.`, attempts });
    }

    const questions = await prisma.questionBank.findMany({
      where: { assessmentId, active: true },
      select: { questionId: true, questionText: true, optionA: true, optionB: true, optionC: true, optionD: true, marks: true, difficulty: true },
    });

    // FIX 4: Shuffle questions for each attempt
    questions.sort(() => Math.random() - 0.5);

    const bestResult = await prisma.assessmentResult.findUnique({
      where: { employeeId_assessmentId: { employeeId: empId, assessmentId } },
    });

    res.json({
      ok: true,
      data: {
        assessment: {
          assessmentId: assessment.assessmentId,
          assessmentName: assessment.assessmentName,
          passingPct: assessment.passingPct,
          attemptLimit: assessment.attemptLimit,
          timeLimitMins: assessment.timeLimitMins,
          instructions: assessment.instructions,
          totalAttempts: attempts,
        },
        questions,
        bestResult,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function submitAssessment(req, res) {
  try {
    const { assessmentId } = req.params;
    const { answers, timeTakenSeconds } = req.body; // answers: { questionId: 'A'|'B'|'C'|'D' }
    const empId = req.userId;

    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found.' });

    const limit = assessment.attemptLimit || 3;
    const attempts = await prisma.assessmentAttempt.count({ where: { employeeId: empId, assessmentId } });
    if (attempts >= limit) return res.status(400).json({ ok: false, message: `Attempt limit reached (${attempts}/${limit}). No more attempts allowed.` });

    const existingResult = await prisma.assessmentResult.findUnique({ where: { employeeId_assessmentId: { employeeId: empId, assessmentId } } });

    const questions = await prisma.questionBank.findMany({ where: { assessmentId, active: true } });

    let totalMarks = 0, scored = 0, correct = 0, wrong = 0, blank = 0;
    for (const q of questions) {
      const given = (answers || {})[q.questionId];
      totalMarks += q.marks;
      if (!given) { blank++; continue; }
      if (given.toUpperCase() === q.correctOption.toUpperCase()) {
        scored += q.marks; correct++;
      } else {
        scored -= q.negativeMarks; wrong++;
      }
    }

    const percentage = totalMarks > 0 ? Math.max(0, Math.round((scored / totalMarks) * 100)) : 0;
    const result = percentage >= assessment.passingPct ? 'Pass' : 'Fail';
    const attemptNo = attempts + 1;

    const attempt = await prisma.assessmentAttempt.create({
      data: {
        attemptId: `ATT-${empId}-${assessmentId}-${attemptNo}`,
        employeeId: empId,
        assessmentId,
        attemptNo,
        startedAt: new Date(Date.now() - ((parseInt(timeTakenSeconds, 10) || 0) * 1000)),
        submittedAt: new Date(),
        timeTakenSeconds: parseInt(timeTakenSeconds, 10) || 0,
        totalQuestions: questions.length,
        correctAnswers: correct,
        wrongAnswers: wrong,
        blankAnswers: blank,
        score: scored,
        percentage,
        result,
        answerJson: answers,
      },
    });

    // Update best result (existingResult already fetched above for attempt limit check)
    const isBest = !existingResult || percentage > existingResult.bestPercentage;

    const traineeForBatch = await prisma.traineeMaster.findUnique({ where: { employeeId: empId } });

    await prisma.assessmentResult.upsert({
      where: { employeeId_assessmentId: { employeeId: empId, assessmentId } },
      create: {
        employeeId: empId,
        batchNo: traineeForBatch?.batchNo,
        classroomId: assessment.classroomId,
        assessmentId,
        bestScore: scored,
        bestPercentage: percentage,
        result,
        totalAttempts: 1,
        lastAttemptAt: new Date(),
      },
      update: {
        totalAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        ...(isBest ? { bestScore: scored, bestPercentage: percentage, result } : {}),
      },
    });

    // Update trainee MCQ stats
    const allResults = await prisma.assessmentResult.findMany({ where: { employeeId: empId, classroomId: assessment.classroomId } });
    if (traineeForBatch) {
      const allAssessments = await prisma.assessmentMaster.count({ where: { classroomId: assessment.classroomId, active: true } });
      const passedCount = allResults.filter(r => r.result === 'Pass').length;
      await prisma.traineeMaster.update({
        where: { employeeId: empId },
        data: {
          assessmentAttemptPct: allAssessments > 0 ? Math.round((allResults.length / allAssessments) * 100) : 0,
          assessmentPassPct: allResults.length > 0 ? Math.round((passedCount / allResults.length) * 100) : 0,
        },
      });
    }

    await detectAndSyncRisks(empId);

    // FIX 2: Sync TraineeMaster stats after assessment submit
    await syncTraineeMasterStats(empId, assessment.classroomId);

    // Mark mcqActivity on today's attendance inference record
    if (traineeForBatch?.batchNo) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      prisma.attendanceInference.upsert({
        where: { date_batchNo_employeeId: { date: today, batchNo: traineeForBatch.batchNo, employeeId: empId } },
        create: {
          date: today,
          batchNo: traineeForBatch.batchNo,
          employeeId: empId,
          traineeName: traineeForBatch.traineeName,
          branch: traineeForBatch.branch,
          process: traineeForBatch.process,
          lob: traineeForBatch.lob,
          mcqActivity: true,
          finalAttendance: 'Present',
          attendanceSource: 'Inferred',
        },
        update: { mcqActivity: true },
      }).catch(() => {});
    }

    // Return correct answers for review
    const attemptsLeft = Math.max(0, limit - attemptNo);
    const revealAnswers = result === 'Pass' || attemptsLeft === 0;

    const reviewData = questions.map(q => ({
      questionId: q.questionId,
      questionText: q.questionText,
      correctOption: revealAnswers ? q.correctOption : null,
      yourAnswer: (answers || {})[q.questionId] || null,
      explanation: revealAnswers ? q.explanation : null,
    }));

    res.json({
      ok: true,
      data: {
        result,
        percentage,
        scored,
        totalMarks,
        correct,
        wrong,
        blank,
        attemptNo,
        passingPct: assessment.passingPct,
        attemptsLeft,
        review: reviewData,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Q&A ───────────────────────────────────────────────────────────────────────
export async function raiseQuestion(req, res) {
  try {
    const empId = req.userId;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: empId } });
    const { category, priority, question, dayNo, moduleId } = req.body;
    if (!question) return res.status(400).json({ ok: false, message: 'Question text required.' });

    const q = await prisma.traineeQueryLog.create({
      data: {
        queryId: `QRY-${empId}-${Date.now()}`,
        employeeId: empId,
        traineeName: trainee?.traineeName,
        batchNo: trainee?.batchNo,
        classroomId: trainee?.classroomId,
        dayNo: dayNo ? parseInt(dayNo, 10) : null,
        moduleId: moduleId || null,
        category: category || 'Process Doubt',
        question,
        priority: priority || 'Normal',
        status: 'Open',
      },
    });

    await detectAndSyncRisks(empId);
    res.json({ ok: true, data: q });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getMyQuestions(req, res) {
  try {
    const empId = req.userId;
    const { status, priority } = req.query;
    const where = { employeeId: empId };
    if (status && status !== 'All') where.status = status;
    if (priority && priority !== 'All') where.priority = priority;

    const questions = await prisma.traineeQueryLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ ok: true, data: questions });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// FIX 7: Trainee profile update
export async function updateProfile(req, res) {
  try {
    const empId = req.userId;
    const { traineeName, email, mobile } = req.body;
    await prisma.traineeMaster.update({
      where: { employeeId: empId },
      data: { traineeName, email, mobile },
    });
    res.json({ ok: true, message: 'Profile updated.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Update failed.' });
  }
}

export async function getAssignedModules(req, res) {
  try {
    const empId = req.userId;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: empId } });
    const assignments = await prisma.assignedModule.findMany({
      where: {
        OR: [
          { assignedTo: empId, assignedToType: 'trainee' },
          { assignedTo: trainee?.batchNo || '', assignedToType: 'batch' },
        ],
        active: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: assignments });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

async function syncAttendance(employeeId, trainee) {
  if (!trainee?.batchNo) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.attendanceInference.upsert({
    where: { date_batchNo_employeeId: { date: today, batchNo: trainee.batchNo, employeeId } },
    create: {
      date: today,
      batchNo: trainee.batchNo,
      employeeId,
      traineeName: trainee.traineeName,
      branch: trainee.branch,
      process: trainee.process,
      lob: trainee.lob,
      courseActivity: true,
      finalAttendance: 'Present',
      attendanceSource: 'Inferred',
    },
    update: { courseActivity: true, finalAttendance: 'Present', attendanceSource: 'Inferred' },
  });

  // FIX 1: Recalculate attendancePct for TraineeMaster
  const [presentDates, totalDates] = await Promise.all([
    prisma.attendanceInference.findMany({
      where: { employeeId, batchNo: trainee.batchNo, finalAttendance: 'Present' },
      select: { date: true },
      distinct: ['date'],
    }),
    prisma.attendanceInference.findMany({
      where: { batchNo: trainee.batchNo },
      select: { date: true },
      distinct: ['date'],
    }),
  ]);

  const presentDays = presentDates.length;
  const totalDays = totalDates.length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

  await prisma.traineeMaster.update({
    where: { employeeId },
    data: { attendancePct },
  });
}

// FIX 2: Helper to sync TraineeMaster stats after heartbeat / assessment submit
async function syncTraineeMasterStats(empId, classroomId) {
  const [allContent, progressRows, allAssessments, assessmentResults] = await Promise.all([
    prisma.contentMaster.count({ where: { module: { classroomId }, active: true } }),
    prisma.contentProgress.findMany({ where: { employeeId: empId, classroomId } }),
    prisma.assessmentMaster.count({ where: { classroomId, active: true } }),
    prisma.assessmentResult.findMany({ where: { employeeId: empId, classroomId } }),
  ]);

  const completedContents = progressRows.filter(p => p.completionStatus === 'Completed').length;
  const courseCompletionPct = allContent > 0 ? Math.round((completedContents / allContent) * 100) : 0;

  const passedAssessments = assessmentResults.filter(r => r.result === 'Pass').length;
  const assessmentPassPct = allAssessments > 0 ? Math.round((passedAssessments / allAssessments) * 100) : 0;
  await prisma.traineeMaster.update({
    where: { employeeId: empId },
    data: { courseCompletionPct, assessmentPassPct },
  });
}
