import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];

async function computeBatchCounters(batchNo) {
  const [totalTrainees, certified, handoverToOps, ojtReady] = await Promise.all([
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' } } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, certificationStatus: 'Certified' } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, handoverToOps: true } }),
    prisma.traineeMaster.count({ where: { batchNo, status: { not: 'Deleted' }, ojtReady: true } }),
  ]);
  return { totalTrainees, certified, handoverToOps, ojtReady };
}

router.post('/reconcile/batch-counters', ...auth, async (req, res) => {
  try {
    const requestedBatchNo = String(req.body?.batchNo || '').trim();
    const where = requestedBatchNo ? { batchNo: requestedBatchNo } : {};
    const batches = await prisma.batchMaster.findMany({ where, orderBy: { lastUpdatedAt: 'desc' } });

    if (requestedBatchNo && batches.length === 0) {
      return res.status(404).json({ ok: false, message: `Batch ${requestedBatchNo} not found.` });
    }

    const results = [];
    for (const batch of batches) {
      const before = {
        totalTrainees: batch.totalTrainees || 0,
        certified: batch.certified || 0,
        handoverToOps: batch.handoverToOps || 0,
        ojtReady: batch.ojtReady || 0,
      };
      const after = await computeBatchCounters(batch.batchNo);
      const changed = before.totalTrainees !== after.totalTrainees
        || before.certified !== after.certified
        || before.handoverToOps !== after.handoverToOps
        || before.ojtReady !== after.ojtReady;

      if (changed) {
        await prisma.batchMaster.update({
          where: { batchNo: batch.batchNo },
          data: after,
        });
      }

      results.push({
        batchNo: batch.batchNo,
        batchName: batch.batchName,
        changed,
        before,
        after,
      });
    }

    const changedCount = results.filter(r => r.changed).length;
    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'RECONCILE_BATCH_COUNTERS',
      module: 'Batch',
      referenceId: requestedBatchNo || 'ALL_BATCHES',
      newValue: { totalBatches: results.length, changedCount },
    });

    return res.json({ ok: true, summary: { totalBatches: results.length, changedCount }, results });
  } catch (err) {
    console.error('[adminStability] batch counter reconciliation failed:', err);
    return res.status(500).json({ ok: false, message: 'Batch counter reconciliation failed.' });
  }
});

export default router;
