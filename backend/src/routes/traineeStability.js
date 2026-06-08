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

function isComplete(row) {
  return row?.completionStatus === 'Completed' || Number(row?.completionPct || 0) >= 100;
}

function contentSort(a, b) {
  const dayDiff = (a.module?.dayNo || 0) - (b.module?.dayNo || 0);
  if (dayDiff) return dayDiff;
  const moduleDiff = (a.module?.moduleOrder || 0) - (b.module?.moduleOrder || 0);
  if (moduleDiff) return moduleDiff;
  return (a.contentOrder || 0) - (b.contentOrder || 0);
}

function mapRepoContent(row) {
  return {
    repositoryContentId: row.repository_content_id,
    title: row.title,
    contentTitle: row.title,
    contentType: row.content_type,
    category: row.category,
    subCategory: row.sub_category,
    process: row.process,
    lob: row.lob,
    tags: row.tags,
    sourceType: row.source_type,
    directMediaUrl: row.direct_media_url,
    localFilePath: row.local_file_path,
    driveFileId: row.drive_file_id,
    driveUrl: row.drive_url,
    playerMode: row.player_mode,
    estimatedMins: row.estimated_mins,
    completionRulePct: row.completion_rule_pct,
    description: row.description,
    versionNo: row.version_no,
    sortOrder: row.sort_order || 0,
    required: Boolean(row.required),
  };
}

function buildContentLockMap(contents, progressMap) {
  const map = new Map();
  const required = [...contents].filter(c => c.active && c.required).sort(contentSort);
  for (let i = 0; i < required.length; i += 1) {
    const content = required[i];
    const previousMissing = required.slice(0, i).find(prev => !isComplete(progressMap[prev.contentId]));
    if (previousMissing) {
      map.set(content.contentId, {
        accessLocked: true,
        lockReason: `Complete "${previousMissing.contentTitle}" first to unlock this content.`,
        prerequisiteContentId: previousMissing.contentId,
        prerequisiteTitle: previousMissing.contentTitle,
      });
    } else {
      map.set(content.contentId, { accessLocked: false, lockReason: null, prerequisiteContentId: null, prerequisiteTitle: null });
    }
  }
  return map;
}

function buildAssessmentLockMeta(assessment, allContent, progressMap) {
  const required = allContent.filter(c => {
    if (!c.active || !c.required) return false;
    if (assessment.moduleId) return c.moduleId === assessment.moduleId;
    if (assessment.dayNo) return c.module?.classroomId === assessment.classroomId && c.module?.dayNo <= assessment.dayNo;
    return c.module?.classroomId === assessment.classroomId;
  }).sort(contentSort);

  const missing = required.find(c => !isComplete(progressMap[c.contentId]));
  if (!missing) return { accessLocked: false, lockReason: null, prerequisiteContentId: null, prerequisiteTitle: null };
  return {
    accessLocked: true,
    lockReason: `Complete "${missing.contentTitle}" before attempting this assessment.`,
    prerequisiteContentId: missing.contentId,
    prerequisiteTitle: missing.contentTitle,
  };
}

