import { randomInt, randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { detectAndSyncRisks } from '../utils/riskEngine.js';

const router = Router();
const auth = [requireSession, requireRole('trainee')];
const IST_OFFSET_MS = 330 * 60 * 1000;

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function capSeconds(value, max = 30) {
  return Math.min(parseNonNegativeInt(value, 0), max);
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

function secureShuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Content that lives inside a classroom module. openUrl points at the
// authenticated route so a learner can open it without needing Google access.
function mapClassroomContent(row) {
  const driveFileId = row.drive_file_id || '';
  const localPath = row.local_file_path || '';
  let openUrl = row.direct_media_url || '';
  if (!openUrl && driveFileId) openUrl = '/api/drive/proxy/' + encodeURIComponent(driveFileId) + '?role=trainee';
  if (!openUrl && localPath) {
    const filename = String(localPath).split('/').pop();
    if (filename) openUrl = '/api/content/files/' + encodeURIComponent(filename) + '?role=trainee';
  }
  return {
    contentId: row.content_id,
    repositoryContentId: row.content_id,
    title: row.content_title,
    contentTitle: row.content_title,
    contentType: row.content_type,
    description: row.description,
    required: Boolean(row.required),
    driveFileId,
    driveUrl: row.drive_url,
    directMediaUrl: row.direct_media_url,
    localFilePath: localPath,
    playerMode: row.player_mode,
    openUrl,
  };
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
  const required = [...contents].filter(content => content.active && content.required).sort(contentSort);
  for (let i = 0; i < required.length; i += 1) {
    const content = required[i];
    const previousMissing = required.slice(0, i).find(previous => !isComplete(progressMap[previous.contentId]));
    map.set(content.contentId, previousMissing ? {
      accessLocked: true,
      lockReason: `Complete "${previousMissing.contentTitle}" first to unlock this content.`,
      prerequisiteContentId: previousMissing.contentId,
      prerequisiteTitle: previousMissing.contentTitle,
    } : {
      accessLocked: false,
      lockReason: null,
      prerequisiteContentId: null,
      prerequisiteTitle: null,
    });
  }
  return map;
}

function buildAssessmentLockMeta(assessment, allContent, progressMap) {
  const required = allContent.filter(content => {
    if (!content.active || !content.required) return false;
    if (assessment.moduleId) return content.moduleId === assessment.moduleId;
    if (assessment.dayNo) return content.module?.classroomId === assessment.classroomId && content.module?.dayNo <= assessment.dayNo;
    return content.module?.classroomId === assessment.classroomId;
  }).sort(contentSort);

  const missing = required.find(content => !isComplete(progressMap[content.contentId]));
  if (!missing) return { accessLocked: false, lockReason: null, prerequisiteContentId: null, prerequisiteTitle: null };
  return {
    accessLocked: true,
    lockReason: `Complete "${missing.contentTitle}" before attempting this assessment.`,
    prerequisiteContentId: missing.contentId,
    prerequisiteTitle: missing.contentTitle,
  };
}

async function getTrainee(employeeId) {
  return prisma.traineeMaster.findUnique({ where: { employeeId } });
}

async function hasClassroomAccess(trainee, classroomId) {
  if (!trainee || !classroomId) return false;
  if (trainee.classroomId === classroomId) return true;
  const mapping = await prisma.traineeClassroomMap.findFirst({
    where: { employeeId: trainee.employeeId, classroomId, active: true },
    select: { id: true },
  });
  return Boolean(mapping);
}

async function requireContentAccess(employeeId, contentId) {
  const [trainee, content] = await Promise.all([
    getTrainee(employeeId),
    prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } }),
  ]);
  if (!trainee) return { error: { status: 404, message: 'Trainee not found.' } };
  if (!content || !content.active || !content.module?.active) return { error: { status: 404, message: 'Content not found.' } };
  const classroomId = content.module.classroomId;
  if (!await hasClassroomAccess(trainee, classroomId)) {
    return { error: { status: 403, message: 'This content is not assigned to your classroom.' } };
  }
  return { trainee, content, classroomId };
}

