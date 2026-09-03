import { prisma } from '../utils/db.js';
import { generateBatchNo } from '../utils/batchNaming.js';
import { hashPassword, generateSalt, normalize } from '../utils/hash.js';
import { audit } from '../utils/audit.js';
import { detectAndSyncRisks } from '../utils/riskEngine.js';
import { awardCertification } from '../utils/leaderboardEngine.js';
import { generateTempEmpId, mapEmployeeId } from '../utils/empIdMapping.js';
import { notifyCertification, notifyBatchAssignment, notifyOnboarding } from '../utils/notify.js';
import { v4 as uuidv4 } from 'uuid';
import * as cache from '../utils/cache.js';
import { randomInt } from 'crypto';

// A coordinator works across their whole assigned branch, not only the batches
// where they are the named owner — branch colleagues share classrooms,
// certification scoring and reporting. No branch on record keeps them owner-scoped.
export function coordinatorBatchWhere(req) {
  const branch = req.userBranch || null;
  return branch
    ? { OR: [{ coordinatorLoginId: req.userId }, { branch }] }
    : { coordinatorLoginId: req.userId };
}

// Read scope: every batch in the coordinator's branch, so they can see what their
// colleagues are running and report across the branch.
function canAccessBatch(batch, req) {
  if (!batch) return false;
  if (batch.coordinatorLoginId === req.userId) return true;
  return !!req.userBranch && batch.branch === req.userBranch;
}