async function getDirectAssignments(trainee, empId) {
  return prisma.assignedModule.findMany({
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
}

async function enrichIndependentAssignments(assignments) {
  if (!assignments?.length) return [];
  const moduleIds = [...new Set(assignments.map(a => a.moduleId).filter(Boolean))];
  if (!moduleIds.length) return assignments;
  try {
    const placeholders = moduleIds.map(() => '?').join(',');
    const moduleRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM independent_module_master WHERE status = 'Active' AND module_id IN (${placeholders})`,
      ...moduleIds
    );
    const knownIndependent = new Set((moduleRows || []).map(m => m.module_id));
    if (!knownIndependent.size) return assignments;

    const contentRows = await prisma.$queryRawUnsafe(
      `SELECT m.module_id, m.sort_order, m.required, r.*
       FROM independent_module_content_map m
       INNER JOIN content_repository_master r ON r.repository_content_id = m.repository_content_id
       WHERE m.active = 1 AND r.status = 'Active' AND m.module_id IN (${placeholders})
       ORDER BY m.module_id, m.sort_order ASC`,
      ...moduleIds
    );
    const byModule = {};
    for (const row of contentRows || []) {
      if (!byModule[row.module_id]) byModule[row.module_id] = [];
      byModule[row.module_id].push(mapRepoContent(row));
    }
    return assignments.map(a => ({
      ...a,
      independentModule: knownIndependent.has(a.moduleId),
      contents: byModule[a.moduleId] || [],
    }));
  } catch (err) {
    // Independent module tables may not exist yet on older local DBs. Keep assignments visible.
    return assignments;
  }
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
  const completedContents = progressRows.filter(p => isComplete(p)).length;
  const completionPct = totalContent > 0 ? Math.round((completedContents / totalContent) * 100) : 0;
  const totalSecondsSpent = progressRows.reduce((sum, p) => sum + Number(p.totalSecondsSpent || 0), 0);

  const passedAssessments = assessmentResults.filter(r => r.result === 'Pass').length;
  const assessmentAttemptPct = totalAssessments > 0 ? Math.round((assessmentResults.length / totalAssessments) * 100) : 0;
  const assessmentPassPct = totalAssessments > 0 ? Math.round((passedAssessments / totalAssessments) * 100) : 0;

  await prisma.$transaction([
    prisma.courseCompletionReport.upsert({
      where: { employeeId_classroomId: { employeeId, classroomId } },
      create: { employeeId, batchNo: trainee?.batchNo || null, classroomId, totalContents: totalContent, openedContents, completionPct, totalSecondsSpent, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
      update: { totalContents: totalContent, openedContents, completionPct, totalSecondsSpent, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
    }),
    prisma.traineeMaster.update({ where: { employeeId }, data: { courseCompletionPct: completionPct, assessmentAttemptPct, assessmentPassPct } }),
  ]);

  await detectAndSyncRisks(employeeId).catch(err => console.error('[traineeStability] risk sync failed:', err.message));
}

router.get('/dashboard', ...auth, async (req, res) => {
  try {
    const empId = req.userId;
    const [user, trainee] = await Promise.all([
      prisma.userMaster.findUnique({ where: { employeeId: empId } }),
      prisma.traineeMaster.findUnique({ where: { employeeId: empId } }),
    ]);

    if (!user || !trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    const directAssignments = await enrichIndependentAssignments(await getDirectAssignments(trainee, empId));
    const classroomId = trainee.classroomId || user.classroomId;
    if (!classroomId) {
      return res.json({
        ok: true,
        dashboard: {
          trainee: { employeeId: trainee.employeeId, name: trainee.traineeName, batchNo: trainee.batchNo, branch: trainee.branch, process: trainee.process, lob: trainee.lob, lastLogin: user.lastLogin },
          classroom: null,
          days: [],
          summary: { totalDays: 0, totalModules: 0, totalContents: 0, openedContents: 0, completedContents: 0, completionPercent: 0, totalSecondsSpent: 0, totalAssessments: 0, attemptedAssessments: 0, passedAssessments: 0, mcqCompletionPercent: 0, bestMcqScore: null, overallTrainingProgress: 0, riskStatus: trainee.riskStatus || null, courseCompletionPct: trainee.courseCompletionPct || 0, attendancePct: trainee.attendancePct || 0 },
          directAssignments,
        },
      });
    }

    const [classroom, modules, allContent, allFaqs, allAssessments, progressRows, allAttemptResults] = await Promise.all([
      prisma.classroomMaster.findUnique({ where: { classroomId } }),
      prisma.moduleMaster.findMany({ where: { classroomId, active: true }, orderBy: [{ dayNo: 'asc' }, { moduleOrder: 'asc' }] }),
      prisma.contentMaster.findMany({ where: { module: { classroomId }, active: true }, include: { module: true }, orderBy: { contentOrder: 'asc' } }),
      prisma.faqMaster.findMany({ where: { module: { classroomId }, active: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.assessmentMaster.findMany({ where: { classroomId, active: true }, orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }] }),
      prisma.contentProgress.findMany({ where: { employeeId: empId, classroomId } }),
      prisma.assessmentResult.findMany({ where: { employeeId: empId, classroomId } }),
    ]);

    const progressMap = {};
    for (const p of progressRows) progressMap[p.contentId] = p;
    const resultMap = {};
    for (const r of allAttemptResults) resultMap[r.assessmentId] = r;
    const contentLockMap = buildContentLockMap(allContent, progressMap);

    const dayMap = {};
    for (const mod of modules) {
      if (!dayMap[mod.dayNo]) dayMap[mod.dayNo] = { dayNo: mod.dayNo, modules: [] };
      const contents = allContent
        .filter(c => c.moduleId === mod.moduleId)
        .sort((a, b) => (a.contentOrder || 0) - (b.contentOrder || 0))
        .map(c => {
          const lock = contentLockMap.get(c.contentId) || { accessLocked: false, lockReason: null, prerequisiteContentId: null, prerequisiteTitle: null };
          const { module, ...cleanContent } = c;
          return { ...cleanContent, ...lock, progress: progressMap[c.contentId] || null };
        });

      const faqs = allFaqs.filter(f => f.moduleId === mod.moduleId);
      const moduleAssessments = allAssessments
        .filter(a => a.moduleId === mod.moduleId)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map(a => ({ ...a, ...buildAssessmentLockMeta(a, allContent, progressMap) }));
      const moduleAssessmentResults = moduleAssessments.map(a => ({ assessment: a, result: resultMap[a.assessmentId] || null }));

      dayMap[mod.dayNo].modules.push({ ...mod, contents, faqs, assessments: moduleAssessments, assessmentResults: moduleAssessmentResults });
    }

    const days = Object.values(dayMap).sort((a, b) => a.dayNo - b.dayNo);
    const totalContents = allContent.filter(c => c.active).length;
    const openedContents = progressRows.filter(p => p.opened).length;
    const completedContents = progressRows.filter(p => isComplete(p)).length;
    const completionPercent = totalContents > 0 ? Math.round((completedContents / totalContents) * 100) : 0;
    const totalSecondsSpent = progressRows.reduce((s, p) => s + Number(p.totalSecondsSpent || 0), 0);
    const totalAssessments = allAssessments.length;
    const attemptedAssessments = allAttemptResults.length;
    const passedAssessments = allAttemptResults.filter(r => r.result === 'Pass').length;
    const mcqCompletionPercent = totalAssessments > 0 ? Math.round((attemptedAssessments / totalAssessments) * 100) : 0;
    const bestMcqScore = allAttemptResults.length > 0 ? Math.max(...allAttemptResults.map(r => r.bestPercentage || 0)) : null;
    const overallTrainingProgress = completionPercent;
    const totalDays = days.length;
    const totalModules = modules.length;

    return res.json({
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
    console.error('[traineeStability] dashboard failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/content/:contentId/open', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const { contentId } = req.params;
    const content = await prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } });
    if (!content || !content.active) return res.status(404).json({ ok: false, message: 'Content not found.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    const classroomId = content.module?.classroomId || trainee?.classroomId || '';
    const allContent = await prisma.contentMaster.findMany({ where: { module: { classroomId }, active: true }, include: { module: true } });
    const priorRequired = allContent.filter(c => c.required).sort(contentSort);
    const idx = priorRequired.findIndex(c => c.contentId === contentId);
    if (content.required && idx > 0 && process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED !== 'true') {
      const previous = priorRequired.slice(0, idx);
      const progress = await prisma.contentProgress.findMany({ where: { employeeId, contentId: { in: previous.map(c => c.contentId) } } });
      const progressMap = new Map(progress.map(p => [p.contentId, p]));
      const missing = previous.find(c => !isComplete(progressMap.get(c.contentId)));
      if (missing) return res.status(403).json({ ok: false, locked: true, message: `Complete "${missing.contentTitle}" first to unlock this content.`, prerequisiteContentId: missing.contentId, prerequisiteTitle: missing.contentTitle });
    }

    const existing = await prisma.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId, contentId } } });
    const now = new Date();
    if (existing) {
      await prisma.contentProgress.update({ where: { id: existing.id }, data: { opened: true, openCount: { increment: 1 }, lastOpenedAt: now } });
    } else {
      const requiredSeconds = content.completionRulePct > 0 && content.estimatedMins > 0 ? Math.round((content.estimatedMins * 60) * (content.completionRulePct / 100)) : 0;
      await prisma.contentProgress.create({ data: { employeeId, classroomId, dayNo: content.module?.dayNo || 0, moduleId: content.moduleId, contentId, opened: true, openCount: 1, firstOpenedAt: now, lastOpenedAt: now, requiredSeconds, completionStatus: 'In Progress', playerMode: content.playerMode || 'Auto' } });
    }

    await prisma.videoWatchLog.create({ data: { employeeId, batchNo: trainee?.batchNo || null, classroomId, dayNo: content.module?.dayNo || 0, moduleId: content.moduleId, contentId, event: 'OPEN', playerMode: content.playerMode || 'Auto' } });
    return res.json({ ok: true, locked: false });
  } catch (err) {
    console.error('[traineeStability] content open failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.get('/assessment/:assessmentId', ...auth, requireAssessmentSequence, async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const employeeId = req.userId;
    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment || !assessment.active) return res.status(404).json({ ok: false, message: 'Assessment not found.' });

    const attemptsUsed = await prisma.assessmentAttempt.count({ where: { employeeId, assessmentId } });
    if (attemptsUsed >= assessment.attemptLimit) return res.json({ ok: false, message: `Max attempts (${assessment.attemptLimit}) reached.`, attempts: attemptsUsed, attemptsUsed });

    const questions = await prisma.questionBank.findMany({ where: { assessmentId, active: true }, select: { questionId: true, questionText: true, optionA: true, optionB: true, optionC: true, optionD: true, marks: true, difficulty: true } });
    questions.sort(() => Math.random() - 0.5);
    const bestResult = await prisma.assessmentResult.findUnique({ where: { employeeId_assessmentId: { employeeId, assessmentId } } });
    return res.json({ ok: true, data: { assessment: { assessmentId: assessment.assessmentId, assessmentName: assessment.assessmentName, passingPct: assessment.passingPct, attemptLimit: assessment.attemptLimit, timeLimitMins: assessment.timeLimitMins, instructions: assessment.instructions, totalAttempts: attemptsUsed, attemptsUsed }, questions, bestResult } });
  } catch (err) {
    console.error('[traineeStability] assessment load failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/content/:contentId/close', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const { contentId } = req.params;
    const completedExplicitly = isTrue(req.body?.completed) || isTrue(req.body?.completionStatus);
    const secondsDelta = capSeconds(req.body?.secondsDelta, 120);
    const positionSeconds = parsePositiveInt(req.body?.positionSeconds, 0);
    const durationSeconds = parsePositiveInt(req.body?.durationSeconds, 0);

    const content = await prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } });
    if (!content || !content.active) return res.status(404).json({ ok: false, message: 'Content not found.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    const classroomId = content.module?.classroomId || trainee?.classroomId || '';
    const dayNo = content.module?.dayNo || 0;
    const moduleId = content.moduleId;
    const existing = await prisma.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId, contentId } } });
    const now = new Date();
    const requiredSeconds = existing?.requiredSeconds || (durationSeconds > 0 ? Math.round(durationSeconds * ((content.completionRulePct || 80) / 100)) : 0) || (content.estimatedMins > 0 ? Math.round((content.estimatedMins * 60) * ((content.completionRulePct || 80) / 100)) : 0);

    if (!existing) {
      await prisma.contentProgress.create({ data: { employeeId, classroomId, dayNo, moduleId, contentId, opened: true, openCount: 1, firstOpenedAt: now, lastOpenedAt: now, totalSecondsSpent: secondsDelta, lastPositionSeconds: positionSeconds, mediaDurationSeconds: durationSeconds, requiredSeconds, completionPct: completedExplicitly ? 100 : 0, completionStatus: completedExplicitly ? 'Completed' : 'In Progress', completedAt: completedExplicitly ? now : null, playerMode: content.playerMode || 'Auto' } });
    } else {
      const newTotal = Number(existing.totalSecondsSpent || 0) + secondsDelta;
      const completionPct = completedExplicitly ? 100 : requiredSeconds > 0 ? Math.min(100, Math.round((newTotal / requiredSeconds) * 100)) : Number(existing.completionPct || 0);
      const completed = completionPct >= 100;
      await prisma.contentProgress.update({ where: { id: existing.id }, data: { opened: true, lastOpenedAt: now, totalSecondsSpent: newTotal, lastPositionSeconds: positionSeconds || existing.lastPositionSeconds, mediaDurationSeconds: durationSeconds || existing.mediaDurationSeconds, requiredSeconds, completionPct, completionStatus: completed ? 'Completed' : 'In Progress', completedAt: completed && !existing.completedAt ? now : existing.completedAt, playerMode: content.playerMode || existing.playerMode || 'Auto' } });
    }

    await prisma.videoWatchLog.create({ data: { employeeId, batchNo: trainee?.batchNo || null, classroomId, dayNo, moduleId, contentId, event: completedExplicitly ? 'COMPLETE' : 'CLOSE', secondsDelta, positionSeconds, durationSeconds, completionPct: completedExplicitly ? 100 : 0, playerMode: content.playerMode || 'Auto', details: completedExplicitly ? 'Explicit completion from document/download viewer' : null } });
    await syncCourseAndTraineeStats(employeeId, classroomId);
    return res.json({ ok: true, completed: completedExplicitly });
  } catch (err) {
    console.error('[traineeStability] content close failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.patch('/profile', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const data = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'traineeName')) data.traineeName = String(req.body.traineeName || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'email')) data.email = String(req.body.email || '').trim().toLowerCase() || null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'mobile')) data.mobile = String(req.body.mobile || '').replace(/\D/g, '').slice(-10) || null;
    if (Object.keys(data).length === 0) return res.status(400).json({ ok: false, message: 'No profile fields provided.' });
    const existing = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Trainee not found.' });
    await prisma.$transaction([prisma.traineeMaster.update({ where: { employeeId }, data }), prisma.userMaster.updateMany({ where: { employeeId }, data })]);
    return res.json({ ok: true, message: 'Profile updated.' });
  } catch (err) {
    console.error('[traineeStability] profile update failed:', err);
    return res.status(500).json({ ok: false, message: 'Update failed.' });
  }
});

export default router;
