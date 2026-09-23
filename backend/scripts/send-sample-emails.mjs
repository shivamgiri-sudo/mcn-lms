/**
 * One-shot script: send one sample of every email template to the supplied addresses.
 * Usage:  node backend/scripts/send-sample-emails.mjs email1@example.com email2@example.com
 * Must be run from /var/www/mcn-lms (or the repo root) so the relative imports resolve.
 */

import {
  notifyOnboarding, notifyBatchAssignment, notifyCertification,
  notifyPasswordReset, notifyModuleAssigned, notifyAssessmentAssigned, sendEmail,
} from '../src/utils/notify.js';
import { sendCertificationEmail } from '../src/utils/mailer.js';

const targets = process.argv.slice(2).filter(a => a.includes('@'));
if (targets.length === 0) {
  console.error('Usage: node backend/scripts/send-sample-emails.mjs <email> [email2 ...]');
  process.exit(1);
}

const sample = {
  traineeName: 'Harneet Kaur',
  employeeId:  'MCN-TEST-001',
  batchNo:     'BATCH-2026-Q3-01',
  batchName:   'Onfido Process Batch — Q3 2026',
  process:     'Onfido KYC Verification',
  lob:         'KYC Operations',
  classroomName: 'Onfido Foundation Module',
  moduleName:  'Onfido Identity Verification — Module 3',
  broadcastTitle: 'Refresher: AML Compliance Update',
  assessmentName: 'PKT — Onfido KYC Module 3',
  tempPassword: 'TempP@ss#2026',
  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
};

