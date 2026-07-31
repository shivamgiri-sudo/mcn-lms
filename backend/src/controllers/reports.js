import { prisma } from '../utils/db.js';
import { sendDailySummaryEmail } from '../utils/mailer.js';

function hasManagementScope(req) {
  return req.userType === 'coordinator' && Boolean(
    req.coordinator?.canViewManagementDashboard ||
    req.coordinator?.role === 'CEO' ||
    req.coordinator?.role === 'Super Admin'
  );
}

async function canReadBatch(req, batchNo) {
  const batch = await prisma.batchMaster.findUnique({
    where: { batchNo },
    select: { batchNo: true, branch: true, coordinatorLoginId: true },
  });
  if (!batch) return { allowed: false, status: 404, message: 'Batch not found.' };

  if (req.userType === 'admin') {
    if (req.userBranch && batch.branch !== req.userBranch) {
      return { allowed: false, status: 403, message: 'This batch is outside your branch scope.' };
    }
    return { allowed: true, batch };
  }

  if (hasManagementScope(req)) return { allowed: true, batch };

  if (req.userType === 'coordinator' && batch.coordinatorLoginId === req.userId) {
    return { allowed: true, batch };
  }

  return { allowed: false, status: 403, message: 'Access denied for this batch.' };
}

function safeCsvValue(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet formula injection when an exported CSV is opened.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export async function getBatchReport(req, res) {
  try {
    const { batchNo } = req.params;
    const access = await canReadBatch(req, batchNo);
    if (!access.allowed) return res.status(access.status).json({ ok: false, message: access.message });

    const trainees = await prisma.traineeMaster.findMany({
      where: { batchNo, status: { not: 'Deleted' } },
      orderBy: { traineeName: 'asc' },
      select: {
        employeeId: true,
        traineeName: true,
        branch: true,
        process: true,
        lob: true,
        courseCompletionPct: true,
        assessmentPassPct: true,
        attendancePct: true,
        riskStatus: true,
        certificationStatus: true,
      },
    });

    const rows = trainees.map(t => ({
      employeeId: t.employeeId,
      name: t.traineeName,
      branch: t.branch,
      process: t.process,
      lob: t.lob,
      courseCompletion: `${t.courseCompletionPct}%`,
      mcqPass: `${t.assessmentPassPct}%`,
      attendance: `${t.attendancePct}%`,
      riskStatus: t.riskStatus,
      certificationStatus: t.certificationStatus,
    }));

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[REPORTS] Batch report failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportTraineesCsv(req, res) {
  try {
    const { batchNo } = req.query;
    const where = { status: { not: 'Deleted' } };

    if (batchNo) {
      const access = await canReadBatch(req, String(batchNo));
      if (!access.allowed) return res.status(access.status).json({ ok: false, message: access.message });
      where.batchNo = String(batchNo);
    }

    if (req.userType === 'admin' && req.userBranch) where.branch = req.userBranch;

    const trainees = await prisma.traineeMaster.findMany({
      where,
      take: 5000,
      orderBy: [{ batchNo: 'asc' }, { employeeId: 'asc' }],
      select: {
        employeeId: true,
        lmsId: true,
        traineeName: true,
        batchNo: true,
        branch: true,
        process: true,
        lob: true,
        courseCompletionPct: true,
        assessmentPassPct: true,
        attendancePct: true,
        riskStatus: true,
        certificationStatus: true,
      },
    });

    const headers = ['Employee ID', 'LMS ID', 'Name', 'Batch No', 'Branch', 'Process', 'LOB', 'Course %', 'MCQ %', 'Attendance %', 'Risk Status', 'Certification'];
    const rows = trainees.map(t => [
      t.employeeId, t.lmsId, t.traineeName, t.batchNo, t.branch, t.process, t.lob,
      t.courseCompletionPct, t.assessmentPassPct, t.attendancePct, t.riskStatus, t.certificationStatus,
    ]);

    const csv = [headers, ...rows].map(row => row.map(safeCsvValue).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trainees-${Date.now()}.csv"`);
    return res.send(`\uFEFF${csv}`);
  } catch (err) {
    console.error('[REPORTS] Trainee export failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function sendDailySummary(req, res) {
  try {
    const rawRecipients = Array.isArray(req.body?.to) ? req.body.to : [req.body?.to];
    const recipients = [...new Set(rawRecipients.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];

    if (!recipients.length) return res.status(400).json({ ok: false, message: 'Recipient required.' });
    if (recipients.length > 20) return res.status(400).json({ ok: false, message: 'Maximum 20 recipients per request.' });
    if (recipients.some(email => !validEmail(email))) {
      return res.status(400).json({ ok: false, message: 'One or more recipient addresses are invalid.' });
    }

    await sendDailySummaryEmail(recipients);
    return res.json({ ok: true, message: 'Email sent.' });
  } catch (err) {
    console.error('[REPORTS] Daily summary send failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Email failed.' });
  }
}
