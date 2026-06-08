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

// Stabilized risk action update: coordinator can update only risks belonging to own batches.
router.patch('/risks/:id', ...auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { actionTaken, status, followUpDate, closureRemarks } = req.body;

    const risk = await prisma.trainingRiskLog.findUnique({ where: { id } });
    if (!risk) return res.status(404).json({ ok: false, message: 'Risk not found.' });
    if (!risk.batchNo) return res.status(403).json({ ok: false, message: 'Risk is not linked to a coordinator batch.' });

    const ownedBatch = await getOwnedBatch(risk.batchNo, req.userId);
    if (!ownedBatch) return res.status(403).json({ ok: false, message: 'Access denied for this risk.' });

    const updated = await prisma.trainingRiskLog.update({
      where: { id },
      data: {
        actionTaken,
        status: status || 'Actioned',
        actionBy: req.userId,
        actionAt: new Date(),
        followUpDate: safeDate(followUpDate),
        closureRemarks,
      },
    });

    await audit({
      userIdentity: req.userId,
      userRole: 'Coordinator',
      action: 'UPDATE_RISK_ACTION',
      module: 'Risk',
      referenceId: id,
      newValue: { status: updated.status, batchNo: risk.batchNo },
    });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[coordinatorStability] risk update failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Stabilized certification: race-safe counter update and ownership check.
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

    const updated = await prisma.$transaction(async (tx) => {
      const traineeUpdate = await tx.traineeMaster.updateMany({
        where: { employeeId, batchNo, certificationStatus: { not: 'Certified' } },
        data: { certificationStatus: 'Certified' },
      });

      if (traineeUpdate.count === 0) {
        return null;
      }

      await tx.batchMaster.update({
        where: { batchNo },
        data: { certified: { increment: 1 } },
      });

      return tx.traineeMaster.findUnique({ where: { employeeId } });
    });

    if (!updated) {
      return res.json({ ok: true, alreadyCertified: true, message: `${employeeId} is already certified.` });
    }

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'CERTIFY_TRAINEE', module: 'Certification', referenceId: employeeId });

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

    return res.json({ ok: true, message: `${employeeId} certified.` });
  } catch (err) {
    console.error('[coordinatorStability] certification failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Stabilized handover: race-safe counter update and ownership check.
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

    if (trainee.handoverToOps) {
      return res.json({ ok: true, alreadyHandedOver: true, message: `${employeeId} is already handed over to OPS.` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const traineeUpdate = await tx.traineeMaster.updateMany({
        where: { employeeId, batchNo, handoverToOps: false },
        data: { handoverToOps: true },
      });

      if (traineeUpdate.count === 0) {
        return false;
      }

      await tx.batchMaster.update({
        where: { batchNo },
        data: { handoverToOps: { increment: 1 } },
      });

      return true;
    });

    if (!updated) {
      return res.json({ ok: true, alreadyHandedOver: true, message: `${employeeId} is already handed over to OPS.` });
    }

    await audit({ userIdentity: req.userId, userRole: 'Coordinator', action: 'HANDOVER_TO_OPS', module: 'Certification', referenceId: employeeId });

    return res.json({ ok: true, message: `${employeeId} handed over to OPS.` });
  } catch (err) {
    console.error('[coordinatorStability] handover failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
