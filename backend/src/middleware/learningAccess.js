import { prisma } from '../utils/db.js';

function isComplete(row) {
  return row?.completionStatus === 'Completed' || Number(row?.completionPct || 0) >= 100;
}

export async function requireContentSequence(req, res, next) {
  try {
    if (process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED === 'true') return next();
    const employeeId = req.userId;
    const { contentId } = req.params;

    const content = await prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } });
    if (!content || !content.active) return res.status(404).json({ ok: false, message: 'Content not found.' });
    if (!content.required) return next();

    const classroomId = content.module.classroomId;
    const contents = await prisma.contentMaster.findMany({
      where: { module: { classroomId }, active: true, required: true },
      include: { module: true },
    });

    contents.sort((a, b) => {
      const dayDiff = (a.module?.dayNo || 0) - (b.module?.dayNo || 0);
      if (dayDiff) return dayDiff;
      const moduleDiff = (a.module?.moduleOrder || 0) - (b.module?.moduleOrder || 0);
      if (moduleDiff) return moduleDiff;
      return (a.contentOrder || 0) - (b.contentOrder || 0);
    });

    const idx = contents.findIndex(c => c.contentId === contentId);
    if (idx <= 0) return next();

    const previous = contents.slice(0, idx);
    const progress = await prisma.contentProgress.findMany({
      where: { employeeId, contentId: { in: previous.map(c => c.contentId) } },
    });
    const progressMap = new Map(progress.map(p => [p.contentId, p]));
    const missing = previous.find(c => !isComplete(progressMap.get(c.contentId)));

    if (missing) {
      return res.status(403).json({
        ok: false,
        locked: true,
        message: `Complete "${missing.contentTitle}" first to unlock this content.`,
        prerequisiteContentId: missing.contentId,
        prerequisiteTitle: missing.contentTitle,
      });
    }

    return next();
  } catch (err) {
    console.error('[learningAccess] content gate failed:', err);
    return res.status(500).json({ ok: false, message: 'Access validation failed.' });
  }
}

export async function requireAssessmentSequence(req, res, next) {
  try {
    if (process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED === 'true') return next();
    const employeeId = req.userId;
    const { assessmentId } = req.params;

    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment || !assessment.active) return res.status(404).json({ ok: false, message: 'Assessment not found.' });

    const where = { active: true, required: true };
    if (assessment.moduleId) {
      where.moduleId = assessment.moduleId;
    } else if (assessment.dayNo) {
      where.module = { classroomId: assessment.classroomId, dayNo: { lte: assessment.dayNo } };
    } else {
      where.module = { classroomId: assessment.classroomId };
    }

    const requiredContents = await prisma.contentMaster.findMany({ where });
    if (!requiredContents.length) return next();

    const progress = await prisma.contentProgress.findMany({
      where: { employeeId, contentId: { in: requiredContents.map(c => c.contentId) } },
    });
    const progressMap = new Map(progress.map(p => [p.contentId, p]));
    const missing = requiredContents.find(c => !isComplete(progressMap.get(c.contentId)));

    if (missing) {
      return res.status(403).json({
        ok: false,
        locked: true,
        message: `Complete "${missing.contentTitle}" before attempting this assessment.`,
        prerequisiteContentId: missing.contentId,
        prerequisiteTitle: missing.contentTitle,
      });
    }

    return next();
  } catch (err) {
    console.error('[learningAccess] assessment gate failed:', err);
    return res.status(500).json({ ok: false, message: 'Access validation failed.' });
  }
}