// Write scope: only the batch you are named on. Branch colleagues can look, but
// certifying, onboarding, answering and closing stay with the assigned coordinator.
function canWriteBatch(batch, req) {
  return Boolean(batch) && batch.coordinatorLoginId === req.userId;
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export async function getDashboard(req, res) {
  try {
    const where = coordinatorBatchWhere(req);

    const activeBatchList = await prisma.batchMaster.findMany({ where: { ...where, batchStatus: 'Active' }, select: { batchNo: true } });
    const activeBatchNos = activeBatchList.map(b => b.batchNo);
    const allBatchList = await prisma.batchMaster.findMany({ where, select: { batchNo: true } });
    const allBatchNos = allBatchList.map(b => b.batchNo);

    const [activeBatches, totalTrainees, pendingCount, criticalRisks] = await Promise.all([
      activeBatchList.length,
      prisma.traineeMaster.count({ where: { batchNo: { in: activeBatchNos }, status: 'Active' } }),
      prisma.pendingActivityLog.count({ where: { batchNo: { in: allBatchNos }, status: 'Open' } }),
      prisma.trainingRiskLog.count({ where: { severity: 'CRITICAL', status: 'Open', batchNo: { in: allBatchNos } } }),
    ]);

    // KPI metrics across active batches
    const [certifiedCount, attritionCount, handedOverCertified, totalActive] = await Promise.all([
      prisma.traineeMaster.count({ where: { batchNo: { in: activeBatchNos }, certificationStatus: 'Certified' } }),
      prisma.traineeMaster.count({ where: { batchNo: { in: activeBatchNos }, certificationStatus: 'Attrition' } }),
      prisma.traineeMaster.count({ where: { batchNo: { in: activeBatchNos }, certificationStatus: 'Certified', handoverToOps: true } }),
      prisma.traineeMaster.count({ where: { batchNo: { in: activeBatchNos } } }),
    ]);

    const throughputPct = totalActive > 0 ? Math.round((handedOverCertified / totalActive) * 1000) / 10 : 0;
    const certBase = totalActive - attritionCount;
    const certificationPct = certBase > 0 ? Math.round((certifiedCount / certBase) * 1000) / 10 : 0;
    const attritionPct = totalActive > 0 ? Math.round((attritionCount / totalActive) * 1000) / 10 : 0;

    res.json({ ok: true, data: { activeBatches, totalTrainees, pendingCount, criticalRisks, throughputPct, certificationPct, attritionPct, attritionCount, certifiedCount } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Batches ────────────────────────────────────────────────────────────────────
export async function getBatches(req, res) {
  try {
    const { status } = req.query;
    const where = coordinatorBatchWhere(req);
    if (status && status !== 'All') where.batchStatus = status;

    const batches = await prisma.batchMaster.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (batches.length === 0) return res.json({ ok: true, data: [] });

    const batchNos = batches.map(b => b.batchNo);

    const [riskCounts, traineeStats, certifiedCounts, traineeCounts] = await Promise.all([
      prisma.trainingRiskLog.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, status: 'Open', severity: { in: ['CRITICAL', 'HIGH'] } },
        _count: { batchNo: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos } },
        _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, certificationStatus: 'Certified' },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, status: 'Active' },
        _count: { employeeId: true },
      }),
    ]);

    const riskMap = {};
    for (const r of riskCounts) riskMap[r.batchNo] = r._count.batchNo;

    const statsMap = {};
    for (const s of traineeStats) {
      statsMap[s.batchNo] = {
        avgCompletionPct: Math.round(s._avg.courseCompletionPct || 0),
        avgMcqPct: Math.round(s._avg.assessmentPassPct || 0),
        avgAttendancePct: Math.round(s._avg.attendancePct || 0),
        totalTrainees: s._count.employeeId,
      };
    }

    const certMap = {};
    for (const c of certifiedCounts) certMap[c.batchNo] = c._count.employeeId;

    const activeCountMap = {};
    for (const a of traineeCounts) activeCountMap[a.batchNo] = a._count.employeeId;

    const enriched = batches.map(b => {
      const stats = statsMap[b.batchNo] || {};
      const avgCourse = stats.avgCompletionPct || 0;
      const avgMcq = stats.avgMcqPct || 0;
      const avgAtt = stats.avgAttendancePct || 0;
      const health = avgCourse >= 80 && avgAtt >= 80 ? 'Good' : avgCourse >= 50 || avgAtt >= 50 ? 'Average' : 'At Risk';
      return {
        ...b,
        riskCount: riskMap[b.batchNo] || 0,
        avgCompletionPct: avgCourse,
        avgMcqPct: avgMcq,
        avgAttendancePct: avgAtt,
        totalTrainees: activeCountMap[b.batchNo] || 0,
        certifiedCount: certMap[b.batchNo] || 0,
        batchHealth: health,
      };
    });

    res.json({ ok: true, data: enriched });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function createBatch(req, res) {
  try {
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: req.userId } });
    if (!coord?.canCreateBatch) return res.status(403).json({ ok: false, message: 'No permission to create batches.' });

    const { batchName, batchType, branch, process, lob, classroomId, startDate, endDate, expectedTrainees, remarks } = req.body;

    // Get classroom name if provided
    let classroomName = null;
    if (classroomId) {
      const cl = await prisma.classroomMaster.findUnique({ where: { classroomId } });
      if (!cl) return res.status(400).json({ ok: false, message: 'Classroom not found.' });
      if (coord.branch && cl.branch && cl.branch !== coord.branch) {
        return res.status(403).json({ ok: false, message: 'You cannot assign classrooms from a different branch.' });
      }
      classroomName = cl?.classroomName;
    }

    const batchNo = await generateBatchNo(process, lob, startDate);

    const batch = await prisma.batchMaster.create({
      data: {
        batchNo,
        batchName: batchName || `${process} ${lob} Batch`,
        batchType: batchType || 'NHT',
        branch: branch || coord.branch,
        process: process || coord.process,
        lob: lob || coord.lob,
        classroomId: classroomId || null,
        classroomName: classroomName || null,
        classroomAssignedAt: classroomId ? new Date() : null,
        classroomAssignedBy: classroomId ? req.userId : null,
        coordinatorName: coord.name,
        coordinatorLoginId: req.userId,
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
      });
    }

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'CREATE_BATCH', module: 'Batch', referenceId: batchNo, newValue: batch });
    res.json({ ok: true, data: batch, message: `Batch ${batchNo} created successfully.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function getBatchDetails(req, res) {
  try {
    const { batchNo } = req.params;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });
    if (!canAccessBatch(batch, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });

    const [trainees, pending, queries, risks, attendance] = await Promise.all([
      prisma.traineeMaster.findMany({ where: { batchNo }, orderBy: { createdAt: 'asc' } }),
      prisma.pendingActivityLog.findMany({ where: { batchNo, status: 'Open' }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.traineeQueryLog.findMany({ where: { batchNo }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.trainingRiskLog.findMany({ where: { batchNo, status: 'Open' }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.attendanceInference.findMany({ where: { batchNo }, orderBy: { date: 'desc' }, take: 60 }),
    ]);

    res.json({ ok: true, data: { batch, trainees, pending, queries, risks, attendance } });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Trainee Onboarding ──────────────────────────────────────────────────────────
export async function addTrainee(req, res) {
  try {
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: req.userId } });
    if (!coord?.canOnboardTrainee) return res.status(403).json({ ok: false, message: 'No permission to onboard trainees.' });

    const { batchNo } = req.params;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const result = await onboardSingleTrainee(req.body, batch, req.userId);
    if (!result.ok) return res.status(400).json(result);

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'ONBOARD_TRAINEE', module: 'Trainee', referenceId: batchNo });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function bulkAddTrainees(req, res) {
  try {
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: req.userId } });
    if (!coord?.canOnboardTrainee) return res.status(403).json({ ok: false, message: 'No permission.' });

    const { batchNo } = req.params;
    const { trainees } = req.body; // array of trainee objects
    if (!Array.isArray(trainees) || trainees.length === 0) return res.status(400).json({ ok: false, message: 'No trainees provided.' });

    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });

    const results = [];
    for (const t of trainees) {
      results.push(await onboardSingleTrainee(t, batch, req.userId));
    }

    const success = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'BULK_ONBOARD', module: 'Trainee', referenceId: batchNo, newValue: { total: trainees.length, success, failed: failed.length } });
    res.json({ ok: true, data: { success, failed: failed.length, errors: failed.map(r => r.message), results } });
  } catch (err) {
    console.error('[bulkAddTrainees]', err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

// Enroll an existing LMS user into a different batch/classroom without re-creating their account
export async function enrollExistingTrainee(req, res) {
  try {
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: req.userId } });
    if (!coord?.canOnboardTrainee) return res.status(403).json({ ok: false, message: 'No permission.' });

    const { batchNo } = req.params;
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ ok: false, message: 'employeeId required.' });

    const normId = normalize(employeeId);

    const [batch, trainee] = await Promise.all([
      prisma.batchMaster.findUnique({ where: { batchNo } }),
      prisma.traineeMaster.findUnique({ where: { employeeId: normId } }),
    ]);

    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });

    await prisma.$transaction(async (tx) => {
      await tx.traineeMaster.update({
        where: { employeeId: normId },
        data: {
          batchNo: batch.batchNo,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          classroomId: batch.classroomId || trainee.classroomId,
          classroomName: batch.classroomName || trainee.classroomName,
          status: 'Active',
          onboardingStatus: 'Active',
        },
      });
      await tx.userMaster.updateMany({
        where: { employeeId: normId },
        data: {
          batchNo: batch.batchNo,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          classroomId: batch.classroomId || trainee.classroomId,
        },
      });
    });

    if (batch.classroomId) {
      await prisma.traineeClassroomMap.upsert({
        where: { employeeId_classroomId: { employeeId: normId, classroomId: batch.classroomId } },
        create: { employeeId: normId, classroomId: batch.classroomId, batchNo: batch.batchNo, assignedBy: req.userId },
        update: { active: true, batchNo: batch.batchNo },
      });
    }

    await prisma.batchMaster.update({
      where: { batchNo: batch.batchNo },
      data: { totalTrainees: { increment: 1 } },
    });

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'ENROLL_EXISTING', module: 'Trainee', referenceId: normId, newValue: { batchNo } });

    cache.delPrefix('dashboard:');

    notifyBatchAssignment({
      traineeName: trainee.traineeName,
      mobile: trainee.mobile,
      email: trainee.email,
      batchNo: batch.batchNo,
      classroomName: batch.classroomName,
      process: batch.process,
    }).catch(err => console.error(`[NOTIFY] Batch assignment notification failed:`, err.message));

    res.json({ ok: true, message: `${trainee.traineeName || normId} enrolled in ${batchNo}.` });
  } catch (err) {
    console.error('[enrollExistingTrainee]', err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

async function onboardSingleTrainee(data, batch, coordinatorLoginId) {
  const { employeeId, traineeName, email, mobile, doj } = data;
  let normEmpId;

  if (!employeeId) {
    const cleanMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : null;
    if (!cleanMobile) return { ok: false, message: 'Mobile number required when Employee ID is not provided.' };
    normEmpId = await generateTempEmpId();
  } else {
    normEmpId = normalize(employeeId);
  }

  // Duplicate check
  const existing = await prisma.traineeMaster.findFirst({
    where: {
      OR: [
        { employeeId: normEmpId },
        email ? { email: normalize(email) } : undefined,
        mobile ? { mobile: mobile.replace(/\D/g, '').slice(-10) } : undefined,
      ].filter(Boolean),
    },
  });
  if (existing) return { ok: false, message: `Duplicate trainee: Employee ID ${existing.employeeId} already exists.` };

  let lmsId = `LMS${normEmpId.replace(/\D/g, '').padStart(6, '0').slice(-6)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await prisma.traineeMaster.findFirst({ where: { lmsId }, select: { employeeId: true } });
    if (!exists) break;
    lmsId = `LMS${normEmpId.replace(/\D/g, '').slice(-4).padStart(4, '0')}${randomInt(100, 999)}`;
  }
  const tempPassword = randomInt(100000, 999999).toString();
  const salt = generateSalt();
  const passwordHash = await hashPassword(tempPassword, salt);
  const cleanMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : null;

  let trainee;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const t = await tx.traineeMaster.create({
        data: {
          employeeId: normEmpId,
          lmsId,
          traineeName,
          email: email ? normalize(email) : null,
          mobile: cleanMobile,
          batchNo: batch.batchNo,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          classroomId: batch.classroomId,
          classroomName: batch.classroomName,
          status: 'Active',
          doj: doj && !isNaN(new Date(doj)) ? new Date(doj) : null,
          onboardingDate: new Date(),
          onboardingStatus: 'Active',
          createdBy: coordinatorLoginId,
          source: 'Coordinator Portal',
          empIdType: employeeId ? 'PERMANENT' : 'TEMP',
        },
      });
      await tx.userMaster.create({
        data: {
          employeeId: normEmpId,
          passwordHash,
          salt,
          traineeName,
          email: t.email,
          mobile: cleanMobile,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          batchNo: batch.batchNo,
          classroomId: batch.classroomId,
          forcePasswordReset: true,
        },
      });
      return t;
    });
    trainee = result;
  } catch (err) {
    if (err.code === 'P2002') return { ok: false, message: `Employee ID ${normEmpId} already exists.` };
    throw err;
  }

  if (batch.classroomId) {
    await prisma.traineeClassroomMap.upsert({
      where: { employeeId_classroomId: { employeeId: normEmpId, classroomId: batch.classroomId } },
      create: { employeeId: normEmpId, classroomId: batch.classroomId, batchNo: batch.batchNo, assignedBy: coordinatorLoginId },
      update: { active: true, batchNo: batch.batchNo },
    });
  }

  await prisma.batchMaster.update({
    where: { batchNo: batch.batchNo },
    data: { totalTrainees: { increment: 1 } },
  });

  await prisma.onboardingLog.create({
    data: {
      batchNo: batch.batchNo,
      employeeId: normEmpId,
      lmsId,
      traineeName,
      mobile: cleanMobile,
      email: trainee.email,
      coordinatorLoginId,
      coordinatorName: null,
      status: 'Success',
    },
  });

  // Notify trainee of account creation — fire and forget
  notifyOnboarding({
    traineeName,
    employeeId: normEmpId,
    mobile: cleanMobile,
    email: trainee.email,
    batchNo: batch.batchNo,
    classroomName: batch.classroomName,
    process: batch.process,
    tempPassword,
  }).catch(err => console.error(`[NOTIFY] Onboarding notification failed for ${normEmpId}:`, err.message));

  return { ok: true, data: trainee, message: `${traineeName || normEmpId} onboarded. Temp password is last 4 digits of mobile (or 1234 if no mobile).` };
}