const TEMPLATES = [
  ['onboarding',         to => notifyOnboarding({ ...sample, email: to })],
  ['batch_assignment',   to => notifyBatchAssignment({ ...sample, email: to })],
  ['certification',      to => notifyCertification({ ...sample, email: to })],
  ['password_reset',     to => notifyPasswordReset({ ...sample, email: to })],
  ['module_assigned',    to => notifyModuleAssigned({ ...sample, email: to, assignmentType: 'Mandatory' })],
  ['assessment_assigned',to => notifyAssessmentAssigned({ ...sample, email: to })],
  ['certification_mailer', to => sendCertificationEmail({ ...sample, email: to })],
  ['typing_test_reminder', to => sendEmail({
    to,
    subject: 'Reminder: Complete Your Daily Typing Test — MCN LMS',
    html: `<p style="font-family:Arial,sans-serif">Hi <b>${sample.traineeName}</b>,<br><br>
You have not yet completed today's Daily Typing Test.<br>
Target: <b>35 WPM</b> / <b>95% accuracy</b> · Duration: <b>5 minutes</b><br><br>
Log in at <a href="https://mcnlms.teammas.in">mcnlms.teammas.in</a> → Typing → Daily Test before midnight.<br><br>
— MCN T&Q Training Operations</p>`,
    text: `Hi ${sample.traineeName}, complete today's typing test at mcnlms.teammas.in. Target 35 WPM / 95%.`,
  })],
  ['pkt_passed', to => sendEmail({
    to,
    subject: `✅ PKT Result: You Passed — ${sample.assessmentName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px">
<div style="background:#15803d;padding:20px;color:#fff;border-radius:8px 8px 0 0">
  <h2 style="margin:0">✅ PKT Passed!</h2><p style="margin:4px 0 0;font-size:13px;color:#bbf7d0">MCN T&Q Training Operations</p>
</div>
<div style="background:#fff;padding:24px;border:1px solid #e2e8f0">
  <p>Hi <b>${sample.traineeName}</b>,</p>
  <p>Congratulations! You have <b style="color:#15803d">passed</b> the following assessment:</p>
  <table style="width:100%;font-size:13px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;border-spacing:0">
    <tr><td style="padding:4px 8px"><b>Assessment</b></td><td>${sample.assessmentName}</td></tr>
    <tr><td style="padding:4px 8px"><b>Module</b></td><td>${sample.moduleName}</td></tr>
    <tr><td style="padding:4px 8px"><b>Score</b></td><td><b style="color:#15803d">82 / 100</b></td></tr>
    <tr><td style="padding:4px 8px"><b>Date</b></td><td>${new Date().toLocaleDateString('en-IN')}</td></tr>
  </table>
  <p>Your next module is now unlocked. Keep up the great work!</p>
</div></div>`,
    text: `You passed the PKT for ${sample.assessmentName} with 82/100. Next module unlocked.`,
  })],
  ['pkt_failed', to => sendEmail({
    to,
    subject: `⚠️ PKT Result: Retest Required — ${sample.assessmentName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px">
<div style="background:#b91c1c;padding:20px;color:#fff;border-radius:8px 8px 0 0">
  <h2 style="margin:0">⚠️ Retest Required</h2><p style="margin:4px 0 0;font-size:13px;color:#fecaca">MCN T&Q Training Operations</p>
</div>
<div style="background:#fff;padding:24px;border:1px solid #e2e8f0">
  <p>Hi <b>${sample.traineeName}</b>,</p>
  <p>You did not meet the passing threshold for this assessment:</p>
  <table style="width:100%;font-size:13px;background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;padding:16px;border-spacing:0">
    <tr><td style="padding:4px 8px"><b>Assessment</b></td><td>${sample.assessmentName}</td></tr>
    <tr><td style="padding:4px 8px"><b>Your Score</b></td><td><b style="color:#b91c1c">38 / 100</b></td></tr>
    <tr><td style="padding:4px 8px"><b>Passing Score</b></td><td>60 / 100</td></tr>
    <tr><td style="padding:4px 8px"><b>Date</b></td><td>${new Date().toLocaleDateString('en-IN')}</td></tr>
  </table>
  <p>Please review the material and speak to your coordinator. You can do this!</p>
</div></div>`,
    text: `PKT retest required. You scored 38/100 on ${sample.assessmentName}. Passing score is 60.`,
  })],
  ['attendance_alert', to => sendEmail({
    to,
    subject: `⚠️ Attendance Alert — ${sample.traineeName} (${sample.batchNo})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px">
<div style="background:#d97706;padding:20px;color:#fff;border-radius:8px 8px 0 0">
  <h2 style="margin:0">⚠️ Low Attendance Alert</h2><p style="margin:4px 0 0;font-size:13px;color:#fef3c7">For Coordinator — MCN T&Q</p>
</div>
<div style="background:#fff;padding:24px;border:1px solid #e2e8f0">
  <p>Automated alert for your action:</p>
  <table style="width:100%;font-size:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:16px;border-spacing:0">
    <tr><td style="padding:4px 8px"><b>Trainee</b></td><td>${sample.traineeName}</td></tr>
    <tr><td style="padding:4px 8px"><b>Employee ID</b></td><td>${sample.employeeId}</td></tr>
    <tr><td style="padding:4px 8px"><b>Batch</b></td><td>${sample.batchNo}</td></tr>
    <tr><td style="padding:4px 8px"><b>Attendance This Week</b></td><td><b style="color:#b91c1c">52%</b></td></tr>
    <tr><td style="padding:4px 8px"><b>Consecutive Absences</b></td><td><b style="color:#b91c1c">3 days</b></td></tr>
  </table>
  <p style="margin-top:16px">Please follow up and document the reason in MCN LMS.</p>
</div></div>`,
    text: `Attendance alert: ${sample.traineeName} (${sample.employeeId}) in ${sample.batchNo} — 52% attendance, 3 consecutive absences.`,
  })],
];

console.log(`\nSending ${TEMPLATES.length} email templates to: ${targets.join(', ')}\n`);

let sent = 0, failed = 0;
for (const to of targets) {
  console.log(`\n── ${to} ──`);
  for (const [name, fn] of TEMPLATES) {
    try {
      const result = await fn(to);
      const ok = result === undefined || result?.ok !== false;
      console.log(`  ${ok ? '✓' : '✗'} ${name}${result?.message ? ' — ' + result.message : ''}`);
      if (ok) sent++; else failed++;
    } catch (err) {
      console.error(`  ✗ ${name} — ${err.message}`);
      failed++;
    }
  }
}

console.log(`\n── Summary ──`);
console.log(`  Sent: ${sent}  Failed: ${failed}  Total: ${TEMPLATES.length * targets.length}`);
process.exit(failed > 0 ? 1 : 0);
