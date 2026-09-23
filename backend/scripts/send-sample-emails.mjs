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
import { renderReportEmailHtml, buildSubject } from '../src/services/dailyBatchReport.js';

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

// ── Mock batch report for daily-report template ───────────────────────────────

const mockReport = {
  batch: {
    batchNo: 'BATCH-2026-Q3-01',
    batchName: 'Onfido KYC Verification — Q3 2026',
    process: 'Onfido KYC',
    lob: 'KYC Operations',
    branch: 'Mumbai HQ',
    coordinatorName: 'Priya Sharma',
    coordinatorLoginId: 'COORD-001',
    startDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
  },
  dateLabel: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
  attendance: { total: 22, present: 17, absent: 5, pct: 77.3, trainingDay: 16, perTrainee: new Map() },
  activities: [
    {
      key: 'typingTest',
      label: 'Daily Typing Test',
      assignedCount: 22,
      batchSummary: { attempted: 17, metTarget: 12, avgNetWpm: 38.4, avgAccuracy: 93.2 },
      perTrainee: new Map([
        ['MCN001', { status: 'Target Met', detail: { netWpm: 42, accuracyPct: 96 } }],
        ['MCN002', { status: 'Speed Focus', detail: { netWpm: 28, accuracyPct: 97 } }],
      ]),
    },
    {
      key: 'classroomCurriculum',
      label: 'Day 16 — Document Verification',
      assignedCount: 22,
      batchSummary: { completed: 15, inProgress: 2, notStarted: 0, completionPct: 68 },
      perTrainee: new Map(),
    },
    {
      key: 'assessment',
      label: 'PKT — Module 4: Biometric Checks',
      assignedCount: 22,
      batchSummary: { attempted: 14, passed: 11, failed: 3, passRate: 78.6, avgScore: 72 },
      perTrainee: new Map(),
    },
  ],
  bestPerformers: [
    { employeeId: 'MCN001', name: 'Harneet Kaur', summary: 'Top performer — Typing: 42 WPM, 96% accuracy; Assessment: 91/100', badges: ['Typing Star', 'PKT Pass'] },
    { employeeId: 'MCN005', name: 'Rahul Verma', summary: 'Assessment: 88/100; All modules completed', badges: ['PKT Pass'] },
  ],
  focusTrainees: [
    { employeeId: 'MCN008', name: 'Deepak Singh', priority: 'High', reasons: ['Absent today (3rd consecutive)', 'Typing speed 19 WPM — below target'] },
    { employeeId: 'MCN012', name: 'Sunita Patel', priority: 'Medium', reasons: ['PKT failed (38/100)', 'Curriculum incomplete (Day 13 pending)'] },
  ],
  tni: [
    { type: 'Typing Speed', topic: 'Speed below 25 WPM', count: 4, recommendation: 'Schedule 30-minute focused typing practice session before Day 17.' },
    { type: 'Assessment', topic: 'Biometric module — question type 3 mistakes', count: 3, recommendation: 'Revisit liveness detection topic; assign targeted reading.' },
  ],
  trainerFocus: [
    'Schedule typing speed drill for MCN008, MCN012, MCN015, MCN019 — target 25 WPM minimum',
    'Debrief MCN012 and MCN015 on biometric module before Day 17 assessment retry',
    'Follow up on 5 absent trainees — document reason in LMS by EOD',
    'Unlock PKT retry for 3 failed trainees after debrief',
  ],
  summary: 'Batch BATCH-2026-Q3-01 completed Day 16 with 77.3% attendance (below the 80% target — follow up on 5 absences). Typing performance is improving: 12 of 17 present trainees met the 35 WPM target. PKT pass rate of 78.6% is acceptable; 3 trainees require debrief and retry. Curriculum completion at 68% needs attention before Day 17.',
  settings: { typingWpmTarget: 35, typingAccuracyTarget: 95 },
  traineeOverall: new Map(),
};

// ── Template list ─────────────────────────────────────────────────────────────

