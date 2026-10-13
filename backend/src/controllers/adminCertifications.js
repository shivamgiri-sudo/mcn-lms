import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

function parseDate(raw) {
  if (!raw) return null;
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + 'T00:00:00.000Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function bulkCertifyTrainees(req, res) {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ ok: false, message: 'No records provided.' });
    }
    if (records.length > 2000) {
      return res.status(400).json({ ok: false, message: 'Maximum 2000 records per batch.' });
    }

    const certified = [];
    const alreadyCertified = [];
    const notFound = [];
    const errors = [];

    for (const row of records) {
      const employeeId = String(row.employeeId || row.employee_id || row.empid || row.emp_id || '').trim();
      const rawDate = String(row.certificationDate || row.certification_date || row.date || '').trim();

      if (!employeeId) {
        errors.push({ employeeId: '(blank)', reason: 'Missing employeeId' });
        continue;
      }

      const certDate = parseDate(rawDate);

      try {
        const trainee = await prisma.traineeMaster.findUnique({
          where: { employeeId },
          select: { employeeId: true, traineeName: true, batchNo: true, certificationStatus: true, status: true },
        });

        if (!trainee) {
          notFound.push(employeeId);
          continue;
        }
        if (trainee.certificationStatus === 'Certified') {
          alreadyCertified.push(employeeId);
          continue;
        }

        await prisma.$transaction(async tx => {
          await tx.traineeMaster.update({
            where: { employeeId },
            data: { certificationStatus: 'Certified' },
          });

          if (trainee.batchNo) {
            await tx.batchMaster.update({
              where: { batchNo: trainee.batchNo },
              data: { certified: { increment: 1 } },
            });
          }

          await tx.certificationEvidence.create({
            data: {
              employeeId,
              batchNo: trainee.batchNo || null,
              evidenceType: 'historical_certification',
              result: 'Pass',
              scorePct: 100,
              conductedAt: certDate,
              conductedBy: 'Historical Import',
              remarks: rawDate ? `Bulk certification import — original date: ${rawDate}` : 'Bulk certification import',
              createdBy: req.userId,
            },
          });
        });

        certified.push({ employeeId, traineeName: trainee.traineeName, certDate: rawDate });
      } catch (err) {
        errors.push({ employeeId, reason: err.message });
      }
    }

    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: 'BULK_CERTIFY_HISTORICAL',
      module: 'Certification',
      referenceId: `batch:${records.length}`,
      details: `Bulk certified ${certified.length}, already certified ${alreadyCertified.length}, not found ${notFound.length}, errors ${errors.length}`,
      newValue: { certified: certified.length, alreadyCertified: alreadyCertified.length, notFound, errors },
    });

    res.json({
      ok: true,
      message: `Certified ${certified.length} trainee(s).`,
      certified: certified.length,
      alreadyCertified: alreadyCertified.length,
      notFound,
      errors,
      certifiedList: certified,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}
