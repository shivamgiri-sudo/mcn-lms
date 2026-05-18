import { prisma } from './db.js';

/**
 * Auto-generates batch number: PRO_LOB_MON'YY_###
 * Example: ONF_KYC_MAY'26_001
 */
export async function generateBatchNo(process, lob, startDate) {
  const d = startDate ? new Date(startDate) : new Date();
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const yr = String(d.getFullYear()).slice(-2);
  const pro = (process || 'GEN').replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
  const lobCode = (lob || 'ALL').replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
  const prefix = `${pro}_${lobCode}_${mon}'${yr}_`;

  const existing = await prisma.batchMaster.findMany({
    where: { batchNo: { startsWith: prefix } },
    select: { batchNo: true },
  });

  let maxSeq = 0;
  for (const { batchNo } of existing) {
    const seq = parseInt(batchNo.split('_').pop(), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}
