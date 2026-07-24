import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyCertification } from '../utils/notify.js';

const router = Router();
const auth = [requireSession, requireRole('coordinator')];

async function getOwnedBatch(batchNo, coordinatorLoginId) {
  return prisma.batchMaster.findFirst({ where: { batchNo, coordinatorLoginId } });
}

function safeDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizedResult(value) {
  return String(value || '').trim().toLowerCase();
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
  if (Number(trainee.courseCompletionPct || 0) < thresholds.courseCompletionMin) {
    blockers.push(`Course completion ${Number(trainee.courseCompletionPct || 0)}% is below ${thresholds.courseCompletionMin}%`);
  }
  if (Number(trainee.assessmentPassPct || 0) < thresholds.mcqPassPctMin) {
    blockers.push(`Assessment pass ${Number(trainee.assessmentPassPct || 0)}% is below ${thresholds.mcqPassPctMin}%`);
  }
  if (Number(trainee.attendancePct || 0) < thresholds.attendancePctMin) {
    blockers.push(`Attendance ${Number(trainee.attendancePct || 0)}% is below ${thresholds.attendancePctMin}%`);
  }

  if (rule?.mockCallRequired && !passingEvidence(evidence, 'mock_call', rule.mockCallPassPct)) {
    blockers.push(`Passing mock-call evidence of at least ${Number(rule.mockCallPassPct || 0)}% is required`);
  }
  if (rule?.internalCertRequired && !passingEvidence(evidence, 'internal', rule.internalCertPassPct)) {
    blockers.push(`Passing internal-certification evidence of at least ${Number(rule.internalCertPassPct || 0)}% is required`);
  }
  if (rule?.externalCertRequired && !passingEvidence(evidence, 'external', rule.externalCertPassPct)) {
    blockers.push(`Passing external-certification evidence of at least ${Number(rule.externalCertPassPct || 0)}% is required`);
  }
  if (blockingRisks.length) {
    blockers.push(`Resolve ${blockingRisks.length} open critical risk${blockingRisks.length === 1 ? '' : 's'} before certification`);
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    thresholds,
    ruleId: rule?.ruleId || null,
    evidenceCount: evidence.length,
    blockingRisks,
  };
}