async function requireAssessmentAccess(employeeId, assessmentId) {
  const [trainee, assessment] = await Promise.all([
    getTrainee(employeeId),
    prisma.assessmentMaster.findUnique({ where: { assessmentId } }),
  ]);
  if (!trainee) return { error: { status: 404, message: 'Trainee not found.' } };
  if (!assessment || !assessment.active) return { error: { status: 404, message: 'Assessment not found.' } };
  if (!await hasClassroomAccess(trainee, assessment.classroomId)) {
    return { error: { status: 403, message: 'This assessment is not assigned to your classroom.' } };
  }
  return { trainee, assessment };
}

async function prerequisiteBlocker(employeeId, assessment) {
  const where = { active: true, required: true };
  if (assessment.moduleId) where.moduleId = assessment.moduleId;
  else if (assessment.dayNo) where.module = { classroomId: assessment.classroomId, dayNo: { lte: assessment.dayNo } };
  else where.module = { classroomId: assessment.classroomId };

  const contents = await prisma.contentMaster.findMany({ where, include: { module: true } });
  if (!contents.length) return null;
  const progress = await prisma.contentProgress.findMany({
    where: { employeeId, contentId: { in: contents.map(content => content.contentId) } },
  });
  const progressMap = new Map(progress.map(row => [row.contentId, row]));
  return contents.sort(contentSort).find(content => !isComplete(progressMap.get(content.contentId))) || null;
}

function istDayBounds(now = new Date()) {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const startLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocalMs - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function syncDailyActivity(employeeId, trainee, flags = {}) {
  if (!trainee?.batchNo) return;
  const { start, end } = istDayBounds();
  const [watch, assessments] = await Promise.all([
    prisma.videoWatchLog.aggregate({
      where: { employeeId, createdAt: { gte: start, lt: end } },
      _sum: { secondsDelta: true },
    }),
    prisma.assessmentAttempt.aggregate({
      where: { employeeId, submittedAt: { gte: start, lt: end } },
      _sum: { timeTakenSeconds: true },
    }),
  ]);
  const totalActivitySeconds = Number(watch._sum.secondsDelta || 0) + Number(assessments._sum.timeTakenSeconds || 0);
  const minimumSeconds = Math.max(60, Number.parseInt(process.env.LMS_ATTENDANCE_MIN_ACTIVITY_SECONDS || '900', 10));
  const qualified = totalActivitySeconds >= minimumSeconds;
  const date = start;
  const existing = await prisma.attendanceInference.findUnique({
    where: { date_batchNo_employeeId: { date, batchNo: trainee.batchNo, employeeId } },
  });

  const activityData = {
    courseActivity: Boolean(existing?.courseActivity || flags.courseActivity),
    mcqActivity: Boolean(existing?.mcqActivity || flags.mcqActivity),
    remarks: `LMS verified activity: ${totalActivitySeconds}s; threshold: ${minimumSeconds}s`,
  };
  if (qualified) {
    activityData.finalAttendance = 'Present';
    activityData.attendanceSource = 'LMS Verified Activity';
  }

  await prisma.attendanceInference.upsert({
    where: { date_batchNo_employeeId: { date, batchNo: trainee.batchNo, employeeId } },
    create: {
      date,
      batchNo: trainee.batchNo,
      employeeId,
      traineeName: trainee.traineeName,
      branch: trainee.branch,
      process: trainee.process,
      lob: trainee.lob,
      courseActivity: Boolean(flags.courseActivity),
      mcqActivity: Boolean(flags.mcqActivity),
      finalAttendance: qualified ? 'Present' : 'Pending',
      attendanceSource: qualified ? 'LMS Verified Activity' : 'LMS Activity Pending Threshold',
      remarks: activityData.remarks,
    },
    update: activityData,
  });
}

function acceptedElapsedDelta(progress, requested, max = 30) {
  if (!progress?.lastOpenedAt) return 0;
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(progress.lastOpenedAt).getTime()) / 1000));
  return Math.min(capSeconds(requested, max), elapsed);
}

function requiredSecondsFor(content, durationSeconds = 0) {
  const ratio = Math.min(100, Math.max(1, Number(content.completionRulePct || 80))) / 100;
  if (durationSeconds > 0) return Math.max(1, Math.round(durationSeconds * ratio));
  if (Number(content.estimatedMins || 0) > 0) return Math.max(1, Math.round(Number(content.estimatedMins) * 60 * ratio));
  return Math.max(60, Number.parseInt(process.env.LMS_DOCUMENT_MIN_ACTIVITY_SECONDS || '60', 10));
}