// ── Trainee Search ─────────────────────────────────────────────────────────────
export async function searchTrainees(req, res) {
  try {
    const { q, limit = 10 } = req.query;
    if (!q || q.trim().length < 2) return res.json({ ok: true, data: [] });
    const trainees = await prisma.traineeMaster.findMany({
      where: {
        OR: [
          { employeeId: { contains: q.trim(), mode: 'insensitive' } },
          { traineeName: { contains: q.trim(), mode: 'insensitive' } },
          { email: { contains: q.trim(), mode: 'insensitive' } },
        ],
      },
      take: parseInt(limit) || 10,
      orderBy: { traineeName: 'asc' },
      select: { employeeId: true, traineeName: true, email: true, mobile: true, batchNo: true },
    });
    res.json({ ok: true, data: trainees });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Pending Activities ─────────────────────────────────────────────────────────
export async function getPendingActivities(req, res) {
  try {
    const batches = await prisma.batchMaster.findMany({
      where: coordinatorBatchWhere(req),
      select: { batchNo: true },
    });
    const batchNos = batches.map(b => b.batchNo);

    const activities = await prisma.pendingActivityLog.findMany({
      where: { batchNo: { in: batchNos }, status: 'Open' },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    });
    res.json({ ok: true, data: activities });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updatePendingActivity(req, res) {
  try {
    const { id } = req.params;
    const { actionTaken, status, followUpDate, closureRemarks } = req.body;

    const activity = await prisma.pendingActivityLog.findUnique({ where: { id } });
    if (!activity) return res.status(404).json({ ok: false, message: 'Activity not found.' });
    if (activity.batchNo) {
      const batch = await prisma.batchMaster.findUnique({ where: { batchNo: activity.batchNo } });
      if (!canWriteBatch(batch, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    }

    const updated = await prisma.pendingActivityLog.update({
      where: { id },
      data: {
        actionTaken,
        status: status || 'Actioned',
        actionBy: req.userId,
        actionAt: new Date(),
        followUpDate: followUpDate ? new Date(followUpDate) : undefined,
        closureRemarks,
        closedAt: status === 'Closed' ? new Date() : undefined,
      },
    });
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Q&A ───────────────────────────────────────────────────────────────────────
export async function getQueryLog(req, res) {
  try {
    const { status, batchNo } = req.query;
    const batches = await prisma.batchMaster.findMany({
      where: coordinatorBatchWhere(req),
      select: { batchNo: true },
    });
    const batchNos = batches.map(b => b.batchNo);

    const where = { batchNo: { in: batchNos } };
    if (status) where.status = status;
    // Only allow filtering to a specific batch if it belongs to this coordinator
    if (batchNo && batchNos.includes(batchNo)) where.batchNo = batchNo;

    const queries = await prisma.traineeQueryLog.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    });
    res.json({ ok: true, data: queries });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function answerQuery(req, res) {
  try {
    const { id } = req.params;
    const { coordinatorAnswer } = req.body;
    if (!coordinatorAnswer) return res.status(400).json({ ok: false, message: 'Answer text required.' });

    const query = await prisma.traineeQueryLog.findUnique({ where: { id } });
    if (!query) return res.status(404).json({ ok: false, message: 'Query not found.' });
    if (query.batchNo) {
      const batch = await prisma.batchMaster.findUnique({ where: { batchNo: query.batchNo } });
      if (!canWriteBatch(batch, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    }
    const tatHours = (Date.now() - new Date(query.createdAt).getTime()) / 3600000;

    const updated = await prisma.traineeQueryLog.update({
      where: { id },
      data: {
        coordinatorAnswer,
        answeredBy: req.userId,
        answeredAt: new Date(),
        status: 'Answered',
        resolutionTatHours: tatHours,
      },
    });

    // Re-check QA breach risks
    if (query?.employeeId) await detectAndSyncRisks(query.employeeId);

    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateRiskAction(req, res) {
  try {
    const { id } = req.params;
    const { actionTaken, status, followUpDate, closureRemarks } = req.body;

    const risk = await prisma.trainingRiskLog.findUnique({ where: { id } });
    if (!risk) return res.status(404).json({ ok: false, message: 'Risk not found.' });
    if (risk.batchNo) {
      const batch = await prisma.batchMaster.findUnique({ where: { batchNo: risk.batchNo } });
      if (!canWriteBatch(batch, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    }

    const updated = await prisma.trainingRiskLog.update({
      where: { id },
      data: { actionTaken, status: status || 'Actioned', actionBy: req.userId, actionAt: new Date(), followUpDate: followUpDate ? new Date(followUpDate) : undefined, closureRemarks },
    });
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Certification ──────────────────────────────────────────────────────────────
export async function getCertificationData(req, res) {
  try {
    const { batchNo } = req.params;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo }, select: { coordinatorLoginId: true } });
    if (!canAccessBatch(batch, req)) {
      return res.status(403).json({ ok: false, message: 'Access denied.' });
    }
    const trainees = await prisma.traineeMaster.findMany({ where: { batchNo } });

    const rule = trainees[0]?.process && trainees[0]?.lob
      ? await prisma.certificationRuleMaster.findFirst({
          where: { process: trainees[0].process, lob: trainees[0].lob, active: true },
        })
      : null;

    const evidence = await prisma.certificationEvidence.findMany({
      where: { batchNo },
    });

    const eligibility = trainees.map(t => {
      const evList = evidence.filter(e => e.employeeId === t.employeeId);
      return { ...t, evidence: evList, eligible: checkEligibility(t, rule) };
    });

    res.json({ ok: true, data: { rule, trainees: eligibility } });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Only reached from getCertificationData below, which routes/coordinatorStability.js
// shadows (see server.js mount order), so this never runs in production. It is kept
// because the handler around it is still exported, but it no longer reads the retired
// mock/internal/external columns — the live evaluator is evaluateCertification in
// coordinatorStability.js, backed by services/certificationCriteria.js.
function checkEligibility(t, rule) {
  if (!rule) return t.courseCompletionPct >= 80 && t.assessmentPassPct >= 60;
  return t.courseCompletionPct >= rule.courseCompletionMin
    && t.assessmentPassPct >= rule.mcqPassPctMin
    && t.attendancePct >= rule.attendancePctMin;
}

export async function saveCertificationEvidence(req, res) {
  try {
    const { employeeId, evidenceType, result, scorePct, conductedBy, conductedAt, remarks } = req.body;
    const batch = await prisma.batchMaster.findUnique({ where: { batchNo: req.params.batchNo } });
    if (!canWriteBatch(batch, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    const ev = await prisma.certificationEvidence.create({
      data: {
        employeeId,
        batchNo: req.params.batchNo,
        evidenceType,
        result,
        scorePct: parseFloat(scorePct || 0),
        conductedBy,
        conductedAt: conductedAt ? new Date(conductedAt) : null,
        remarks,
        createdBy: req.userId,
      },
    });
    res.json({ ok: true, data: ev });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function certifyTrainee(req, res) {
  try {
    const { employeeId } = req.body;
    const batchNo = req.params.batchNo;

    const [batchCheck, traineeCheck] = await Promise.all([
      prisma.batchMaster.findUnique({ where: { batchNo } }),
      prisma.traineeMaster.findUnique({ where: { employeeId } }),
    ]);
    if (!canWriteBatch(batchCheck, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    if (!traineeCheck || traineeCheck.batchNo !== batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });

    const [trainee, batch] = await prisma.$transaction(async tx => {
      const t = await tx.traineeMaster.update({
        where: { employeeId },
        data: { certificationStatus: 'Certified' },
      });
      const b = await tx.batchMaster.update({
        where: { batchNo },
        data: { certified: { increment: 1 } },
        select: { batchNo: true, batchName: true, process: true, lob: true },
      });
      return [t, b];
    });

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'CERTIFY_TRAINEE', module: 'Certification', referenceId: employeeId });

    // Notify trainee via all enabled channels — fire-and-forget
    notifyCertification({
      traineeName: trainee.traineeName,
      employeeId,
      email: trainee.email,
      mobile: trainee.mobile,
      batchNo: batch.batchNo,
      batchName: batch.batchName,
      process: batch.process,
      lob: batch.lob,
    }).catch(err => console.error(`[NOTIFY] Cert notification failed for ${employeeId}:`, err.message));

    // Leaderboard: award certification points. Fire-and-forget so a
    // leaderboard failure never breaks certification.
    awardCertification(employeeId).catch(err => console.error(`[Leaderboard] certification award failed for ${employeeId}:`, err.message));

    res.json({ ok: true, message: `${employeeId} certified.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function handoverTrainee(req, res) {
  try {
    const { employeeId } = req.body;
    const batchCheck = await prisma.batchMaster.findUnique({ where: { batchNo: req.params.batchNo } });
    if (!canWriteBatch(batchCheck, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    const traineeCheck = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!traineeCheck || traineeCheck.batchNo !== req.params.batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });
    await prisma.$transaction(async tx => {
      await tx.traineeMaster.update({
        where: { employeeId },
        data: { handoverToOps: true },
      });
      await tx.batchMaster.update({
        where: { batchNo: req.params.batchNo },
        data: { handoverToOps: { increment: 1 } },
      });
    });
    res.json({ ok: true, message: `${employeeId} handed over to OPS.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateTraineeFinalStatus(req, res) {
  try {
    const { batchNo, employeeId } = req.params;
    const { finalStatus, remarks } = req.body;

    const validStatuses = ['Certified', 'Not Certified', 'Attrition'];
    if (!validStatuses.includes(finalStatus)) {
      return res.status(400).json({ ok: false, message: `finalStatus must be one of: ${validStatuses.join(', ')}` });
    }

    const batchCheck = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!canWriteBatch(batchCheck, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    const traineeCheck = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!traineeCheck || traineeCheck.batchNo !== batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });

    const updateData = { certificationStatus: finalStatus };
    if (finalStatus === 'Attrition') {
      updateData.status = 'Inactive';
    }

    await prisma.traineeMaster.update({ where: { employeeId }, data: updateData });

    if (finalStatus === 'Attrition') {
      try {
        const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
        if (batch && batch.totalTrainees != null && batch.totalTrainees > 0) {
          await prisma.batchMaster.update({ where: { batchNo }, data: { totalTrainees: { decrement: 1 } } });
        }
      } catch (_) { /* graceful — field may not exist */ }
    }

    await audit({
      userIdentity: req.userId,
      userRole: 'Coordinator',
      action: 'UPDATE_TRAINEE_FINAL_STATUS',
      module: 'Certification',
      referenceId: employeeId,
      newValue: { finalStatus, remarks, batchNo },
    });

    res.json({ ok: true, message: `${employeeId} marked as ${finalStatus}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function getProcessLobList(req, res) {
  try {
    const list = await prisma.processLobMaster.findMany({ where: { active: true }, orderBy: [{ process: 'asc' }, { lob: 'asc' }] });
    res.json({ ok: true, data: list });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getClassrooms(req, res) {
  try {
    const coord = await prisma.roleAccessMatrix.findFirst({ where: { loginId: req.userId } });
    const where = { active: true };
    if (coord?.branch) where.branch = coord.branch;
    const classrooms = await prisma.classroomMaster.findMany({ where, orderBy: { classroomName: 'asc' } });
    res.json({ ok: true, data: classrooms });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function closeBatchByCoordinator(req, res) {
  try {
    const { batchNo } = req.params;
    const { remarks } = req.body;

    if (!remarks || !remarks.trim()) {
      return res.status(400).json({ ok: false, message: 'Closure remarks are required.' });
    }

    const batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });
    if (!canWriteBatch(batch, req)) return res.status(403).json({ ok: false, message: 'You are not the coordinator of this batch.' });
    if (!req.coordinator?.canCloseBatch) return res.status(403).json({ ok: false, message: 'You do not have permission to close batches.' });
    if (batch.batchStatus === 'Completed') return res.status(400).json({ ok: false, message: 'Batch already closed.' });

    // Hard check: every active trainee must have been explicitly marked Certified or Attrition
    const unsetTrainees = await prisma.traineeMaster.count({
      where: {
        batchNo,
        status: 'Active',
        certificationStatus: 'Not Certified',
      },
    });

    if (unsetTrainees > 0) {
      const certifiedCount = await prisma.traineeMaster.count({ where: { batchNo, certificationStatus: 'Certified' } });
      const attritionCount = await prisma.traineeMaster.count({ where: { batchNo, certificationStatus: 'Attrition' } });
      return res.status(400).json({
        ok: false,
        message: `Cannot close batch: ${unsetTrainees} trainee(s) have not been given a final status. Mark each as Certified or Attrition before closing. (Certified: ${certifiedCount}, Attrition: ${attritionCount})`,
        unresolved: unsetTrainees,
        certifiedCount,
        attritionCount,
      });
    }

    const certifiedFinal = await prisma.traineeMaster.count({ where: { batchNo, certificationStatus: 'Certified' } });
    const attritionFinal = await prisma.traineeMaster.count({ where: { batchNo, certificationStatus: 'Attrition' } });

    // Warn about pending items (soft check — advisory, not blocking since frontend checklist is the gate)
    const openQueries = await prisma.traineeQueryLog.count({ where: { batchNo, status: 'Open' } });
    const warnings = [];
    if (openQueries > 0) warnings.push(`${openQueries} open queries remain unanswered`);

    const updated = await prisma.batchMaster.update({
      where: { batchNo },
      data: {
        batchStatus: 'Completed',
        endDate: batch.endDate || new Date(),
        remarks: remarks.trim(),
      },
    });
    await audit({
      userIdentity: req.userId,
      userRole: 'Coordinator',
      action: 'CLOSE_BATCH',
      module: 'Batch',
      referenceId: batchNo,
      newValue: { remarks: remarks.trim(), warnings },
    });
    res.json({ ok: true, data: updated, warnings, certifiedCount: certifiedFinal, attritionCount: attritionFinal, message: `Batch ${batchNo} closed successfully.${warnings.length ? ' Note: ' + warnings.join('; ') : ''}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message });
  }
}

// ── Coordinator: Map Permanent Employee ID ────────────────────────────────────
export async function coordMapEmpId(req, res) {
  try {
    const { employeeId } = req.params;
    const { permanentEmpId } = req.body;
    if (!permanentEmpId?.trim()) return res.status(400).json({ ok: false, message: 'permanentEmpId is required.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee not found.' });
    if (trainee.batchNo) {
      const batch = await prisma.batchMaster.findUnique({ where: { batchNo: trainee.batchNo } });
      if (!canWriteBatch(batch, req)) return res.status(403).json({ ok: false, message: 'Access denied.' });
    }
    if (!trainee.mobile) return res.status(400).json({ ok: false, message: 'Trainee has no mobile — cannot map.' });

    const result = await mapEmployeeId({
      mobile: trainee.mobile,
      permanentEmpId: permanentEmpId.trim(),
      triggeredBy: req.userId,
      triggeredByRole: 'Coordinator',
    });

    if (!result.ok) return res.status(400).json({ ok: false, message: result.error });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Report Exports (coordinator-scoped) ────────────────────────────────────────

function fmtDt(v) { if (!v) return ''; return new Date(v).toISOString().replace('T', ' ').slice(0, 19); }
function fmtDate(v) { if (!v) return ''; return new Date(v).toISOString().slice(0, 10); }

function toCsv(headers, rows) {
  const esc = v => {
    if (v === null || v === undefined) return '""';
    let s = String(v);
    // Prefix formula-injection triggers so spreadsheet apps don't execute them
    if (/^[=+\-@|]/.test(s)) s = '\t' + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
}

function csvRes(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

// ── Coord Export 1: Trainee Progress ──────────────────────────────────────────
export async function coordExportTrainees(req, res) {
  try {
    const { batchNo } = req.query;
    const coordId = req.userId;
    const batchWhere = { coordinatorLoginId: coordId };
    if (batchNo) batchWhere.batchNo = batchNo;

    const batches = await prisma.batchMaster.findMany({ where: batchWhere });
    const batchNos = batches.map(b => b.batchNo);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const trainees = await prisma.traineeMaster.findMany({
      where: { batchNo: { in: batchNos } },
      orderBy: [{ batchNo: 'asc' }, { employeeId: 'asc' }],
    });

    const headers = [
      'Employee ID', 'Name', 'Email', 'Mobile',
      'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date',
      'Onboarding Date', 'Last Updated At',
      'Course Completion %', 'MCQ Pass %', 'Attendance %',
      'Risk Status', 'Risk Reason',
      'OJT Ready', 'Certification Status',
      'Status', 'Export Generated At',
    ];
    const genAt = fmtDt(new Date());
    const rows = trainees.map(t => {
      const b = batchMap[t.batchNo] || {};
      return [
        t.employeeId, t.traineeName, t.email, t.mobile,
        t.batchNo, t.branch, t.process, t.lob,
        fmtDate(b.startDate), fmtDate(b.endDate),
        fmtDate(t.onboardingDate), fmtDt(t.lastUpdatedAt),
        t.courseCompletionPct || 0, t.assessmentPassPct || 0, t.attendancePct || 0,
        t.riskStatus, t.riskReason || '',
        t.ojtReady ? 'Yes' : 'No', t.certificationStatus,
        t.status, genAt,
      ];
    });
    csvRes(res, `trainee-progress-${batchNo || 'my-batches'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── Coord Export 2: At-Risk Trainees ──────────────────────────────────────────
export async function coordExportAtRisk(req, res) {
  try {
    const { batchNo } = req.query;
    const coordId = req.userId;
    const batchWhere = { coordinatorLoginId: coordId };
    if (batchNo) batchWhere.batchNo = batchNo;

    const batches = await prisma.batchMaster.findMany({ where: batchWhere, select: { batchNo: true, startDate: true, endDate: true } });
    const batchNos = batches.map(b => b.batchNo);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const traineeWhere = { batchNo: { in: batchNos }, riskStatus: { in: ['CRITICAL', 'HIGH', 'WATCH'] } };
    const [trainees, risks] = await Promise.all([
      prisma.traineeMaster.findMany({ where: traineeWhere, orderBy: [{ riskStatus: 'asc' }, { courseCompletionPct: 'asc' }] }),
      prisma.trainingRiskLog.findMany({ where: { status: 'Open', batchNo: { in: batchNos } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const riskMap = {};
    risks.forEach(r => { if (!riskMap[r.employeeId]) riskMap[r.employeeId] = []; riskMap[r.employeeId].push(r); });

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date',
      'Risk Level', 'Risk Reason',
      'Risk Type', 'Risk Flagged At',
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
        r.riskType || '', fmtDt(r.createdAt),
        t.courseCompletionPct || 0, t.assessmentPassPct || 0, t.attendancePct || 0,
        t.certificationStatus, t.email, t.mobile,
      ];
    });
    csvRes(res, `at-risk-${batchNo || 'my-batches'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── Coord Export 3: Q&A Activity ──────────────────────────────────────────────
export async function coordExportQAActivity(req, res) {
  try {
    const { batchNo } = req.query;
    const coordId = req.userId;
    const batchWhere = { coordinatorLoginId: coordId };
    if (batchNo) batchWhere.batchNo = batchNo;

    const batches = await prisma.batchMaster.findMany({ where: batchWhere, select: { batchNo: true } });
    const batchNos = batches.map(b => b.batchNo);

    const queries = await prisma.traineeQueryLog.findMany({
      where: { batchNo: { in: batchNos }, ...(batchNo ? { batchNo } : {}) },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Query ID', 'Employee ID', 'Batch No',
      'Module', 'Query Text',
      'Status', 'Priority',
      'Raised At', 'Answered At', 'Closed At',
      'TAT (hours)', 'Answer',
    ];
    const rows = queries.map(q => {
      const raisedAt = q.createdAt ? new Date(q.createdAt) : null;
      const answeredAt = q.answeredAt ? new Date(q.answeredAt) : null;
      const closedAt = q.closedAt ? new Date(q.closedAt) : null;
      const endTime = closedAt || answeredAt;
      const tatHours = raisedAt && endTime ? Math.round((endTime - raisedAt) / 3600000 * 10) / 10 : '';
      return [
        q.queryId, q.employeeId, q.batchNo,
        q.moduleId || '',
        q.question,
        q.status, q.priority || '',
        fmtDt(q.createdAt), fmtDt(q.answeredAt), fmtDt(q.closedAt),
        tatHours, q.coordinatorAnswer || '',
      ];
    });
    csvRes(res, `qa-activity-${batchNo || 'my-batches'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}
