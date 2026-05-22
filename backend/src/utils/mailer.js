import nodemailer from 'nodemailer';
import { prisma } from './db.js';

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) throw new Error('SMTP_USER and SMTP_PASS are not configured.');
  return nodemailer.createTransport({
    host: SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(SMTP_PORT || '587', 10),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendDailySummaryEmail(recipients) {
  if (!recipients || recipients.length === 0) return;

  const [activeBatches, totalTrainees, avgRaw, criticalRisks, todayCertified] = await Promise.all([
    prisma.batchMaster.count({ where: { batchStatus: 'Active' } }),
    prisma.traineeMaster.count({ where: { status: 'Active' } }),
    prisma.traineeMaster.aggregate({
      _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true },
      where: { status: 'Active' },
    }),
    prisma.trainingRiskLog.count({ where: { severity: 'CRITICAL', status: 'Open' } }),
    prisma.traineeMaster.count({
      where: {
        certificationStatus: 'Certified',
        updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  const avgCourse = Math.round(avgRaw._avg.courseCompletionPct || 0);
  const avgMcq = Math.round(avgRaw._avg.assessmentPassPct || 0);
  const avgAttendance = Math.round(avgRaw._avg.attendancePct || 0);
  const dateStr = new Date().toDateString();

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1e40af;padding:24px 28px;">
      <h2 style="color:#fff;margin:0;font-size:20px;">MCN LMS — Daily Training Progress</h2>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${dateStr}</p>
    </div>
    <div style="padding:28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px;">Active Batches</td>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:16px;color:#1e293b;">${activeBatches}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px;">Active Trainees</td>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:16px;color:#1e293b;">${totalTrainees}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px;">Avg Course Completion</td>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:16px;color:${avgCourse >= 70 ? '#16a34a' : avgCourse >= 50 ? '#d97706' : '#dc2626'};">${avgCourse}%</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px;">Avg MCQ Pass Rate</td>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:16px;color:${avgMcq >= 60 ? '#16a34a' : '#dc2626'};">${avgMcq}%</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px;">Avg Attendance</td>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:16px;color:${avgAttendance >= 70 ? '#16a34a' : '#dc2626'};">${avgAttendance}%</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#555;font-size:14px;">Critical Risks Open</td>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:16px;color:${criticalRisks > 0 ? '#dc2626' : '#16a34a'};">${criticalRisks}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#555;font-size:14px;">Certifications Today</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;font-size:16px;color:${todayCertified > 0 ? '#16a34a' : '#1e293b'};">${todayCertified}</td>
        </tr>
      </table>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">MCN T&amp;Q Training Operations · Automated Daily Report</p>
    </div>
  </div>
</body>
</html>`;

  const text = `MCN LMS Daily Training Progress — ${dateStr}

Active Batches:       ${activeBatches}
Active Trainees:      ${totalTrainees}
Avg Course:           ${avgCourse}%
Avg MCQ Pass:         ${avgMcq}%
Avg Attendance:       ${avgAttendance}%
Critical Risks Open:  ${criticalRisks}
Certifications Today: ${todayCertified}
`;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: Array.isArray(recipients) ? recipients.join(',') : recipients,
    subject: `LMS Daily Progress — ${dateStr}`,
    text,
    html,
  });

  console.log(`[MAILER] Daily summary sent to ${recipients.length ?? 1} recipient(s).`);
}

export async function sendCertificationEmail({ employeeId, traineeName, email, batchNo, batchName, process: proc, lob }) {
  if (!email) return;

  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#15803d;padding:24px 28px;">
      <h2 style="color:#fff;margin:0;font-size:20px;">🎓 Congratulations — Certified!</h2>
      <p style="color:#bbf7d0;margin:6px 0 0;font-size:13px;">MCN T&amp;Q Training Operations</p>
    </div>
    <div style="padding:28px;">
      <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Dear <strong>${traineeName}</strong>,</p>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px;">
        We are pleased to inform you that you have successfully completed your training and have been
        <strong style="color:#15803d;">certified</strong> as of <strong>${dateStr}</strong>.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
        <table style="width:100%;font-size:13px;color:#166534;">
          <tr><td style="padding:4px 0;"><strong>Employee ID</strong></td><td style="text-align:right;">${employeeId}</td></tr>
          <tr><td style="padding:4px 0;"><strong>Batch</strong></td><td style="text-align:right;">${batchNo}${batchName ? ' — ' + batchName : ''}</td></tr>
          ${proc ? `<tr><td style="padding:4px 0;"><strong>Process</strong></td><td style="text-align:right;">${proc}${lob ? ' / ' + lob : ''}</td></tr>` : ''}
          <tr><td style="padding:4px 0;"><strong>Date</strong></td><td style="text-align:right;">${dateStr}</td></tr>
        </table>
      </div>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0;">
        Thank you for your dedication and hard work throughout the training programme.
        Your certification reflects your commitment to excellence.
      </p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">MCN T&amp;Q Training Operations · This is an automated notification.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Congratulations ${traineeName}!

You have been certified as of ${dateStr}.

Employee ID: ${employeeId}
Batch:       ${batchNo}${batchName ? ' — ' + batchName : ''}
${proc ? `Process:     ${proc}${lob ? ' / ' + lob : ''}\n` : ''}Date:        ${dateStr}

Thank you for your dedication throughout the training programme.

— MCN T&Q Training Operations`;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Congratulations on your Certification — ${traineeName}`,
    text,
    html,
  });

  console.log(`[MAILER] Certification email sent to ${email} (${employeeId}).`);
}