// A batch may carry several classrooms, and each learner is enrolled into all of
// them through trainee_classroom_map. The dashboard covers every one of them,
// with the batch primary classroom first so a single classroom learner sees
// exactly what they always have.
async function resolveLearnerClassrooms(employeeId, trainee, user) {
  const primary = trainee.classroomId || user?.classroomId || null;
  const mapped = await prisma.traineeClassroomMap.findMany({
    where: { employeeId, active: true },
    select: { classroomId: true },
  });
  const ids = [...new Set([primary, ...mapped.map(row => row.classroomId)].filter(Boolean))];
  return { primary, ids };
}

async function getDirectAssignments(trainee, employeeId) {
  return prisma.assignedModule.findMany({
    where: {
      OR: [
        { assignedTo: employeeId, assignedToType: 'individual' },
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
  const moduleIds = [...new Set(assignments.map(assignment => assignment.moduleId).filter(Boolean))];
  if (!moduleIds.length) return assignments;
  try {
    const placeholders = moduleIds.map(() => '?').join(',');
    const moduleRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM independent_module_master WHERE status = 'Active' AND module_id IN (${placeholders})`,
      ...moduleIds,
    );
    const knownIndependent = new Set((moduleRows || []).map(module => module.module_id));
    const byModule = {};

    if (knownIndependent.size) {
      const contentRows = await prisma.$queryRawUnsafe(
        `SELECT m.module_id, m.sort_order, m.required, r.*
         FROM independent_module_content_map m
         INNER JOIN content_repository_master r ON r.repository_content_id = m.repository_content_id
         WHERE m.active = 1 AND r.status = 'Active' AND m.module_id IN (${placeholders})
         ORDER BY m.module_id, m.sort_order ASC`,
        ...moduleIds,
      );
      for (const row of contentRows || []) {
        if (!byModule[row.module_id]) byModule[row.module_id] = [];
        byModule[row.module_id].push(mapRepoContent(row));
      }
    }

    // A directly assigned classroom module keeps its content in content_master,
    // so without this branch the learner sees the assignment but nothing to open.
    const classroomModuleIds = moduleIds.filter(id => !knownIndependent.has(id));
    if (classroomModuleIds.length) {
      const classroomPlaceholders = classroomModuleIds.map(() => '?').join(',');
      const classroomRows = await prisma.$queryRawUnsafe(
        `SELECT content_id, module_id, content_type, content_title, description, required,
                drive_file_id, drive_url, direct_media_url, local_file_path, player_mode
           FROM content_master
          WHERE active = 1 AND module_id IN (${classroomPlaceholders})
          ORDER BY module_id, content_order ASC`,
        ...classroomModuleIds,
      );
      for (const row of classroomRows || []) {
        if (!byModule[row.module_id]) byModule[row.module_id] = [];
        byModule[row.module_id].push(mapClassroomContent(row));
      }
    }
    return assignments.map(assignment => ({
      ...assignment,
      independentModule: knownIndependent.has(assignment.moduleId),
      contents: byModule[assignment.moduleId] || [],
    }));
  } catch {
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
    getTrainee(employeeId),
  ]);

  const openedContents = progressRows.filter(progress => progress.opened).length;
  const completedContents = progressRows.filter(isComplete).length;
  const completionPct = totalContent > 0 ? Math.round((completedContents / totalContent) * 100) : 0;
  const totalSecondsSpent = progressRows.reduce((sum, progress) => sum + Number(progress.totalSecondsSpent || 0), 0);
  const passedAssessments = assessmentResults.filter(result => result.result === 'Pass').length;
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
  await detectAndSyncRisks(employeeId).catch(error => console.error('[traineeStability] risk sync failed:', error.message));
}

router.get('/dashboard', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const [user, trainee] = await Promise.all([
      prisma.userMaster.findUnique({ where: { employeeId } }),
      getTrainee(employeeId),
    ]);
    if (!user || !trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    const directAssignments = await enrichIndependentAssignments(await getDirectAssignments(trainee, employeeId));
    const { primary: classroomId, ids: classroomIds } = await resolveLearnerClassrooms(employeeId, trainee, user);
    const multiClassroom = classroomIds.length > 1;
    if (!classroomIds.length) {
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

    const [classroomRows, modules, allContent, allFaqs, allAssessments, progressRows, allAttemptResults] = await Promise.all([
      prisma.classroomMaster.findMany({ where: { classroomId: { in: classroomIds } } }),
      prisma.moduleMaster.findMany({ where: { classroomId: { in: classroomIds }, active: true }, orderBy: [{ dayNo: 'asc' }, { moduleOrder: 'asc' }] }),
      prisma.contentMaster.findMany({ where: { module: { classroomId: { in: classroomIds } }, active: true }, include: { module: true }, orderBy: { contentOrder: 'asc' } }),
      prisma.faqMaster.findMany({ where: { module: { classroomId: { in: classroomIds } }, active: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.assessmentMaster.findMany({ where: { classroomId: { in: classroomIds }, active: true }, orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }] }),
      prisma.contentProgress.findMany({ where: { employeeId, classroomId: { in: classroomIds } } }),
      prisma.assessmentResult.findMany({ where: { employeeId, classroomId: { in: classroomIds } } }),
    ]);

    const progressMap = Object.fromEntries(progressRows.map(progress => [progress.contentId, progress]));
    const resultMap = Object.fromEntries(allAttemptResults.map(result => [result.assessmentId, result]));
    // Sequential unlock applies within a classroom. Chaining it across classrooms
    // would force a learner to finish one before starting the next.
    const contentLockMap = new Map();
    for (const id of classroomIds) {
      const scoped = allContent.filter(content => content.module?.classroomId === id);
      for (const [key, value] of buildContentLockMap(scoped, progressMap)) contentLockMap.set(key, value);
    }
    const classroomById = new Map(classroomRows.map(room => [room.classroomId, room]));
    const classroomOrder = new Map(classroomIds.map((id, index) => [id, index]));
    const dayMap = {};

    for (const module of modules) {
      const dayKey = multiClassroom ? module.classroomId + '|' + module.dayNo : String(module.dayNo);
      if (!dayMap[dayKey]) {
        dayMap[dayKey] = multiClassroom
          ? {
            dayNo: module.dayNo,
            modules: [],
            classroomId: module.classroomId,
            classroomName: classroomById.get(module.classroomId)?.classroomName || null,
          }
          : { dayNo: module.dayNo, modules: [] };
      }
      const contents = allContent
        .filter(content => content.moduleId === module.moduleId)
        .sort((a, b) => (a.contentOrder || 0) - (b.contentOrder || 0))
        .map(content => {
          const lock = contentLockMap.get(content.contentId) || { accessLocked: false, lockReason: null, prerequisiteContentId: null, prerequisiteTitle: null };
          const { module: _module, ...cleanContent } = content;
          return { ...cleanContent, ...lock, progress: progressMap[content.contentId] || null };
        });
      const faqs = allFaqs.filter(faq => faq.moduleId === module.moduleId);
      const moduleAssessments = allAssessments
        .filter(assessment => assessment.moduleId === module.moduleId)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map(assessment => ({ ...assessment, ...buildAssessmentLockMeta(assessment, allContent, progressMap) }));
      const assessmentResults = moduleAssessments.map(assessment => ({ assessment, result: resultMap[assessment.assessmentId] || null }));
      dayMap[dayKey].modules.push({ ...module, contents, faqs, assessments: moduleAssessments, assessmentResults });
    }

    const days = Object.values(dayMap).sort((a, b) => {
      const roomDiff = (classroomOrder.get(a.classroomId) ?? 0) - (classroomOrder.get(b.classroomId) ?? 0);
      return roomDiff !== 0 ? roomDiff : a.dayNo - b.dayNo;
    });
    const totalContents = allContent.length;
    const openedContents = progressRows.filter(progress => progress.opened).length;
    const completedContents = progressRows.filter(isComplete).length;
    const completionPercent = totalContents > 0 ? Math.round((completedContents / totalContents) * 100) : 0;
    const totalSecondsSpent = progressRows.reduce((sum, progress) => sum + Number(progress.totalSecondsSpent || 0), 0);
    const totalAssessments = allAssessments.length;
    const attemptedAssessments = allAttemptResults.length;
    const passedAssessments = allAttemptResults.filter(result => result.result === 'Pass').length;
    const mcqCompletionPercent = totalAssessments > 0 ? Math.round((attemptedAssessments / totalAssessments) * 100) : 0;
    const bestMcqScore = allAttemptResults.length ? Math.max(...allAttemptResults.map(result => result.bestPercentage || 0)) : null;

    return res.json({
      ok: true,
      dashboard: {
        trainee: { employeeId: trainee.employeeId, name: trainee.traineeName, batchNo: trainee.batchNo, branch: trainee.branch, process: trainee.process, lob: trainee.lob, lastLogin: user.lastLogin },
        classroom: (() => {
          const room = classroomById.get(classroomId) || classroomRows[0] || null;
          const base = { classroomId, classroomName: room?.classroomName, process: room?.process, lob: room?.lob };
          if (!multiClassroom) return base;
          return {
            ...base,
            classrooms: classroomIds.map(id => ({
              classroomId: id,
              classroomName: classroomById.get(id)?.classroomName || null,
            })),
          };
        })(),
        days,
        summary: { totalDays: days.length, totalModules: modules.length, totalContents, openedContents, completedContents, completionPercent, totalSecondsSpent, totalAssessments, attemptedAssessments, passedAssessments, mcqCompletionPercent, bestMcqScore, overallTrainingProgress: completionPercent, riskStatus: trainee.riskStatus || null, courseCompletionPct: trainee.courseCompletionPct || 0, attendancePct: trainee.attendancePct || 0 },
        directAssignments,
      },
    });
  } catch (error) {
    console.error('[traineeStability] dashboard failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/content/:contentId/open', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const access = await requireContentAccess(employeeId, req.params.contentId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { trainee, content, classroomId } = access;

    const allContent = await prisma.contentMaster.findMany({ where: { module: { classroomId }, active: true }, include: { module: true } });
    const priorRequired = allContent.filter(item => item.required).sort(contentSort);
    const index = priorRequired.findIndex(item => item.contentId === content.contentId);
    if (content.required && index > 0 && process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED !== 'true') {
      const previous = priorRequired.slice(0, index);
      const progress = await prisma.contentProgress.findMany({ where: { employeeId, contentId: { in: previous.map(item => item.contentId) } } });
      const progressMap = new Map(progress.map(row => [row.contentId, row]));
      const missing = previous.find(item => !isComplete(progressMap.get(item.contentId)));
      if (missing) return res.status(403).json({ ok: false, locked: true, message: `Complete "${missing.contentTitle}" first to unlock this content.`, prerequisiteContentId: missing.contentId, prerequisiteTitle: missing.contentTitle });
    }

    const existing = await prisma.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId, contentId: content.contentId } } });
    const now = new Date();
    if (existing) {
      await prisma.contentProgress.update({ where: { id: existing.id }, data: { opened: true, openCount: { increment: 1 }, lastOpenedAt: now } });
    } else {
      await prisma.contentProgress.create({
        data: {
          employeeId,
          classroomId,
          dayNo: content.module.dayNo || 0,
          moduleId: content.moduleId,
          contentId: content.contentId,
          opened: true,
          openCount: 1,
          firstOpenedAt: now,
          lastOpenedAt: now,
          requiredSeconds: requiredSecondsFor(content),
          completionStatus: 'In Progress',
          playerMode: content.playerMode || 'Auto',
        },
      });
    }

    await prisma.videoWatchLog.create({ data: { employeeId, batchNo: trainee.batchNo || null, classroomId, dayNo: content.module.dayNo || 0, moduleId: content.moduleId, contentId: content.contentId, event: 'OPEN', playerMode: content.playerMode || 'Auto' } });
    await syncDailyActivity(employeeId, trainee, { courseActivity: true });
    return res.json({ ok: true, locked: false });
  } catch (error) {
    console.error('[traineeStability] content open failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/content/:contentId/heartbeat', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const access = await requireContentAccess(employeeId, req.params.contentId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { trainee, content, classroomId } = access;
    const progress = await prisma.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId, contentId: content.contentId } } });
    if (!progress?.opened) return res.status(409).json({ ok: false, message: 'Open the content before sending progress.' });

    const acceptedDelta = acceptedElapsedDelta(progress, req.body?.secondsDelta, 30);
    const durationSeconds = parseNonNegativeInt(req.body?.durationSeconds, progress.mediaDurationSeconds || 0);
    const positionSeconds = Math.min(parseNonNegativeInt(req.body?.positionSeconds, progress.lastPositionSeconds || 0), durationSeconds || Number.MAX_SAFE_INTEGER);
    const requiredSeconds = progress.requiredSeconds || requiredSecondsFor(content, durationSeconds);
    const totalSecondsSpent = Number(progress.totalSecondsSpent || 0) + acceptedDelta;
    const completionPct = Math.min(100, Math.round((totalSecondsSpent / requiredSeconds) * 100));
    const completed = completionPct >= 100;
    const now = new Date();

    await prisma.contentProgress.update({
      where: { id: progress.id },
      data: {
        totalSecondsSpent,
        lastPositionSeconds: positionSeconds,
        mediaDurationSeconds: durationSeconds,
        requiredSeconds,
        completionPct,
        completionStatus: completed ? 'Completed' : 'In Progress',
        completedAt: completed && !progress.completedAt ? now : progress.completedAt,
        lastOpenedAt: now,
        playerMode: content.playerMode || progress.playerMode || 'Auto',
      },
    });

    if (acceptedDelta > 0) {
      await prisma.videoWatchLog.create({
        data: { employeeId, batchNo: trainee.batchNo || null, classroomId, dayNo: content.module.dayNo || 0, moduleId: content.moduleId, contentId: content.contentId, event: 'HEARTBEAT', secondsDelta: acceptedDelta, positionSeconds, durationSeconds, completionPct, playerMode: content.playerMode || 'Auto' },
      });
    }
    if (completed && !isComplete(progress)) await syncCourseAndTraineeStats(employeeId, classroomId);
    await syncDailyActivity(employeeId, trainee, { courseActivity: true });
    return res.json({ ok: true, acceptedSeconds: acceptedDelta, completionPct, completed });
  } catch (error) {
    console.error('[traineeStability] heartbeat failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/content/:contentId/close', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const access = await requireContentAccess(employeeId, req.params.contentId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { trainee, content, classroomId } = access;
    const progress = await prisma.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId, contentId: content.contentId } } });
    if (!progress?.opened) return res.status(409).json({ ok: false, message: 'No active content session found.' });

    const acceptedDelta = acceptedElapsedDelta(progress, req.body?.secondsDelta, 120);
    const durationSeconds = parseNonNegativeInt(req.body?.durationSeconds, progress.mediaDurationSeconds || 0);
    const positionSeconds = Math.min(parseNonNegativeInt(req.body?.positionSeconds, progress.lastPositionSeconds || 0), durationSeconds || Number.MAX_SAFE_INTEGER);
    const requiredSeconds = progress.requiredSeconds || requiredSecondsFor(content, durationSeconds);
    const totalSecondsSpent = Number(progress.totalSecondsSpent || 0) + acceptedDelta;
    const timedCompletionPct = Math.min(100, Math.round((totalSecondsSpent / requiredSeconds) * 100));
    const nonVideo = !['video', 'scorm'].includes(String(content.contentType || '').toLowerCase());
    const acknowledged = req.body?.completed === true || req.body?.completionStatus === 'Completed';
    const completed = timedCompletionPct >= 100 && (!nonVideo || acknowledged);
    const completionPct = completed ? 100 : timedCompletionPct;
    const now = new Date();

    await prisma.contentProgress.update({
      where: { id: progress.id },
      data: {
        totalSecondsSpent,
        lastPositionSeconds: positionSeconds,
        mediaDurationSeconds: durationSeconds,
        requiredSeconds,
        completionPct,
        completionStatus: completed ? 'Completed' : 'In Progress',
        completedAt: completed && !progress.completedAt ? now : progress.completedAt,
        lastOpenedAt: now,
        playerMode: content.playerMode || progress.playerMode || 'Auto',
      },
    });
    await prisma.videoWatchLog.create({
      data: { employeeId, batchNo: trainee.batchNo || null, classroomId, dayNo: content.module.dayNo || 0, moduleId: content.moduleId, contentId: content.contentId, event: completed ? 'COMPLETE' : 'CLOSE', secondsDelta: acceptedDelta, positionSeconds, durationSeconds, completionPct, playerMode: content.playerMode || 'Auto', details: completed ? 'Server-validated completion' : null },
    });
    await syncCourseAndTraineeStats(employeeId, classroomId);
    await syncDailyActivity(employeeId, trainee, { courseActivity: true });
    return res.json({ ok: true, acceptedSeconds: acceptedDelta, completionPct, completed });
  } catch (error) {
    console.error('[traineeStability] content close failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

async function getOrCreateAttempt(employeeId, assessment, totalQuestions) {
  let pending = await prisma.assessmentAttempt.findFirst({
    where: { employeeId, assessmentId: assessment.assessmentId, submittedAt: null },
    orderBy: { startedAt: 'desc' },
  });

  const limitSeconds = Math.max(60, Number(assessment.timeLimitMins || 30) * 60);
  if (pending && Date.now() > new Date(pending.startedAt).getTime() + (limitSeconds + 30) * 1000) {
    await prisma.assessmentAttempt.update({
      where: { id: pending.id },
      data: { submittedAt: new Date(), timeTakenSeconds: limitSeconds, totalQuestions, result: 'Expired' },
    });
    pending = null;
  }
  if (pending) return pending;

  const attemptsUsed = await prisma.assessmentAttempt.count({ where: { employeeId, assessmentId: assessment.assessmentId } });
  const attemptLimit = Math.max(1, Number(assessment.attemptLimit || 3));
  if (attemptsUsed >= attemptLimit) return null;

  return prisma.assessmentAttempt.create({
    data: {
      attemptId: `ATT-${randomUUID()}`,
      employeeId,
      assessmentId: assessment.assessmentId,
      attemptNo: attemptsUsed + 1,
      startedAt: new Date(),
      totalQuestions,
      result: 'In Progress',
    },
  });
}

router.get('/assessment/:assessmentId', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const access = await requireAssessmentAccess(employeeId, req.params.assessmentId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { assessment } = access;
    const missing = await prerequisiteBlocker(employeeId, assessment);
    if (missing && process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED !== 'true') {
      return res.status(403).json({ ok: false, locked: true, message: `Complete "${missing.contentTitle}" before attempting this assessment.`, prerequisiteContentId: missing.contentId, prerequisiteTitle: missing.contentTitle });
    }

    const questions = await prisma.questionBank.findMany({
      where: { assessmentId: assessment.assessmentId, active: true },
      select: { questionId: true, questionText: true, optionA: true, optionB: true, optionC: true, optionD: true, marks: true, difficulty: true },
    });
    if (!questions.length) return res.status(409).json({ ok: false, message: 'This assessment has no active questions.' });

    const attempt = await getOrCreateAttempt(employeeId, assessment, questions.length);
    if (!attempt) return res.status(409).json({ ok: false, message: `Maximum attempts (${assessment.attemptLimit || 3}) reached.` });
    const bestResult = await prisma.assessmentResult.findUnique({ where: { employeeId_assessmentId: { employeeId, assessmentId: assessment.assessmentId } } });

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
          attemptId: attempt.attemptId,
          attemptNo: attempt.attemptNo,
          startedAt: attempt.startedAt,
        },
        questions: secureShuffle(questions),
        bestResult,
      },
    });
  } catch (error) {
    console.error('[traineeStability] assessment load failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/assessment/:assessmentId/submit', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const access = await requireAssessmentAccess(employeeId, req.params.assessmentId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { trainee, assessment } = access;
    const missing = await prerequisiteBlocker(employeeId, assessment);
    if (missing && process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED !== 'true') {
      return res.status(403).json({ ok: false, locked: true, message: `Complete "${missing.contentTitle}" before submitting this assessment.` });
    }

    const attemptId = String(req.body?.attemptId || '').trim();
    const attempt = attemptId
      ? await prisma.assessmentAttempt.findFirst({ where: { attemptId, employeeId, assessmentId: assessment.assessmentId, submittedAt: null } })
      : await prisma.assessmentAttempt.findFirst({ where: { employeeId, assessmentId: assessment.assessmentId, submittedAt: null }, orderBy: { startedAt: 'desc' } });
    if (!attempt) return res.status(409).json({ ok: false, message: 'No active assessment attempt found. Reopen the assessment.' });

    const timeLimitSeconds = Math.max(60, Number(assessment.timeLimitMins || 30) * 60);
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000));
    if (elapsedSeconds > timeLimitSeconds + 30) {
      await prisma.assessmentAttempt.update({ where: { id: attempt.id }, data: { submittedAt: new Date(), timeTakenSeconds: timeLimitSeconds, result: 'Expired' } });
      return res.status(409).json({ ok: false, message: 'Assessment time limit exceeded. This attempt has expired.' });
    }

    const answers = req.body?.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers) ? req.body.answers : {};
    const questions = await prisma.questionBank.findMany({ where: { assessmentId: assessment.assessmentId, active: true } });
    let totalMarks = 0;
    let scored = 0;
    let correct = 0;
    let wrong = 0;
    let blank = 0;
    for (const question of questions) {
      const answer = String(answers[question.questionId] || '').toUpperCase();
      totalMarks += Number(question.marks || 0);
      if (!['A', 'B', 'C', 'D'].includes(answer)) {
        blank += 1;
      } else if (answer === String(question.correctOption || '').toUpperCase()) {
        scored += Number(question.marks || 0);
        correct += 1;
      } else {
        scored -= Number(question.negativeMarks || 0);
        wrong += 1;
      }
    }

    const percentage = totalMarks > 0 ? Math.max(0, Math.round((scored / totalMarks) * 100)) : 0;
    const result = percentage >= Number(assessment.passingPct || 60) ? 'Pass' : 'Fail';
    const submittedAt = new Date();

    const transactionResult = await prisma.$transaction(async tx => {
      const claimed = await tx.assessmentAttempt.updateMany({
        where: { id: attempt.id, submittedAt: null },
        data: {
          submittedAt,
          timeTakenSeconds: Math.min(elapsedSeconds, timeLimitSeconds),
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
      if (claimed.count === 0) return null;

      const existing = await tx.assessmentResult.findUnique({ where: { employeeId_assessmentId: { employeeId, assessmentId: assessment.assessmentId } } });
      const isBest = !existing || percentage > Number(existing.bestPercentage || 0);
      await tx.assessmentResult.upsert({
        where: { employeeId_assessmentId: { employeeId, assessmentId: assessment.assessmentId } },
        create: { employeeId, batchNo: trainee.batchNo || null, classroomId: assessment.classroomId, assessmentId: assessment.assessmentId, bestScore: scored, bestPercentage: percentage, result, totalAttempts: 1, lastAttemptAt: submittedAt },
        update: { totalAttempts: { increment: 1 }, lastAttemptAt: submittedAt, ...(isBest ? { bestScore: scored, bestPercentage: percentage, result } : {}) },
      });
      return true;
    });
    if (!transactionResult) return res.status(409).json({ ok: false, message: 'This attempt was already submitted.' });

    await syncCourseAndTraineeStats(employeeId, assessment.classroomId);
    await syncDailyActivity(employeeId, trainee, { mcqActivity: true });
    const attemptsUsed = await prisma.assessmentAttempt.count({ where: { employeeId, assessmentId: assessment.assessmentId } });
    const attemptsLeft = Math.max(0, Number(assessment.attemptLimit || 3) - attemptsUsed);
    const revealAnswers = result === 'Pass' || attemptsLeft === 0;
    const review = questions.map(question => ({
      questionId: question.questionId,
      questionText: question.questionText,
      correctOption: revealAnswers ? question.correctOption : null,
      yourAnswer: answers[question.questionId] || null,
      explanation: revealAnswers ? question.explanation : null,
    }));

    return res.json({
      ok: true,
      data: { result, percentage, scored, totalMarks, correct, wrong, blank, attemptNo: attempt.attemptNo, passingPct: assessment.passingPct, attemptsLeft, review },
    });
  } catch (error) {
    console.error('[traineeStability] assessment submission failed:', error);
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
    if (!Object.keys(data).length) return res.status(400).json({ ok: false, message: 'No profile fields provided.' });
    const existing = await getTrainee(employeeId);
    if (!existing) return res.status(404).json({ ok: false, message: 'Trainee not found.' });
    await prisma.$transaction([
      prisma.traineeMaster.update({ where: { employeeId }, data }),
      prisma.userMaster.updateMany({ where: { employeeId }, data }),
    ]);
    return res.json({ ok: true, message: 'Profile updated.' });
  } catch (error) {
    console.error('[traineeStability] profile update failed:', error);
    return res.status(500).json({ ok: false, message: 'Update failed.' });
  }
});

export default router;
