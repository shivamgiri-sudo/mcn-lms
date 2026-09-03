import { randomInt } from 'crypto';
import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { hashPassword, generateSalt, normalize, firstTimePassword } from '../utils/hash.js';
import { generateTempEmpId } from '../utils/empIdMapping.js';
import { audit } from '../utils/audit.js';
import { getFormOptions, scopeFormOptions } from '../services/formOptions.js';
import { notifyCertification, notifyOnboarding, notifyBatchAssignment } from '../utils/notify.js';

const router = Router();
const auth = [requireSession, requireRole('coordinator')];

// A coordinator reaches every batch in their assigned branch, not only the ones
// they personally own — branch colleagues share classrooms, certification scoring
// and reporting. A coordinator with no branch on record stays owner-scoped.
function batchScopeWhere(req) {
  const branch = req.userBranch || null;
  return branch
    ? { OR: [{ coordinatorLoginId: req.userId }, { branch }] }
    : { coordinatorLoginId: req.userId };
}

// Visible = anywhere in the coordinator's branch. Writable = the batch they are
// actually named on. Branch colleagues can see each other's batches and report
// across the branch, but certifying, onboarding, answering and closing stay with
// the assigned coordinator.
async function getVisibleBatch(batchNo, req) {
  return prisma.batchMaster.findFirst({ where: { batchNo, ...batchScopeWhere(req) } });
}

async function getWritableBatch(batchNo, req) {
  return prisma.batchMaster.findFirst({ where: { batchNo, coordinatorLoginId: req.userId } });
}

async function ownedBatchNumbers(req) {
  const rows = await prisma.batchMaster.findMany({
    where: batchScopeWhere(req),
    select: { batchNo: true },
  });
  return rows.map(row => row.batchNo);
}

function safeDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function cleanMobile(value) {
  const mobile = String(value || '').replace(/\D/g, '').slice(-10);
  return mobile.length === 10 ? mobile : null;
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function uniqueLmsId(employeeId) {
  const digits = String(employeeId || '').replace(/\D/g, '');
  let candidate = `LMS${digits.padStart(6, '0').slice(-6)}`;
  while (await prisma.traineeMaster.findFirst({ where: { lmsId: candidate }, select: { id: true } })) {
    candidate = `LMS${Date.now().toString().slice(-6)}${String(randomInt(1000)).padStart(3, '0')}`;
  }
  return candidate;
}

async function createTraineeAccount(raw, batch, coordinatorLoginId) {
  const traineeName = String(raw?.traineeName || '').trim();
  const email = cleanEmail(raw?.email);
  const mobile = cleanMobile(raw?.mobile);
  if (traineeName.length < 2) return { ok: false, message: 'Trainee name is required.' };
  if (!email && !mobile) return { ok: false, message: 'A valid email address or 10-digit mobile number is required for secure credential delivery.' };

  const employeeId = raw?.employeeId ? normalize(raw.employeeId) : await generateTempEmpId();
  const duplicateFilters = [{ employeeId }];
  if (email) duplicateFilters.push({ email });
  if (mobile) duplicateFilters.push({ mobile });
  const duplicate = await prisma.traineeMaster.findFirst({
    where: { OR: duplicateFilters },
    select: { employeeId: true },
  });
  if (duplicate) return { ok: false, message: `An LMS account already exists for employee ${duplicate.employeeId}.` };

  const lmsId = await uniqueLmsId(employeeId);
  const tempPassword = firstTimePassword(mobile);
  const salt = generateSalt();
  const passwordHash = await hashPassword(tempPassword, salt);
  const doj = raw?.doj && !Number.isNaN(new Date(raw.doj).getTime()) ? new Date(raw.doj) : null;

  let trainee;
  try {
    trainee = await prisma.$transaction(async tx => {
      const created = await tx.traineeMaster.create({
        data: {
          employeeId,
          lmsId,
          traineeName,
          email,
          mobile,
          batchNo: batch.batchNo,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          classroomId: batch.classroomId,
          classroomName: batch.classroomName,
          status: 'Active',
          doj,
          onboardingDate: new Date(),
          onboardingStatus: 'Active',
          createdBy: coordinatorLoginId,
          source: 'Coordinator Portal',
          empIdType: raw?.employeeId ? 'PERMANENT' : 'TEMP',
        },
      });

      await tx.userMaster.create({
        data: {
          employeeId,
          passwordHash,
          salt,
          traineeName,
          email,
          mobile,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          batchNo: batch.batchNo,
          classroomId: batch.classroomId,
          forcePasswordReset: true,
        },
      });

      if (batch.classroomId) {
        await tx.traineeClassroomMap.create({
          data: { employeeId, classroomId: batch.classroomId, batchNo: batch.batchNo, assignedBy: coordinatorLoginId },
        });
      }

      await tx.batchMaster.update({
        where: { batchNo: batch.batchNo },
        data: { totalTrainees: { increment: 1 } },
      });

      await tx.onboardingLog.create({
        data: {
          batchNo: batch.batchNo,
          employeeId,
          lmsId,
          traineeName,
          mobile,
          email,
          coordinatorLoginId,
          status: 'Success',
        },
      });
      return created;
    });
  } catch (error) {
    if (error.code === 'P2002') return { ok: false, message: 'A conflicting employee, LMS, email, or mobile identity already exists.' };
    throw error;
  }

  let deliveryResults = [];
  try {
    deliveryResults = await notifyOnboarding({
      traineeName,
      employeeId,
      mobile,
      email,
      batchNo: batch.batchNo,
      classroomName: batch.classroomName,
      process: batch.process,
      tempPassword,
    });
  } catch (error) {
    console.error(`[NOTIFY] Onboarding delivery failed for ${employeeId}:`, error.message);
  }
  const credentialDelivered = deliveryResults.some(result => result?.ok);

  await audit({
    userIdentity: coordinatorLoginId,
    userRole: 'Coordinator',
    action: 'ONBOARD_TRAINEE',
    module: 'Trainee',
    referenceId: employeeId,
    newValue: { batchNo: batch.batchNo, lmsId, credentialDelivered, channelsAttempted: deliveryResults.length },
  });

  return {
    ok: true,
    data: {
      employeeId: trainee.employeeId,
      lmsId: trainee.lmsId,
      traineeName: trainee.traineeName,
      batchNo: trainee.batchNo,
      branch: trainee.branch,
      process: trainee.process,
      lob: trainee.lob,
      credentialDelivered,
    },
    message: credentialDelivered
      ? `${traineeName} was onboarded and a one-time credential was sent through an enabled registered channel.`
      : `${traineeName} was onboarded, but no credential channel confirmed delivery. A super administrator must complete secure account activation.`,
    warning: credentialDelivered ? null : 'CREDENTIAL_DELIVERY_NOT_CONFIRMED',
  };
}

function normalizedResult(value) {
  return String(value || '').trim().toLowerCase();
}

// Process Quality is an ERROR RATE recorded once per training day as evidence rows
// typed pq_day1 .. pq_dayN. Only the days actually recorded count, so a trainee
// part-way through the week is measured on the days they have. Lower is better: the
// average must come in at or BELOW pqMaxErrorPct, the opposite of every other gate.
const PQ_TYPE_PREFIX = 'pq_day';

export function pqDayNumber(evidenceType) {
  const match = /^pq_day(\d{1,2})$/.exec(String(evidenceType || ''));
  return match ? Number(match[1]) : null;
}

export function summarisePq(evidence, rule) {
  const maxError = Number(rule?.pqMaxErrorPct ?? 2.5);
  const days = Math.max(1, Number(rule?.pqDays ?? 5));
  const scores = new Map();
  for (const item of evidence || []) {
    const day = pqDayNumber(item.evidenceType);
    if (!day || day > days) continue;
    // A day re-scored later supersedes the earlier attempt.
    const previous = scores.get(day);
    if (!previous || new Date(item.conductedAt || item.createdAt || 0) >= new Date(previous.conductedAt || previous.createdAt || 0)) {
      scores.set(day, item);
    }
  }
  const recorded = [...scores.entries()].sort((a, b) => a[0] - b[0]).map(([day, item]) => ({ day, scorePct: Number(item.scorePct || 0) }));
  const average = recorded.length
    ? recorded.reduce((sum, row) => sum + row.scorePct, 0) / recorded.length
    : null;
  const rounded = average === null ? null : Math.round(average * 100) / 100;
  return {
    required: Boolean(rule?.pqRequired),
    maxError,
    days,
    recorded,
    recordedCount: recorded.length,
    average: rounded,
    // At or below the ceiling passes. Inverting this silently certifies the worst
    // performers, so it is asserted directly in process-quality-regressions.test.js.
    meetsTarget: rounded !== null && rounded <= maxError,
  };
}

function passingEvidence(evidence, type, minimumScore) {
  return evidence.some(item =>
    item.evidenceType === type &&
    normalizedResult(item.result) === 'pass' &&
    Number(item.scorePct || 0) >= Number(minimumScore || 0)
  );
}

async function evaluateCertification(trainee, batchNo) {
  const [rule, evidence, blockingRisks] = await Promise.all([
    trainee.process && trainee.lob
      ? prisma.certificationRuleMaster.findFirst({ where: { process: trainee.process, lob: trainee.lob, active: true } })
      : null,
    prisma.certificationEvidence.findMany({ where: { employeeId: trainee.employeeId, batchNo } }),
    prisma.trainingRiskLog.findMany({
      where: { employeeId: trainee.employeeId, batchNo, status: 'Open', severity: 'CRITICAL' },
      select: { riskType: true, riskTitle: true },
    }),
  ]);

  const thresholds = {
    courseCompletionMin: Number(rule?.courseCompletionMin ?? 80),
    mcqPassPctMin: Number(rule?.mcqPassPctMin ?? 60),
    attendancePctMin: Number(rule?.attendancePctMin ?? 70),
  };
  const blockers = [];
  if (trainee.status !== 'Active') blockers.push(`Trainee status is ${trainee.status || 'not active'}`);
  if (Number(trainee.courseCompletionPct || 0) < thresholds.courseCompletionMin) blockers.push(`Course completion ${Number(trainee.courseCompletionPct || 0)}% is below ${thresholds.courseCompletionMin}%`);
  if (Number(trainee.assessmentPassPct || 0) < thresholds.mcqPassPctMin) blockers.push(`Assessment pass ${Number(trainee.assessmentPassPct || 0)}% is below ${thresholds.mcqPassPctMin}%`);
  if (Number(trainee.attendancePct || 0) < thresholds.attendancePctMin) blockers.push(`Attendance ${Number(trainee.attendancePct || 0)}% is below ${thresholds.attendancePctMin}%`);
  if (rule?.mockCallRequired && !passingEvidence(evidence, 'mock_call', rule.mockCallPassPct)) blockers.push(`Passing mock-call evidence of at least ${Number(rule.mockCallPassPct || 0)}% is required`);
  if (rule?.internalCertRequired && !passingEvidence(evidence, 'internal', rule.internalCertPassPct)) blockers.push(`Passing internal-certification evidence of at least ${Number(rule.internalCertPassPct || 0)}% is required`);
  if (rule?.externalCertRequired && !passingEvidence(evidence, 'external', rule.externalCertPassPct)) blockers.push(`Passing external-certification evidence of at least ${Number(rule.externalCertPassPct || 0)}% is required`);
  const pq = summarisePq(evidence, rule);
  if (pq.required) {
    if (!pq.recordedCount) blockers.push(`No Process Quality scores recorded yet (max ${pq.maxError}% error rate across ${pq.days} days)`);
    else if (!pq.meetsTarget) blockers.push(`Process Quality error rate ${pq.average}% across ${pq.recordedCount} day${pq.recordedCount === 1 ? '' : 's'} exceeds the ${pq.maxError}% limit`);
  }
  if (blockingRisks.length) blockers.push(`Resolve ${blockingRisks.length} open critical risk${blockingRisks.length === 1 ? '' : 's'} before certification`);

  return { eligible: blockers.length === 0, blockers, thresholds, pq, ruleId: rule?.ruleId || null, evidenceCount: evidence.length, blockingRisks };
}

router.get('/trainees/search', ...auth, async (req, res) => {
  try {
    const query = String(req.query?.q || '').trim();
    if (query.length < 2) return res.json({ ok: true, data: [] });
    const batchNos = await ownedBatchNumbers(req);
    if (!batchNos.length) return res.json({ ok: true, data: [] });
    const take = Math.min(50, Math.max(1, Number.parseInt(req.query?.limit || '10', 10)));
    const trainees = await prisma.traineeMaster.findMany({
      where: {
        batchNo: { in: batchNos },
        status: { not: 'Deleted' },
        OR: [
          { employeeId: { contains: query } },
          { lmsId: { contains: query } },
          { traineeName: { contains: query } },
        ],
      },
      take,
      orderBy: { traineeName: 'asc' },
      select: { employeeId: true, lmsId: true, traineeName: true, batchNo: true, branch: true, process: true, lob: true, status: true },
    });
    return res.json({ ok: true, data: trainees });
  } catch (error) {
    console.error('[coordinatorStability] trainee search failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/trainees', ...auth, async (req, res) => {
  try {
    if (!req.coordinator?.canOnboardTrainee) return res.status(403).json({ ok: false, message: 'No permission to onboard trainees.' });
    const batch = await getWritableBatch(req.params.batchNo, req);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    const result = await createTraineeAccount(req.body, batch, req.userId);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    console.error('[coordinatorStability] trainee onboarding failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/trainees/bulk', ...auth, async (req, res) => {
  try {
    if (!req.coordinator?.canOnboardTrainee) return res.status(403).json({ ok: false, message: 'No permission to onboard trainees.' });
    const batch = await getWritableBatch(req.params.batchNo, req);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    const rows = Array.isArray(req.body?.trainees) ? req.body.trainees : [];
    if (!rows.length) return res.status(400).json({ ok: false, message: 'No trainees provided.' });
    if (rows.length > 500) return res.status(400).json({ ok: false, message: 'Maximum 500 trainees per bulk request.' });

    const results = [];
    for (const row of rows) results.push(await createTraineeAccount(row, batch, req.userId));
    const success = results.filter(result => result.ok).length;
    return res.json({
      ok: true,
      data: {
        total: rows.length,
        success,
        failed: rows.length - success,
        credentialDeliveryWarnings: results.filter(result => result.warning).length,
        results,
      },
    });
  } catch (error) {
    console.error('[coordinatorStability] bulk onboarding failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/trainees/enroll-existing', ...auth, async (req, res) => {
  try {
    if (!req.coordinator?.canOnboardTrainee) return res.status(403).json({ ok: false, message: 'No permission to enrol trainees.' });
    const batch = await getWritableBatch(req.params.batchNo, req);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    const employeeId = normalize(req.body?.employeeId || '');
    if (!employeeId) return res.status(400).json({ ok: false, message: 'Employee ID is required.' });

    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee || trainee.status === 'Deleted') return res.status(404).json({ ok: false, message: 'Active LMS trainee not found.' });
    if (trainee.batchNo === batch.batchNo) return res.json({ ok: true, alreadyEnrolled: true, message: 'Trainee is already enrolled in this batch.' });
    const previousBatchNo = trainee.batchNo;

    await prisma.$transaction(async tx => {
      await tx.traineeMaster.update({
        where: { employeeId },
        data: {
          batchNo: batch.batchNo,
          branch: batch.branch,
          process: batch.process,
          lob: batch.lob,
          classroomId: batch.classroomId,
          classroomName: batch.classroomName,
          courseCompletionPct: 0,
          assessmentAttemptPct: 0,
          assessmentPassPct: 0,
          attendancePct: 0,
          riskStatus: 'HEALTHY',
          riskReason: null,
          ojtReady: false,
          nestingStatus: 'Not Started',
          certificationStatus: 'Not Certified',
          handoverToOps: false,
          status: 'Active',
        },
      });
      await tx.userMaster.updateMany({
        where: { employeeId },
        data: { batchNo: batch.batchNo, branch: batch.branch, process: batch.process, lob: batch.lob, classroomId: batch.classroomId, active: true },
      });
      await tx.traineeClassroomMap.updateMany({ where: { employeeId }, data: { active: false } });
      if (batch.classroomId) {
        await tx.traineeClassroomMap.upsert({
          where: { employeeId_classroomId: { employeeId, classroomId: batch.classroomId } },
          create: { employeeId, classroomId: batch.classroomId, batchNo: batch.batchNo, assignedBy: req.userId },
          update: { active: true, batchNo: batch.batchNo, assignedBy: req.userId },
        });
      }
      await tx.batchMaster.update({ where: { batchNo: batch.batchNo }, data: { totalTrainees: { increment: 1 } } });
      if (previousBatchNo) {
        await tx.batchMaster.updateMany({
          where: { batchNo: previousBatchNo, totalTrainees: { gt: 0 } },
          data: { totalTrainees: { decrement: 1 } },
        });
      }
    });

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'ENROLL_EXISTING', module: 'Trainee', referenceId: employeeId, oldValue: { batchNo: previousBatchNo }, newValue: { batchNo: batch.batchNo } });
    notifyBatchAssignment({ traineeName: trainee.traineeName, mobile: trainee.mobile, email: trainee.email, batchNo: batch.batchNo, classroomName: batch.classroomName, process: batch.process }).catch(error => console.error('[NOTIFY] Re-enrolment notification failed:', error.message));
    return res.json({ ok: true, message: `${trainee.traineeName || employeeId} was enrolled in ${batch.batchNo}.` });
  } catch (error) {
    console.error('[coordinatorStability] existing trainee enrolment failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.patch('/pending-activities/:id', ...auth, async (req, res) => {
  try {
    const activity = await prisma.pendingActivityLog.findUnique({ where: { id: req.params.id } });
    if (!activity?.batchNo || !await getWritableBatch(activity.batchNo, req)) return res.status(403).json({ ok: false, message: 'Access denied for this activity.' });
    const status = String(req.body?.status || 'Actioned');
    if (!['Open', 'Actioned', 'Closed'].includes(status)) return res.status(400).json({ ok: false, message: 'Invalid activity status.' });
    const closureRemarks = String(req.body?.closureRemarks || '').trim();
    if (status === 'Closed' && !closureRemarks) return res.status(400).json({ ok: false, message: 'Closure remarks are required.' });
    const updated = await prisma.pendingActivityLog.update({
      where: { id: activity.id },
      data: {
        actionTaken: String(req.body?.actionTaken || '').trim() || null,
        status,
        actionBy: req.userId,
        actionAt: new Date(),
        followUpDate: safeDate(req.body?.followUpDate),
        closureRemarks: closureRemarks || null,
        closedAt: status === 'Closed' ? new Date() : null,
      },
    });
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'UPDATE_PENDING_ACTIVITY', module: 'Risk', referenceId: activity.id, oldValue: { status: activity.status }, newValue: { status } });
    return res.json({ ok: true, data: updated });
  } catch (error) {
    console.error('[coordinatorStability] pending activity update failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.patch('/queries/:id', ...auth, async (req, res) => {
  try {
    const query = await prisma.traineeQueryLog.findUnique({ where: { id: req.params.id } });
    if (!query?.batchNo || !await getWritableBatch(query.batchNo, req)) return res.status(403).json({ ok: false, message: 'Access denied for this query.' });
    const answer = String(req.body?.answer || req.body?.coordinatorAnswer || '').trim();
    if (!answer) return res.status(400).json({ ok: false, message: 'Answer is required.' });
    const now = new Date();
    const resolutionTatHours = Math.max(0, (now.getTime() - new Date(query.createdAt).getTime()) / 3600000);
    const updated = await prisma.traineeQueryLog.update({
      where: { id: query.id },
      data: { coordinatorAnswer: answer, answeredBy: req.userId, answeredAt: now, closedAt: now, status: 'Closed', resolutionTatHours },
    });
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'ANSWER_TRAINEE_QUERY', module: 'Q&A', referenceId: query.queryId, newValue: { batchNo: query.batchNo, resolutionTatHours } });
    return res.json({ ok: true, data: updated });
  } catch (error) {
    console.error('[coordinatorStability] query answer failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.patch('/risks/:id', ...auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { actionTaken, status = 'Actioned', followUpDate, closureRemarks } = req.body;
    const validStatuses = new Set(['Open', 'Actioned', 'Closed']);
    if (!validStatuses.has(status)) return res.status(400).json({ ok: false, message: 'Invalid risk status.' });
    if (status === 'Closed' && !String(closureRemarks || '').trim()) return res.status(400).json({ ok: false, message: 'Closure remarks are required to close a risk.' });
    const risk = await prisma.trainingRiskLog.findUnique({ where: { id } });
    if (!risk?.batchNo || !await getWritableBatch(risk.batchNo, req)) return res.status(403).json({ ok: false, message: 'Access denied for this risk.' });

    const updated = await prisma.$transaction(async tx => {
      const savedRisk = await tx.trainingRiskLog.update({
        where: { id },
        data: { actionTaken: String(actionTaken || '').trim() || null, status, actionBy: req.userId, actionAt: new Date(), followUpDate: safeDate(followUpDate), closureRemarks: String(closureRemarks || '').trim() || null, closedAt: status === 'Closed' ? new Date() : null },
      });
      if (risk.riskKey) {
        await tx.pendingActivityLog.updateMany({
          where: { referenceId: risk.riskKey },
          data: { status: status === 'Closed' ? 'Closed' : status, actionTaken: String(actionTaken || '').trim() || null, actionBy: req.userId, actionAt: new Date(), closureRemarks: String(closureRemarks || '').trim() || null, closedAt: status === 'Closed' ? new Date() : null },
        });
      }
      return savedRisk;
    });
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'UPDATE_RISK_ACTION', module: 'Risk', referenceId: id, oldValue: { status: risk.status }, newValue: { status: updated.status, batchNo: risk.batchNo } });
    return res.json({ ok: true, data: updated });
  } catch (error) {
    console.error('[coordinatorStability] risk update failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.get('/batches/:batchNo/certification', ...auth, async (req, res) => {
  try {
    const batch = await getVisibleBatch(req.params.batchNo, req);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    const trainees = await prisma.traineeMaster.findMany({ where: { batchNo: batch.batchNo }, orderBy: { traineeName: 'asc' } });
    const rule = trainees[0]?.process && trainees[0]?.lob ? await prisma.certificationRuleMaster.findFirst({ where: { process: trainees[0].process, lob: trainees[0].lob, active: true } }) : null;
    const evidence = await prisma.certificationEvidence.findMany({ where: { batchNo: batch.batchNo } });
    const rows = await Promise.all(trainees.map(async trainee => ({ ...trainee, evidence: evidence.filter(item => item.employeeId === trainee.employeeId), eligibility: await evaluateCertification(trainee, batch.batchNo) })));
    return res.json({ ok: true, data: { rule, trainees: rows } });
  } catch (error) {
    console.error('[coordinatorStability] certification data failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/certification/evidence', ...auth, async (req, res) => {
  try {
    const batch = await getWritableBatch(req.params.batchNo, req);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    const employeeId = String(req.body?.employeeId || '').trim();
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
    if (!trainee || trainee.batchNo !== batch.batchNo) return res.status(400).json({ ok: false, message: 'Trainee is not in this batch.' });
    const evidenceType = String(req.body?.evidenceType || '').trim();
    const result = String(req.body?.result || '').trim();
    const pqDay = pqDayNumber(evidenceType);
    if (pqDay !== null) {
      const rule = trainee.process && trainee.lob
        ? await prisma.certificationRuleMaster.findFirst({ where: { process: trainee.process, lob: trainee.lob, active: true } })
        : null;
      const maxDays = Number(rule?.pqDays ?? 0);
      if (maxDays < 1) return res.status(400).json({ ok: false, message: 'This process does not track Process Quality.' });
      if (pqDay < 1 || pqDay > maxDays) return res.status(400).json({ ok: false, message: `Process Quality day must be between 1 and ${maxDays}.` });
    } else if (!['mock_call', 'internal', 'external'].includes(evidenceType)) {
      return res.status(400).json({ ok: false, message: 'Invalid evidence type.' });
    }
    if (!['Pass', 'Fail'].includes(result)) return res.status(400).json({ ok: false, message: 'Evidence result must be Pass or Fail.' });
    const scorePct = Number(req.body?.scorePct || 0);
    if (!Number.isFinite(scorePct) || scorePct < 0 || scorePct > 100) return res.status(400).json({ ok: false, message: 'Score must be between 0 and 100.' });
    const evidence = await prisma.certificationEvidence.create({
      data: { employeeId, batchNo: batch.batchNo, evidenceType, result, scorePct, conductedBy: String(req.body?.conductedBy || '').trim() || req.userId, conductedAt: safeDate(req.body?.conductedAt) || new Date(), remarks: String(req.body?.remarks || '').trim() || null, createdBy: req.userId },
    });
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'ADD_CERTIFICATION_EVIDENCE', module: 'Certification', referenceId: employeeId, newValue: { batchNo: batch.batchNo, evidenceType, result, scorePct } });
    return res.json({ ok: true, data: evidence });
  } catch (error) {
    console.error('[coordinatorStability] certification evidence failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/certification/certify', ...auth, async (req, res) => {
  try {
    const { batchNo } = req.params;
    const employeeId = String(req.body?.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ ok: false, message: 'Employee ID required.' });
    const [batch, trainee] = await Promise.all([getWritableBatch(batchNo, req), prisma.traineeMaster.findUnique({ where: { employeeId } })]);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    if (!trainee || trainee.batchNo !== batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });
    if (trainee.certificationStatus === 'Certified') return res.json({ ok: true, alreadyCertified: true, message: `${employeeId} is already certified.` });

    const eligibility = await evaluateCertification(trainee, batchNo);
    if (!eligibility.eligible) {
      await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'CERTIFICATION_REJECTED', module: 'Certification', referenceId: employeeId, status: 'Rejected', newValue: { batchNo, blockers: eligibility.blockers } });
      return res.status(409).json({ ok: false, eligible: false, message: 'Trainee does not meet certification requirements.', blockers: eligibility.blockers, eligibility });
    }

    const updated = await prisma.$transaction(async tx => {
      const claimed = await tx.traineeMaster.updateMany({ where: { employeeId, batchNo, certificationStatus: { not: 'Certified' }, status: 'Active' }, data: { certificationStatus: 'Certified' } });
      if (!claimed.count) return null;
      await tx.batchMaster.update({ where: { batchNo }, data: { certified: { increment: 1 } } });
      return tx.traineeMaster.findUnique({ where: { employeeId } });
    });
    if (!updated) return res.status(409).json({ ok: false, message: 'Certification state changed. Refresh and try again.' });
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'CERTIFY_TRAINEE', module: 'Certification', referenceId: employeeId, newValue: { batchNo, eligibility } });
    notifyCertification({ traineeName: updated.traineeName, employeeId, email: updated.email, mobile: updated.mobile, batchNo: batch.batchNo, batchName: batch.batchName, process: batch.process, lob: batch.lob }).catch(error => console.error(`[NOTIFY] Cert notification failed for ${employeeId}:`, error.message));
    return res.json({ ok: true, eligible: true, message: `${employeeId} certified.`, eligibility });
  } catch (error) {
    console.error('[coordinatorStability] certification failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/certification/handover', ...auth, async (req, res) => {
  try {
    const { batchNo } = req.params;
    const employeeId = String(req.body?.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ ok: false, message: 'Employee ID required.' });
    const [batch, trainee] = await Promise.all([getWritableBatch(batchNo, req), prisma.traineeMaster.findUnique({ where: { employeeId } })]);
    if (!batch) return res.status(403).json({ ok: false, message: 'Only the coordinator assigned to this batch can make this change.' });
    if (!trainee || trainee.batchNo !== batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });
    if (trainee.certificationStatus !== 'Certified') return res.status(409).json({ ok: false, message: 'Only certified trainees can be handed over to operations.' });
    if (trainee.handoverToOps) return res.json({ ok: true, alreadyHandedOver: true, message: `${employeeId} is already handed over to OPS.` });

    const updated = await prisma.$transaction(async tx => {
      const claimed = await tx.traineeMaster.updateMany({ where: { employeeId, batchNo, certificationStatus: 'Certified', handoverToOps: false }, data: { handoverToOps: true } });
      if (!claimed.count) return false;
      await tx.batchMaster.update({ where: { batchNo }, data: { handoverToOps: { increment: 1 } } });
      return true;
    });
    if (!updated) return res.status(409).json({ ok: false, message: 'Handover state changed. Refresh and try again.' });
    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'HANDOVER_TO_OPS', module: 'Certification', referenceId: employeeId, newValue: { batchNo, certificationStatus: trainee.certificationStatus } });
    return res.json({ ok: true, message: `${employeeId} handed over to OPS.` });
  } catch (error) {
    console.error('[coordinatorStability] handover failed:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});


// Same list the admin console uses, narrowed to the coordinator's own branch.
router.get('/form-options', ...auth, async (req, res) => {
  try {
    const options = await getFormOptions();
    return res.json({ ok: true, data: scopeFormOptions(options, req.userBranch) });
  } catch (error) {
    console.error('[coordinatorStability] form options failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to load form options.' });
  }
});

export default router;
