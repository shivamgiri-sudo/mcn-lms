import { prisma } from '../utils/db.js';
import { hashPassword, generateSalt, generateId, hashCredential } from '../utils/hash.js';
import { audit } from '../utils/audit.js';
import { createSession, deleteAllSessions } from '../utils/session.js';
import { notifyPasswordReset, notifyModuleAssigned, notifyAssessmentAssigned } from '../utils/notify.js';
import { listDriveFolderAny } from '../services/drive.js';
import { generateTempEmpId, mapEmployeeId } from '../utils/empIdMapping.js';
import path from 'path';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const cleanText = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
};
const parseOptionalInt = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseOptionalFloat = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseOptionalBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
};
const parseOptionalDate = (value) => {
  if (value === undefined) return undefined;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const drivePreviewUrl = (driveFileId) => driveFileId ? `https://drive.google.com/file/d/${driveFileId}/preview` : null;

async function syncBatchClassroomAssignment({ batch, classroomId, classroomName, assignedBy, db = prisma }) {
  const batchNo = batch.batchNo;

  await db.traineeMaster.updateMany({
    where: { batchNo },
    data: { classroomId, classroomName },
  });
  await db.userMaster.updateMany({
    where: { batchNo },
    data: { classroomId },
  });

  if (!classroomId) {
    await Promise.all([
      db.traineeClassroomMap.updateMany({ where: { batchNo }, data: { active: false } }),
      db.batchClassroomMap.updateMany({ where: { batchNo }, data: { active: false } }),
    ]);
    return;
  }

  const trainees = await db.traineeMaster.findMany({
    where: { batchNo },
    select: { employeeId: true },
  });

  await Promise.all(trainees.map(t => db.traineeClassroomMap.upsert({
    where: { employeeId_classroomId: { employeeId: t.employeeId, classroomId } },
    create: { employeeId: t.employeeId, classroomId, batchNo, assignedBy },
    update: { active: true, batchNo, assignedBy },
  })));

  const existingMap = await db.batchClassroomMap.findFirst({ where: { batchNo } });
  const mapData = {
    batchName: batch.batchName,
    branch: batch.branch,
    process: batch.process,
    lob: batch.lob,
    classroomId,
    classroomName,
    active: true,
    assignedBy,
  };

  if (existingMap) {
    await db.batchClassroomMap.update({ where: { id: existingMap.id }, data: mapData });
  } else {
    await db.batchClassroomMap.create({ data: { batchNo, ...mapData } });
  }
}

export async function getAdminDashboard(req, res) {
  try {
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};

    // Build query log filter scoped to this admin's branch (queryLog has batchNo but no branch col)
    const queryLogWhere = { status: 'Open' };
    if (req.userBranch) {
      const branchBatches = await prisma.batchMaster.findMany({
        where: { branch: req.userBranch },
        select: { batchNo: true },
      });
      queryLogWhere.batchNo = { in: branchBatches.map(b => b.batchNo) };
    }

    const [classrooms, trainees, batches, openQueries, atRisk] = await Promise.all([
      prisma.classroomMaster.count({ where: { active: true, ...branchFilter } }),
      prisma.traineeMaster.count({ where: { status: 'Active', ...branchFilter } }),
      prisma.batchMaster.count({ where: { batchStatus: 'Active', ...branchFilter } }),
      prisma.traineeQueryLog.count({ where: queryLogWhere }),
      prisma.traineeMaster.count({ where: { status: 'Active', riskStatus: { in: ['CRITICAL', 'HIGH'] }, ...branchFilter } }),
    ]);

    const activeBatches = await prisma.batchMaster.findMany({
      where: { batchStatus: 'Active', ...branchFilter },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { batchNo: true, batchName: true, coordinatorName: true, startDate: true, endDate: true, totalTrainees: true, certified: true, process: true, lob: true },
    });

    const coordinators = await prisma.batchMaster.findMany({
      where: { batchStatus: 'Active', coordinatorLoginId: { not: null }, ...branchFilter },
      select: { coordinatorLoginId: true, coordinatorName: true, batchNo: true, batchName: true },
      distinct: ['coordinatorLoginId'],
      take: 10,
    });

    const atRiskTrainees = await prisma.traineeMaster.findMany({
      where: { status: 'Active', riskStatus: { in: ['CRITICAL', 'HIGH', 'MEDIUM'] }, ...branchFilter },
      orderBy: [{ riskStatus: 'asc' }, { courseCompletionPct: 'asc' }],
      take: 20,
      select: { employeeId: true, traineeName: true, batchNo: true, riskStatus: true, courseCompletionPct: true, attendancePct: true, assessmentPassPct: true },
    });

    const riskCounts = await prisma.traineeMaster.groupBy({
      by: ['riskStatus'],
      where: { status: 'Active', ...branchFilter },
      _count: { riskStatus: true },
    });

    const riskMap = {};
    riskCounts.forEach(r => { riskMap[r.riskStatus] = r._count.riskStatus; });

    res.json({
      ok: true,
      data: {
        classrooms, trainees, batches, openQueries,
        openQueriesCount: openQueries,
        atRiskCount: atRisk,
        coordinatorAlerts: openQueries,
        activeBatches,
        coordinators,
        atRiskTrainees,
        riskSnapshot: {
          CRITICAL: riskMap['CRITICAL'] || 0,
          HIGH: riskMap['HIGH'] || 0,
          MEDIUM: riskMap['MEDIUM'] || 0,
          HEALTHY: riskMap['HEALTHY'] || 0,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Classrooms ────────────────────────────────────────────────────────────────
export async function listClassrooms(req, res) {
  try {
    const { branch } = req.query;
    const where = { active: true };
    if (branch) where.branch = branch;
    else if (req.userBranch) where.branch = req.userBranch;
    const classrooms = await prisma.classroomMaster.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { modules: true } } },
    });
    res.json({ ok: true, data: classrooms });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createClassroom(req, res) {
  try {
    const { classroomName, process, lob, branch, description, driveFolderId, driveFolderUrl } = req.body;
    if (!classroomName) return res.status(400).json({ ok: false, message: 'Classroom name required.' });

    const classroomId = `CL-${generateId()}`;
    const cl = await prisma.classroomMaster.create({
      data: { classroomId, classroomName, process, lob, branch: branch || null, description, driveFolderId, driveFolderUrl },
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_CLASSROOM', module: 'Curriculum', referenceId: classroomId });
    res.json({ ok: true, data: cl });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateClassroom(req, res) {
  try {
    const { classroomId } = req.params;
    const { classroomName, process, lob, branch, active, description, driveFolderId, driveFolderUrl } = req.body;
    const data = {};
    if (classroomName !== undefined) data.classroomName = classroomName;
    if (process !== undefined) data.process = process;
    if (lob !== undefined) data.lob = lob;
    if (branch !== undefined) data.branch = branch;
    if (active !== undefined) data.active = active;
    if (description !== undefined) data.description = description;
    if (driveFolderId !== undefined) data.driveFolderId = driveFolderId;
    if (driveFolderUrl !== undefined) data.driveFolderUrl = driveFolderUrl;
    const cl = await prisma.classroomMaster.update({ where: { classroomId }, data });
    res.json({ ok: true, data: cl });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteClassroom(req, res) {
  try {
    const { classroomId } = req.params;
    const { confirmName } = req.body;

    const cl = await prisma.classroomMaster.findUnique({ where: { classroomId } });
    if (!cl) return res.status(404).json({ ok: false, message: 'Classroom not found.' });
    if (confirmName !== cl.classroomName) {
      return res.status(400).json({ ok: false, message: 'Classroom name does not match. Deletion cancelled.' });
    }

    const modules = await prisma.moduleMaster.findMany({ where: { classroomId }, select: { moduleId: true } });
    const moduleIds = modules.map(m => m.moduleId);
    const assessments = await prisma.assessmentMaster.findMany({ where: { classroomId }, select: { assessmentId: true } });
    const assessmentIds = assessments.map(a => a.assessmentId);

    await prisma.$transaction(async tx => {
      await tx.contentProgress.deleteMany({ where: { classroomId } });
      await tx.videoWatchLog.deleteMany({ where: { classroomId } });
      await tx.courseCompletionReport.deleteMany({ where: { classroomId } });
      await tx.assessmentResult.deleteMany({ where: { classroomId } });
      if (assessmentIds.length) {
        await tx.assessmentAttempt.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
        await tx.questionBank.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
      }
      await tx.assessmentMaster.deleteMany({ where: { classroomId } });
      if (moduleIds.length) {
        await tx.faqMaster.deleteMany({ where: { moduleId: { in: moduleIds } } });
        await tx.contentMaster.deleteMany({ where: { moduleId: { in: moduleIds } } });
      }
      await tx.moduleMaster.deleteMany({ where: { classroomId } });
      await tx.traineeClassroomMap.deleteMany({ where: { classroomId } });
      await tx.classroomMaster.delete({ where: { classroomId } });
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DELETE_CLASSROOM', module: 'Curriculum', referenceId: classroomId, details: cl.classroomName });
    res.json({ ok: true, message: `Classroom "${cl.classroomName}" deleted permanently.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error: ' + err.message });
  }
}

// ── Modules ───────────────────────────────────────────────────────────────────
export async function listModules(req, res) {
  try {
    const { classroomId } = req.params;
    const modules = await prisma.moduleMaster.findMany({
      where: { classroomId, active: true },
      orderBy: [{ dayNo: 'asc' }, { moduleOrder: 'asc' }],
      include: { _count: { select: { contents: true, faqs: true } } },
    });
    res.json({ ok: true, data: modules });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createModule(req, res) {
  try {
    const { classroomId } = req.params;
    const { dayNo, moduleTitle, moduleOrder, required, description } = req.body;
    const title = cleanText(moduleTitle);
    const parsedDayNo = parseOptionalInt(dayNo, 0);

    if (!parsedDayNo || !title) return res.status(400).json({ ok: false, message: 'Day number and module title required.' });

    const classroom = await prisma.classroomMaster.findUnique({ where: { classroomId } });
    if (!classroom || !classroom.active) return res.status(404).json({ ok: false, message: 'Classroom not found.' });

    const moduleId = `MOD-${generateId()}`;
    const mod = await prisma.moduleMaster.create({
      data: {
        moduleId,
        classroomId,
        dayNo: parsedDayNo,
        moduleTitle: title,
        moduleOrder: parseOptionalInt(moduleOrder, 0),
        required: parseOptionalBoolean(required, true),
        description: cleanText(description),
      },
    });
    res.json({ ok: true, data: mod });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function updateModule(req, res) {
  try {
    const { moduleId } = req.params;
    const data = {};
    if (hasOwn(req.body, 'dayNo')) data.dayNo = parseOptionalInt(req.body.dayNo, 0);
    if (hasOwn(req.body, 'moduleTitle')) data.moduleTitle = cleanText(req.body.moduleTitle);
    if (hasOwn(req.body, 'moduleOrder')) data.moduleOrder = parseOptionalInt(req.body.moduleOrder, 0);
    if (hasOwn(req.body, 'required')) data.required = parseOptionalBoolean(req.body.required, true);
    if (hasOwn(req.body, 'active')) data.active = parseOptionalBoolean(req.body.active, true);
    if (hasOwn(req.body, 'description')) data.description = cleanText(req.body.description);

    if (data.dayNo !== undefined && !data.dayNo) return res.status(400).json({ ok: false, message: 'Valid day number required.' });
    if (data.moduleTitle !== undefined && !data.moduleTitle) return res.status(400).json({ ok: false, message: 'Module title cannot be empty.' });
    if (Object.keys(data).length === 0) return res.status(400).json({ ok: false, message: 'No valid fields to update.' });

    const mod = await prisma.moduleMaster.update({ where: { moduleId }, data });
    res.json({ ok: true, data: mod });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function deleteModule(req, res) {
  try {
    const { moduleId } = req.params;
    await prisma.moduleMaster.update({ where: { moduleId }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Content ───────────────────────────────────────────────────────────────────
export async function listContents(req, res) {
  try {
    const { moduleId } = req.params;
    const contents = await prisma.contentMaster.findMany({
      where: { moduleId, active: true },
      orderBy: { contentOrder: 'asc' },
    });
    res.json({ ok: true, data: contents });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createContent(req, res) {
  try {
    const { moduleId } = req.params;
    const { contentType, contentTitle, driveFileId, driveUrl, directMediaUrl, playerMode, contentOrder, required, estimatedMins, completionRulePct, description } = req.body;

    const module = await prisma.moduleMaster.findUnique({ where: { moduleId } });
    if (!module || !module.active) return res.status(404).json({ ok: false, message: 'Module not found.' });

    let localFilePath = null;
    if (req.file) {
      localFilePath = `/uploads/content/${req.file.filename}`;
    }

    // Auto-assign next order if not provided
    let order = parseInt(contentOrder || 0, 10);
    if (!order) {
      const last = await prisma.contentMaster.findFirst({
        where: { moduleId },
        orderBy: { contentOrder: 'desc' },
        select: { contentOrder: true },
      });
      order = (last?.contentOrder || 0) + 1;
    }

    const cleanDriveFileId = cleanText(driveFileId);
    const cleanDriveUrl = cleanText(driveUrl) || drivePreviewUrl(cleanDriveFileId);
    const apiBase = process.env.API_URL || `${req.protocol}://${req.get('host')}`;

    const contentId = `CON-${generateId()}`;
    const content = await prisma.contentMaster.create({
      data: {
        contentId,
        moduleId,
        contentType: contentType || 'video',
        contentTitle: cleanText(contentTitle) || req.file?.originalname || 'Untitled',
        driveFileId: cleanDriveFileId,
        driveUrl: cleanDriveUrl,
        directMediaUrl: cleanText(directMediaUrl) || (localFilePath ? `${apiBase}${localFilePath}` : null),
        localFilePath,
        playerMode: playerMode || 'Auto',
        contentOrder: order,
        required: parseOptionalBoolean(required, true),
        estimatedMins: parseOptionalInt(estimatedMins, 0),
        completionRulePct: parseOptionalFloat(completionRulePct, 80),
        description: cleanText(description),
      },
    });
    res.json({ ok: true, data: content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateContent(req, res) {
  try {
    const { contentId } = req.params;
    const data = {};
    if (hasOwn(req.body, 'contentType')) data.contentType = cleanText(req.body.contentType) || 'video';
    if (hasOwn(req.body, 'contentTitle')) data.contentTitle = cleanText(req.body.contentTitle);
    if (hasOwn(req.body, 'driveFileId')) data.driveFileId = cleanText(req.body.driveFileId);
    if (hasOwn(req.body, 'driveUrl')) data.driveUrl = cleanText(req.body.driveUrl);
    if (hasOwn(req.body, 'directMediaUrl')) data.directMediaUrl = cleanText(req.body.directMediaUrl);
    if (hasOwn(req.body, 'playerMode')) data.playerMode = cleanText(req.body.playerMode) || 'Auto';
    if (hasOwn(req.body, 'contentOrder')) data.contentOrder = parseOptionalInt(req.body.contentOrder, 0);
    if (hasOwn(req.body, 'required')) data.required = parseOptionalBoolean(req.body.required, true);
    if (hasOwn(req.body, 'active')) data.active = parseOptionalBoolean(req.body.active, true);
    if (hasOwn(req.body, 'locked')) data.locked = parseOptionalBoolean(req.body.locked, false);
    if (hasOwn(req.body, 'estimatedMins')) data.estimatedMins = parseOptionalInt(req.body.estimatedMins, 0);
    if (hasOwn(req.body, 'completionRulePct')) data.completionRulePct = parseOptionalFloat(req.body.completionRulePct, 80);
    if (hasOwn(req.body, 'description')) data.description = cleanText(req.body.description);
    if (data.driveFileId && !data.driveUrl && !hasOwn(req.body, 'driveUrl')) data.driveUrl = drivePreviewUrl(data.driveFileId);

    if (data.contentTitle !== undefined && !data.contentTitle) return res.status(400).json({ ok: false, message: 'Content title cannot be empty.' });
    if (Object.keys(data).length === 0) return res.status(400).json({ ok: false, message: 'No valid fields to update.' });

    const content = await prisma.contentMaster.update({ where: { contentId }, data });
    res.json({ ok: true, data: content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function deleteContent(req, res) {
  try {
    const { contentId } = req.params;
    await prisma.contentMaster.update({ where: { contentId }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── FAQs ──────────────────────────────────────────────────────────────────────
export async function listFaqs(req, res) {
  try {
    const { moduleId } = req.params;
    const faqs = await prisma.faqMaster.findMany({ where: { moduleId, active: true }, orderBy: { sortOrder: 'asc' } });
    res.json({ ok: true, data: faqs });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createFaq(req, res) {
  try {
    const { moduleId } = req.params;
    const { question, answer, sortOrder } = req.body;
    if (!question || !answer) return res.status(400).json({ ok: false, message: 'Question and answer required.' });

    const faqId = `FAQ-${generateId()}`;
    const faq = await prisma.faqMaster.create({ data: { faqId, moduleId, question, answer, sortOrder: parseInt(sortOrder || 0) } });
    res.json({ ok: true, data: faq });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function bulkUploadFaqs(req, res) {
  try {
    const { moduleId } = req.params;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, message: 'No files uploaded.' });

    // Build base URL from the incoming request so it works on any host (Render, localhost, etc.)
    const API_URL = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    const created = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const title = f.originalname.replace(/\.[^/.]+$/, '');
      const fileUrl = `${API_URL}/uploads/content/${f.filename}`;
      const ext = f.originalname.split('.').pop().toUpperCase();
      const faqId = `FAQ-${generateId()}`;
      const faq = await prisma.faqMaster.create({
        data: {
          faqId, moduleId,
          question: title,
          answer: `[${ext} Document] ${fileUrl}`,
          sortOrder: i + 1,
        },
      });
      created.push(faq);
    }
    res.json({ ok: true, data: created, message: `${created.length} FAQ document(s) uploaded.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateFaq(req, res) {
  try {
    const { faqId } = req.params;
    const { question, answer, active, sortOrder } = req.body;
    const data = {};
    if (question !== undefined) data.question = question;
    if (answer !== undefined) data.answer = answer;
    if (active !== undefined) data.active = active;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    const faq = await prisma.faqMaster.update({ where: { faqId }, data });
    res.json({ ok: true, data: faq });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteFaq(req, res) {
  try {
    const { faqId } = req.params;
    await prisma.faqMaster.update({ where: { faqId }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Assessments ───────────────────────────────────────────────────────────────
function parseAssessmentOrder(name) {
  const m = name.match(/^(\d+(?:\.\d+)*)[_\s\-\.]/);
  if (!m) return 9999;
  const parts = m[1].split('.').map(Number);
  return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

export async function listAssessments(req, res) {
  try {
    const { classroomId } = req.query;
    const where = classroomId ? { classroomId } : {};
    const assessments = await prisma.assessmentMaster.findMany({
      where,
      orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { questions: true } } },
    });
    res.json({ ok: true, data: assessments });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createAssessment(req, res) {
  try {
    const { classroomId, dayNo, moduleId, assessmentName, passingPct, attemptLimit, timeLimitMins, instructions } = req.body;
    if (!classroomId || !assessmentName) return res.status(400).json({ ok: false, message: 'Classroom and name required.' });

    // Extract sort order from numeric prefix in name (e.g. "1_MCQ" → 10000, "2. Quiz" → 20000)
    const sortOrder = parseAssessmentOrder(assessmentName);

    const assessmentId = `ASS-${generateId()}`;
    const a = await prisma.assessmentMaster.create({
      data: {
        assessmentId, classroomId,
        dayNo: dayNo ? parseInt(dayNo) : null,
        moduleId: moduleId || null,
        sortOrder,
        assessmentName,
        passingPct: parseFloat(passingPct || 60),
        attemptLimit: parseInt(attemptLimit || 3),
        timeLimitMins: parseInt(timeLimitMins || 30),
        instructions,
      },
    });

    res.json({ ok: true, data: a });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateAssessment(req, res) {
  try {
    const { assessmentId } = req.params;
    const { moduleId, assessmentName, passingPct, attemptLimit, timeLimitMins, active, instructions, dayNo } = req.body;
    const data = {};
    if (assessmentName !== undefined) {
      data.assessmentName = assessmentName;
      data.sortOrder = parseAssessmentOrder(assessmentName);
    }
    if (moduleId !== undefined) data.moduleId = moduleId || null;
    if (passingPct !== undefined) data.passingPct = passingPct;
    if (attemptLimit !== undefined) data.attemptLimit = attemptLimit;
    if (timeLimitMins !== undefined) data.timeLimitMins = timeLimitMins;
    if (active !== undefined) data.active = active;
    if (instructions !== undefined) data.instructions = instructions;
    if (dayNo !== undefined) data.dayNo = dayNo;
    const a = await prisma.assessmentMaster.update({ where: { assessmentId }, data });
    res.json({ ok: true, data: a });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteAssessment(req, res) {
  try {
    const { assessmentId } = req.params;
    const { confirm } = req.body;
    if (confirm !== 'DELETE') {
      return res.status(400).json({ ok: false, message: 'Confirmation required.' });
    }

    const a = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!a) return res.status(404).json({ ok: false, message: 'Assessment not found.' });

    await prisma.$transaction([
      prisma.assessmentAttempt.deleteMany({ where: { assessmentId } }),
      prisma.assessmentResult.deleteMany({ where: { assessmentId } }),
      prisma.questionBank.deleteMany({ where: { assessmentId } }),
      prisma.assessmentMaster.delete({ where: { assessmentId } }),
    ]);

    res.json({ ok: true, message: `Assessment "${a.assessmentName}" deleted.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error: ' + err.message });
  }
}

// ── Attempt Grants ────────────────────────────────────────────────────────────
export async function listAttemptGrantsForAssessment(req, res) {
  try {
    const { assessmentId } = req.params;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT g.grant_id AS grantId, g.employee_id AS employeeId,
              t.trainee_name AS traineeName, g.extra_attempts AS extraAttempts,
              g.reason, g.granted_by AS grantedBy, g.granted_by_name AS grantedByName,
              g.active, g.revoked_by AS revokedBy, g.revoked_at AS revokedAt,
              g.revoke_reason AS revokeReason, g.created_at AS createdAt
         FROM assessment_attempt_grants g
         LEFT JOIN trainee_master t ON t.employee_id = g.employee_id
        WHERE g.assessment_id = ?
        ORDER BY g.created_at DESC`,
      assessmentId,
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function listAttemptGrantsForTrainee(req, res) {
  try {
    const { employeeId } = req.params;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT g.grant_id AS grantId, g.assessment_id AS assessmentId,
              a.assessment_name AS assessmentName, c.classroom_name AS classroomName,
              g.extra_attempts AS extraAttempts, g.reason,
              g.granted_by AS grantedBy, g.granted_by_name AS grantedByName,
              g.active, g.revoked_by AS revokedBy, g.revoked_at AS revokedAt,
              g.revoke_reason AS revokeReason, g.created_at AS createdAt
         FROM assessment_attempt_grants g
         INNER JOIN assessment_master a ON a.assessment_id = g.assessment_id
         INNER JOIN classroom_master c ON c.classroom_id = a.classroom_id
        WHERE g.employee_id = ?
        ORDER BY g.created_at DESC`,
      employeeId,
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createAttemptGrant(req, res) {
  try {
    const { assessmentId } = req.params;
    const { employeeId, extraAttempts, reason } = req.body;
    if (!employeeId) return res.status(400).json({ ok: false, message: 'employeeId is required.' });
    const extra = parseInt(extraAttempts, 10);
    if (!extra || extra < 1 || extra > 10) return res.status(400).json({ ok: false, message: 'extraAttempts must be 1–10.' });

    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    const grantId = `GRN-${generateId()}`;
    await prisma.assessmentAttemptGrant.create({
      data: {
        grantId,
        assessmentId,
        employeeId,
        extraAttempts: extra,
        reason: reason || null,
        grantedBy: req.userId,
        grantedByName: req.adminInfo?.adminName || req.userId,
      },
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'GRANT_EXTRA_ATTEMPTS', module: 'Assessment', referenceId: grantId, details: `${employeeId} +${extra} on ${assessmentId}` });
    res.status(201).json({ ok: true, data: { grantId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function revokeAttemptGrant(req, res) {
  try {
    const { grantId } = req.params;
    const { revokeReason } = req.body;

    const grant = await prisma.assessmentAttemptGrant.findUnique({ where: { grantId } });
    if (!grant) return res.status(404).json({ ok: false, message: 'Grant not found.' });
    if (!grant.active) return res.status(409).json({ ok: false, message: 'Grant is already revoked.' });

    await prisma.assessmentAttemptGrant.update({
      where: { grantId },
      data: { active: false, revokedBy: req.userId, revokedAt: new Date(), revokeReason: revokeReason || null },
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'REVOKE_ATTEMPT_GRANT', module: 'Assessment', referenceId: grantId, details: grant.employeeId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Questions ─────────────────────────────────────────────────────────────────
export async function listQuestions(req, res) {
  try {
    const { assessmentId } = req.params;
    const questions = await prisma.questionBank.findMany({
      where: { assessmentId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ ok: true, data: questions });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function uploadQuestions(req, res) {
  try {
    const { assessmentId } = req.params;
    const { questions } = req.body; // array: [{questionText, optionA, optionB, optionC, optionD, correctOption, marks, difficulty, explanation}]
    if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ ok: false, message: 'No questions provided.' });

    const rows = questions.map((q, i) => ({
      questionId: `QST-${assessmentId}-${i + 1}-${Date.now()}`,
      assessmentId,
      questionText: q.questionText || q.question || '',
      optionA: q.optionA || q.option_a || '',
      optionB: q.optionB || q.option_b || '',
      optionC: q.optionC || q.option_c || null,
      optionD: q.optionD || q.option_d || null,
      correctOption: (q.correctOption || q.correct_option || 'A').toUpperCase(),
      marks: parseFloat(q.marks || 1),
      negativeMarks: parseFloat(q.negativeMarks || q.negative_marks || 0),
      difficulty: q.difficulty || 'Medium',
      explanation: q.explanation || null,
    }));

    await prisma.questionBank.createMany({ data: rows, skipDuplicates: true });
    res.json({ ok: true, message: `${rows.length} questions uploaded.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateQuestion(req, res) {
  try {
    const { questionId } = req.params;
    const q = await prisma.questionBank.update({ where: { questionId }, data: req.body });
    res.json({ ok: true, data: q });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteQuestion(req, res) {
  try {
    const { questionId } = req.params;
    await prisma.questionBank.update({ where: { questionId }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Trainee Accounts ──────────────────────────────────────────────────────────
export async function searchTrainees(req, res) {
  try {
    const { q, designation } = req.query;
    const where = {
      status: { not: 'Deleted' },
      ...(req.userBranch ? { branch: req.userBranch } : {}),
      ...(designation ? { designation: { contains: designation } } : {}),
      ...(q ? {
        OR: [
          { employeeId: { contains: q } },
          { traineeName: { contains: q } },
          { email: { contains: q } },
          { batchNo: { contains: q } },
        ],
      } : {}),
    };
    const take = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const trainees = await prisma.traineeMaster.findMany({
      where, take, orderBy: { createdAt: 'desc' },
      include: { userAccount: { select: { locked: true, failedAttempts: true, active: true, forcePasswordReset: true } } },
    });
    const data = trainees.map(t => ({ ...t, locked: t.userAccount?.locked ?? false, hasAccount: !!t.userAccount }));
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function resetTraineePassword(req, res) {
  try {
    const { employeeId } = req.params;
    const { newPassword } = req.body;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });
    const userAccount = await prisma.userMaster.findUnique({ where: { employeeId } });
    if (!userAccount) return res.status(404).json({ ok: false, message: 'Trainee has no login account.' });
    const tempPass = newPassword || (trainee.mobile ? trainee.mobile.slice(-4) : '1234');

    const salt = generateSalt();
    const passwordHash = await hashPassword(tempPass, salt);
    await prisma.userMaster.update({
      where: { employeeId },
      data: { passwordHash, salt, forcePasswordReset: true, failedAttempts: 0, locked: false },
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_PASSWORD', module: 'Accounts', referenceId: employeeId });

    // Notify trainee — fire and forget
    notifyPasswordReset({
      traineeName: trainee.traineeName,
      mobile: trainee.mobile,
      email: trainee.email,
      tempPassword: tempPass,
    }).catch(err => console.error(`[NOTIFY] Password reset notification failed for ${employeeId}:`, err.message));

    res.json({ ok: true, message: `Password reset for ${employeeId}. Trainee notified with new credentials.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function unlockTrainee(req, res) {
  try {
    const { employeeId } = req.params;
    const account = await prisma.userMaster.findUnique({ where: { employeeId } });
    if (!account) return res.status(404).json({ ok: false, message: 'No login account found for this trainee.' });
    await prisma.userMaster.update({ where: { employeeId }, data: { locked: false, failedAttempts: 0 } });
    res.json({ ok: true, message: `${employeeId} unlocked.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteTraineeAccount(req, res) {
  try {
    const { employeeId } = req.params;
    await prisma.userMaster.update({ where: { employeeId }, data: { active: false } });
    await prisma.traineeMaster.update({ where: { employeeId }, data: { status: 'Deleted' } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DELETE_TRAINEE', module: 'Accounts', referenceId: employeeId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Certification Rules ────────────────────────────────────────────────────────
export async function listCertificationRules(req, res) {
  try {
    const rules = await prisma.certificationRuleMaster.findMany({ orderBy: [{ process: 'asc' }, { lob: 'asc' }] });
    res.json({ ok: true, data: rules });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function saveCertificationRule(req, res) {
  try {
    const { process, lob, ...rest } = req.body;
    if (!process || !lob) return res.status(400).json({ ok: false, message: 'Process and LOB required.' });
    const existing = await prisma.certificationRuleMaster.findFirst({ where: { process, lob } });
    let rule;
    if (existing) {
      rule = await prisma.certificationRuleMaster.update({ where: { id: existing.id }, data: rest });
    } else {
      rule = await prisma.certificationRuleMaster.create({ data: { ruleId: `RULE-${generateId()}`, process, lob, ...rest } });
    }
    res.json({ ok: true, data: rule });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateCertificationRule(req, res) {
  try {
    const { id } = req.params;
    const { process, lob, courseCompletionMin, mcqPassPctMin, attendancePctMin, mockCallRequired, mockCallPassPct, internalCertRequired, internalCertPassPct, externalCertRequired, externalCertPassPct, active } = req.body;
    const rule = await prisma.certificationRuleMaster.update({
      where: { id },
      data: { process, lob, courseCompletionMin: courseCompletionMin != null ? parseFloat(courseCompletionMin) : undefined, mcqPassPctMin: mcqPassPctMin != null ? parseFloat(mcqPassPctMin) : undefined, attendancePctMin: attendancePctMin != null ? parseFloat(attendancePctMin) : undefined, mockCallRequired, mockCallPassPct: mockCallPassPct != null ? parseFloat(mockCallPassPct) : undefined, internalCertRequired, internalCertPassPct: internalCertPassPct != null ? parseFloat(internalCertPassPct) : undefined, externalCertRequired, externalCertPassPct: externalCertPassPct != null ? parseFloat(externalCertPassPct) : undefined, active },
    });
    res.json({ ok: true, data: rule });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteCertificationRule(req, res) {
  try {
    const { id } = req.params;
    await prisma.certificationRuleMaster.delete({ where: { id } });
    res.json({ ok: true, message: 'Rule deleted.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Drive Sync ────────────────────────────────────────────────────────────────
function extractFolderId(raw) {
  if (!raw) return raw;
  const m = raw.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : raw.trim();
}

// Parse numeric prefix from filename: "1_foo", "1.1_foo", "2.3.1_foo" → float for sorting
function parseFileOrder(name) {
  const m = name.match(/^(\d+(?:\.\d+)*)[_\s-]/);
  if (!m) return Infinity;
  // Convert "1.2.3" → 1.0203 so 1.1 < 1.2 < 2
  const parts = m[1].split('.').map(Number);
  return parts[0] + (parts[1] || 0) / 100 + (parts[2] || 0) / 10000;
}

function sortFilesByPrefix(files) {
  return [...files].sort((a, b) => parseFileOrder(a.name) - parseFileOrder(b.name));
}

// Strip numeric prefix from display title: "1.2_Welcome Video" → "Welcome Video"
function cleanTitle(name) {
  return name
    .replace(/^[\d.]+[_\s-]+/, '')   // strip leading "1_", "1.2_", "1.2 - " etc
    .replace(/\.[^/.]+$/, '')         // strip extension
    .trim();
}

export async function syncClassroomFromDrive(req, res) {
  try {
    const { classroomId } = req.params;
    const rawFolderId = req.body.folderId;

    const classroom = await prisma.classroomMaster.findUnique({ where: { classroomId } });
    if (!classroom) return res.status(404).json({ ok: false, message: 'Classroom not found.' });

    const driveFolderId = extractFolderId(rawFolderId) || classroom.driveFolderId;
    if (!driveFolderId) return res.status(400).json({ ok: false, message: 'No Drive folder ID provided.' });

    const { files: rawFiles, method } = await listDriveFolderAny(driveFolderId);

    // Sort files by numeric prefix before saving
    const files = sortFilesByPrefix(rawFiles);

    // Update classroom with folder id
    await prisma.classroomMaster.update({ where: { classroomId }, data: { driveFolderId } });

    // Sync Drive files into DriveFile table with sortOrder from filename prefix
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const sortOrder = i + 1;
      await prisma.driveFile.upsert({
        where: { driveFileId: f.id },
        create: {
          driveFileId: f.id,
          driveFolderId,
          fileName: f.name,
          mimeType: f.mimeType,
          driveUrl: f.driveUrl || `https://drive.google.com/file/d/${f.id}/preview`,
          thumbnailUrl: f.thumbnailLink || null,
          size: f.size ? BigInt(f.size) : null,
          syncedAt: new Date(),
          sortOrder,
        },
        update: {
          driveFolderId,
          fileName: f.name,
          mimeType: f.mimeType,
          driveUrl: f.driveUrl || `https://drive.google.com/file/d/${f.id}/preview`,
          thumbnailUrl: f.thumbnailLink || null,
          size: f.size ? BigInt(f.size) : null,
          syncedAt: new Date(),
          sortOrder,
        },
      });
    }

    // Return files with sortOrder and cleaned title attached
    const enriched = files.map((f, i) => ({
      ...f,
      sortOrder: i + 1,
      displayTitle: cleanTitle(f.name),
    }));

    res.json({ ok: true, data: { synced: files.length, files: enriched, method } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Drive sync failed.' });
  }
}

// ── Assign Module ─────────────────────────────────────────────────────────────
export async function assignModule(req, res) {
  try {
    const { moduleId, moduleName, broadcastTitle, assignedTo, assignedToType, assignmentType, message, dueDate } = req.body;
    const assignment = await prisma.assignedModule.create({
      data: {
        moduleId,
        moduleName,
        broadcastTitle: broadcastTitle?.trim() || null,
        assignedTo,
        assignedToType,
        assignmentType,
        message,
        dueDate: dueDate ? new Date(dueDate) : null,
        assignedBy: req.userId,
      },
    });
    res.json({ ok: true, data: assignment });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Broadcast a module to a group: process, branch, company, or multiple batches
export async function broadcastModule(req, res) {
  try {
    const { moduleId, moduleName, broadcastTitle, scope, scopeValue, assignmentType, message, dueDate, contentIds, assessmentId } = req.body;
    if (!moduleId || !moduleName || !scope) {
      return res.status(400).json({ ok: false, message: 'moduleId, moduleName and scope are required.' });
    }
    if (req.userBranch && scope === 'branch' && scopeValue !== req.userBranch) {
      return res.status(403).json({ ok: false, message: 'You can only broadcast to your own branch.' });
    }
    if (req.userBranch && scope === 'company') {
      return res.status(403).json({ ok: false, message: 'Branch admin cannot broadcast to entire company.' });
    }
    const data = {
      moduleId,
      moduleName,
      broadcastTitle: broadcastTitle?.trim() || null,
      assignedTo: scopeValue || scope,
      assignedToType: scope,
      assignmentType: assignmentType || 'Mandatory',
      message: message || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedBy: req.userId,
      assessmentId: assessmentId || null,
    };
    // Store optional content filter as JSON in the message field prefix if provided
    if (Array.isArray(contentIds) && contentIds.length > 0) {
      data.message = `[contentIds:${contentIds.join(',')}]${message ? ' ' + message : ''}`;
    }
    const assignment = await prisma.assignedModule.create({ data });

    // Notify recipients that a PKT/test was attached — fire-and-forget, gated by
    // notificationConfig. Only fires when an assessment is actually attached; a plain
    // (no-MCQ) broadcast on this single-scope endpoint sends no email either way, matching
    // this endpoint's existing (pre-existing, unchanged) behavior.
    if (assessmentId) {
      notifyAssessmentAssignedForScope({ scope, scopeValue: data.assignedTo, moduleName, assessmentId, dueDate, userBranch: req.userBranch })
        .catch(err => console.error('[NOTIFY] broadcastModule PKT notification failed:', err.message));
    }

    res.json({ ok: true, data: assignment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Bulk assignment — supports two modes:
//   1. employeeIds[]  — direct list of specific employee IDs
//   2. scopeType + scopeValues[]  — expand multiple batches/processes/branches to individuals
export async function broadcastModuleBulk(req, res) {
  try {
    const { moduleId, moduleName, broadcastTitle, employeeIds, scopeType, scopeValues, assignmentType, message, dueDate, assessmentId } = req.body;
    if (!moduleId || !moduleName) {
      return res.status(400).json({ ok: false, message: 'moduleId and moduleName are required.' });
    }

    let trainees = [];
    let notFound = [];

    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      // Mode 1: specific employee IDs
      const empWhere = { employeeId: { in: employeeIds }, status: { not: 'Deleted' } };
      if (req.userBranch) empWhere.branch = req.userBranch;
      const found = await prisma.traineeMaster.findMany({
        where: empWhere,
        select: { employeeId: true, traineeName: true },
      });
      const foundIds = new Set(found.map(t => t.employeeId));
      notFound = employeeIds.filter(id => !foundIds.has(id));
      trainees = found;
    } else if (scopeType && Array.isArray(scopeValues) && scopeValues.length > 0) {
      // Mode 2: expand by scope (batch / process / branch)
      if (req.userBranch && scopeType === 'branch') {
        const invalid = scopeValues.filter(v => v !== req.userBranch);
        if (invalid.length) return res.status(403).json({ ok: false, message: `You can only assign to your own branch: ${req.userBranch}` });
      }
      const where = { status: { not: 'Deleted' } };
      if (scopeType === 'batch') where.batchNo = { in: scopeValues };
      else if (scopeType === 'process') where.process = { in: scopeValues };
      else if (scopeType === 'branch') where.branch = { in: scopeValues };
      else return res.status(400).json({ ok: false, message: 'scopeType must be batch, process, or branch.' });
      if (req.userBranch) where.branch = req.userBranch;

      trainees = await prisma.traineeMaster.findMany({
        where,
        select: { employeeId: true, traineeName: true },
      });
    } else {
      return res.status(400).json({ ok: false, message: 'Provide employeeIds[] or scopeType + scopeValues[].' });
    }

    if (trainees.length === 0) {
      return res.json({ ok: true, assigned: 0, notFound, message: 'No matching active trainees found.' });
    }

    // Deduplicate in case of overlapping scope values
    const seen = new Set();
    const unique = trainees.filter(t => seen.has(t.employeeId) ? false : seen.add(t.employeeId));

    const now = Date.now();
    const records = unique.map((t, i) => ({
      id: `bk-${now}-${i}-${t.employeeId}`.slice(0, 36),
      moduleId,
      moduleName,
      broadcastTitle: broadcastTitle?.trim() || null,
      assignedTo: t.employeeId,
      assignedToType: 'individual',
      assignmentType: assignmentType || 'Mandatory',
      message: message || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedBy: req.userId,
      assessmentId: assessmentId || null,
    }));

    await prisma.assignedModule.createMany({ data: records, skipDuplicates: true });

    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'BROADCAST_BULK',
      module: 'AssignedModule',
      referenceId: moduleId,
      newValue: { assigned: unique.length, notFound: notFound.length, scopeType: scopeType || 'individual' },
    });

    // Notify trainees — fire and forget, check config first
    prisma.notificationConfig.findUnique({ where: { id: 'default' } }).then(cfg => {
      if (!cfg?.notifyModuleAssigned) return;
      return Promise.all(unique.map(t =>
        prisma.traineeMaster.findUnique({ where: { employeeId: t.employeeId }, select: { email: true, mobile: true, traineeName: true } })
          .then(tr => tr && notifyModuleAssigned({ traineeName: tr.traineeName, email: tr.email, mobile: tr.mobile, moduleName, broadcastTitle, dueDate, assignmentType }))
          .catch(() => {})
      ));
    }).catch(() => {});

    // PKT/test attached — separate notification, only when an assessment was actually
    // attached to this broadcast. Fire-and-forget, same config gate.
    if (assessmentId) {
      notifyAssessmentAssignedForTrainees({ employeeIds: unique.map(t => t.employeeId), moduleName, assessmentId, dueDate })
        .catch(err => console.error('[NOTIFY] broadcastModuleBulk PKT notification failed:', err.message));
    }

    res.json({
      ok: true,
      assigned: unique.length,
      notFound,
      message: `Module assigned to ${unique.length} trainee(s).${notFound.length ? ` ${notFound.length} ID(s) not found.` : ''}`,
    });
  } catch (err) {
    console.error('[broadcastModuleBulk]', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// PKT/test-attached notification — resolves a single (non-bulk) broadcast scope to its
// trainee list and emails each one. Reuses the notifyModuleAssigned config toggle since
// this is still "a module got assigned to you", just with a test attached.
async function notifyAssessmentAssignedForScope({ scope, scopeValue, moduleName, assessmentId, dueDate, userBranch }) {
  const cfg = await prisma.notificationConfig.findUnique({ where: { id: 'default' } });
  if (!cfg?.notifyModuleAssigned) return;

  const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId }, select: { assessmentName: true } });
  if (!assessment) return;

  const where = { status: { not: 'Deleted' } };
  if (scope === 'individual') where.employeeId = scopeValue;
  else if (scope === 'batch') where.batchNo = scopeValue;
  else if (scope === 'process') where.process = scopeValue;
  else if (scope === 'branch') where.branch = scopeValue;
  // scope === 'company' → no extra filter, every active trainee
  if (userBranch) where.branch = userBranch;

  const trainees = await prisma.traineeMaster.findMany({ where, select: { email: true, traineeName: true } });
  await Promise.all(trainees.map(t => t.email
    ? notifyAssessmentAssigned({ traineeName: t.traineeName, email: t.email, moduleName, assessmentName: assessment.assessmentName, dueDate }).catch(() => {})
    : Promise.resolve()));
}

// PKT/test-attached notification for the bulk path — trainees are already resolved to a
// concrete employeeId list, so this just fetches emails and sends.
async function notifyAssessmentAssignedForTrainees({ employeeIds, moduleName, assessmentId, dueDate }) {
  const cfg = await prisma.notificationConfig.findUnique({ where: { id: 'default' } });
  if (!cfg?.notifyModuleAssigned) return;

  const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId }, select: { assessmentName: true } });
  if (!assessment) return;

  const trainees = await prisma.traineeMaster.findMany({
    where: { employeeId: { in: employeeIds } },
    select: { email: true, traineeName: true },
  });
  await Promise.all(trainees.map(t => t.email
    ? notifyAssessmentAssigned({ traineeName: t.traineeName, email: t.email, moduleName, assessmentName: assessment.assessmentName, dueDate }).catch(() => {})
    : Promise.resolve()));
}

// Validate a list of employee IDs — returns found/notFound without assigning
export async function validateEmployeeIds(req, res) {
  try {
    const { employeeIds } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ ok: false, message: 'employeeIds required.' });
    }
    const found = await prisma.traineeMaster.findMany({
      where: { employeeId: { in: employeeIds }, status: { not: 'Deleted' } },
      select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true },
    });
    const foundIds = new Set(found.map(t => t.employeeId));
    const notFound = employeeIds.filter(id => !foundIds.has(id));
    res.json({ ok: true, found, notFound });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIST(v) {
  return new Date(new Date(v).getTime() + IST_OFFSET_MS);
}

function fmtDt(v) {
  if (!v) return '';
  return toIST(v).toISOString().replace('T', ' ').slice(0, 19);
}

function fmtDate(v) {
  if (!v) return '';
  return toIST(v).toISOString().slice(0, 10);
}

function csvRes(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

// ── 1. Trainee Progress ────────────────────────────────────────────────────────
export async function exportTrainees(req, res) {
  try {
    const { batchNo, classroomId, status } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const where = { ...branchFilter };
    if (batchNo) where.batchNo = batchNo;
    if (classroomId) where.classroomId = classroomId;
    // status filter: 'Active', 'Inactive', or omitted for all (excludes Deleted)
    if (status === 'Active' || status === 'Inactive') {
      where.status = status;
    } else {
      where.status = { not: 'Deleted' };
    }

    const [trainees, batches] = await Promise.all([
      prisma.traineeMaster.findMany({ where, orderBy: [{ batchNo: 'asc' }, { employeeId: 'asc' }] }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true, createdAt: true, lastUpdatedAt: true } }),
    ]);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const headers = [
      'Employee ID', 'Name', 'Email', 'Mobile',
      'ID Type', 'Permanent Emp ID',
      'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date',
      'Onboarding Date', 'Last Updated At',
      'Course Completion %', 'MCQ Pass %', 'Attendance %',
      'Risk Status', 'Risk Reason',
      'OJT Ready', 'Certification Status',
      'Status', 'Source', 'Export Generated At',
    ];
    const genAt = fmtDt(new Date());
    const statusLabel = status === 'Active' ? 'active' : status === 'Inactive' ? 'inactive' : 'all';
    const rows = trainees.map(t => {
      const b = batchMap[t.batchNo] || {};
      return [
        t.employeeId, t.traineeName, t.email, t.mobile,
        t.empIdType || 'PERMANENT', t.permanentEmpId || '',
        t.batchNo, t.branch, t.process, t.lob,
        fmtDate(b.startDate), fmtDate(b.endDate),
        fmtDate(t.onboardingDate), fmtDt(t.lastUpdatedAt),
        t.courseCompletionPct || 0, t.assessmentPassPct || 0, t.attendancePct || 0,
        t.riskStatus, t.riskReason || '',
        t.ojtReady ? 'Yes' : 'No', t.certificationStatus,
        t.status, t.source, genAt,
      ];
    });
    csvRes(res, `trainees-${statusLabel}-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 2. Batch Summary ───────────────────────────────────────────────────────────
export async function exportBatchSummary(req, res) {
  try {
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const batches = await prisma.batchMaster.findMany({ where: { ...branchFilter }, orderBy: { createdAt: 'desc' } });
    const batchNos = batches.map(b => b.batchNo);
    const [stats, riskCounts, certCounts] = await Promise.all([
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos } },
        _count: { employeeId: true },
        _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, riskStatus: { in: ['CRITICAL', 'HIGH'] } },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, certificationStatus: 'Certified' },
        _count: { employeeId: true },
      }),
    ]);
    const sMap = {};
    stats.forEach(s => { sMap[s.batchNo] = { count: s._count.employeeId, avgCourse: Math.round(s._avg.courseCompletionPct || 0), avgMcq: Math.round(s._avg.assessmentPassPct || 0), avgAtt: Math.round(s._avg.attendancePct || 0) }; });
    const riskMap = {};
    riskCounts.forEach(r => { riskMap[r.batchNo] = r._count.employeeId; });
    const certMap = {};
    certCounts.forEach(c => { certMap[c.batchNo] = c._count.employeeId; });

    const headers = [
      'Batch No', 'Batch Name', 'Batch Type', 'Branch', 'Process', 'LOB',
      'Classroom', 'Coordinator', 'Status',
      'Batch Start Date', 'Batch End Date', 'Created At', 'Last Updated At',
      'Total Trainees', 'Avg Course %', 'Avg MCQ Pass %', 'Avg Attendance %',
      'At-Risk Count', 'Certified Count', 'Remarks',
    ];
    const rows = batches.map(b => {
      const s = sMap[b.batchNo] || {};
      return [
        b.batchNo, b.batchName, b.batchType, b.branch, b.process, b.lob,
        b.classroomName || b.classroomId || '', b.coordinatorName || '', b.batchStatus,
        fmtDate(b.startDate), fmtDate(b.endDate), fmtDt(b.createdAt), fmtDt(b.lastUpdatedAt),
        s.count || 0, s.avgCourse || 0, s.avgMcq || 0, s.avgAtt || 0,
        riskMap[b.batchNo] || 0, certMap[b.batchNo] || 0, b.remarks || '',
      ];
    });
    csvRes(res, `batch-summary-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 3. At-Risk Trainees ────────────────────────────────────────────────────────
export async function exportAtRisk(req, res) {
  try {
    const { batchNo } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const where = { riskStatus: { in: ['CRITICAL', 'HIGH', 'WATCH'] }, ...branchFilter };
    if (batchNo) where.batchNo = batchNo;

    const [trainees, batches, risks] = await Promise.all([
      prisma.traineeMaster.findMany({ where, orderBy: [{ riskStatus: 'asc' }, { courseCompletionPct: 'asc' }] }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true } }),
      prisma.trainingRiskLog.findMany({
        where: { status: 'Open', ...(batchNo ? { batchNo } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });
    const riskMap = {};
    risks.forEach(r => {
      if (!riskMap[r.employeeId]) riskMap[r.employeeId] = [];
      riskMap[r.employeeId].push(r);
    });

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date',
      'Risk Level', 'Risk Reason',
      'Risk Type', 'Risk Flagged At', 'Risk Last Updated At',
      'Course %', 'MCQ Pass %', 'Attendance %',
      'Certification Status', 'Email', 'Mobile',
    ];
    const rows = trainees.map(t => {
      const b = batchMap[t.batchNo] || {};
      const r = (riskMap[t.employeeId] || [])[0] || {};
      return [
        t.employeeId, t.traineeName, t.batchNo, t.branch, t.process, t.lob,
        fmtDate(b.startDate), fmtDate(b.endDate),
        t.riskStatus, t.riskReason || '',
        r.riskType || '', fmtDt(r.createdAt), fmtDt(r.lastUpdatedAt),
        t.courseCompletionPct || 0, t.assessmentPassPct || 0, t.attendancePct || 0,
        t.certificationStatus, t.email, t.mobile,
      ];
    });
    csvRes(res, `at-risk-trainees-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 4. Module Completion Detail ────────────────────────────────────────────────
export async function exportModuleCompletion(req, res) {
  try {
    const { batchNo, classroomId } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const traineeWhere = { ...branchFilter };
    if (batchNo) traineeWhere.batchNo = batchNo;
    if (classroomId) traineeWhere.classroomId = classroomId;

    const [trainees, batches] = await Promise.all([
      prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true } }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true } }),
    ]);
    const empIds = trainees.map(t => t.employeeId);
    const traineeMap = {};
    trainees.forEach(t => { traineeMap[t.employeeId] = t; });
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const [progress, modules, contents] = await Promise.all([
      prisma.contentProgress.findMany({
        where: { employeeId: { in: empIds }, ...(classroomId ? { classroomId } : {}) },
        orderBy: [{ employeeId: 'asc' }, { dayNo: 'asc' }],
      }),
      prisma.moduleMaster.findMany({
        where: classroomId ? { classroomId } : {},
        select: { moduleId: true, moduleTitle: true, dayNo: true, classroomId: true },
      }),
      prisma.contentMaster.findMany({
        where: classroomId ? { module: { classroomId } } : {},
        select: { contentId: true, contentTitle: true, contentType: true, moduleId: true, estimatedMins: true },
      }),
    ]);
    const moduleMap = {};
    modules.forEach(m => { moduleMap[m.moduleId] = m; });
    const contentMap = {};
    contents.forEach(c => { contentMap[c.contentId] = c; });

    const headers = [
      'Employee ID', 'Trainee Name', 'Batch No', 'Branch', 'Process',
      'Batch Start Date', 'Batch End Date',
      'Classroom ID', 'Day No', 'Module Name',
      'Content Title', 'Content Type',
      'Status', 'Completion %',
      'First Opened At', 'Last Opened At', 'Completed At',
      'Total Time Spent (mins)', 'Estimated Mins',
      'Open Count',
    ];
    const rows = progress.map(p => {
      const t = traineeMap[p.employeeId] || {};
      const b = batchMap[t.batchNo] || {};
      const mod = moduleMap[p.moduleId] || {};
      const con = contentMap[p.contentId] || {};
      return [
        p.employeeId, t.traineeName, t.batchNo, t.branch, t.process,
        fmtDate(b.startDate), fmtDate(b.endDate),
        p.classroomId, p.dayNo, mod.moduleTitle || '',
        con.contentTitle || p.contentId, con.contentType || '',
        p.completionStatus, Math.round(p.completionPct || 0),
        fmtDt(p.firstOpenedAt), fmtDt(p.lastOpenedAt), fmtDt(p.completedAt),
        Math.round((p.totalSecondsSpent || 0) / 60), con.estimatedMins || '',
        p.openCount || 0,
      ];
    });
    csvRes(res, `module-completion-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 5. Assessment Results ──────────────────────────────────────────────────────
export async function exportAssessmentResults(req, res) {
  try {
    const { batchNo, classroomId, assessmentId } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const traineeWhere = { ...branchFilter };
    if (batchNo) traineeWhere.batchNo = batchNo;
    if (classroomId) traineeWhere.classroomId = classroomId;

    const trainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true } });
    const empIds = trainees.map(t => t.employeeId);
    const traineeMap = {};
    trainees.forEach(t => { traineeMap[t.employeeId] = t; });

    const attemptWhere = { employeeId: { in: empIds } };
    if (assessmentId) attemptWhere.assessmentId = assessmentId;

    const [attempts, assessments, batches, modules] = await Promise.all([
      prisma.assessmentAttempt.findMany({
        where: attemptWhere,
        orderBy: [{ employeeId: 'asc' }, { assessmentId: 'asc' }, { attemptNo: 'asc' }],
      }),
      prisma.assessmentMaster.findMany({ select: { assessmentId: true, assessmentName: true, passingPct: true, timeLimitMins: true, dayNo: true, moduleId: true } }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true } }),
      prisma.moduleMaster.findMany({ select: { moduleId: true, dayNo: true } }),
    ]);
    const assessMap = {};
    assessments.forEach(a => { assessMap[a.assessmentId] = a; });
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });
    const moduleMap = {};
    modules.forEach(m => { moduleMap[m.moduleId] = m; });

    const headers = [
      'Employee ID', 'Trainee Name', 'Batch No', 'Branch', 'Process',
      'Batch Start Date', 'Batch End Date',
      'Assessment Name', 'Day No',
      'Attempt No', 'Attempt Started At', 'Attempt Submitted At',
      'Time Taken (mins)', 'Time Limit (mins)',
      'Total Questions', 'Correct', 'Wrong', 'Blank',
      'Score %', 'Passing %', 'Result (Pass/Fail)',
    ];
    const rows = attempts.map(a => {
      const t = traineeMap[a.employeeId] || {};
      const b = batchMap[t.batchNo] || {};
      const as = assessMap[a.assessmentId] || {};
      return [
        a.employeeId, t.traineeName, t.batchNo, t.branch, t.process,
        fmtDate(b.startDate), fmtDate(b.endDate),
        as.assessmentName || a.assessmentId, as.dayNo ?? moduleMap[as.moduleId]?.dayNo ?? '',
        a.attemptNo, fmtDt(a.startedAt), fmtDt(a.submittedAt),
        Math.round((a.timeTakenSeconds || 0) / 60), as.timeLimitMins || '',
        a.totalQuestions, a.correctAnswers, a.wrongAnswers, a.blankAnswers,
        Math.round(a.percentage || 0), as.passingPct || '', a.result,
      ];
    });
    csvRes(res, `assessment-results-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 6. Attendance Log ──────────────────────────────────────────────────────────
export async function exportAttendanceLog(req, res) {
  try {
    const { batchNo, dateFrom, dateTo } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const where = { ...branchFilter };
    if (batchNo) where.batchNo = batchNo;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59Z');
    }

    const [records, batches] = await Promise.all([
      prisma.attendanceInference.findMany({ where, orderBy: [{ batchNo: 'asc' }, { employeeId: 'asc' }, { date: 'asc' }] }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true } }),
    ]);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const headers = [
      'Employee ID', 'Trainee Name', 'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date',
      'Date', 'Final Attendance', 'Attendance Source',
      'Course Activity', 'MCQ Activity',
      'Remarks', 'Record Created At',
    ];
    const rows = records.map(r => {
      const b = batchMap[r.batchNo] || {};
      return [
        r.employeeId, r.traineeName, r.batchNo, r.branch, r.process, r.lob,
        fmtDate(b.startDate), fmtDate(b.endDate),
        fmtDate(r.date), r.finalAttendance, r.attendanceSource,
        r.courseActivity ? 'Yes' : 'No', r.mcqActivity ? 'Yes' : 'No',
        r.remarks || '', fmtDt(r.createdAt),
      ];
    });
    csvRes(res, `attendance-log-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 7. Certification Evidence ──────────────────────────────────────────────────
export async function exportCertificationEvidence(req, res) {
  try {
    const { batchNo } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const traineeWhere = { ...branchFilter };
    if (batchNo) traineeWhere.batchNo = batchNo;

    const trainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, certificationStatus: true } });
    const empIds = trainees.map(t => t.employeeId);
    const traineeMap = {};
    trainees.forEach(t => { traineeMap[t.employeeId] = t; });

    const [evidence, batches] = await Promise.all([
      prisma.certificationEvidence.findMany({
        where: { employeeId: { in: empIds } },
        orderBy: [{ employeeId: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true } }),
    ]);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const headers = [
      'Employee ID', 'Trainee Name', 'Batch No', 'Branch', 'Process',
      'Batch Start Date', 'Batch End Date',
      'Overall Cert Status',
      'Evidence Type', 'Result', 'Score %',
      'Conducted By', 'Conducted At', 'Created By', 'Created At',
      'Remarks',
    ];
    const rows = evidence.map(e => {
      const t = traineeMap[e.employeeId] || {};
      const b = batchMap[t.batchNo] || {};
      return [
        e.employeeId, t.traineeName, t.batchNo, t.branch, t.process,
        fmtDate(b.startDate), fmtDate(b.endDate),
        t.certificationStatus,
        e.evidenceType, e.result, e.scorePct || 0,
        e.conductedBy || '', fmtDt(e.conductedAt), e.createdBy || '', fmtDt(e.createdAt),
        e.remarks || '',
      ];
    });
    csvRes(res, `certification-evidence-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 8. Broadcast Assignments ───────────────────────────────────────────────────
export async function exportBroadcastAssignments(req, res) {
  try {
    const { scopeType } = req.query;
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const where = { ...branchFilter, ...(scopeType ? { assignedToType: scopeType } : {}) };
    const assignments = await prisma.assignedModule.findMany({ where, orderBy: { createdAt: 'desc' } });

    const headers = ['Broadcast Title', 'Module Name', 'Scope Type', 'Scope Value (Target)', 'Assignment Type', 'Status (Active)', 'Assigned By', 'Assigned At', 'Due Date', 'Message'];
    const rows = assignments.map(a => [
      a.broadcastTitle || '',
      a.moduleName,
      a.assignedToType,
      a.assignedTo,
      a.assignmentType,
      a.active ? 'Active' : 'Inactive',
      a.assignedBy || '',
      fmtDt(a.createdAt),
      fmtDate(a.dueDate),
      a.message || '',
    ]);
    csvRes(res, `broadcast-assignments-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── 9. Q&A Activity ────────────────────────────────────────────────────────────
export async function exportQAActivity(req, res) {
  try {
    const { batchNo, status } = req.query;
    const where = {};
    if (batchNo) where.batchNo = batchNo;
    if (status) where.status = status;

    const [queries, batches] = await Promise.all([
      prisma.traineeQueryLog.findMany({ where, orderBy: [{ batchNo: 'asc' }, { createdAt: 'asc' }] }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true } }),
    ]);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const headers = [
      'Query ID', 'Employee ID', 'Trainee Name', 'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date',
      'Category', 'Priority', 'Question',
      'Status', 'Coordinator Answer',
      'Answered By', 'Raised At', 'Answered At', 'Closed At',
      'TAT (Hours)',
    ];
    const rows = queries.map(q => {
      const b = batchMap[q.batchNo] || {};
      return [
        q.queryId, q.employeeId, q.traineeName, q.batchNo, '', q.classroomId || '', '',
        fmtDate(b.startDate), fmtDate(b.endDate),
        q.category, q.priority, q.question,
        q.status, q.coordinatorAnswer || '',
        q.answeredBy || '', fmtDt(q.createdAt), fmtDt(q.answeredAt), fmtDt(q.closedAt),
        q.resolutionTatHours != null ? Math.round(q.resolutionTatHours * 10) / 10 : '',
      ];
    });
    csvRes(res, `qa-activity-${batchNo || 'all'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// FIX 6: Historical KPI sync
export async function syncHistoricalKpi(req, res) {
  try {
    const period = new Date().toISOString().slice(0, 7); // "2026-05"
    const [trainees, batches, results] = await Promise.all([
      prisma.traineeMaster.findMany({ where: { status: "Active" } }),
      prisma.batchMaster.findMany({ where: { batchStatus: 'Active' } }),
      prisma.assessmentResult.findMany(),
    ]);
    const totalTrainees = trainees.length;
    const avgCourse = totalTrainees > 0 ? Math.round(trainees.reduce((s, t) => s + (t.courseCompletionPct || 0), 0) / totalTrainees) : 0;
    const avgMcq = totalTrainees > 0 ? Math.round(trainees.reduce((s, t) => s + (t.assessmentPassPct || 0), 0) / totalTrainees) : 0;
    const avgAttendance = totalTrainees > 0 ? Math.round(trainees.reduce((s, t) => s + (t.attendancePct || 0), 0) / totalTrainees) : 0;
    const certified = trainees.filter(t => t.certificationStatus === 'Certified').length;

    await prisma.historicalTrainingKpi.upsert({
      where: { period_branch_process_lob: { period, branch: '', process: '', lob: '' } },
      create: { period, branch: '', process: '', lob: '', totalTrainees, activeBatches: batches.length, avgCoursePct: avgCourse, avgMcqPct: avgMcq, avgAttendancePct: avgAttendance, certifiedCount: certified },
      update: { totalTrainees, activeBatches: batches.length, avgCoursePct: avgCourse, avgMcqPct: avgMcq, avgAttendancePct: avgAttendance, certifiedCount: certified },
    });
    res.json({ ok: true, message: `KPI snapshot saved for ${period}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

// Returns distinct branch + process values from active trainees — used by Broadcast page
export async function getBroadcastTargets(req, res) {
  try {
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const trainees = await prisma.traineeMaster.findMany({
      where: { status: 'Active', ...branchFilter },
      select: { branch: true, process: true, lob: true, designation: true },
    });
    const branches = [...new Set(trainees.map(t => t.branch).filter(Boolean))].sort();
    const processes = [...new Set(trainees.map(t => t.process).filter(Boolean))].sort();
    const designations = [...new Set(trainees.map(t => t.designation).filter(Boolean))].sort();
    res.json({ ok: true, data: { branches, processes, designations } });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getProcessLobList(req, res) {
  try {
    const list = await prisma.processLobMaster.findMany({ orderBy: [{ process: 'asc' }, { lob: 'asc' }] });
    res.json({ ok: true, data: list });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function saveProcessLob(req, res) {
  try {
    const { process, lob, active, notes } = req.body;
    const existing = await prisma.processLobMaster.findFirst({ where: { process, lob } });
    let row;
    if (existing) {
      row = await prisma.processLobMaster.update({ where: { id: existing.id }, data: { active, notes } });
    } else {
      row = await prisma.processLobMaster.create({ data: { process, lob, active: active !== false, notes } });
    }
    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Batch list ────────────────────────────────────────────────────────────────
export async function listBatches(req, res) {
  try {
    const branchFilter = req.userBranch ? { branch: req.userBranch } : {};
    const batches = await prisma.batchMaster.findMany({
      where: { batchStatus: { notIn: ['Archived', 'Deleted'] }, ...branchFilter },
      orderBy: { createdAt: 'desc' },
    });
    const batchNos = batches.map(b => b.batchNo);
    const traineeCounts = await prisma.traineeMaster.groupBy({
      by: ['batchNo'],
      where: { batchNo: { in: batchNos }, status: 'Active' },
      _count: { employeeId: true },
      _avg: { courseCompletionPct: true, attendancePct: true },
    });
    const riskCounts = await prisma.traineeMaster.groupBy({
      by: ['batchNo', 'riskStatus'],
      where: { batchNo: { in: batchNos }, status: 'Active', riskStatus: { in: ['CRITICAL', 'HIGH'] } },
      _count: { employeeId: true },
    });
    const tcMap = {};
    traineeCounts.forEach(t => { tcMap[t.batchNo] = { count: t._count.employeeId, avgCourse: Math.round(t._avg.courseCompletionPct || 0), avgAttendance: Math.round(t._avg.attendancePct || 0) }; });
    const riskMap = {};
    riskCounts.forEach(r => { if (!riskMap[r.batchNo]) riskMap[r.batchNo] = 0; riskMap[r.batchNo] += r._count.employeeId; });
    const data = batches.map(b => ({ ...b, traineeCount: tcMap[b.batchNo]?.count || 0, avgCourse: tcMap[b.batchNo]?.avgCourse || 0, avgAttendance: tcMap[b.batchNo]?.avgAttendance || 0, atRiskCount: riskMap[b.batchNo] || 0 }));
    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getBatchDetail(req, res) {
  try {
    const { batchNo } = req.params;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found' });
    const trainees = await prisma.traineeMaster.findMany({
      where: { batchNo, status: 'Active' },
      orderBy: { traineeName: 'asc' },
      select: { employeeId: true, traineeName: true, riskStatus: true, courseCompletionPct: true, attendancePct: true, assessmentPassPct: true, certificationStatus: true, ojtReady: true, empIdType: true },
    });
    const openQueries = await prisma.traineeQueryLog.count({ where: { batchNo, status: 'Open' } });
    // Fetch all active classrooms for this batch from the map
    const classroomMaps = await prisma.batchClassroomMap.findMany({
      where: { batchNo, active: true },
      orderBy: { assignedAt: 'asc' },
      select: { classroomId: true, classroomName: true },
    });
    const classroomIds = classroomMaps.map(m => m.classroomId);
    // If no map entries fall back to the denormalised field (old batches)
    if (classroomIds.length === 0 && batch.classroomId) classroomIds.push(batch.classroomId);

    const total = trainees.length;
    const onTrack = trainees.filter(t => t.riskStatus === 'HEALTHY').length;
    const atRisk = trainees.filter(t => ['CRITICAL','HIGH'].includes(t.riskStatus)).length;
    const needsAttention = trainees.filter(t => t.riskStatus === 'MEDIUM').length;
    const mcqPassed = trainees.filter(t => t.assessmentPassPct >= 60).length;
    const avgCourse = total > 0 ? Math.round(trainees.reduce((s,t) => s + (t.courseCompletionPct||0), 0) / total) : 0;
    const avgAttendance = total > 0 ? Math.round(trainees.reduce((s,t) => s + (t.attendancePct||0), 0) / total) : 0;
    const avgMcq = total > 0 ? Math.round(trainees.reduce((s,t) => s + (t.assessmentPassPct||0), 0) / total) : 0;
    const certified = trainees.filter(t => t.certificationStatus === 'Certified').length;
    res.json({ ok: true, data: {
      batch: { ...batch, classroomIds, classrooms: classroomMaps },
      trainees, openQueries,
      summary: { total, onTrack, atRisk, needsAttention, mcqPassed, avgCourse, avgAttendance, avgMcq, certified },
    } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getBatchAnalytics(req, res) {
  try {
    const { batchNo } = req.params;
    const attendance = await prisma.attendanceInference.findMany({
      where: { batchNo },
      orderBy: { date: 'asc' },
    });
    const byDate = {};
    attendance.forEach(a => {
      const d = a.date.toISOString().slice(0,10);
      if (!byDate[d]) byDate[d] = { total: 0, present: 0 };
      byDate[d].total++;
      if (a.finalAttendance === 'Present') byDate[d].present++;
    });
    const attendanceTrend = Object.entries(byDate).map(([date, v]) => ({ date, pct: v.total > 0 ? Math.round(v.present/v.total*100) : 0 }));

    const trainees = await prisma.traineeMaster.findMany({
      where: { batchNo, status: 'Active' },
      select: { assessmentPassPct: true, certificationStatus: true, courseCompletionPct: true },
    });
    const bands = { '90-100': 0, '75-89': 0, '60-74': 0, 'below60': 0, 'notTaken': 0 };
    trainees.forEach(t => {
      const s = t.assessmentPassPct;
      if (s === 0) bands.notTaken++;
      else if (s >= 90) bands['90-100']++;
      else if (s >= 75) bands['75-89']++;
      else if (s >= 60) bands['60-74']++;
      else bands.below60++;
    });

    const willCert = trainees.filter(t => t.certificationStatus === 'Certified').length;
    const borderline = trainees.filter(t => t.courseCompletionPct >= 70 && t.courseCompletionPct < 90 && t.certificationStatus !== 'Certified').length;
    const certAtRisk = trainees.length - willCert - borderline;

    res.json({ ok: true, data: { attendanceTrend, mcqDistribution: bands, certForecast: { willCert, borderline, atRisk: certAtRisk > 0 ? certAtRisk : 0 } } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Coordinator list + detail ─────────────────────────────────────────────────
export async function listCoordinators(req, res) {
  try {
    const [batches, roleRows] = await Promise.all([
      prisma.batchMaster.findMany({
        where: { coordinatorLoginId: { not: null } },
        select: { coordinatorLoginId: true, coordinatorName: true, batchNo: true, batchName: true, totalTrainees: true, batchStatus: true },
      }),
      prisma.roleAccessMatrix.findMany({
        where: { role: { in: ['coordinator', 'Coordinator'] }, active: true },
        select: { loginId: true, name: true, branch: true, process: true, lob: true },
      }),
    ]);

    // Seed coordMap from RoleAccessMatrix — every active coordinator appears
    const coordMap = {};
    roleRows.forEach(r => {
      coordMap[r.loginId] = { coordinatorLoginId: r.loginId, coordinatorName: r.name || r.loginId, branch: r.branch, process: r.process, lob: r.lob, batches: [], activeBatches: 0, totalBatches: 0 };
    });

    // Enrich with batch data — also picks up coordinators not in RoleAccessMatrix
    batches.forEach(b => {
      const id = b.coordinatorLoginId;
      if (!coordMap[id]) coordMap[id] = { coordinatorLoginId: id, coordinatorName: b.coordinatorName || id, branch: null, process: null, lob: null, batches: [], activeBatches: 0, totalBatches: 0 };
      coordMap[id].batches.push({ batchNo: b.batchNo, batchName: b.batchName, totalTrainees: b.totalTrainees, batchStatus: b.batchStatus });
      coordMap[id].totalBatches++;
      if (b.batchStatus === 'Active') coordMap[id].activeBatches++;
    });

    res.json({ ok: true, data: Object.values(coordMap).sort((a, b) => (a.coordinatorName || '').localeCompare(b.coordinatorName || '')) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getCoordinatorDetail(req, res) {
  try {
    const { loginId } = req.params;
    const batches = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: loginId },
      orderBy: { createdAt: 'desc' },
    });
    const batchNos = batches.map(b => b.batchNo);

    const [openQueries, answeredQueries, totalQueries, tatAgg, pendingActions, recentAnswered] = await Promise.all([
      prisma.traineeQueryLog.count({ where: { batchNo: { in: batchNos }, status: 'Open' } }),
      prisma.traineeQueryLog.count({ where: { batchNo: { in: batchNos }, answeredBy: loginId } }),
      prisma.traineeQueryLog.count({ where: { batchNo: { in: batchNos } } }),
      prisma.traineeQueryLog.aggregate({
        where: { batchNo: { in: batchNos }, answeredBy: loginId, resolutionTatHours: { not: null } },
        _avg: { resolutionTatHours: true },
        _min: { resolutionTatHours: true },
        _max: { resolutionTatHours: true },
      }),
      prisma.traineeQueryLog.findMany({
        where: { batchNo: { in: batchNos }, status: 'Open' },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true, queryId: true, traineeName: true, question: true, createdAt: true, priority: true, batchNo: true },
      }),
      prisma.traineeQueryLog.findMany({
        where: { batchNo: { in: batchNos }, answeredBy: loginId },
        orderBy: { answeredAt: 'desc' },
        take: 10,
        select: { queryId: true, traineeName: true, question: true, coordinatorAnswer: true, answeredAt: true, resolutionTatHours: true, batchNo: true },
      }),
    ]);

    const qaResponseRate = totalQueries > 0 ? Math.round(answeredQueries / totalQueries * 100) : 100;
    const avgTatHours = tatAgg._avg.resolutionTatHours ? Math.round(tatAgg._avg.resolutionTatHours * 10) / 10 : null;
    // Effectiveness score: response rate weighted 60%, speed bonus 40% (capped at 24h ideal)
    const speedScore = avgTatHours !== null ? Math.max(0, Math.min(100, Math.round((1 - avgTatHours / 48) * 100))) : null;
    const effectivenessScore = speedScore !== null
      ? Math.round(qaResponseRate * 0.6 + speedScore * 0.4)
      : qaResponseRate;

    res.json({
      ok: true,
      data: {
        loginId, batches, openQueries, answeredQueries, totalQueries, qaResponseRate,
        avgTatHours, speedScore, effectivenessScore,
        pendingActions, recentAnswered,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Trainee detail ────────────────────────────────────────────────────────────
export async function getTraineeDetail(req, res) {
  try {
    const { empId } = req.params;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: empId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found' });

    const [attendance, queries, riskLogs] = await Promise.all([
      prisma.attendanceInference.findMany({ where: { employeeId: empId }, orderBy: { date: 'desc' }, take: 30 }),
      prisma.traineeQueryLog.findMany({ where: { employeeId: empId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.trainingRiskLog.findMany({ where: { employeeId: empId, status: 'Open' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    res.json({ ok: true, data: { trainee, attendance, queries, riskLogs } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Risk drilldown ────────────────────────────────────────────────────────────
export async function getRiskLevel(req, res) {
  try {
    const { level } = req.params;
    const validLevels = ['CRITICAL', 'HIGH', 'MEDIUM', 'HEALTHY'];
    if (!validLevels.includes(level.toUpperCase())) return res.status(400).json({ ok: false, message: 'Invalid risk level' });
    const trainees = await prisma.traineeMaster.findMany({
      where: { status: 'Active', riskStatus: level.toUpperCase() },
      orderBy: [{ attendancePct: 'asc' }, { courseCompletionPct: 'asc' }],
      select: { employeeId: true, traineeName: true, batchNo: true, riskStatus: true, riskReason: true, courseCompletionPct: true, attendancePct: true, assessmentPassPct: true, certificationStatus: true },
    });
    res.json({ ok: true, data: { level: level.toUpperCase(), count: trainees.length, trainees } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Process/LOB update + delete ───────────────────────────────────────────────
export async function updateProcessLob(req, res) {
  try {
    const { id } = req.params;
    const { process, lob, active, notes } = req.body;
    const row = await prisma.processLobMaster.update({ where: { id }, data: { process, lob, active, notes } });
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function deleteProcessLob(req, res) {
  try {
    const { id } = req.params;
    await prisma.processLobMaster.update({ where: { id }, data: { active: false } });
    res.json({ ok: true, message: 'Deactivated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

function parseCsvRows(rawCsv) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < rawCsv.length; i++) {
    const ch = rawCsv[i];
    const next = rawCsv[i + 1];

    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

// ── CSV MCQ upload ────────────────────────────────────────────────────────────
export async function uploadQuestionsCSV(req, res) {
  try {
    const { assessmentId } = req.params;
    const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
    if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found' });

    const rawCsv = req.body.csv;
    if (!rawCsv) return res.status(400).json({ ok: false, message: 'No CSV data provided' });

    const rows = parseCsvRows(rawCsv);
    if (rows.length < 2) return res.status(400).json({ ok: false, message: 'CSV must have header + at least one row' });

    const header = rows[0].map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const required = ['question', 'option_a', 'option_b', 'correct'];
    for (const f of required) {
      if (!header.includes(f)) return res.status(400).json({ ok: false, message: `Missing column: ${f}` });
    }

    const questions = [];
    const errors = [];
    for (let i = 1; i < rows.length; i++) {
      const vals = rows[i].map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      header.forEach((h, idx) => { row[h] = vals[idx] || ''; });
      if (!row.question || !row.option_a || !row.option_b || !row.correct) {
        errors.push({ row: i + 1, error: 'Missing required fields' });
        continue;
      }
      const correctUpper = row.correct.toUpperCase();
      if (!['A','B','C','D'].includes(correctUpper)) {
        errors.push({ row: i + 1, error: `Invalid correct option: ${row.correct}` });
        continue;
      }
      questions.push({
        questionId: `QST-${assessmentId}-CSV-${i}-${Date.now()}`,
        assessmentId,
        questionText: row.question,
        optionA: row.option_a,
        optionB: row.option_b,
        optionC: row.option_c || null,
        optionD: row.option_d || null,
        correctOption: correctUpper,
        marks: parseInt(row.marks) || 1,
        difficulty: row.difficulty || 'Medium',
        explanation: row.explanation || null,
        active: true,
      });
    }

    if (questions.length === 0) return res.status(400).json({ ok: false, message: 'No valid questions parsed', errors });
    await prisma.questionBank.createMany({ data: questions });
    res.json({ ok: true, count: questions.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ── Admin Batch Creation ──

export async function adminCreateBatch(req, res) {
  try {
    const { batchName, batchType, branch, process, lob, coordinatorLoginId, startDate, endDate, expectedTrainees, remarks } = req.body;

    if (!coordinatorLoginId) return res.status(400).json({ ok: false, message: 'Coordinator is required.' });

    // Normalise classroom ids — frontend sends classroomIds[] (multi-select);
    // older callers may still send classroomId (string). Derive a single primary.
    const rawIds = [...new Set(
      (Array.isArray(req.body.classroomIds) ? req.body.classroomIds : [])
        .concat(req.body.classroomId ? [req.body.classroomId] : [])
        .map(v => String(v || '').trim())
        .filter(Boolean)
    )];
    const classroomId = rawIds[0] || null;
    const extraClassroomIds = rawIds.slice(1);

    // Get coordinator info
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: coordinatorLoginId } });
    const coordinatorName = coord?.name || coordinatorLoginId;

    let classroomName = null;
    if (classroomId) {
      const cl = await prisma.classroomMaster.findUnique({ where: { classroomId } });
      if (!cl || !cl.active) return res.status(400).json({ ok: false, message: 'Classroom not found.' });
      classroomName = cl?.classroomName;
    }

    // Generate batch number
    const now = startDate ? new Date(startDate) : new Date();
    const mon = now.toLocaleString('en', { month: 'short' }).toUpperCase();
    const yr = String(now.getFullYear()).slice(-2);
    const prefix = `${(process || 'GEN').slice(0, 3).toUpperCase()}-${mon}${yr}`;
    const existing = await prisma.batchMaster.count({ where: { batchNo: { startsWith: prefix } } });
    const batchNo = `${prefix}-${String(existing + 1).padStart(3, '0')}`;

    const batch = await prisma.batchMaster.create({
      data: {
        batchNo,
        batchName: batchName || `${process} ${lob} Batch`,
        batchType: batchType || 'NHT',
        branch: branch || '',
        process: process || '',
        lob: lob || '',
        classroomId: classroomId || null,
        classroomName: classroomName || null,
        classroomAssignedAt: classroomId ? new Date() : null,
        classroomAssignedBy: classroomId ? req.userId : null,
        coordinatorName,
        coordinatorLoginId,
        batchStatus: 'Active',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        expectedTrainees: parseInt(expectedTrainees || 0),
        createdBy: req.userId,
        remarks,
      },
    });

    if (classroomId && classroomName) {
      await prisma.batchClassroomMap.create({
        data: {
          batchNo,
          batchName: batch.batchName,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          classroomId,
          classroomName,
          assignedBy: req.userId,
        },
      }).catch(() => {});
    }

    // Any further classrooms picked in the wizard are attached the same way the
    // batch screen attaches them later on.
    if (extraClassroomIds.length) {
      await attachBatchClassrooms(batchNo, extraClassroomIds, req.userId).catch(error => {
        console.error('[BATCH] extra classrooms failed:', error.message);
      });
    }

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_BATCH', module: 'Batch', referenceId: batchNo, newValue: batch });
    res.json({ ok: true, data: batch, message: `Batch ${batchNo} created.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function adminUpdateBatchCoordinator(req, res) {
  try {
    const { batchNo } = req.params;
    const { coordinatorLoginId } = req.body;
    if (!coordinatorLoginId) return res.status(400).json({ ok: false, message: 'coordinatorLoginId required.' });

    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: coordinatorLoginId } });
    const coordinatorName = coord?.name || coordinatorLoginId;

    const batch = await prisma.batchMaster.update({
      where: { batchNo },
      data: { coordinatorLoginId, coordinatorName },
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_BATCH_COORDINATOR', module: 'Batch', referenceId: batchNo });
    res.json({ ok: true, data: batch });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function adminUpdateBatch(req, res) {
  try {
    const { batchNo } = req.params;
    const { batchName, branch, process: proc, lob, classroomId, startDate, endDate, expectedTrainees, remarks, coordinatorLoginId } = req.body;

    const existingBatch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!existingBatch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const data = {};
    if (batchName !== undefined) data.batchName = String(batchName).trim();
    if (branch !== undefined) data.branch = String(branch).trim() || null;
    if (proc !== undefined) data.process = String(proc).trim() || null;
    if (lob !== undefined) data.lob = String(lob).trim() || null;
    if (startDate !== undefined) data.startDate = parseOptionalDate(startDate);
    if (endDate !== undefined) data.endDate = parseOptionalDate(endDate);
    if (expectedTrainees !== undefined) data.expectedTrainees = parseOptionalInt(expectedTrainees, 0);
    if (remarks !== undefined) data.remarks = String(remarks).trim() || null;

    // Coordinator change — inline (same as the dedicated endpoint)
    if (coordinatorLoginId) {
      const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: coordinatorLoginId } });
      data.coordinatorLoginId = coordinatorLoginId;
      data.coordinatorName = coord?.name || coordinatorLoginId;
    }

    let shouldSyncClassroom = false;
    let nextClassroomId = existingBatch.classroomId;
    let nextClassroomName = existingBatch.classroomName;

    // ── Multi-classroom sync ──────────────────────────────────────────────────
    // Frontend sends classroomIds[] (the desired full set).
    // We reconcile against the current batchClassroomMap.
    if (Array.isArray(req.body.classroomIds)) {
      const desiredIds = [...new Set(
        req.body.classroomIds.map(v => String(v || '').trim()).filter(Boolean)
      )];

      const currentMaps = await prisma.batchClassroomMap.findMany({
        where: { batchNo, active: true },
        select: { classroomId: true },
      });
      const currentIds = new Set(currentMaps.map(m => m.classroomId));
      const toAdd    = desiredIds.filter(id => !currentIds.has(id));
      const toRemove = [...currentIds].filter(id => !desiredIds.includes(id));

      if (toAdd.length) {
        await attachBatchClassrooms(batchNo, toAdd, req.userId);
      }
      if (toRemove.length) {
        await prisma.batchClassroomMap.updateMany({
          where: { batchNo, classroomId: { in: toRemove } },
          data: { active: false },
        });
        // Deactivate trainee mappings for removed classrooms
        await prisma.traineeClassroomMap.updateMany({
          where: { batchNo, classroomId: { in: toRemove } },
          data: { active: false },
        });
      }

      // Keep batchMaster.classroomId pointing at the first desired classroom (or null)
      const newPrimary = desiredIds[0] || null;
      if (newPrimary !== existingBatch.classroomId) {
        let newPrimaryName = null;
        if (newPrimary) {
          const cl = await prisma.classroomMaster.findUnique({ where: { classroomId: newPrimary }, select: { classroomName: true } });
          newPrimaryName = cl?.classroomName || null;
        }
        data.classroomId = newPrimary;
        data.classroomName = newPrimaryName;
        data.classroomAssignedAt = newPrimary ? new Date() : null;
        data.classroomAssignedBy = newPrimary ? req.userId : null;
        nextClassroomId = newPrimary;
        nextClassroomName = newPrimaryName;
        shouldSyncClassroom = true;
      }

    } else if (classroomId !== undefined) {
      // Legacy single-classroom path
      const newClassroomId = cleanText(classroomId);
      let classroomName = null;
      if (newClassroomId) {
        const cl = await prisma.classroomMaster.findUnique({ where: { classroomId: newClassroomId } });
        if (!cl || !cl.active) return res.status(400).json({ ok: false, message: 'Classroom not found.' });
        classroomName = cl.classroomName;
      }
      data.classroomId = newClassroomId;
      data.classroomName = classroomName;
      data.classroomAssignedAt = newClassroomId ? new Date() : null;
      data.classroomAssignedBy = newClassroomId ? req.userId : null;
      shouldSyncClassroom = true;
      nextClassroomId = newClassroomId;
      nextClassroomName = classroomName;
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ ok: false, message: 'No fields to update.' });
    if (data.batchName !== undefined && !data.batchName) return res.status(400).json({ ok: false, message: 'Batch name cannot be empty.' });
    if (data.startDate === null && startDate) return res.status(400).json({ ok: false, message: 'Invalid start date.' });
    if (data.endDate === null && endDate) return res.status(400).json({ ok: false, message: 'Invalid end date.' });

    const batch = await prisma.$transaction(async (tx) => {
      const updated = await tx.batchMaster.update({ where: { batchNo }, data });
      if (shouldSyncClassroom) {
        await syncBatchClassroomAssignment({
          batch: updated,
          classroomId: nextClassroomId,
          classroomName: nextClassroomName,
          assignedBy: req.userId,
          db: tx,
        });
      }
      return updated;
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_BATCH', module: 'Batch', referenceId: batchNo, newValue: data });
    res.json({ ok: true, data: batch });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function listAllCoordinators(req, res) {
  try {
    const coords = await prisma.roleAccessMatrix.findMany({
      where: { active: true, canCreateBatch: true },
      select: { loginId: true, name: true, branch: true, process: true, lob: true },
      orderBy: { name: 'asc' },
    });
    res.json({ ok: true, data: coords });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createCoordinator(req, res) {
  try {
    const { loginId, pin, name, process, lob, designation, department, employeeCode,
      canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard } = req.body;

    if (!loginId || !pin || !name) return res.status(400).json({ ok: false, message: 'Login ID, PIN and Name are required.' });
    if (pin.length < 4) return res.status(400).json({ ok: false, message: 'PIN must be at least 4 characters.' });

    const cleanLoginId = loginId.trim();

    // Branch-scoped admins can only create coordinators for their own branch
    const branch = req.userBranch || req.body.branch || null;

    const [existingCoord, existingAdmin] = await Promise.all([
      prisma.roleAccessMatrix.findFirst({ where: { loginId: cleanLoginId } }),
      prisma.adminUserMaster.findFirst({ where: { adminId: cleanLoginId } }),
    ]);
    if (existingCoord || existingAdmin) return res.status(400).json({ ok: false, message: 'Login ID already exists.' });

    const hashedPin = await hashCredential(pin);
    const user = await prisma.roleAccessMatrix.create({
      data: {
        loginId: cleanLoginId, pin: hashedPin, name: name.trim(),
        role: 'Coordinator', portalAccess: 'Coordinator',
        branch, process: process || null, lob: lob || null,
        designation: designation || null, department: department || null, employeeCode: employeeCode || null,
        active: true,
        canCreateBatch: !!canCreateBatch, canOnboardTrainee: !!canOnboardTrainee,
        canUploadLmsReport: !!canUploadLmsReport, canOverrideAttendance: !!canOverrideAttendance,
        canCloseBatch: !!canCloseBatch, canViewManagementDashboard: !!canViewManagementDashboard,
      },
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_COORDINATOR', module: 'Coordinators', referenceId: cleanLoginId });
    res.json({ ok: true, data: user, message: `Coordinator ${cleanLoginId} created.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function closeBatch(req, res) {
  try {
    const { batchNo } = req.params;
    const { remarks, closureReason } = req.body;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const updated = await prisma.batchMaster.update({
      where: { batchNo },
      data: {
        batchStatus: 'Completed',
        endDate: batch.endDate || new Date(),
        remarks: remarks || closureReason || batch.remarks,
      },
    });
    await audit({ userIdentity: req.userId, userRole: req.userRole || 'Admin', action: 'CLOSE_BATCH', module: 'Batch', referenceId: batchNo });
    res.json({ ok: true, data: updated, message: `Batch ${batchNo} closed.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function adminBulkAddTrainees(req, res) {
  try {
    const { batchNo } = req.params;
    const { trainees } = req.body;
    if (!Array.isArray(trainees) || trainees.length === 0) {
      return res.status(400).json({ ok: false, message: 'No trainees provided.' });
    }

    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const results = [];
    for (const t of trainees) {
      const { employeeId, traineeName, email, mobile } = t;
      let normEmpId;
      let isTemp = false;

      if (!employeeId) {
        const cleanMob = mobile ? mobile.replace(/\D/g, '').slice(-10) : null;
        if (!cleanMob) { results.push({ ok: false, message: 'Mobile required when Employee ID is absent.' }); continue; }
        normEmpId = await generateTempEmpId();
        isTemp = true;
      } else {
        normEmpId = employeeId.trim().toUpperCase();
      }

      const existing = await prisma.traineeMaster.findFirst({
        where: { OR: [{ employeeId: normEmpId }, ...(email ? [{ email: email.trim().toLowerCase() }] : [])].filter(Boolean) },
      });
      if (existing) { results.push({ ok: false, message: `${normEmpId} already exists.` }); continue; }

      // Generate unique lmsId — use timestamp+random if collision risk
      let lmsId = `LMS${normEmpId.replace(/\D/g, '').padStart(6, '0').slice(-6)}`;
      const lmsIdExists = await prisma.traineeMaster.findFirst({ where: { lmsId } });
      if (lmsIdExists) lmsId = `LMS${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`.slice(0, 9);
      const cleanMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : null;
      const tempPassword = cleanMobile ? cleanMobile.slice(-4) : '1234';
      const salt = generateSalt();
      const passwordHash = await hashPassword(tempPassword, salt);

      await prisma.$transaction(async (tx) => {
        await tx.traineeMaster.create({
          data: {
            employeeId: normEmpId,
            lmsId,
            traineeName: traineeName || normEmpId,
            email: email ? email.trim().toLowerCase() : null,
            mobile: cleanMobile,
            batchNo: batch.batchNo,
            branch: batch.branch,
            process: batch.process,
            lob: batch.lob,
            classroomId: batch.classroomId,
            classroomName: batch.classroomName,
            certificationStatus: 'Not Certified',
            empIdType: isTemp ? 'TEMP' : 'PERMANENT',
          },
        });
        await tx.userMaster.create({
          data: {
            employeeId: normEmpId,
            traineeName: traineeName || normEmpId,
            email: email ? email.trim().toLowerCase() : null,
            mobile: cleanMobile,
            batchNo: batch.batchNo,
            classroomId: batch.classroomId,
            passwordHash,
            salt,
            forcePasswordReset: true,
          },
        });
        if (batch.classroomId) {
          await tx.traineeClassroomMap.upsert({
            where: { employeeId_classroomId: { employeeId: normEmpId, classroomId: batch.classroomId } },
            create: { employeeId: normEmpId, classroomId: batch.classroomId, batchNo: batch.batchNo, assignedBy: req.userId },
            update: {},
          });
        }
      });
      results.push({ ok: true, employeeId: normEmpId });
    }

    const success = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);
    if (success > 0) {
      await prisma.batchMaster.update({
        where: { batchNo },
        data: { totalTrainees: { increment: success } },
      });
    }
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'BULK_ONBOARD', module: 'Trainee', referenceId: batchNo, newValue: { total: trainees.length, success } });
    res.json({ ok: true, data: { success, failed: failed.length, errors: failed.map(r => r.message) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

// ── Content Sequential Lock Toggle ────────────────────────────────────────────
export async function setContentLock(req, res) {
  try {
    const { contentId } = req.params;
    const { locked } = req.body;

    const content = await prisma.contentMaster.findUnique({ where: { contentId } });
    if (!content) return res.status(404).json({ ok: false, message: 'Content not found.' });

    await prisma.contentMaster.update({ where: { contentId }, data: { locked: !!locked } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: locked ? 'LOCK_CONTENT' : 'UNLOCK_CONTENT', module: 'Content', referenceId: contentId });
    res.json({ ok: true, message: locked ? 'Content locked.' : 'Content unlocked.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function unlockContentForTrainee(req, res) {
  try {
    const { contentId, employeeId } = req.params;

    const content = await prisma.contentMaster.findUnique({ where: { contentId }, include: { module: true } });
    if (!content) return res.status(404).json({ ok: false, message: 'Content not found.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    const classroomId = trainee.classroomId || '';
    await prisma.contentProgress.upsert({
      where: { employeeId_contentId: { employeeId, contentId } },
      create: {
        employeeId, classroomId,
        dayNo: content.module.dayNo, moduleId: content.moduleId, contentId,
        opened: true, openCount: 0, requiredSeconds: 0,
        completionStatus: 'Completed', completionPct: 100,
        playerMode: content.playerMode,
        completedAt: new Date(), firstOpenedAt: new Date(), lastOpenedAt: new Date(),
      },
      update: { completionStatus: 'Completed', completionPct: 100, completedAt: new Date() },
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ADMIN_UNLOCK_CONTENT', module: 'Content', referenceId: contentId, newValue: { employeeId } });
    res.json({ ok: true, message: 'Content unlocked for trainee.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function resetAdminPassword(req, res) {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ ok: false, message: 'Password must be at least 6 characters.' });
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);
    await prisma.adminUserMaster.update({
      where: { adminId: req.userId },
      data: { passwordHash, salt, failedAttempts: 0, locked: false },
    });
    await deleteAllSessions(req.userId);
    const newToken = await createSession(req.userId, 'admin');
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_OWN_PASSWORD', module: 'Auth' });
    res.json({ ok: true, token: newToken, message: 'Password updated.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function deleteBatch(req, res) {
  try {
    const { batchNo } = req.params;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    // SOFT-DELETE ONLY — all trainee records, progress, logs, assessments and reports
    // are preserved for compliance and reporting. Only status flags are changed.
    //
    // What changes:
    //   batchMaster.batchStatus  → 'Deleted'
    //   traineeMaster.status     → 'Inactive'  (NOT deleted — reports still work)
    //   userMaster.active        → false        (login disabled, account NOT deleted)
    //
    // What is NOT touched:
    //   contentProgress, assessmentResult, trainingRiskLog, certificationEvidence,
    //   onboardingLog, attendanceInference, traineeQueryLog, pendingActivityLog —
    //   all remain fully accessible in Reports and Compliance exports.

    const empIds = (await prisma.traineeMaster.findMany({
      where: { batchNo },
      select: { employeeId: true },
    })).map(t => t.employeeId);

    // Disable login accounts — trainees can no longer log in
    if (empIds.length > 0) {
      await prisma.userMaster.updateMany({
        where: { employeeId: { in: empIds } },
        data: { active: false },
      });
      // Mark trainees as Inactive — they still appear in all reports
      await prisma.traineeMaster.updateMany({
        where: { batchNo },
        data: { status: 'Inactive' },
      });
    }

    // Mark batch as Deleted — it disappears from active views but reports still show it
    await prisma.batchMaster.update({
      where: { batchNo },
      data: { batchStatus: 'Deleted' },
    });

    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'DELETE_BATCH',
      module: 'Batch',
      referenceId: batchNo,
      newValue: { traineeCount: empIds.length, note: 'Soft-delete — all records preserved' },
    });
    res.json({
      ok: true,
      message: `Batch ${batchNo} removed from active view. ${empIds.length} trainee account(s) deactivated. All records and reports preserved.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ── Branch Management ─────────────────────────────────────────────────────────

export async function listBranches(req, res) {
  try {
    // Aggregate branch data from batches and coordinators
    const [batches, coords] = await Promise.all([
      prisma.batchMaster.findMany({
        where: { branch: { not: null } },
        select: { branch: true, process: true, lob: true, batchStatus: true },
      }),
      prisma.roleAccessMatrix.findMany({
        where: { active: true, branch: { not: null } },
        select: { loginId: true, name: true, branch: true, process: true, lob: true, role: true, portalAccess: true },
      }),
    ]);

    // Build branch summary
    const branchMap = {};
    batches.forEach(b => {
      const br = (b.branch || '').trim();
      if (!br) return;
      if (!branchMap[br]) branchMap[br] = { branch: br, processes: new Set(), activeBatches: 0, totalBatches: 0, users: [] };
      if (b.process) branchMap[br].processes.add(b.process);
      branchMap[br].totalBatches++;
      if (b.batchStatus === 'Active') branchMap[br].activeBatches++;
    });
    coords.forEach(c => {
      const br = (c.branch || '').trim();
      if (!br) return;
      if (!branchMap[br]) branchMap[br] = { branch: br, processes: new Set(), activeBatches: 0, totalBatches: 0, users: [] };
      branchMap[br].users.push({ loginId: c.loginId, name: c.name, role: c.role, process: c.process });
    });

    const data = Object.values(branchMap).map(b => ({
      ...b,
      processes: [...b.processes],
    })).sort((a, b) => a.branch.localeCompare(b.branch));

    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getBranchDetail(req, res) {
  try {
    const { branch } = req.params;
    const [batches, users, trainees] = await Promise.all([
      prisma.batchMaster.findMany({
        where: { branch },
        orderBy: { createdAt: 'desc' },
        select: { batchNo: true, batchName: true, process: true, lob: true, batchStatus: true, startDate: true, totalTrainees: true, coordinatorName: true },
      }),
      prisma.roleAccessMatrix.findMany({
        where: { branch, active: true },
        select: { loginId: true, name: true, role: true, process: true, lob: true, portalAccess: true },
        orderBy: { name: 'asc' },
      }),
      prisma.traineeMaster.findMany({
        where: { branch, status: 'Active' },
        select: { employeeId: true, traineeName: true, batchNo: true, process: true, courseCompletionPct: true, riskStatus: true },
        take: 100,
        orderBy: { traineeName: 'asc' },
      }),
    ]);
    res.json({ ok: true, data: { branch, batches, users, trainees } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Portal User Management ────────────────────────────────────────────────────

export async function listPortalUsers(req, res) {
  try {
    const [coordUsers, adminUsers] = await Promise.all([
      prisma.roleAccessMatrix.findMany({
        where: { active: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      }),
      prisma.adminUserMaster.findMany({
        where: { active: true },
        orderBy: { adminName: 'asc' },
        select: { id: true, adminId: true, adminName: true, role: true, branch: true, active: true, locked: true, failedAttempts: true, lastLogin: true, createdAt: true },
      }),
    ]);
    // Normalise admin_user_master rows to the same shape as role_access_matrix
    const adminRows = adminUsers.map(a => ({
      id: a.id,
      loginId: a.adminId,
      name: a.adminName,
      role: 'Admin',
      portalAccess: 'Admin',
      branch: a.branch || null,
      active: a.active,
      lastLogin: a.lastLogin,
      createdAt: a.createdAt,
      _source: 'admin_user_master',
    }));
    res.json({ ok: true, data: [...adminRows, ...coordUsers] });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createPortalUser(req, res) {
  try {
    const { loginId, pin, name, role, portalAccess, branch, process, lob, designation, department, employeeCode,
      canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard } = req.body;

    if (!loginId || !pin || !name) return res.status(400).json({ ok: false, message: 'Login ID, PIN/Password and Name are required.' });
    if (pin.length < 4) return res.status(400).json({ ok: false, message: 'PIN/Password must be at least 4 characters.' });

    const cleanLoginId = loginId.trim();

    // Cross-table uniqueness check — loginId must be unique across BOTH tables
    const [existingCoord, existingAdmin] = await Promise.all([
      prisma.roleAccessMatrix.findFirst({ where: { loginId: cleanLoginId } }),
      prisma.adminUserMaster.findFirst({ where: { adminId: cleanLoginId } }),
    ]);
    if (existingCoord || existingAdmin) return res.status(400).json({ ok: false, message: 'Login ID already exists.' });

    // Admin role → create in admin_user_master (logs into Admin portal with password)
    const normalizedRole = (role || '').trim();
    if (normalizedRole === 'Admin') {
      const salt = generateSalt();
      const passwordHash = await hashPassword(pin, salt);
      const admin = await prisma.adminUserMaster.create({
        data: { adminId: cleanLoginId, adminName: name.trim(), passwordHash, salt, role: 'Admin', active: true, branch: branch || null },
      });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_ADMIN_USER', module: 'Users', referenceId: cleanLoginId });
      return res.json({ ok: true, data: { loginId: admin.adminId, name: admin.adminName, role: 'Admin' }, message: `Admin ${cleanLoginId} created. They can log into the Admin portal with this password.` });
    }

    // All other roles → create in role_access_matrix (logs into Coordinator portal with PIN)

    const hashedPin = await hashCredential(pin);
    const user = await prisma.roleAccessMatrix.create({
      data: {
        loginId, pin: hashedPin, name,
        role: role || 'Coordinator',
        portalAccess: portalAccess || role || 'Coordinator',
        branch: branch || null, process: process || null, lob: lob || null,
        designation: designation || null, department: department || null, employeeCode: employeeCode || null,
        active: true,
        canCreateBatch: !!canCreateBatch, canOnboardTrainee: !!canOnboardTrainee,
        canUploadLmsReport: !!canUploadLmsReport, canOverrideAttendance: !!canOverrideAttendance,
        canCloseBatch: !!canCloseBatch, canViewManagementDashboard: !!canViewManagementDashboard,
      },
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_PORTAL_USER', module: 'Users', referenceId: loginId });
    res.json({ ok: true, data: user, message: `User ${loginId} created.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function updatePortalUser(req, res) {
  try {
    const { id } = req.params;
    const { name, pin, role, portalAccess, branch, process, lob,
      canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard, active,
      email, mobile, designation, department, employeeCode } = req.body;

    // Check if this is an admin_user_master record
    const adminRecord = await prisma.adminUserMaster.findUnique({ where: { id } });
    if (adminRecord) {
      const data = {};
      if (name !== undefined) data.adminName = name;
      if (branch !== undefined) data.branch = branch || null;
      if (active !== undefined) data.active = !!active;
      if (pin !== undefined && pin.length >= 4) {
        // generateSalt and hashPassword are statically imported at top of file
        const salt = generateSalt();
        data.passwordHash = await hashPassword(pin, salt);
        data.salt = salt;
        data.failedAttempts = 0;
        data.locked = false;
      }
      const updated = await prisma.adminUserMaster.update({ where: { id }, data });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_ADMIN_USER', module: 'Users', referenceId: updated.adminId });
      return res.json({ ok: true, data: { loginId: updated.adminId, name: updated.adminName, role: 'Admin' } });
    }

    const user = await prisma.roleAccessMatrix.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(pin !== undefined && { pin: await hashCredential(pin) }),
        ...(role !== undefined && { role }),
        ...(portalAccess !== undefined && { portalAccess }),
        ...(branch !== undefined && { branch: branch || null }),
        ...(process !== undefined && { process: process || null }),
        ...(lob !== undefined && { lob: lob || null }),
        ...(designation !== undefined && { designation: designation || null }),
        ...(department !== undefined && { department: department || null }),
        ...(employeeCode !== undefined && { employeeCode: employeeCode || null }),
        ...(email !== undefined && { email: email || null }),
        ...(mobile !== undefined && { mobile: mobile || null }),
        ...(canCreateBatch !== undefined && { canCreateBatch: !!canCreateBatch }),
        ...(canOnboardTrainee !== undefined && { canOnboardTrainee: !!canOnboardTrainee }),
        ...(canUploadLmsReport !== undefined && { canUploadLmsReport: !!canUploadLmsReport }),
        ...(canOverrideAttendance !== undefined && { canOverrideAttendance: !!canOverrideAttendance }),
        ...(canCloseBatch !== undefined && { canCloseBatch: !!canCloseBatch }),
        ...(canViewManagementDashboard !== undefined && { canViewManagementDashboard: !!canViewManagementDashboard }),
        ...(active !== undefined && { active: !!active }),
      },
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_PORTAL_USER', module: 'Users', referenceId: user.loginId });
    res.json({ ok: true, data: user });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

/**
 * POST /admin/portal-users/:id/change-role
 * Changes a user's role, handling cross-table migration when
 * moving between Admin (admin_user_master) and non-Admin (role_access_matrix).
 *
 * Cases:
 *  1. Non-Admin → Non-Admin:  simple role field update in role_access_matrix
 *  2. Non-Admin → Admin:      create in admin_user_master, deactivate role_access_matrix row
 *  3. Admin → Non-Admin:      create in role_access_matrix, deactivate admin_user_master row
 *  4. Admin → Admin:          no-op (already Admin)
 *
 * Requires newRole and (for cases 2 & 3) a newPin/newPassword for the target table.
 */
export async function changeUserRole(req, res) {
  try {
    const { id } = req.params;
    const { newRole, newPin } = req.body;
    if (!newRole) return res.status(400).json({ ok: false, message: 'newRole is required.' });

    const ADMIN_ROLES = ['Admin'];
    const isTargetAdmin = ADMIN_ROLES.includes(newRole);

    // Determine source record
    const adminRecord = await prisma.adminUserMaster.findUnique({ where: { id } });
    const coordRecord = adminRecord ? null : await prisma.roleAccessMatrix.findUnique({ where: { id } });

    if (!adminRecord && !coordRecord) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const loginId = adminRecord ? adminRecord.adminId : coordRecord.loginId;
    const userName = adminRecord ? adminRecord.adminName : coordRecord.name;
    const isSourceAdmin = !!adminRecord;

    // Case 1: Non-Admin → Non-Admin (simple update)
    if (!isSourceAdmin && !isTargetAdmin) {
      await prisma.roleAccessMatrix.update({
        where: { id },
        data: { role: newRole, portalAccess: newRole },
      });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CHANGE_ROLE', module: 'Users', referenceId: loginId, newValue: { from: coordRecord.role, to: newRole } });
      return res.json({ ok: true, message: `${loginId} role changed to ${newRole}.` });
    }

    // Case 4: Admin → Admin (no-op)
    if (isSourceAdmin && isTargetAdmin) {
      return res.json({ ok: true, message: `${loginId} is already Admin.` });
    }

    // Cases 2 & 3 require a new PIN/password for the target table
    if (!newPin || newPin.length < 4) {
      return res.status(400).json({ ok: false, message: `A new ${isTargetAdmin ? 'password' : 'PIN'} (min 4 chars) is required when changing to ${newRole}.` });
    }

    if (!isSourceAdmin && isTargetAdmin) {
      // Case 2: Coordinator → Admin
      // Check no admin account already exists with this loginId
      const existingAdmin = await prisma.adminUserMaster.findFirst({ where: { adminId: loginId } });
      if (existingAdmin) {
        return res.status(400).json({ ok: false, message: `An Admin account with login ID "${loginId}" already exists.` });
      }
      const salt = generateSalt();
      const passwordHash = await hashPassword(newPin, salt);
      await prisma.$transaction([
        prisma.adminUserMaster.create({
          data: { adminId: loginId, adminName: userName, passwordHash, salt, role: 'Admin', active: true },
        }),
        prisma.roleAccessMatrix.update({
          where: { id },
          data: { active: false },
        }),
      ]);
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CHANGE_ROLE', module: 'Users', referenceId: loginId, newValue: { from: coordRecord.role, to: 'Admin', note: 'Migrated to admin_user_master' } });
      return res.json({ ok: true, message: `${loginId} promoted to Admin. They can now log in via the Admin portal with the new password.` });
    }

    // Case 3: Admin → Non-Admin (Coordinator / Manager / Trainer etc.)
    const existingCoord = await prisma.roleAccessMatrix.findFirst({ where: { loginId } });
    if (existingCoord) {
      // Reactivate if previously deactivated
      await prisma.roleAccessMatrix.update({
        where: { id: existingCoord.id },
        data: { active: true, role: newRole, portalAccess: newRole, pin: newPin },
      });
    } else {
      await prisma.roleAccessMatrix.create({
        data: { loginId, name: userName, pin: newPin, role: newRole, portalAccess: newRole, active: true },
      });
    }
    await prisma.adminUserMaster.update({ where: { id }, data: { active: false } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CHANGE_ROLE', module: 'Users', referenceId: loginId, newValue: { from: 'Admin', to: newRole, note: 'Migrated to role_access_matrix' } });
    return res.json({ ok: true, message: `${loginId} changed to ${newRole}. They can now log in via the Coordinator portal with the new PIN.` });
  } catch (err) {
    console.error('[changeUserRole]', err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function deletePortalUser(req, res) {
  try {
    const { id } = req.params;

    // Check if this is an admin_user_master record
    const adminRecord = await prisma.adminUserMaster.findUnique({ where: { id } });
    if (adminRecord) {
      await prisma.adminUserMaster.update({ where: { id }, data: { active: false } });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DEACTIVATE_ADMIN_USER', module: 'Users', referenceId: adminRecord.adminId });
      return res.json({ ok: true, message: 'Admin user deactivated.' });
    }

    await prisma.roleAccessMatrix.update({ where: { id }, data: { active: false } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DEACTIVATE_PORTAL_USER', module: 'Users', referenceId: id });
    res.json({ ok: true, message: 'User deactivated.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function resetPortalUserPin(req, res) {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    if (!pin || pin.length < 4) return res.status(400).json({ ok: false, message: 'PIN/Password must be at least 4 characters.' });

    // Check if this is an admin_user_master record
    const adminRecord = await prisma.adminUserMaster.findUnique({ where: { id } });
    if (adminRecord) {
      const salt = generateSalt();
      const passwordHash = await hashPassword(pin, salt);
      await prisma.adminUserMaster.update({ where: { id }, data: { passwordHash, salt, failedAttempts: 0, locked: false } });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_ADMIN_PASSWORD', module: 'Users', referenceId: adminRecord.adminId });
      return res.json({ ok: true, message: 'Admin password reset.' });
    }

    const user = await prisma.roleAccessMatrix.update({ where: { id }, data: { pin: await hashCredential(pin), failedAttempts: 0, locked: false } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_PORTAL_USER_PIN', module: 'Users', referenceId: user.loginId });
    res.json({ ok: true, message: 'PIN reset.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function bulkCreatePortalUsers(req, res) {
  try {
    const { users } = req.body;
    if (!Array.isArray(users) || users.length === 0)
      return res.status(400).json({ ok: false, message: 'No users provided.' });

    const results = [];
    for (const u of users) {
      const { loginId, pin, name, role, branch, process, lob, designation, department, employeeCode,
        canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard } = u;
      if (!loginId || !pin || !name) { results.push({ loginId, ok: false, message: 'Login ID, PIN and Name required.' }); continue; }
      if (String(pin).length < 4) { results.push({ loginId, ok: false, message: 'PIN min 4 chars.' }); continue; }
      try {
        // Cross-table uniqueness check
        const [existingC, existingA] = await Promise.all([
          prisma.roleAccessMatrix.findFirst({ where: { loginId } }),
          prisma.adminUserMaster.findFirst({ where: { adminId: loginId } }),
        ]);
        if (existingC || existingA) { results.push({ loginId, ok: false, message: 'Login ID already exists.' }); continue; }

        if ((role || '').trim() === 'Admin') {
          const salt = generateSalt();
          const passwordHash = await hashPassword(String(pin), salt);
          await prisma.adminUserMaster.create({ data: { adminId: loginId, adminName: name, passwordHash, salt, role: 'Admin', active: true } });
        } else {
          await prisma.roleAccessMatrix.create({
            data: {
              loginId, pin: await hashCredential(String(pin)), name,
              role: role || 'Coordinator', portalAccess: role || 'Coordinator',
              branch: branch || null, process: process || null, lob: lob || null,
              designation: designation || null, department: department || null, employeeCode: employeeCode || null,
              active: true,
              canCreateBatch: !!canCreateBatch, canOnboardTrainee: !!canOnboardTrainee,
              canUploadLmsReport: !!canUploadLmsReport, canOverrideAttendance: !!canOverrideAttendance,
              canCloseBatch: !!canCloseBatch, canViewManagementDashboard: !!canViewManagementDashboard,
            },
          });
        }
        results.push({ loginId, ok: true });
      } catch (err) {
        results.push({ loginId, ok: false, message: err.message });
      }
    }
    const success = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);
    res.json({ ok: true, data: { success, failed: failed.length, errors: failed }, message: `${success} created, ${failed.length} failed.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ── Branch Master ─────────────────────────────────────────────────────────────
export async function listBranchMaster(req, res) {
  try {
    const branches = await prisma.branchMaster.findMany({ where: { active: true }, orderBy: { branchName: 'asc' } });
    res.json({ ok: true, data: branches });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function createBranchMaster(req, res) {
  try {
    const { branchName, branchCode, city, state } = req.body;
    if (!branchName) return res.status(400).json({ ok: false, message: 'Branch name required.' });
    const b = await prisma.branchMaster.create({ data: { branchName, branchCode: branchCode || null, city: city || null, state: state || null } });
    res.json({ ok: true, data: b });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function updateBranchMaster(req, res) {
  try {
    const { id } = req.params;
    const { branchName, branchCode, city, state } = req.body;
    const b = await prisma.branchMaster.update({ where: { id }, data: { branchName, branchCode: branchCode || null, city: city || null, state: state || null } });
    res.json({ ok: true, data: b });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function deleteBranchMaster(req, res) {
  try {
    const { id } = req.params;
    await prisma.branchMaster.update({ where: { id }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

// ── Designation Master ────────────────────────────────────────────────────────
export async function listDesignations(req, res) {
  try {
    const data = await prisma.designationMaster.findMany({ where: { active: true }, orderBy: { title: 'asc' } });
    res.json({ ok: true, data });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function createDesignation(req, res) {
  try {
    const { title, department } = req.body;
    if (!title) return res.status(400).json({ ok: false, message: 'Title required.' });
    const d = await prisma.designationMaster.create({ data: { title, department: department || null } });
    res.json({ ok: true, data: d });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function updateDesignation(req, res) {
  try {
    const { id } = req.params;
    const { title, department } = req.body;
    const d = await prisma.designationMaster.update({ where: { id }, data: { title, department: department || null } });
    res.json({ ok: true, data: d });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function deleteDesignation(req, res) {
  try {
    const { id } = req.params;
    await prisma.designationMaster.update({ where: { id }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

// ── Department Master ─────────────────────────────────────────────────────────
export async function listDepartments(req, res) {
  try {
    const data = await prisma.departmentMaster.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    res.json({ ok: true, data });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function createDepartment(req, res) {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ ok: false, message: 'Department name required.' });
    const d = await prisma.departmentMaster.create({ data: { name } });
    res.json({ ok: true, data: d });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function updateDepartment(req, res) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const d = await prisma.departmentMaster.update({ where: { id }, data: { name } });
    res.json({ ok: true, data: d });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

export async function deleteDepartment(req, res) {
  try {
    const { id } = req.params;
    await prisma.departmentMaster.update({ where: { id }, data: { active: false } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
}

// ── Admin: Map single trainee's emp ID ─────────────────────────────────────
export async function adminMapSingleEmpId(req, res) {
  try {
    const { employeeId } = req.params;
    const { permanentEmpId } = req.body;
    if (!permanentEmpId?.trim()) return res.status(400).json({ ok: false, message: 'permanentEmpId is required.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });
    if (!trainee.mobile) return res.status(400).json({ ok: false, message: 'Trainee has no mobile number — cannot map without bridge key.' });

    const result = await mapEmployeeId({
      mobile: trainee.mobile,
      permanentEmpId: permanentEmpId.trim(),
      triggeredBy: req.userId,
      triggeredByRole: 'Admin',
    });

    if (!result.ok) return res.status(400).json({ ok: false, message: result.error });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Admin: Bulk map emp IDs from CSV upload ────────────────────────────────
export async function adminBulkMapEmpIds(req, res) {
  try {
    const { mappings } = req.body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ ok: false, message: 'No mappings provided.' });
    }

    const results = [];
    for (const m of mappings) {
      const result = await mapEmployeeId({
        mobile: m.mobile,
        permanentEmpId: m.permanentEmpId,
        triggeredBy: req.userId,
        triggeredByRole: 'Admin',
      });
      results.push({ mobile: m.mobile, permanentEmpId: m.permanentEmpId, ...result });
    }

    const mapped = results.filter(r => r.ok).length;
    const errors = results.filter(r => !r.ok);
    res.json({ ok: true, data: { mapped, errors: errors.length, results } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Admin: List trainees with TEMP emp IDs ─────────────────────────────────
export async function getTempTrainees(req, res) {
  try {
    const { batchNo } = req.query;
    const where = { empIdType: 'TEMP' };
    if (batchNo) where.batchNo = batchNo;

    const trainees = await prisma.traineeMaster.findMany({
      where,
      orderBy: [{ batchNo: 'asc' }, { employeeId: 'asc' }],
      select: {
        employeeId: true, traineeName: true, mobile: true,
        batchNo: true, branch: true, process: true,
        empIdType: true, permanentEmpId: true, empIdMappedAt: true,
      },
    });
    res.json({ ok: true, data: trainees });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Batch Content Progress ────────────────────────────────────────────────────
// Returns per-classroom breakdown. Shape:
//   { totalTrainees, classrooms: [{ classroomId, classroomName, modules, assessments }] }
// For backward compat, top-level modules/assessments mirror the first classroom.
async function buildClassroomProgress(classroomId, classroomName, employeeIds) {
  const totalTrainees = employeeIds.length;
  const [modules, contents, progressRows, assessments, results] = await Promise.all([
    prisma.moduleMaster.findMany({ where: { classroomId, active: true }, orderBy: { dayNo: 'asc' }, select: { moduleId: true, moduleTitle: true, dayNo: true } }),
    prisma.contentMaster.findMany({ where: { module: { classroomId }, active: true }, orderBy: { contentOrder: 'asc' }, select: { contentId: true, contentTitle: true, contentType: true, moduleId: true, estimatedMins: true, completionRulePct: true } }),
    prisma.contentProgress.findMany({ where: { employeeId: { in: employeeIds }, classroomId }, select: { employeeId: true, contentId: true, opened: true, completionPct: true, completionStatus: true } }),
    prisma.assessmentMaster.findMany({ where: { classroomId, active: true }, orderBy: { sortOrder: 'asc' }, select: { assessmentId: true, assessmentName: true, moduleId: true, dayNo: true, passingPct: true } }),
    prisma.assessmentResult.findMany({ where: { employeeId: { in: employeeIds }, classroomId }, select: { employeeId: true, assessmentId: true, bestPercentage: true, result: true } }),
  ]);

  const progressMap = {};
  for (const p of progressRows) {
    if (!progressMap[p.contentId]) progressMap[p.contentId] = {};
    progressMap[p.contentId][p.employeeId] = p;
  }
  const resultMap = {};
  for (const r of results) {
    if (!resultMap[r.assessmentId]) resultMap[r.assessmentId] = {};
    resultMap[r.assessmentId][r.employeeId] = r;
  }
  const moduleMap = {};
  for (const m of modules) moduleMap[m.moduleId] = m;

  const contentsByModule = {};
  for (const c of contents) {
    if (!contentsByModule[c.moduleId]) contentsByModule[c.moduleId] = [];
    const byEmp = progressMap[c.contentId] || {};
    const progressArr = Object.values(byEmp);
    const completedCount = progressArr.filter(p => p.completionStatus === 'Completed').length;
    const openedCount   = progressArr.filter(p => p.opened).length;
    const avgCompletionPct = progressArr.length > 0
      ? Math.round(progressArr.reduce((s, p) => s + (p.completionPct || 0), 0) / progressArr.length)
      : 0;
    contentsByModule[c.moduleId].push({
      contentId: c.contentId, contentTitle: c.contentTitle, contentType: c.contentType,
      estimatedMins: c.estimatedMins, completionRulePct: c.completionRulePct,
      completedCount, openedCount,
      notStartedCount: totalTrainees - openedCount,
      completionRate: totalTrainees > 0 ? Math.round(completedCount / totalTrainees * 100) : 0,
      avgCompletionPct,
    });
  }

  const modulesOut = modules.map(m => ({
    moduleId: m.moduleId, moduleTitle: m.moduleTitle, dayNo: m.dayNo,
    contents: contentsByModule[m.moduleId] || [],
  }));

  const assessmentsOut = assessments.map(a => {
    const byEmp = resultMap[a.assessmentId] || {};
    const attempted = Object.values(byEmp);
    const passedCount = attempted.filter(r => r.result === 'Pass').length;
    const avgBestScore = attempted.length > 0
      ? Math.round(attempted.reduce((s, r) => s + (r.bestPercentage || 0), 0) / attempted.length)
      : 0;
    const mod = moduleMap[a.moduleId] || {};
    return {
      assessmentId: a.assessmentId, assessmentName: a.assessmentName,
      moduleId: a.moduleId, moduleTitle: mod.moduleTitle || null,
      dayNo: a.dayNo ?? mod.dayNo ?? null, passingPct: a.passingPct,
      attemptedCount: attempted.length, passedCount,
      notAttemptedCount: totalTrainees - attempted.length,
      attemptRate: totalTrainees > 0 ? Math.round(attempted.length / totalTrainees * 100) : 0,
      passRate:    totalTrainees > 0 ? Math.round(passedCount     / totalTrainees * 100) : 0,
      avgBestScore,
    };
  });

  return { classroomId, classroomName, modules: modulesOut, assessments: assessmentsOut };
}

export async function getBatchContentProgress(req, res) {
  try {
    const { batchNo } = req.params;

    const batch = await prisma.batchMaster.findUnique({ where: { batchNo }, select: { classroomId: true } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    // Collect all active classrooms for this batch
    const maps = await prisma.batchClassroomMap.findMany({
      where: { batchNo, active: true },
      orderBy: { assignedAt: 'asc' },
      select: { classroomId: true, classroomName: true },
    });
    // Fall back to denormalized field for old batches
    let classroomList = maps;
    if (classroomList.length === 0 && batch.classroomId) {
      classroomList = [{ classroomId: batch.classroomId, classroomName: null }];
    }
    if (classroomList.length === 0) return res.json({ ok: true, data: null });

    const trainees = await prisma.traineeMaster.findMany({ where: { batchNo }, select: { employeeId: true } });
    const employeeIds = trainees.map(t => t.employeeId);
    const totalTrainees = employeeIds.length;

    if (totalTrainees === 0) {
      return res.json({ ok: true, data: { totalTrainees: 0, classrooms: classroomList.map(c => ({ ...c, modules: [], assessments: [] })), modules: [], assessments: [] } });
    }

    const classroomsOut = await Promise.all(
      classroomList.map(c => buildClassroomProgress(c.classroomId, c.classroomName, employeeIds))
    );

    // Top-level modules/assessments mirror first classroom for backward compat
    const first = classroomsOut[0];
    res.json({ ok: true, data: {
      totalTrainees,
      classrooms: classroomsOut,
      modules: first.modules,
      assessments: first.assessments,
    } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Audit Log Viewer ──────────────────────────────────────────────────────────
export async function listAuditLogs(req, res) {
  try {
    const { action, module, userIdentity, userRole, status, page = 1, limit = 50 } = req.query;
    const where = {};
    if (action) where.action = { contains: action };
    if (module) where.module = { contains: module };
    if (userIdentity) where.userIdentity = { contains: userIdentity };
    if (userRole) where.userRole = { contains: userRole };
    if (status) where.status = status;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = Math.min(parseInt(limit, 10), 200);
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ ok: true, data, total, page: parseInt(page, 10), totalPages: Math.ceil(total / take) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getAuditLogDetail(req, res) {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
    if (!log) return res.status(404).json({ ok: false, message: 'Log not found.' });
    res.json({ ok: true, data: log });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Certificate Generator ─────────────────────────────────────────────────────
export async function generateCertificate(req, res) {
  try {
    const { employeeId } = req.params;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });
    if (trainee.certificationStatus !== 'Certified' && trainee.certificationStatus !== 'HandedOver') {
      return res.status(400).json({ ok: false, message: 'Trainee is not certified.' });
    }
    const batch = trainee.batchNo ? await prisma.batchMaster.findUnique({ where: { batchNo: trainee.batchNo } }) : null;
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate - ${esc(trainee.traineeName)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 297mm; height: 210mm; display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: #f0f2f5; }
  .cert { width: 275mm; height: 185mm; background: #fff; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.15); padding: 40px 50px; position: relative;
    border: 6px double #1a56db; display: flex; flex-direction: column; justify-content: center; }
  .cert h1 { font-size: 32px; color: #1a56db; text-align: center; letter-spacing: 2px; margin-bottom: 8px; }
  .cert .subtitle { text-align: center; font-size: 14px; color: #666; margin-bottom: 24px; }
  .cert .presented { text-align: center; font-size: 15px; color: #444; margin-bottom: 6px; }
  .cert .name { text-align: center; font-size: 38px; font-weight: 800; color: #111; margin: 8px 0; }
  .cert .for-text { text-align: center; font-size: 15px; color: #444; line-height: 1.7; }
  .cert .details { text-align: center; font-size: 14px; color: #555; margin-top: 16px; }
  .cert .footer { display: flex; justify-content: space-between; margin-top: 30px; padding-top: 16px; border-top: 2px solid #e5e7eb; font-size: 12px; color: #888; }
  .cert .stamp { position: absolute; bottom: 50px; right: 70px; width: 80px; height: 80px;
    border: 2px solid #1a56db; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #1a56db; font-weight: 700; text-align: center; transform: rotate(-15deg); }
</style></head><body>
<div class="cert">
  <h1>MCN LMS</h1>
  <div class="subtitle">Learning Management System</div>
  <div class="presented">This is to certify that</div>
  <div class="name">${esc(trainee.traineeName)}</div>
  <div class="for-text">has successfully completed the training program<br>
    ${trainee.process ? `Process: <b>${esc(trainee.process)}</b>` : ''}${trainee.lob ? ` &middot; LOB: <b>${esc(trainee.lob)}</b>` : ''}<br>
    ${batch ? `Batch: <b>${esc(batch.batchName || batch.batchNo)}</b>` : ''}
  </div>
  <div class="details">Certification Status: <b>${esc(trainee.certificationStatus)}</b></div>
  <div class="footer"><span>Certificate ID: MCN-${esc(employeeId)}-${Date.now().toString(36).toUpperCase()}</span><span>Date: ${esc(today)}</span></div>
  <div class="stamp">MCN LMS<br>VERIFIED</div>
</div></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Bulk Trainee Import ───────────────────────────────────────────────────────
export async function bulkImportPreview(req, res) {
  try {
    const { records, skipDuplicates } = req.body;
    if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ ok: false, message: 'records[] required.' });
    if (records.length > 500) return res.status(400).json({ ok: false, message: 'Max 500 records per batch.' });
    if (req.userBranch) {
      for (const r of records) { r.branch = req.userBranch; }
    }
    const employeeIds = records.map(r => r.employeeId).filter(Boolean);
    const existing = employeeIds.length ? await prisma.traineeMaster.findMany({
      where: { employeeId: { in: employeeIds }, status: { not: 'Deleted' } },
      select: { employeeId: true },
    }) : [];
    const existingSet = new Set(existing.map(e => e.employeeId));
    const lmsIds = records.map(r => r.lmsId).filter(Boolean);
    const existingLms = lmsIds.length ? await prisma.traineeMaster.findMany({
      where: { lmsId: { in: lmsIds } },
      select: { lmsId: true },
    }) : [];
    const existingLmsSet = new Set(existingLms.map(e => e.lmsId));
    const preview = records.map(r => ({
      ...r,
      _duplicate: existingSet.has(r.employeeId) || (r.lmsId && existingLmsSet.has(r.lmsId)),
      _errors: [],
    }));
    res.json({ ok: true, data: preview, existingCount: existingSet.size });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function bulkImportExecute(req, res) {
  try {
    const { records, skipDuplicates } = req.body;
    if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ ok: false, message: 'records[] required.' });
    if (records.length > 500) return res.status(400).json({ ok: false, message: 'Max 500 records per batch.' });
    if (req.userBranch) {
      for (const r of records) { r.branch = req.userBranch; }
    }
    const created = [];
    const skipped = [];
    const errors = [];
    const now = Date.now();
    for (const r of records) {
      try {
        const employeeId = r.employeeId || `LMS-${now}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        if (skipDuplicates) {
          const dup = await prisma.traineeMaster.findFirst({ where: { employeeId, status: { not: 'Deleted' } } });
          if (dup) { skipped.push(employeeId); continue; }
        }
        const lmsId = r.lmsId || `LMS${String(created.length + 1).padStart(6, '0')}`;
        const tempPassword = r.mobile ? String(r.mobile).replace(/\D/g, '').slice(-4) : '1234';
        const salt = generateSalt();
        const passwordHash = await hashPassword(tempPassword, salt);
        const traineePayload = {
          employeeId, lmsId, traineeName: r.traineeName || r.name,
          email: r.email, mobile: r.mobile ? String(r.mobile).replace(/\D/g, '').slice(-10) : null,
          batchNo: r.batchNo, branch: r.branch, process: r.process, lob: r.lob,
          classroomId: r.classroomId, classroomName: r.classroomName,
          status: 'Active', source: 'BulkImport', empIdType: 'PERMANENT', createdBy: req.userId,
        };
        await prisma.$transaction(async tx => {
          await tx.traineeMaster.create({ data: traineePayload });
          await tx.userMaster.create({ data: { employeeId, passwordHash, salt, traineeName: r.traineeName || r.name, email: r.email, mobile: r.mobile ? String(r.mobile).replace(/\D/g, '').slice(-10) : null, batchNo: r.batchNo, branch: r.branch, process: r.process, lob: r.lob, classroomId: r.classroomId, active: true, forcePasswordReset: true } });
          if (r.classroomId) {
            await tx.traineeClassroomMap.upsert({
              where: { employeeId_classroomId: { employeeId, classroomId: r.classroomId } },
              create: { employeeId, classroomId: r.classroomId, batchNo: r.batchNo, assignedBy: req.userId },
              update: {},
            });
          }
        });
        created.push(employeeId);
      } catch (e) {
        errors.push({ record: r.employeeId || r.traineeName, error: e.message });
      }
    }
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'BULK_IMPORT_TRAINEES', module: 'Accounts', newValue: { created: created.length, skipped: skipped.length, errors: errors.length } });
    res.json({ ok: true, created: created.length, skipped: skipped.length, errors, message: `${created.length} trainee(s) created.${skipped.length ? ` ${skipped.length} skipped.` : ''}${errors.length ? ` ${errors.length} error(s).` : ''}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}


// ── Broadcast assignment management ───────────────────────────────────────────
// One broadcast writes a row per recipient, and every row from that broadcast
// shares the "bk-<timestamp>" prefix of its id. Grouping on that prefix lets a
// broadcast be reviewed and withdrawn as a single unit.
export async function listBroadcastAssignments(req, res) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT SUBSTRING_INDEX(id, '-', 2) AS batchKey,
              module_id AS moduleId, module_name AS moduleName,
              broadcast_title AS broadcastTitle, assignment_type AS assignmentType,
              assigned_by AS assignedBy, assigned_to_type AS assignedToType,
              MIN(created_at) AS createdAt, MAX(due_date) AS dueDate,
              COUNT(*) AS recipients, SUM(active) AS activeRecipients
         FROM assigned_modules
        GROUP BY batchKey, module_id, module_name, broadcast_title,
                 assignment_type, assigned_by, assigned_to_type
        ORDER BY MIN(created_at) DESC
        LIMIT 200`,
    );
    const data = (rows || []).map(row => ({
      ...row,
      recipients: Number(row.recipients || 0),
      activeRecipients: Number(row.activeRecipients || 0),
    }));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[BROADCAST] list failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function withdrawBroadcastAssignment(req, res) {
  try {
    const batchKey = String(req.params.batchKey || '').trim();
    // Only ever match a whole broadcast key, never an arbitrary LIKE pattern.
    if (!/^bk-[0-9]+$/.test(batchKey)) {
      return res.status(400).json({ ok: false, message: 'That broadcast reference is not valid.' });
    }
    const withdrawn = await prisma.$executeRawUnsafe(
      'UPDATE assigned_modules SET active = 0 WHERE active = 1 AND id LIKE ?',
      batchKey + '-%',
    );
    if (!Number(withdrawn)) {
      return res.status(404).json({ ok: false, message: 'That broadcast is already withdrawn or no longer exists.' });
    }
    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'WITHDRAW_BROADCAST',
      module: 'Broadcast',
      referenceId: batchKey,
      newValue: { recipientsWithdrawn: Number(withdrawn) },
    });
    return res.json({
      ok: true,
      message: 'Withdrawn from ' + Number(withdrawn) + ' learners.',
      data: { withdrawn: Number(withdrawn) },
    });
  } catch (err) {
    console.error('[BROADCAST] withdraw failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}


// ── Batch classrooms ──────────────────────────────────────────────────────────
// batch_master.classroomId stays the primary classroom and still drives the
// learner dashboard. batch_classroom_map holds every classroom attached to the
// batch, and each trainee is enrolled into all of them through
// trainee_classroom_map so they can actually open that content.
async function attachBatchClassrooms(batchNo, classroomIds, assignedBy) {
  const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
  if (!batch) return { attached: [], unknown: classroomIds };

  const classrooms = await prisma.classroomMaster.findMany({
    where: { classroomId: { in: classroomIds }, active: true },
  });
  const found = new Set(classrooms.map(c => c.classroomId));
  const trainees = await prisma.traineeMaster.findMany({ where: { batchNo }, select: { employeeId: true } });

  for (const classroom of classrooms) {
    const data = {
      batchName: batch.batchName,
      branch: batch.branch,
      process: batch.process,
      lob: batch.lob,
      classroomId: classroom.classroomId,
      classroomName: classroom.classroomName,
      active: true,
      assignedBy,
    };
    const existing = await prisma.batchClassroomMap.findFirst({
      where: { batchNo, classroomId: classroom.classroomId },
    });
    if (existing) await prisma.batchClassroomMap.update({ where: { id: existing.id }, data });
    else await prisma.batchClassroomMap.create({ data: { batchNo, ...data } });

    for (const trainee of trainees) {
      await prisma.traineeClassroomMap.upsert({
        where: { employeeId_classroomId: { employeeId: trainee.employeeId, classroomId: classroom.classroomId } },
        create: { employeeId: trainee.employeeId, classroomId: classroom.classroomId, batchNo, assignedBy },
        update: { active: true, batchNo, assignedBy },
      });
    }
  }

  return {
    attached: classrooms.map(c => ({ classroomId: c.classroomId, classroomName: c.classroomName })),
    unknown: classroomIds.filter(id => !found.has(id)),
  };
}

export async function listBatchClassrooms(req, res) {
  try {
    const batchNo = String(req.params.batchNo || '').trim();
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const rows = await prisma.batchClassroomMap.findMany({
      where: { batchNo, active: true },
      orderBy: { assignedAt: 'asc' },
    });
    const data = rows.map(row => ({
      id: row.id,
      classroomId: row.classroomId,
      classroomName: row.classroomName,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
      primary: row.classroomId === batch.classroomId,
    }));
    return res.json({ ok: true, data, primaryClassroomId: batch.classroomId || null });
  } catch (err) {
    console.error('[BATCH] list classrooms failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function addBatchClassrooms(req, res) {
  try {
    const batchNo = String(req.params.batchNo || '').trim();
    const raw = req.body?.classroomIds ?? req.body?.classroomId;
    const classroomIds = [...new Set((Array.isArray(raw) ? raw : [raw])
      .map(value => String(value || '').trim())
      .filter(Boolean))];
    if (!classroomIds.length) return res.status(400).json({ ok: false, message: 'Select at least one classroom.' });

    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const result = await attachBatchClassrooms(batchNo, classroomIds, req.userId);
    if (!result.attached.length) {
      return res.status(400).json({ ok: false, message: 'None of those classrooms exist or are active.' });
    }

    // The first classroom attached to a batch with none becomes the primary one.
    if (!batch.classroomId) {
      const first = result.attached[0];
      await prisma.batchMaster.update({
        where: { batchNo },
        data: { classroomId: first.classroomId, classroomName: first.classroomName },
      });
    }

    await audit({
      userIdentity: req.userId, userRole: 'Admin', action: 'ADD_BATCH_CLASSROOMS',
      module: 'Batches', referenceId: batchNo,
      newValue: { added: result.attached.map(c => c.classroomId), unknown: result.unknown },
    });
    return res.json({
      ok: true,
      message: result.attached.length + ' classroom(s) attached to ' + batchNo + '.',
      data: result,
    });
  } catch (err) {
    console.error('[BATCH] add classrooms failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function removeBatchClassroom(req, res) {
  try {
    const batchNo = String(req.params.batchNo || '').trim();
    const classroomId = String(req.params.classroomId || '').trim();
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    if (batch.classroomId === classroomId) {
      const others = await prisma.batchClassroomMap.count({
        where: { batchNo, active: true, classroomId: { not: classroomId } },
      });
      if (!others) {
        return res.status(400).json({
          ok: false,
          message: 'This is the only classroom on the batch. Attach another one before removing it.',
        });
      }
      return res.status(400).json({
        ok: false,
        message: 'This is the primary classroom. Make another classroom primary before removing it.',
      });
    }

    const removed = await prisma.batchClassroomMap.updateMany({
      where: { batchNo, classroomId, active: true },
      data: { active: false },
    });
    if (!removed.count) return res.status(404).json({ ok: false, message: 'That classroom is not attached to this batch.' });

    // Withdraw the learner enrolments this batch created for that classroom.
    await prisma.traineeClassroomMap.updateMany({
      where: { batchNo, classroomId },
      data: { active: false },
    });

    await audit({
      userIdentity: req.userId, userRole: 'Admin', action: 'REMOVE_BATCH_CLASSROOM',
      module: 'Batches', referenceId: batchNo, newValue: { classroomId },
    });
    return res.json({ ok: true, message: 'Classroom removed from ' + batchNo + '.' });
  } catch (err) {
    console.error('[BATCH] remove classroom failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function setPrimaryBatchClassroom(req, res) {
  try {
    const batchNo = String(req.params.batchNo || '').trim();
    const classroomId = String(req.params.classroomId || '').trim();
    const mapped = await prisma.batchClassroomMap.findFirst({ where: { batchNo, classroomId, active: true } });
    if (!mapped) return res.status(404).json({ ok: false, message: 'Attach that classroom to the batch first.' });

    await prisma.batchMaster.update({
      where: { batchNo },
      data: { classroomId, classroomName: mapped.classroomName },
    });
    await prisma.traineeMaster.updateMany({ where: { batchNo }, data: { classroomId } });
    await prisma.userMaster.updateMany({ where: { batchNo }, data: { classroomId } });

    await audit({
      userIdentity: req.userId, userRole: 'Admin', action: 'SET_PRIMARY_BATCH_CLASSROOM',
      module: 'Batches', referenceId: batchNo, newValue: { classroomId },
    });
    return res.json({ ok: true, message: mapped.classroomName + ' is now the primary classroom.' });
  } catch (err) {
    console.error('[BATCH] set primary classroom failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
