import { randomInt, randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { detectAndSyncRisks } from '../utils/riskEngine.js';
import { attachAssessmentsToAssignments } from '../controllers/trainee.js';
import { issueCertificate, renderCertificateHtml, ensureCertificateTable } from '../services/certificates.js';
import { awardContentCompletion, awardAttendanceStreak } from '../utils/leaderboardEngine.js';
import { audit } from '../utils/audit.js';

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

// Time-based completion alone lets a learner later claim they never actually read
// something. Sequential unlock and assessment submission both route through this
// function, so requiring an explicit acknowledgement here closes that gap
// everywhere at once. Pre-existing completions are grandfathered by a one-time
// backfill in contentProgressSchema.js, so this does not retroactively lock
// anyone who genuinely finished content before the requirement existed.
function isComplete(row) {
  const timeComplete = row?.completionStatus === 'Completed' || Number(row?.completionPct || 0) >= 100;
  return timeComplete && Boolean(row?.acknowledgedAt);
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

// A stored /uploads/content/<file> path is NOT served in production - nginx's
// try_files hands it to the SPA, which renders a blank page in the new tab. Any
// local upload has to go through the authenticated content route instead. The
// ?role hint is read by utils/session.js because a link opened in a new tab
// cannot send the X-LMS-Role header.
function uploadFilename(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || '');
    if (!value || /^https?:\/\//i.test(value)) continue;
    // multer records a POSIX path in production but a Windows one locally.
    const normalised = value.split(String.fromCharCode(92)).join('/');
    if (!normalised.includes('uploads/content/')) continue;
    const name = normalised.split('/').pop();
    if (name) return name;
  }
  return '';
}

function buildOpenUrl({ directMediaUrl, driveFileId, localFilePath }) {
  const name = uploadFilename(directMediaUrl, localFilePath);
  if (name) return '/api/content/files/' + encodeURIComponent(name) + '?role=trainee';
  if (directMediaUrl) return directMediaUrl;
  if (driveFileId) return '/api/drive/proxy/' + encodeURIComponent(driveFileId) + '?role=trainee';
  return '';
}

// Content that lives inside a classroom module. openUrl points at the
// authenticated route so a learner can open it without needing Google access.
function mapClassroomContent(row) {
  const driveFileId = row.drive_file_id || '';
  const localPath = row.local_file_path || '';
  const openUrl = buildOpenUrl({ directMediaUrl: row.direct_media_url, driveFileId, localFilePath: localPath });
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
    // The tracked viewer and the heartbeat endpoints key on contentId, so broadcast
    // content carries its repository id there too and needs no special casing.
    contentId: row.repository_content_id,
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
    // Was missing entirely, so AssignedTab fell back to directMediaUrl and opened
    // /uploads/content/<file> - a path nginx answers with the SPA shell.
    openUrl: buildOpenUrl({
      directMediaUrl: row.direct_media_url,
      driveFileId: row.drive_file_id,
      localFilePath: row.local_file_path,
    }),
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

// Broadcast content lives in content_repository_master and reaches a learner through
// an independent module, so it has no content_master row and used to fall straight
// through to "Content not found" — which is why opening a nugget recorded nothing and
// an admin had no way to see whether the reading time was spent. Resolving it here
// puts it on exactly the same open/heartbeat/close pipeline as classroom content.
async function resolveRepositoryContentAccess(trainee, employeeId, repositoryContentId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.*, m.module_id, m.module_name, m.estimated_mins AS module_estimated_mins
       FROM content_repository_master r
       INNER JOIN independent_module_content_map c
               ON c.repository_content_id = r.repository_content_id AND c.active = 1
       INNER JOIN independent_module_master m
               ON m.module_id = c.module_id AND m.status = 'Active'
      WHERE r.repository_content_id = ? AND r.status = 'Active'
      ORDER BY m.updated_at DESC
      LIMIT 1`,
    repositoryContentId,
  );
  const row = rows?.[0];
  if (!row) return { error: { status: 404, message: 'Content not found.' } };

  // Same scopes the dashboard uses to decide the learner may see the module at all.
  const assignment = await prisma.assignedModule.findFirst({
    where: {
      active: true,
      moduleId: row.module_id,
      OR: [
        { assignedTo: employeeId, assignedToType: 'individual' },
        { assignedTo: trainee.batchNo || '__none__', assignedToType: 'batch' },
        { assignedTo: trainee.process || '__none__', assignedToType: 'process' },
        { assignedTo: trainee.branch || '__none__', assignedToType: 'branch' },
        { assignedToType: 'company' },
      ],
    },
    select: { id: true },
  });
  if (!assignment) return { error: { status: 403, message: 'This content is not assigned to you.' } };

  // The reading time an admin set sits on the module; the repository item's own
  // estimate is the fallback.
  const estimatedMins = Number(row.module_estimated_mins || 0) || Number(row.estimated_mins || 0);
  const content = {
    contentId: repositoryContentId,
    contentTitle: row.title,
    contentType: row.content_type,
    required: false,
    completionRulePct: row.completion_rule_pct,
    estimatedMins,
    playerMode: row.player_mode || 'Auto',
    moduleId: row.module_id,
    module: { dayNo: 0, classroomId: '', active: true },
  };
  return { trainee, content, classroomId: '', isRepository: true };
}

async function requireContentAccess(employeeId, contentId) {
  const [trainee, content] = await Promise.all([
    getTrainee(employeeId),
    prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } }),
  ]);
  if (!trainee) return { error: { status: 404, message: 'Trainee not found.' } };
  if (!content) return resolveRepositoryContentAccess(trainee, employeeId, contentId);
  if (!content.active || !content.module?.active) return { error: { status: 404, message: 'Content not found.' } };
  const classroomId = content.module.classroomId;
  if (!await hasClassroomAccess(trainee, classroomId)) {
    return { error: { status: 403, message: 'This content is not assigned to your classroom.' } };
  }
  return { trainee, content, classroomId, isRepository: false };
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

  // Leaderboard: award any attendance-streak milestone reached today. Fire-and-forget so
  // a leaderboard failure never breaks attendance tracking. Only meaningful once the day
  // actually qualifies as Present.
  if (qualified) {
    awardAttendanceStreak(employeeId, trainee.batchNo).catch(err => console.error('[Leaderboard] attendance streak award failed:', err.message));
  }
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

// NOTE: this router is mounted BEFORE routes/trainee.js at the same /api/trainee prefix
// (see server.js), so its handlers shadow trainee.js's — trainee.js's own
// getLearnerDashboard/logContentHeartbeat/logContentClose never actually run in production.
// Anything added to the trainee dashboard/content pipeline (PKT attachment, leaderboard
// hooks, etc.) must be wired in HERE, not just in trainee.js, or it silently does nothing.
async function enrichIndependentAssignments(assignments, employeeId) {
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
      // "A Specific Day" direct-broadcast mode (ensureIndependentWrapperForDay in
      // services/independentModules.js) stores real content_master ids in this table's
      // repository_content_id column using a "CM:<contentId>" marker — content_master rows
      // are joined separately below instead of via content_repository_master.
      const mapRows = await prisma.$queryRawUnsafe(
        `SELECT module_id, sort_order, required, repository_content_id
         FROM independent_module_content_map
         WHERE active = 1 AND module_id IN (${placeholders})`,
        ...moduleIds,
      );
      const mapByKey = {};
      const repoIds = [];
      const classroomContentIds = [];
      for (const row of mapRows || []) {
        mapByKey[row.repository_content_id] = row;
        const rid = String(row.repository_content_id);
        if (rid.startsWith('CM:')) classroomContentIds.push(rid.slice(3));
        else repoIds.push(rid);
      }

      if (repoIds.length) {
        const repoPlaceholders = repoIds.map(() => '?').join(',');
        const repoRows = await prisma.$queryRawUnsafe(
          `SELECT * FROM content_repository_master WHERE status = 'Active' AND repository_content_id IN (${repoPlaceholders})`,
          ...repoIds,
        );
        for (const row of repoRows || []) {
          const map = mapByKey[row.repository_content_id];
          if (!map) continue;
          if (!byModule[map.module_id]) byModule[map.module_id] = [];
          byModule[map.module_id].push({ ...mapRepoContent({ ...row, sort_order: map.sort_order, required: map.required }), _sortOrder: map.sort_order });
        }
      }

      if (classroomContentIds.length) {
        const cmPlaceholders = classroomContentIds.map(() => '?').join(',');
        const cmRows = await prisma.$queryRawUnsafe(
          `SELECT content_id, module_id, content_type, content_title, description, required,
                  drive_file_id, drive_url, direct_media_url, local_file_path, player_mode
             FROM content_master
            WHERE active = 1 AND content_id IN (${cmPlaceholders})`,
          ...classroomContentIds,
        );
        for (const row of cmRows || []) {
          const map = mapByKey['CM:' + row.content_id];
          if (!map) continue;
          if (!byModule[map.module_id]) byModule[map.module_id] = [];
          byModule[map.module_id].push({ ...mapClassroomContent(row), _sortOrder: map.sort_order });
        }
      }

      for (const key of Object.keys(byModule)) {
        byModule[key].sort((a, b) => (a._sortOrder ?? 0) - (b._sortOrder ?? 0));
        byModule[key] = byModule[key].map(({ _sortOrder, ...rest }) => rest);
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
    // The reading time an admin sets lives on the module, not on the repository
    // item, so it has to travel with the assignment or the learner never sees it.
    const moduleMeta = new Map((moduleRows || []).map(row => [row.module_id, row]));
    // Time spent is recorded against the repository content id, so the learner sees
    // their own progress on a nugget and an admin has something to report on.
    const allContentIds = Object.values(byModule).flat().map(item => item.contentId).filter(Boolean);
    const progressRows = allContentIds.length && employeeId
      ? await prisma.contentProgress.findMany({ where: { employeeId, contentId: { in: [...new Set(allContentIds)] } } })
      : [];
    const progressByContent = new Map(progressRows.map(row => [row.contentId, {
      completionStatus: row.completionStatus,
      completionPct: row.completionPct,
      totalSecondsSpent: row.totalSecondsSpent,
      requiredSeconds: row.requiredSeconds,
      acknowledgedAt: row.acknowledgedAt,
    }]));
    for (const list of Object.values(byModule)) {
      for (const item of list) item.progress = progressByContent.get(item.contentId) || null;
    }
    const withContent = assignments.map(assignment => {
      const meta = moduleMeta.get(assignment.moduleId);
      return {
        ...assignment,
        independentModule: knownIndependent.has(assignment.moduleId),
        estimatedMins: Number(meta?.estimated_mins || 0),
        category: meta?.category || null,
        contents: byModule[assignment.moduleId] || [],
      };
    });
    return employeeId ? attachAssessmentsToAssignments(withContent, employeeId) : withContent;
  } catch (err) {
    console.error('[traineeStability] enrichIndependentAssignments failed:', err.message);
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
  // Per-classroom assessment values — kept for context but NOT written to traineeMaster
  // because writing them on each single-classroom sync would overwrite the cross-classroom
  // aggregate (see globalAttemptPct / globalPassPct below).
  const passedAssessments = assessmentResults.filter(result => result.result === 'Pass').length;
  const assessmentAttemptPct = totalAssessments > 0 ? Math.round((assessmentResults.length / totalAssessments) * 100) : 0; // eslint-disable-line no-unused-vars
  const assessmentPassPct = totalAssessments > 0 ? Math.round((passedAssessments / totalAssessments) * 100) : 0; // eslint-disable-line no-unused-vars

  // Aggregate assessment pct across ALL classrooms the trainee is enrolled in so that
  // syncing one classroom does not overwrite the trainee-level aggregate with a
  // single-classroom value (e.g. 0/2 in classroom B would erase 3/3 from classroom A).
  const mappedClassroomIds = (await prisma.traineeClassroomMap.findMany({
    where: { employeeId, active: true },
    select: { classroomId: true },
  })).map(m => m.classroomId);
  const primaryClassroomId = trainee?.classroomId || classroomId;
  const allClassroomIds = [...new Set([primaryClassroomId, ...mappedClassroomIds].filter(Boolean))];
  // Fall back to the triggering classroom if the trainee has no map entries at all.
  const aggregateClassroomIds = allClassroomIds.length ? allClassroomIds : [classroomId];

  const [totalAssessmentsAll, assessmentResultsAll] = await Promise.all([
    prisma.assessmentMaster.count({ where: { classroomId: { in: aggregateClassroomIds }, active: true } }),
    prisma.assessmentResult.findMany({ where: { employeeId, classroomId: { in: aggregateClassroomIds } } }),
  ]);
  const passedAll = assessmentResultsAll.filter(r => r.result === 'Pass').length;
  const globalAttemptPct = totalAssessmentsAll > 0 ? Math.round((assessmentResultsAll.length / totalAssessmentsAll) * 100) : 0;
  const globalPassPct = totalAssessmentsAll > 0 ? Math.round((passedAll / totalAssessmentsAll) * 100) : 0;

  await prisma.$transaction([
    prisma.courseCompletionReport.upsert({
      where: { employeeId_classroomId: { employeeId, classroomId } },
      create: { employeeId, batchNo: trainee?.batchNo || null, classroomId, totalContents: totalContent, openedContents, completionPct, totalSecondsSpent, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
      update: { totalContents: totalContent, openedContents, completionPct, totalSecondsSpent, status: completionPct >= 100 ? 'Completed' : 'In Progress' },
    }),
    prisma.traineeMaster.update({ where: { employeeId }, data: { courseCompletionPct: completionPct, assessmentAttemptPct: globalAttemptPct, assessmentPassPct: globalPassPct } }),
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

    const directAssignments = await enrichIndependentAssignments(await getDirectAssignments(trainee, employeeId), employeeId);
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
    const { trainee, content, classroomId, isRepository } = access;

    // Sequential unlock is a property of a classroom day. Broadcast content has no
    // classroom, so this lookup would scan every module with a blank classroomId.
    const allContent = isRepository
      ? []
      : await prisma.contentMaster.findMany({ where: { module: { classroomId }, active: true }, include: { module: true } });
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
    if (completed && !isComplete(progress)) {
      await syncCourseAndTraineeStats(employeeId, classroomId);
      // Leaderboard: award points for a fresh content completion. Fire-and-forget so a
      // leaderboard failure never breaks content playback.
      awardContentCompletion(employeeId, content.contentId).catch(err => console.error('[Leaderboard] content completion award failed:', err.message));
    }
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
    if (completed && !isComplete(progress)) {
      // Leaderboard: award points for a fresh content completion.
      awardContentCompletion(employeeId, content.contentId).catch(err => console.error('[Leaderboard] content completion award failed:', err.message));
    }
    await syncCourseAndTraineeStats(employeeId, classroomId);
    await syncDailyActivity(employeeId, trainee, { courseActivity: true });
    return res.json({ ok: true, acceptedSeconds: acceptedDelta, completionPct, completed });
  } catch (error) {
    console.error('[traineeStability] content close failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// A time-based completion percentage can be reached by leaving a tab open; it does
// not prove the learner actually read the content. Acknowledging is a distinct,
// explicit action captured with the time, IP and user agent of the click, plus a
// server-built (not client-supplied) attestation sentence, so it stands on its own
// as a record the learner cannot later claim never happened. isComplete() above
// requires this on top of time-completion, so it also gates sequential unlock and
// assessment submission.
router.post('/content/:contentId/acknowledge', ...auth, async (req, res) => {
  try {
    const employeeId = req.userId;
    const access = await requireContentAccess(employeeId, req.params.contentId);
    if (access.error) return res.status(access.error.status).json({ ok: false, message: access.error.message });
    const { content } = access;

    const progress = await prisma.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId, contentId: content.contentId } } });
    if (!progress?.opened) return res.status(409).json({ ok: false, message: 'Open the content before acknowledging it.' });

    const timeComplete = progress.completionStatus === 'Completed' || Number(progress.completionPct || 0) >= 100;
    if (!timeComplete) {
      return res.status(409).json({ ok: false, message: 'Finish the content before you can acknowledge it.' });
    }

    if (progress.acknowledgedAt) {
      // Idempotent: the first acknowledgement is the one on record, a repeat click
      // is not an error and does not overwrite the original timestamp or IP.
      return res.json({
        ok: true,
        alreadyAcknowledged: true,
        acknowledgedAt: progress.acknowledgedAt,
        acknowledgementText: progress.acknowledgementText,
      });
    }

    const acknowledgementText = `I acknowledge that I have read and understood "${content.contentTitle}".`;
    const acknowledgedAt = new Date();
    const acknowledgedIp = String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
    const acknowledgedUserAgent = String(req.headers['user-agent'] || '').slice(0, 500);

    await prisma.contentProgress.update({
      where: { id: progress.id },
      data: { acknowledgedAt, acknowledgedIp, acknowledgedUserAgent, acknowledgementText },
    });

    await audit({
      userIdentity: employeeId,
      userRole: 'Trainee',
      action: 'ACKNOWLEDGE_CONTENT',
      module: 'Learning',
      referenceId: content.contentId,
      newValue: { contentTitle: content.contentTitle, acknowledgedAt, acknowledgedIp },
      source: 'Trainee Portal',
    });

    return res.json({ ok: true, alreadyAcknowledged: false, acknowledgedAt, acknowledgementText });
  } catch (error) {
    console.error('[traineeStability] content acknowledge failed:', error);
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

  return prisma.$transaction(async (tx) => {
    const [attemptsUsed, grantsAgg] = await Promise.all([
      tx.assessmentAttempt.count({ where: { employeeId, assessmentId: assessment.assessmentId, result: { not: 'Expired' } } }),
      tx.assessmentAttemptGrant.aggregate({ where: { employeeId, assessmentId: assessment.assessmentId, active: true }, _sum: { extraAttempts: true } }),
    ]);
    const attemptLimit = Math.max(1, Number(assessment.attemptLimit || 3)) + (grantsAgg._sum.extraAttempts || 0);
    if (attemptsUsed >= attemptLimit) return null;

    return tx.assessmentAttempt.create({
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
    if (!attempt) return res.status(409).json({ ok: false, message: 'Maximum attempts reached.' });
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
    const [attemptsUsed, grantsAggPost] = await Promise.all([
      prisma.assessmentAttempt.count({ where: { employeeId, assessmentId: assessment.assessmentId } }),
      prisma.assessmentAttemptGrant.aggregate({ where: { employeeId, assessmentId: assessment.assessmentId, active: true }, _sum: { extraAttempts: true } }),
    ]);
    const effectiveLimitPost = Math.max(1, Number(assessment.attemptLimit || 3)) + (grantsAggPost._sum.extraAttempts || 0);
    const attemptsLeft = Math.max(0, effectiveLimitPost - attemptsUsed);
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


// A learner could not reach their own certificate at all — only an admin or
// coordinator could open one. Entitlement is derived rather than stored as a flag:
// the training certificate exists once they are certified, and an assessment
// certificate once they have passed that assessment.
async function entitledCertificates(employeeId) {
  await ensureCertificateTable();
  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
  if (!trainee) return [];
  const issued = [];

  if (['Certified', 'HandedOver'].includes(trainee.certificationStatus)) {
    const batch = trainee.batchNo ? await prisma.batchMaster.findUnique({ where: { batchNo: trainee.batchNo } }) : null;
    issued.push(await issueCertificate({
      employeeId,
      certificateType: 'TRAINING',
      referenceId: trainee.batchNo || null,
      title: batch?.batchName || [trainee.process, trainee.lob].filter(Boolean).join(' / ') || 'Training Programme',
      traineeName: trainee.traineeName,
      batchNo: trainee.batchNo,
      process: trainee.process,
      lob: trainee.lob,
      issuedBy: 'system',
    }));
  }

  const passed = await prisma.assessmentResult.findMany({
    where: { employeeId, result: 'Pass' },
    select: { assessmentId: true, bestPercentage: true },
  });
  if (passed.length) {
    const assessments = await prisma.assessmentMaster.findMany({
      where: { assessmentId: { in: passed.map(row => row.assessmentId) } },
      select: { assessmentId: true, assessmentName: true },
    });
    const nameById = new Map(assessments.map(row => [row.assessmentId, row.assessmentName]));
    for (const row of passed) {
      issued.push(await issueCertificate({
        employeeId,
        certificateType: 'ASSESSMENT',
        referenceId: row.assessmentId,
        title: nameById.get(row.assessmentId) || 'Assessment',
        traineeName: trainee.traineeName,
        batchNo: trainee.batchNo,
        process: trainee.process,
        lob: trainee.lob,
        scorePct: row.bestPercentage ?? null,
        issuedBy: 'system',
      }));
    }
  }
  return issued.filter(Boolean);
}

router.get('/certificates', ...auth, async (req, res) => {
  try {
    const certs = await entitledCertificates(req.userId);
    return res.json({
      ok: true,
      data: certs.map(cert => ({
        certificateNo: cert.certificate_no,
        verificationCode: cert.verification_code,
        type: cert.certificate_type,
        title: cert.title,
        batchNo: cert.batch_no,
        scorePct: cert.score_pct,
        issuedAt: cert.issued_at,
        revoked: Boolean(cert.revoked_at),
      })),
    });
  } catch (error) {
    console.error('[traineeStability] certificate list failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to load your certificates.' });
  }
});

router.get('/certificates/:certificateNo', ...auth, async (req, res) => {
  try {
    await ensureCertificateTable();
    // Scoped to the signed-in learner, so a certificate number cannot be used to
    // pull somebody else's certificate.
    const rows = await prisma.$queryRawUnsafe(
      'SELECT * FROM certificate_issue WHERE certificate_no = ? AND employee_id = ? LIMIT 1',
      String(req.params.certificateNo || '').trim(), req.userId,
    );
    const cert = rows?.[0];
    if (!cert) return res.status(404).json({ ok: false, message: 'Certificate not found.' });
    if (cert.revoked_at) return res.status(410).json({ ok: false, message: 'This certificate has been revoked.' });
    res.setHeader('Content-Type', 'text/html');
    return res.send(renderCertificateHtml(cert));
  } catch (error) {
    console.error('[traineeStability] certificate render failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to open the certificate.' });
  }
});
export default router;