const TEMPLATES = [
  ['onboarding',         to => notifyOnboarding({ ...sample, email: to })],
  ['batch_assignment',   to => notifyBatchAssignment({ ...sample, email: to })],
  ['certification',      to => notifyCertification({ ...sample, email: to })],
  ['password_reset',     to => notifyPasswordReset({ ...sample, email: to })],
  ['module_assigned',    to => notifyModuleAssigned({ ...sample, email: to, assignmentType: 'Mandatory' })],
  ['assessment_assigned',to => notifyAssessmentAssigned({ ...sample, email: to })],
  ['certification_mailer', to => sendCertificationEmail({ ...sample, email: to })],

  // ── Typing test reminder — purple theme ──────────────────────────────────────
  ['typing_test_reminder', to => sendEmail({
    to,
    subject: 'Reminder: Complete Your Daily Typing Test — MCN LMS',
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ff;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#4c1d95 0%,#7c3aed 100%);padding:28px 36px">
  <div style="font-size:22px;font-weight:bold;color:#ffffff;margin-bottom:6px">&#9200; Daily Typing Test — Pending</div>
  <div style="font-size:13px;color:#ddd6fe">MCN LMS — Performance Reminder</div>
</td></tr>
<tr><td style="padding:28px 36px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Hi <strong>${sample.traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">You have not yet completed today's Daily Typing Test. Complete it before midnight to keep your streak and maintain your performance record.</p>

  <!-- Today's target card -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf5ff;border:2px solid #c4b5fd;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#7c3aed;padding:10px 20px">
      <div style="font-size:11px;font-weight:bold;color:#ddd6fe;text-transform:uppercase;letter-spacing:1px">Today's Target</div>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:33%;padding:18px 14px;text-align:center;border-right:1px solid #ede9fe">
            <div style="font-size:32px;font-weight:bold;color:#7c3aed">35</div>
            <div style="font-size:12px;color:#6d28d9;font-weight:bold;margin-top:4px">WPM</div>
            <div style="font-size:11px;color:#64748b">Net Speed</div>
          </td>
          <td style="width:33%;padding:18px 14px;text-align:center;border-right:1px solid #ede9fe">
            <div style="font-size:32px;font-weight:bold;color:#7c3aed">95%</div>
            <div style="font-size:12px;color:#6d28d9;font-weight:bold;margin-top:4px">Accuracy</div>
            <div style="font-size:11px;color:#64748b">Minimum</div>
          </td>
          <td style="width:33%;padding:18px 14px;text-align:center">
            <div style="font-size:32px;font-weight:bold;color:#7c3aed">5</div>
            <div style="font-size:12px;color:#6d28d9;font-weight:bold;margin-top:4px">Minutes</div>
            <div style="font-size:11px;color:#64748b">Duration</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Quick tips -->
  <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:#1e40af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Quick Tips</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:4px 0;font-size:13px;color:#1e3a8a">&#128161;&nbsp; Sit comfortably, keep your wrists neutral and fingers on home row</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#1e3a8a">&#128161;&nbsp; Read ahead by 3–4 words — your fingers will follow</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#1e3a8a">&#128161;&nbsp; Prioritise accuracy over speed; net WPM penalises errors</td></tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <a href="https://mcnlms.teammas.in" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none">Take Typing Test Now &#8594;</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 36px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Reminder</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    text: `Hi ${sample.traineeName}, complete today's typing test at mcnlms.teammas.in. Target 35 WPM / 95%.`,
  })],

  // ── PKT passed — green certificate style ────────────────────────────────────
  ['pkt_passed', to => sendEmail({
    to,
    subject: `✅ PKT Result: You Passed — ${sample.assessmentName}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0fdf4;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#14532d 0%,#16a34a 100%);padding:32px 36px">
  <div style="font-size:28px;margin-bottom:10px">&#9989;</div>
  <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-bottom:6px">PKT Passed!</div>
  <div style="font-size:13px;color:#bbf7d0">MCN LMS — Assessment Results</div>
</td></tr>
<tr><td style="padding:28px 36px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Hi <strong>${sample.traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">Congratulations! You have <strong style="color:#16a34a">passed</strong> the following assessment. Your next module is now unlocked.</p>

  <!-- Score result card -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#16a34a;padding:10px 20px">
      <div style="font-size:11px;font-weight:bold;color:#dcfce7;text-transform:uppercase;letter-spacing:1px">Assessment Result</div>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #dcfce7">
          <td style="padding:12px 20px;font-size:13px;color:#166534;font-weight:bold;width:130px">Assessment</td>
          <td style="padding:12px 20px;font-size:14px;font-weight:bold;color:#1e293b">${sample.assessmentName}</td>
        </tr>
        <tr style="border-bottom:1px solid #dcfce7">
          <td style="padding:12px 20px;font-size:13px;color:#166534;font-weight:bold">Module</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${sample.moduleName}</td>
        </tr>
        <tr style="border-bottom:1px solid #dcfce7">
          <td style="padding:12px 20px;font-size:13px;color:#166534;font-weight:bold">Date</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
        </tr>
        <tr>
          <td style="padding:12px 20px;font-size:13px;color:#166534;font-weight:bold">Score</td>
          <td style="padding:12px 20px">
            <span style="font-size:24px;font-weight:bold;color:#16a34a">82</span>
            <span style="font-size:16px;color:#64748b"> / 100</span>
            &nbsp;&nbsp;
            <span style="background:#dcfce7;color:#166534;border:1px solid #86efac;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:10px">PASSED</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Score bar -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
    <tr><td style="padding:16px 20px">
      <div style="font-size:12px;color:#64748b;margin-bottom:8px">Score Breakdown</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:12px;color:#475569;width:70px">Your Score</td>
          <td style="padding:0 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:12px;overflow:hidden">
              <tr><td style="background:#16a34a;width:82%;border-radius:4px;height:12px"></td></tr>
            </table>
          </td>
          <td style="font-size:13px;font-weight:bold;color:#16a34a;width:50px;text-align:right">82%</td>
        </tr>
        <tr><td style="height:8px"></td></tr>
        <tr>
          <td style="font-size:12px;color:#475569">Pass Mark</td>
          <td style="padding:0 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:12px;overflow:hidden">
              <tr><td style="background:#94a3b8;width:60%;border-radius:4px;height:12px"></td></tr>
            </table>
          </td>
          <td style="font-size:13px;color:#64748b;width:50px;text-align:right">60%</td>
        </tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <a href="https://mcnlms.teammas.in" style="display:inline-block;background:#16a34a;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none">Continue to Next Module &#8594;</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 36px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Result</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    text: `You passed the PKT for ${sample.assessmentName} with 82/100. Next module unlocked.`,
  })],

  // ── PKT failed — red alert + encouragement ──────────────────────────────────
  ['pkt_failed', to => sendEmail({
    to,
    subject: `⚠️ PKT Result: Retest Required — ${sample.assessmentName}`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fef2f2;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef2f2;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#7f1d1d 0%,#b91c1c 100%);padding:32px 36px">
  <div style="font-size:28px;margin-bottom:10px">&#9888;&#65039;</div>
  <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-bottom:6px">Retest Required</div>
  <div style="font-size:13px;color:#fecaca">MCN LMS — Assessment Results</div>
</td></tr>
<tr><td style="padding:28px 36px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Hi <strong>${sample.traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">You did not meet the passing threshold for this assessment. Your coordinator has been notified and will schedule a debrief and retry session with you.</p>

  <!-- Score result card -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef2f2;border:2px solid #fecaca;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#b91c1c;padding:10px 20px">
      <div style="font-size:11px;font-weight:bold;color:#fecaca;text-transform:uppercase;letter-spacing:1px">Assessment Result</div>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #fecaca">
          <td style="padding:12px 20px;font-size:13px;color:#991b1b;font-weight:bold;width:130px">Assessment</td>
          <td style="padding:12px 20px;font-size:14px;font-weight:bold;color:#1e293b">${sample.assessmentName}</td>
        </tr>
        <tr style="border-bottom:1px solid #fecaca">
          <td style="padding:12px 20px;font-size:13px;color:#991b1b;font-weight:bold">Module</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${sample.moduleName}</td>
        </tr>
        <tr style="border-bottom:1px solid #fecaca">
          <td style="padding:12px 20px;font-size:13px;color:#991b1b;font-weight:bold">Date</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
        </tr>
        <tr style="border-bottom:1px solid #fecaca">
          <td style="padding:12px 20px;font-size:13px;color:#991b1b;font-weight:bold">Your Score</td>
          <td style="padding:12px 20px">
            <span style="font-size:24px;font-weight:bold;color:#dc2626">38</span>
            <span style="font-size:16px;color:#64748b"> / 100</span>
            &nbsp;&nbsp;
            <span style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:10px">FAILED</span>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 20px;font-size:13px;color:#991b1b;font-weight:bold">Pass Mark</td>
          <td style="padding:12px 20px;font-size:14px;color:#64748b">60 / 100</td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Score comparison bar -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
    <tr><td style="padding:16px 20px">
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">Score vs Pass Mark</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:12px;color:#475569;width:80px">Your Score</td>
          <td style="padding:0 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:12px;overflow:hidden">
              <tr><td style="background:#dc2626;width:38%;border-radius:4px;height:12px"></td></tr>
            </table>
          </td>
          <td style="font-size:13px;font-weight:bold;color:#dc2626;width:50px;text-align:right">38%</td>
        </tr>
        <tr><td style="height:8px"></td></tr>
        <tr>
          <td style="font-size:12px;color:#475569">Pass Mark</td>
          <td style="padding:0 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:12px;overflow:hidden">
              <tr><td style="background:#16a34a;width:60%;border-radius:4px;height:12px"></td></tr>
            </table>
          </td>
          <td style="font-size:13px;color:#16a34a;width:50px;text-align:right">60%</td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Encouragement + action steps -->
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <div style="font-size:12px;font-weight:bold;color:#1e40af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">&#128170; What to Do Next</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#2563eb;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">1</td>
            <td style="padding-left:10px;font-size:13px;color:#1e3a8a">Re-read the module content carefully — focus on areas you found difficult</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#2563eb;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">2</td>
            <td style="padding-left:10px;font-size:13px;color:#1e3a8a">Attend the debrief session with your coordinator before the retry</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#2563eb;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">3</td>
            <td style="padding-left:10px;font-size:13px;color:#1e3a8a">You can do this — many trainees who fail the first attempt pass on retry</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <a href="https://mcnlms.teammas.in" style="display:inline-block;background:#b91c1c;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none">Review Module &amp; Prepare for Retry &#8594;</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 36px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Result</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    text: `PKT retest required. You scored 38/100 on ${sample.assessmentName}. Passing score is 60.`,
  })],

  // ── Attendance alert — coordinator-facing amber ──────────────────────────────
  ['attendance_alert', to => sendEmail({
    to,
    subject: `⚠️ Attendance Alert — ${sample.traineeName} (${sample.batchNo})`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fffbeb;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#78350f 0%,#d97706 100%);padding:28px 36px">
  <div style="font-size:22px;font-weight:bold;color:#ffffff;margin-bottom:6px">&#9888;&#65039; Low Attendance Alert</div>
  <div style="font-size:13px;color:#fde68a">For Coordinator — MCN T&amp;Q Training Operations</div>
</td></tr>
<tr><td style="padding:28px 36px">
  <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:28px;font-size:20px;vertical-align:top">&#128308;</td>
          <td style="padding-left:10px;font-size:13px;color:#991b1b;line-height:1.6">This trainee has <strong>3 consecutive absences</strong> and weekly attendance below 60%. Immediate follow-up is required.</td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Trainee details table -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:2px solid #fbbf24;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#d97706;padding:10px 20px">
      <div style="font-size:11px;font-weight:bold;color:#fef3c7;text-transform:uppercase;letter-spacing:1px">Trainee Information</div>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:11px 20px;font-size:13px;color:#92400e;font-weight:bold;width:170px">Trainee Name</td>
          <td style="padding:11px 20px;font-size:14px;font-weight:bold;color:#1e293b">${sample.traineeName}</td>
        </tr>
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:11px 20px;font-size:13px;color:#92400e;font-weight:bold">Employee ID</td>
          <td style="padding:11px 20px;font-size:14px;color:#1e293b">${sample.employeeId}</td>
        </tr>
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:11px 20px;font-size:13px;color:#92400e;font-weight:bold">Batch</td>
          <td style="padding:11px 20px;font-size:14px;color:#1e293b">${sample.batchNo}</td>
        </tr>
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:11px 20px;font-size:13px;color:#92400e;font-weight:bold">Process</td>
          <td style="padding:11px 20px;font-size:14px;color:#1e293b">${sample.process}</td>
        </tr>
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:11px 20px;font-size:13px;color:#92400e;font-weight:bold">Weekly Attendance</td>
          <td style="padding:11px 20px">
            <span style="font-size:18px;font-weight:bold;color:#dc2626">52%</span>
            <span style="margin-left:8px;font-size:11px;color:#dc2626;font-weight:bold">&#9660; BELOW TARGET (80%)</span>
          </td>
        </tr>
        <tr>
          <td style="padding:11px 20px;font-size:13px;color:#92400e;font-weight:bold">Consecutive Absences</td>
          <td style="padding:11px 20px">
            <span style="font-size:18px;font-weight:bold;color:#dc2626">3 days</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Weekly attendance bar -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
    <tr><td style="padding:16px 20px">
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">Weekly Attendance vs Target</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:12px;color:#475569;width:80px">Actual</td>
          <td style="padding:0 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:12px;overflow:hidden">
              <tr><td style="background:#dc2626;width:52%;border-radius:4px;height:12px"></td></tr>
            </table>
          </td>
          <td style="font-size:13px;font-weight:bold;color:#dc2626;width:44px;text-align:right">52%</td>
        </tr>
        <tr><td style="height:8px"></td></tr>
        <tr>
          <td style="font-size:12px;color:#475569">Target</td>
          <td style="padding:0 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:12px;overflow:hidden">
              <tr><td style="background:#16a34a;width:80%;border-radius:4px;height:12px"></td></tr>
            </table>
          </td>
          <td style="font-size:13px;color:#16a34a;width:44px;text-align:right">80%</td>
        </tr>
      </table>
    </td></tr>
  </table>

  <!-- Action items -->
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
    <tr><td>
      <div style="font-size:12px;font-weight:bold;color:#1e40af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Required Actions</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:5px 0;font-size:13px;color:#1e3a8a">&#9744;&nbsp; Contact trainee and document absence reason in LMS today</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#1e3a8a">&#9744;&nbsp; Escalate to Branch Head if no response within 24 hours</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#1e3a8a">&#9744;&nbsp; Review if trainee is at attrition risk — mark accordingly in LMS</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 36px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Attendance Alert</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    text: `Attendance alert: ${sample.traineeName} (${sample.employeeId}) in ${sample.batchNo} — 52% attendance, 3 consecutive absences.`,
  })],

  // ── Daily batch performance report ──────────────────────────────────────────
  ['batch_daily_report', to => sendEmail({
    to,
    subject: buildSubject(mockReport),
    html: renderReportEmailHtml(mockReport),
    text: `Daily Training Report — ${mockReport.batch.batchName} — ${mockReport.dateLabel}. Attendance: ${mockReport.attendance.pct}% (${mockReport.attendance.present}/${mockReport.attendance.total}). See HTML email for full details.`,
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
