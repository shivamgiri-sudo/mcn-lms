import { prisma } from '../utils/db.js';
import nodemailer from 'nodemailer';

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

    const [activeBatches, totalTrainees, avgRaw, criticalRisks] = await Promise.all([
      prisma.batchMaster.count({ where: { batchStatus: 'Active' } }),
      prisma.traineeMaster.count({ where: { status: 'Active' } }),
      prisma.traineeMaster.aggregate({ _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true } }),
      prisma.trainingRiskLog.count({ where: { severity: 'CRITICAL', status: 'Open' } }),
    ]);

    const body = `
LMS 2.0 Daily Training Summary — ${new Date().toDateString()}

Active Batches: ${activeBatches}
Active Trainees: ${totalTrainees}
Avg Course Completion: ${Math.round(avgRaw._avg.courseCompletionPct || 0)}%
Avg MCQ Pass: ${Math.round(avgRaw._avg.assessmentPassPct || 0)}%
Avg Attendance: ${Math.round(avgRaw._avg.attendancePct || 0)}%
Critical Risks Open: ${criticalRisks}
    `.trim();

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: `LMS Daily Summary – ${new Date().toDateString()}`,
      text: body,
    });

    res.json({ ok: true, message: 'Email sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Email failed.' });
  }
}
