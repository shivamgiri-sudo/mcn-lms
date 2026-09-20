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

export async function sendCertificateEmail({ to, trainee_name, certificate_no, title, process, score_pct, lms_url }) {
  if (!to || !to.includes('@')) return { ok: false, reason: 'No valid email address' };
  try {
    const t = createTransporter();
    const score = score_pct != null ? `${Math.round(score_pct)}%` : null;
    const portalUrl = lms_url || 'https://mcnlms.teammas.in/trainee';
    await t.sendMail({
      from: `"MAS Callnet T&Q" <${process.env.SMTP_USER}>`,
      to,
      subject: `🎓 Certificate of Completion — ${title || 'Training Programme'}`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#267abd,#0d3c72);padding:28px 32px">
    <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:.3px">MAS Callnet Pvt. Ltd.</div>
    <div style="font-size:11px;color:rgba(255,255,255,.7);letter-spacing:1.2px;text-transform:uppercase;margin-top:3px">Training &amp; Quality · Learning Management System</div>
  </div>
  <!-- Gold accent strip -->
  <div style="height:4px;background:linear-gradient(90deg,#267abd 33%,#76c053 33% 66%,#dc363a 66%)"></div>
  <!-- Body -->
  <div style="padding:32px">
    <div style="font-size:13px;color:#6b7280;margin-bottom:6px">Dear <strong style="color:#0d3c72">${trainee_name || 'Trainee'}</strong>,</div>
    <div style="font-size:15px;color:#1e293b;line-height:1.7;margin-bottom:20px">
      Congratulations! You have successfully completed your training programme and earned your
      <strong>Certificate of Completion</strong> from MAS Callnet Pvt. Ltd.
    </div>
    <!-- Certificate card -->
    <div style="background:linear-gradient(135deg,#edf4ff,#f0f4ff);border:1.5px solid #bfdbfe;border-radius:10px;padding:20px 24px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#267abd;margin-bottom:8px">Certificate Details</div>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280;width:40%">Certificate No</td><td style="padding:5px 0;font-size:13px;font-weight:700;color:#0d3c72;font-family:monospace">${certificate_no}</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Programme</td><td style="padding:5px 0;font-size:13px;font-weight:700;color:#0d3c72">${title || '—'}</td></tr>
        ${process ? `<tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Process</td><td style="padding:5px 0;font-size:13px;font-weight:700;color:#0d3c72">${process}</td></tr>` : ''}
        ${score ? `<tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Final Score</td><td style="padding:5px 0;font-size:16px;font-weight:900;color:#267abd">${score}</td></tr>` : ''}
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Issued</td><td style="padding:5px 0;font-size:13px;font-weight:700;color:#0d3c72">${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</td></tr>
      </table>
    </div>
    <!-- Download button -->
    <div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:linear-gradient(135deg,#267abd,#0d3c72);color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:.3px">
        🎓 View &amp; Download Certificate
      </a>
    </div>
    <div style="font-size:12px;color:#9ca3af;line-height:1.7">
      Log in to the LMS portal to view, download, or print your certificate at any time.<br>
      This certificate is verifiable at <a href="https://mcnlms.teammas.in/verify" style="color:#267abd">mcnlms.teammas.in/verify</a>
    </div>
  </div>
  <!-- Footer -->
  <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#9ca3af;text-align:center">
    MAS Callnet Pvt. Ltd. · Training &amp; Quality Division<br>
    This is an automated email from MCN LMS. Please do not reply.
  </div>
</div>
</body></html>`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