router.patch('/risks/:id', ...auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { actionTaken, status = 'Actioned', followUpDate, closureRemarks } = req.body;
    const validStatuses = new Set(['Open', 'Actioned', 'Closed']);
    if (!validStatuses.has(status)) return res.status(400).json({ ok: false, message: 'Invalid risk status.' });
    if (status === 'Closed' && !String(closureRemarks || '').trim()) {
      return res.status(400).json({ ok: false, message: 'Closure remarks are required to close a risk.' });
    }

    const risk = await prisma.trainingRiskLog.findUnique({ where: { id } });
    if (!risk) return res.status(404).json({ ok: false, message: 'Risk not found.' });
    if (!risk.batchNo) return res.status(403).json({ ok: false, message: 'Risk is not linked to a coordinator batch.' });

    const ownedBatch = await getOwnedBatch(risk.batchNo, req.userId);
    if (!ownedBatch) return res.status(403).json({ ok: false, message: 'Access denied for this risk.' });

    const updated = await prisma.$transaction(async tx => {
      const savedRisk = await tx.trainingRiskLog.update({
        where: { id },
        data: {
          actionTaken: String(actionTaken || '').trim() || null,
          status,
          actionBy: req.userId,
          actionAt: new Date(),
          followUpDate: safeDate(followUpDate),
          closureRemarks: String(closureRemarks || '').trim() || null,
          closedAt: status === 'Closed' ? new Date() : null,
        },
      });

      if (risk.riskKey) {
        await tx.pendingActivityLog.updateMany({
          where: { referenceId: risk.riskKey },
          data: {
            status: status === 'Closed' ? 'Closed' : status,
            actionTaken: String(actionTaken || '').trim() || null,
            actionBy: req.userId,
            actionAt: new Date(),
            closureRemarks: String(closureRemarks || '').trim() || null,
            closedAt: status === 'Closed' ? new Date() : null,
          },
        });
      }

      return savedRisk;
    });

    await audit({
      userIdentity: req.userId,
      userRole: 'Coordinator',
      action: 'UPDATE_RISK_ACTION',
      module: 'Risk',
      referenceId: id,
      oldValue: { status: risk.status },
      newValue: { status: updated.status, batchNo: risk.batchNo },
    });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[coordinatorStability] risk update failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/certification/certify', ...auth, async (req, res) => {
  try {
    const { batchNo } = req.params;
    const employeeId = String(req.body?.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ ok: false, message: 'Employee ID required.' });

    const [batch, trainee] = await Promise.all([
      getOwnedBatch(batchNo, req.userId),
      prisma.traineeMaster.findUnique({ where: { employeeId } }),
    ]);

    if (!batch) return res.status(403).json({ ok: false, message: 'Access denied.' });
    if (!trainee || trainee.batchNo !== batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });

    if (trainee.certificationStatus === 'Certified') {
      return res.json({ ok: true, alreadyCertified: true, message: `${employeeId} is already certified.` });
    }

    const eligibility = await evaluateCertification(trainee, batchNo);
    if (!eligibility.eligible) {
      await audit({
        userIdentity: req.userId,
        userRole: 'Coordinator',
        action: 'CERTIFICATION_REJECTED',
        module: 'Certification',
        referenceId: employeeId,
        status: 'Rejected',
        newValue: { batchNo, blockers: eligibility.blockers },
      });
      return res.status(409).json({
        ok: false,
        eligible: false,
        message: 'Trainee does not meet certification requirements.',
        blockers: eligibility.blockers,
        eligibility,
      });
    }

    const updated = await prisma.$transaction(async tx => {
      const traineeUpdate = await tx.traineeMaster.updateMany({
        where: { employeeId, batchNo, certificationStatus: { not: 'Certified' }, status: 'Active' },
        data: { certificationStatus: 'Certified' },
      });
      if (traineeUpdate.count === 0) return null;

      await tx.batchMaster.update({
        where: { batchNo },
        data: { certified: { increment: 1 } },
      });
      return tx.traineeMaster.findUnique({ where: { employeeId } });
    });

    if (!updated) {
      return res.status(409).json({ ok: false, message: 'Certification state changed. Refresh and try again.' });
    }

    await audit({
      userIdentity: req.userId,
      userRole: 'Coordinator',
      action: 'CERTIFY_TRAINEE',
      module: 'Certification',
      referenceId: employeeId,
      newValue: { batchNo, eligibility },
    });

    notifyCertification({
      traineeName: updated.traineeName,
      employeeId,
      email: updated.email,
      mobile: updated.mobile,
      batchNo: batch.batchNo,
      batchName: batch.batchName,
      process: batch.process,
      lob: batch.lob,
    }).catch(err => console.error(`[NOTIFY] Cert notification failed for ${employeeId}:`, err.message));

    return res.json({ ok: true, eligible: true, message: `${employeeId} certified.`, eligibility });
  } catch (err) {
    console.error('[coordinatorStability] certification failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.post('/batches/:batchNo/certification/handover', ...auth, async (req, res) => {
  try {
    const { batchNo } = req.params;
    const employeeId = String(req.body?.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ ok: false, message: 'Employee ID required.' });

    const [batch, trainee] = await Promise.all([
      getOwnedBatch(batchNo, req.userId),
      prisma.traineeMaster.findUnique({ where: { employeeId } }),
    ]);

    if (!batch) return res.status(403).json({ ok: false, message: 'Access denied.' });
    if (!trainee || trainee.batchNo !== batchNo) return res.status(400).json({ ok: false, message: 'Trainee not in this batch.' });
    if (trainee.certificationStatus !== 'Certified') {
      return res.status(409).json({ ok: false, message: 'Only certified trainees can be handed over to operations.' });
    }
    if (trainee.handoverToOps) {
      return res.json({ ok: true, alreadyHandedOver: true, message: `${employeeId} is already handed over to OPS.` });
    }

    const updated = await prisma.$transaction(async tx => {
      const traineeUpdate = await tx.traineeMaster.updateMany({
        where: { employeeId, batchNo, certificationStatus: 'Certified', handoverToOps: false },
        data: { handoverToOps: true },
      });
      if (traineeUpdate.count === 0) return false;

      await tx.batchMaster.update({
        where: { batchNo },
        data: { handoverToOps: { increment: 1 } },
      });
      return true;
    });

    if (!updated) {
      return res.status(409).json({ ok: false, message: 'Handover state changed. Refresh and try again.' });
    }

    await audit({
      userIdentity: req.userId,
      userRole: 'Coordinator',
      action: 'HANDOVER_TO_OPS',
      module: 'Certification',
      referenceId: employeeId,
      newValue: { batchNo, certificationStatus: trainee.certificationStatus },
    });

    return res.json({ ok: true, message: `${employeeId} handed over to OPS.` });
  } catch (err) {
    console.error('[coordinatorStability] handover failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
