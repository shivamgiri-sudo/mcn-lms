import { prisma } from '../utils/db.js';
import { sendDailySummaryEmail } from '../utils/mailer.js';

export async function getBatchReport(req, res) {
  try {
    const { batchNo } = req.params;
    const trainees = await prisma.traineeMaster.findMany({ where: { batchNo } });

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

    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportTraineesCsv(req, res) {
  try {
    const { batchNo } = req.query;
    const where = batchNo ? { batchNo } : {};
    const trainees = await prisma.traineeMaster.findMany({ where, take: 5000 });

    const headers = ['Employee ID', 'LMS ID', 'Name', 'Batch No', 'Branch', 'Process', 'LOB', 'Course %', 'MCQ %', 'Attendance %', 'Risk Status', 'Certification'];
    const rows = trainees.map(t => [
      t.employeeId, t.lmsId, t.traineeName, t.batchNo, t.branch, t.process, t.lob,
      t.courseCompletionPct, t.assessmentPassPct, t.attendancePct, t.riskStatus, t.certificationStatus,
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trainees-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function sendDailySummary(req, res) {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ ok: false, message: 'Recipient required.' });

    const recipients = Array.isArray(to) ? to : [to];
    await sendDailySummaryEmail(recipients);
    res.json({ ok: true, message: 'Email sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Email failed.' });
  }
}
