import { prisma } from '../utils/db.js';
import { hashPassword, generateSalt, generateId } from '../utils/hash.js';
import { audit } from '../utils/audit.js';
import { listDriveFolderAny } from '../services/drive.js';
import path from 'path';

export async function getAdminDashboard(req, res) {
  try {
    const [classrooms, trainees, batches, openQueries, atRisk] = await Promise.all([
      prisma.classroomMaster.count({ where: { active: true } }),
      prisma.traineeMaster.count({ where: { status: 'Active' } }),
      prisma.batchMaster.count({ where: { batchStatus: 'Active' } }),
      prisma.traineeQueryLog.count({ where: { status: 'Open' } }),
      prisma.traineeMaster.count({ where: { status: 'Active', riskStatus: { in: ['CRITICAL', 'HIGH'] } } }),
    ]);

    const activeBatches = await prisma.batchMaster.findMany({
      where: { batchStatus: 'Active' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { batchNo: true, batchName: true, coordinatorName: true, startDate: true, endDate: true, totalTrainees: true, certified: true, process: true, lob: true },
    });

    const coordinators = await prisma.batchMaster.findMany({
      where: { batchStatus: 'Active', coordinatorLoginId: { not: null } },
      select: { coordinatorLoginId: true, coordinatorName: true, batchNo: true, batchName: true },
      distinct: ['coordinatorLoginId'],
      take: 10,
    });

    const atRiskTrainees = await prisma.traineeMaster.findMany({
      where: { status: 'Active', riskStatus: { in: ['CRITICAL', 'HIGH', 'MEDIUM'] } },
      orderBy: [{ riskStatus: 'asc' }, { courseCompletionPct: 'asc' }],
      take: 20,
      select: { employeeId: true, traineeName: true, batchNo: true, riskStatus: true, courseCompletionPct: true, attendancePct: true, assessmentPassPct: true },
    });

    const riskCounts = await prisma.traineeMaster.groupBy({
      by: ['riskStatus'],
      where: { status: 'Active' },
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
    const classrooms = await prisma.classroomMaster.findMany({
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
    const { classroomName, process, lob, description, driveFolderId, driveFolderUrl } = req.body;
    if (!classroomName) return res.status(400).json({ ok: false, message: 'Classroom name required.' });

    const classroomId = `CL-${generateId()}`;
    const cl = await prisma.classroomMaster.create({
      data: { classroomId, classroomName, process, lob, description, driveFolderId, driveFolderUrl },
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
    const data = req.body;
    const cl = await prisma.classroomMaster.update({ where: { classroomId }, data });
    res.json({ ok: true, data: cl });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Modules ───────────────────────────────────────────────────────────────────
export async function listModules(req, res) {
  try {
    const { classroomId } = req.params;
    const modules = await prisma.moduleMaster.findMany({
      where: { classroomId },
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
    const { dayNo, moduleTitle, moduleOrder, required, assessmentId, description } = req.body;
    if (!dayNo || !moduleTitle) return res.status(400).json({ ok: false, message: 'Day number and module title required.' });

    const moduleId = `MOD-${generateId()}`;
    const mod = await prisma.moduleMaster.create({
      data: {
        moduleId,
        classroomId,
        dayNo: parseInt(dayNo, 10),
        moduleTitle,
        moduleOrder: parseInt(moduleOrder || 0, 10),
        required: required !== false,
        assessmentId: assessmentId || null,
        description,
      },
    });
    res.json({ ok: true, data: mod });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateModule(req, res) {
  try {
    const { moduleId } = req.params;
    const mod = await prisma.moduleMaster.update({ where: { moduleId }, data: req.body });
    res.json({ ok: true, data: mod });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
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
      where: { moduleId },
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

    const contentId = `CON-${generateId()}`;
    const content = await prisma.contentMaster.create({
      data: {
        contentId,
        moduleId,
        contentType: contentType || 'video',
        contentTitle: contentTitle || req.file?.originalname || 'Untitled',
        driveFileId: driveFileId || null,
        driveUrl: driveUrl || null,
        directMediaUrl: directMediaUrl || (localFilePath ? `${process.env.API_URL || 'http://localhost:4000'}${localFilePath}` : null),
        localFilePath,
        playerMode: playerMode || 'Auto',
        contentOrder: order,
        required: required !== false,
        estimatedMins: parseInt(estimatedMins || 0, 10),
        completionRulePct: parseFloat(completionRulePct || 80),
        description,
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
    const content = await prisma.contentMaster.update({ where: { contentId }, data: req.body });
    res.json({ ok: true, data: content });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
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
    const faqs = await prisma.faqMaster.findMany({ where: { moduleId }, orderBy: { sortOrder: 'asc' } });
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

    const API_URL = process.env.API_URL || 'http://localhost:4000';
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
    const faq = await prisma.faqMaster.update({ where: { faqId }, data: req.body });
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
export async function listAssessments(req, res) {
  try {
    const { classroomId } = req.query;
    const where = classroomId ? { classroomId } : {};
    const assessments = await prisma.assessmentMaster.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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

    const assessmentId = `ASS-${generateId()}`;
    const a = await prisma.assessmentMaster.create({
      data: {
        assessmentId, classroomId,
        dayNo: dayNo ? parseInt(dayNo) : null,
        moduleId: moduleId || null,
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
    const a = await prisma.assessmentMaster.update({ where: { assessmentId }, data: req.body });
    res.json({ ok: true, data: a });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Questions ─────────────────────────────────────────────────────────────────
export async function listQuestions(req, res) {
  try {
    const { assessmentId } = req.params;
    const questions = await prisma.questionBank.findMany({
      where: { assessmentId },
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
    const { q } = req.query;
    const where = q ? {
      OR: [
        { employeeId: { contains: q, mode: 'insensitive' } },
        { traineeName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { batchNo: { contains: q, mode: 'insensitive' } },
      ],
    } : {};
    const trainees = await prisma.traineeMaster.findMany({ where, take: 50, orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, data: trainees });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function resetTraineePassword(req, res) {
  try {
    const { employeeId } = req.params;
    const { newPassword } = req.body;
    const pass = newPassword || '1234';
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    const tempPass = trainee?.mobile ? trainee.mobile.slice(-4) : pass;

    const salt = generateSalt();
    const passwordHash = await hashPassword(tempPass, salt);
    await prisma.userMaster.update({
      where: { employeeId },
      data: { passwordHash, salt, forcePasswordReset: true, failedAttempts: 0, locked: false },
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_PASSWORD', module: 'Accounts', referenceId: employeeId });
    res.json({ ok: true, message: `Password reset for ${employeeId}. Temp: ${tempPass}` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function unlockTrainee(req, res) {
  try {
    const { employeeId } = req.params;
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

    const { files: rawFiles } = await listDriveFolderAny(driveFolderId);

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
          driveUrl: `https://drive.google.com/file/d/${f.id}/view`,
          thumbnailUrl: f.thumbnailLink || null,
          size: f.size ? BigInt(f.size) : null,
          syncedAt: new Date(),
          sortOrder,
        },
        update: { fileName: f.name, syncedAt: new Date(), sortOrder },
      });
    }

    // Return files with sortOrder and cleaned title attached
    const enriched = files.map((f, i) => ({
      ...f,
      sortOrder: i + 1,
      displayTitle: cleanTitle(f.name),
    }));

    res.json({ ok: true, data: { synced: files.length, files: enriched } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Drive sync failed.' });
  }
}

// ── Assign Module ─────────────────────────────────────────────────────────────
export async function assignModule(req, res) {
  try {
    const { moduleId, moduleName, assignedTo, assignedToType, assignmentType, message, dueDate } = req.body;
    const assignment = await prisma.assignedModule.create({
      data: { moduleId, moduleName, assignedTo, assignedToType, assignmentType, message, dueDate: dueDate ? new Date(dueDate) : null, assignedBy: req.userId },
    });
    res.json({ ok: true, data: assignment });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// FIX 5: Export trainees as CSV
export async function exportTrainees(req, res) {
  try {
    const { batchNo, classroomId } = req.query;
    const where = { status: "Active" };
    if (batchNo) where.batchNo = batchNo;
    if (classroomId) where.classroomId = classroomId;

    const trainees = await prisma.traineeMaster.findMany({ where, orderBy: { employeeId: 'asc' } });

    const headers = ['Employee ID', 'Name', 'Batch', 'Branch', 'Process', 'LOB', 'Course %', 'MCQ %', 'Attendance %', 'Risk Status', 'Certification', 'Email', 'Mobile'];
    const rows = trainees.map(t => [
      t.employeeId, t.traineeName || '', t.batchNo || '', t.branch || '', t.process || '', t.lob || '',
      t.courseCompletionPct || 0, t.assessmentPassPct || 0, t.attendancePct || 0,
      t.riskStatus || '', t.certificationStatus || '', t.email || '', t.mobile || '',
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trainees-${batchNo || 'all'}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
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
    const batches = await prisma.batchMaster.findMany({
      where: { batchStatus: { not: 'Archived' } },
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
      select: { employeeId: true, traineeName: true, riskStatus: true, courseCompletionPct: true, attendancePct: true, assessmentPassPct: true, certificationStatus: true, ojtReady: true },
    });
    const openQueries = await prisma.traineeQueryLog.count({ where: { batchNo, status: 'Open' } });
    const total = trainees.length;
    const onTrack = trainees.filter(t => t.riskStatus === 'HEALTHY').length;
    const atRisk = trainees.filter(t => ['CRITICAL','HIGH'].includes(t.riskStatus)).length;
    const needsAttention = trainees.filter(t => t.riskStatus === 'MEDIUM').length;
    const mcqPassed = trainees.filter(t => t.assessmentPassPct >= 60).length;
    const avgCourse = total > 0 ? Math.round(trainees.reduce((s,t) => s + (t.courseCompletionPct||0), 0) / total) : 0;
    const avgAttendance = total > 0 ? Math.round(trainees.reduce((s,t) => s + (t.attendancePct||0), 0) / total) : 0;
    const avgMcq = total > 0 ? Math.round(trainees.reduce((s,t) => s + (t.assessmentPassPct||0), 0) / total) : 0;
    const certified = trainees.filter(t => t.certificationStatus === 'Certified').length;
    res.json({ ok: true, data: { batch, trainees, openQueries, summary: { total, onTrack, atRisk, needsAttention, mcqPassed, avgCourse, avgAttendance, avgMcq, certified } } });
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
    const batches = await prisma.batchMaster.findMany({
      where: { batchStatus: 'Active', coordinatorLoginId: { not: null } },
      select: { coordinatorLoginId: true, coordinatorName: true, batchNo: true, batchName: true, totalTrainees: true },
    });
    const coordMap = {};
    batches.forEach(b => {
      const id = b.coordinatorLoginId;
      if (!coordMap[id]) coordMap[id] = { coordinatorLoginId: id, coordinatorName: b.coordinatorName, batches: [] };
      coordMap[id].batches.push({ batchNo: b.batchNo, batchName: b.batchName, totalTrainees: b.totalTrainees });
    });
    res.json({ ok: true, data: Object.values(coordMap) });
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

    const openQueries = await prisma.traineeQueryLog.count({ where: { batchNo: { in: batchNos }, status: 'Open' } });
    const answeredQueries = await prisma.traineeQueryLog.count({ where: { batchNo: { in: batchNos }, answeredBy: loginId } });
    const totalQueries = await prisma.traineeQueryLog.count({ where: { batchNo: { in: batchNos } } });

    const qaResponseRate = totalQueries > 0 ? Math.round(answeredQueries / totalQueries * 100) : 100;
    const effectivenessScore = Math.round((qaResponseRate + 80 + 75 + 70) / 4);

    const pendingActions = await prisma.traineeQueryLog.findMany({
      where: { batchNo: { in: batchNos }, status: 'Open' },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { queryId: true, traineeName: true, question: true, createdAt: true, priority: true, batchNo: true },
    });

    res.json({ ok: true, data: { loginId, batches, openQueries, answeredQueries, totalQueries, qaResponseRate, effectivenessScore, pendingActions } });
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
    const { batchName, batchType, branch, process, lob, classroomId, coordinatorLoginId, startDate, endDate, expectedTrainees, remarks } = req.body;

    if (!coordinatorLoginId) return res.status(400).json({ ok: false, message: 'Coordinator is required.' });

    // Get coordinator info
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: coordinatorLoginId } });
    const coordinatorName = coord?.name || coordinatorLoginId;

    let classroomName = null;
    if (classroomId) {
      const cl = await prisma.classroomMaster.findUnique({ where: { classroomId } });
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
        endDate: new Date(),
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
      if (!employeeId) { results.push({ ok: false, message: 'Employee ID required.' }); continue; }

      const normEmpId = employeeId.trim().toUpperCase();
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
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_OWN_PASSWORD', module: 'Auth' });
    res.json({ ok: true, message: 'Password updated.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function deleteBatch(req, res) {
  try {
    const { batchNo } = req.params;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    // Delete all dependent records in a transaction
    await prisma.$transaction([
      prisma.onboardingLog.deleteMany({ where: { batchNo } }),
      prisma.attendanceInference.deleteMany({ where: { batchNo } }),
      prisma.batchClassroomMap.deleteMany({ where: { batchNo } }),
      prisma.traineeMaster.deleteMany({ where: { batchNo } }),
      prisma.batchMaster.delete({ where: { batchNo } }),
    ]);
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DELETE_BATCH', module: 'Batch', referenceId: batchNo });
    res.json({ ok: true, message: `Batch ${batchNo} and all related data deleted.` });
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
    const users = await prisma.roleAccessMatrix.findMany({
      where: { active: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json({ ok: true, data: users });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createPortalUser(req, res) {
  try {
    const { loginId, pin, name, role, portalAccess, branch, process, lob, designation, department, employeeCode,
      canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard } = req.body;

    if (!loginId || !pin || !name) return res.status(400).json({ ok: false, message: 'Login ID, PIN and Name are required.' });
    if (pin.length < 4) return res.status(400).json({ ok: false, message: 'PIN must be at least 4 characters.' });

    const existing = await prisma.roleAccessMatrix.findFirst({ where: { loginId } });
    if (existing) return res.status(400).json({ ok: false, message: 'Login ID already exists.' });

    const user = await prisma.roleAccessMatrix.create({
      data: {
        loginId,
        pin,
        name,
        role: role || 'Coordinator',
        portalAccess: portalAccess || role || 'Coordinator',
        branch: branch || null,
        process: process || null,
        lob: lob || null,
        active: true,
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
      canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard, active } = req.body;

    const user = await prisma.roleAccessMatrix.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(pin !== undefined && { pin }),
        ...(role !== undefined && { role }),
        ...(portalAccess !== undefined && { portalAccess }),
        ...(branch !== undefined && { branch: branch || null }),
        ...(process !== undefined && { process: process || null }),
        ...(lob !== undefined && { lob: lob || null }),
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

export async function deletePortalUser(req, res) {
  try {
    const { id } = req.params;
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
    if (!pin || pin.length < 4) return res.status(400).json({ ok: false, message: 'PIN must be at least 4 characters.' });
    const user = await prisma.roleAccessMatrix.update({ where: { id }, data: { pin, failedAttempts: 0, locked: false } });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RESET_PORTAL_USER_PIN', module: 'Users', referenceId: user.loginId });
    res.json({ ok: true, message: 'PIN reset.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}
