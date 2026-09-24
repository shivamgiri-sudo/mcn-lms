import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin, requireRecentElevation } from '../middleware/auth.js';
import { validate, classroomSchema, moduleSchema, assessmentSchema, batchSchema } from '../utils/validate.js';
import {
  getAdminDashboard,
  listClassrooms, createClassroom, updateClassroom, deleteClassroom,
  copyClassroom, getClassroomBranches, setClassroomBranches,
  listModules, createModule, updateModule, deleteModule,
  listContents, createContent, updateContent, deleteContent, publishContentVersion,
  listFaqs, createFaq, bulkUploadFaqs, updateFaq, deleteFaq,
  listAssessments, createAssessment, updateAssessment, deleteAssessment,
  attachAssessmentToClassroom, detachAssessmentFromClassroom,
  listAttemptGrantsForAssessment, listAttemptGrantsForTrainee, createAttemptGrant, revokeAttemptGrant,
  listQuestions, uploadQuestions, updateQuestion, deleteQuestion,
  searchTrainees, resetTraineePassword, unlockTrainee, deleteTraineeAccount,
  listCertificationRules, saveCertificationRule, updateCertificationRule, deleteCertificationRule,
  syncClassroomFromDrive,
  assignModule, broadcastModule, broadcastModuleBulk, validateEmployeeIds, getBroadcastTargets,
  searchBroadcastContent,
  getProcessLobList, saveProcessLob, updateProcessLob, deleteProcessLob,
  exportTrainees,
  syncHistoricalKpi,
  listBatches, getBatchDetail, getBatchAnalytics, getBatchContentProgress,
  listCoordinators, getCoordinatorDetail, createCoordinator,
  getTraineeDetail,
  getRiskLevel,
  uploadQuestionsCSV,
  adminCreateBatch, adminUpdateBatch, adminUpdateBatchCoordinator, listAllCoordinators, closeBatch, deleteBatch,
  adminBulkAddTrainees, enrollExistingTraineeAdmin, adminChangeTraineeBatch, resetAdminPassword,
  setContentLock, unlockContentForTrainee,
  listBranches, getBranchDetail,
  listPortalUsers, createPortalUser, updatePortalUser, changeUserRole, deletePortalUser, resetPortalUserPin,
  listBroadcastAssignments, withdrawBroadcastAssignment,
  listBatchClassrooms, addBatchClassrooms, removeBatchClassroom, setPrimaryBatchClassroom,
  bulkCreatePortalUsers,
  exportBatchSummary, exportAtRisk,
  exportModuleCompletion, getModuleCompletionDetail, exportAssessmentResults, exportAttendanceLog,
  exportCertificationEvidence, exportBroadcastAssignments, exportContentReading, exportQAActivity,
  listBranchMaster, createBranchMaster, updateBranchMaster, deleteBranchMaster,
  listDesignations, createDesignation, updateDesignation, deleteDesignation,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  adminMapSingleEmpId, adminBulkMapEmpIds, getTempTrainees,
  listAuditLogs, getAuditLogDetail, generateCertificate, verifyCertificate,
  bulkImportPreview, bulkImportExecute,
} from '../controllers/admin.js';
import { getCommConfig, saveCommConfig, testEmailConfig, testSmsConfig, testWhatsAppConfig } from '../controllers/commConfig.js';
import { getNotifConfig, saveNotifConfig } from '../controllers/notifConfig.js';
import { contentUpload } from '../utils/upload.js';
import { syncBranches, syncDepartments, syncDesignations, syncProcessLob, syncEmployees, detectHRMSTables, hrmsStatus } from '../controllers/hrmsSeed.js';
import { getHrmsConfig, setHrmsConfig } from '../controllers/hrmsConfigController.js';
import { getLeaderboardAdmin } from '../controllers/leaderboard.js';
import {
  notifyOnboarding, notifyBatchAssignment, notifyCertification,
  notifyPasswordReset, notifyModuleAssigned, notifyAssessmentAssigned, sendEmail,
} from '../utils/notify.js';
import { sendCertificationEmail } from '../utils/mailer.js';

const auth = [requireSession, requireRole('admin')];
const superAuth = [requireSession, requireRole('admin'), requireSuperAdmin];
const superElevatedAuth = [requireSession, requireRole('admin'), requireSuperAdmin, requireRecentElevation];
const router = Router();

router.get('/dashboard', ...auth, getAdminDashboard);
router.post('/reset-password', ...auth, resetAdminPassword);

// Curriculum reads and routine authoring remain available to branch-scoped admins.
router.get('/classrooms', ...auth, listClassrooms);
router.post('/classrooms', ...auth, validate(classroomSchema), createClassroom);
router.put('/classrooms/:classroomId', ...auth, updateClassroom);
router.delete('/classrooms/:classroomId', ...superElevatedAuth, deleteClassroom);
router.post('/classrooms/:classroomId/copy', ...auth, copyClassroom);
router.get('/classrooms/:classroomId/branches', ...auth, getClassroomBranches);
router.put('/classrooms/:classroomId/branches', ...superAuth, setClassroomBranches);

router.get('/classrooms/:classroomId/modules', ...auth, listModules);
router.post('/classrooms/:classroomId/modules', ...auth, validate(moduleSchema), createModule);
router.put('/modules/:moduleId', ...auth, updateModule);
router.delete('/modules/:moduleId', ...auth, deleteModule);

router.get('/modules/:moduleId/contents', ...auth, listContents);
router.post('/modules/:moduleId/contents', ...auth, contentUpload.single('file'), createContent);
router.put('/contents/:contentId', ...auth, updateContent);
router.delete('/contents/:contentId', ...auth, deleteContent);
router.post('/contents/:contentId/publish-version', ...auth, publishContentVersion);

router.get('/modules/:moduleId/faqs', ...auth, listFaqs);
router.post('/modules/:moduleId/faqs', ...auth, createFaq);
router.post('/modules/:moduleId/faqs/bulk-upload', ...auth, (req, res, next) => {
  contentUpload.array('files', 20)(req, res, err => {
    if (err) return res.status(400).json({ ok: false, message: err.message || 'File upload error' });
    return next();
  });
}, bulkUploadFaqs);
router.put('/faqs/:faqId', ...auth, updateFaq);
router.delete('/faqs/:faqId', ...auth, deleteFaq);

router.get('/assessments', ...auth, listAssessments);
router.post('/assessments', ...auth, validate(assessmentSchema), createAssessment);
router.put('/assessments/:assessmentId', ...auth, updateAssessment);
router.delete('/assessments/:assessmentId', ...auth, deleteAssessment);
router.put('/assessments/:assessmentId/attach-classroom', ...auth, attachAssessmentToClassroom);
router.put('/assessments/:assessmentId/detach-classroom', ...auth, detachAssessmentFromClassroom);
router.get('/assessments/:assessmentId/attempt-grants', ...auth, listAttemptGrantsForAssessment);
router.post('/assessments/:assessmentId/attempt-grants', ...auth, createAttemptGrant);
router.post('/attempt-grants/:grantId/revoke', ...auth, revokeAttemptGrant);
router.get('/trainees/:employeeId/attempt-grants', ...auth, listAttemptGrantsForTrainee);
router.get('/assessments/:assessmentId/questions', ...auth, listQuestions);
router.post('/assessments/:assessmentId/questions/upload', ...auth, uploadQuestions);
router.post('/assessments/:assessmentId/questions/upload-csv', ...auth, uploadQuestionsCSV);
router.put('/questions/:questionId', ...auth, updateQuestion);
router.delete('/questions/:questionId', ...auth, deleteQuestion);

// Trainee and report operations.
router.get('/trainees/search', ...auth, searchTrainees);
router.get('/trainees/export', ...auth, exportTrainees);
router.get('/reports/batch-summary', ...auth, exportBatchSummary);
router.get('/reports/at-risk', ...auth, exportAtRisk);
router.get('/reports/module-completion', ...auth, exportModuleCompletion);
router.get('/reports/module-completion-detail', ...auth, getModuleCompletionDetail);
router.get('/reports/assessment-results', ...auth, exportAssessmentResults);
router.get('/reports/attendance-log', ...auth, exportAttendanceLog);
router.get('/reports/certification-evidence', ...auth, exportCertificationEvidence);
router.get('/reports/broadcast-assignments', ...auth, exportBroadcastAssignments);
router.get('/reports/content-reading', ...auth, exportContentReading);
router.get('/reports/qa-activity', ...auth, exportQAActivity);
router.post('/trainees/:employeeId/reset-password', ...auth, resetTraineePassword);
router.post('/trainees/:employeeId/unlock', ...auth, unlockTrainee);
// Super Admin only, not superElevatedAuth: this transfers a trainee the same way
// enroll-existing does, not a role/org/comms/HRMS change — requireRecentElevation
// would 403 with no UI re-entry prompt (see CLAUDE.md's auth notes).
router.post('/trainees/:employeeId/change-batch', ...superAuth, adminChangeTraineeBatch);
router.delete('/trainees/:employeeId', ...superElevatedAuth, deleteTraineeAccount);
router.get('/trainees/:empId/detail', ...auth, getTraineeDetail);

// Permanent employee-ID mapping changes the identity key and requires elevation.
router.get('/emp-mapping/temp-trainees', ...superAuth, getTempTrainees);
router.post('/trainees/:employeeId/map-emp-id', ...superElevatedAuth, adminMapSingleEmpId);
router.post('/emp-mapping/bulk', ...superElevatedAuth, adminBulkMapEmpIds);

// Certification policy and process/LOB masters are editable by any admin.
router.get('/cert-rules', ...auth, listCertificationRules);
router.post('/cert-rules', ...auth, saveCertificationRule);
router.put('/cert-rules/:id', ...auth, updateCertificationRule);
router.delete('/cert-rules/:id', ...auth, deleteCertificationRule);

router.post('/classrooms/:classroomId/sync-drive', ...auth, syncClassroomFromDrive);
router.post('/assign-module', ...auth, assignModule);
router.post('/broadcast-module', ...auth, broadcastModule);
router.post('/broadcast-module-bulk', ...auth, broadcastModuleBulk);
router.post('/validate-employee-ids', ...auth, validateEmployeeIds);
router.get('/broadcast-targets', ...auth, getBroadcastTargets);
router.get('/broadcast-search/content', ...auth, searchBroadcastContent);
router.get('/broadcast-assignments', ...auth, listBroadcastAssignments);
router.delete('/broadcast-assignments/:batchKey', ...auth, withdrawBroadcastAssignment);

router.get('/process-lob', ...auth, getProcessLobList);
router.post('/process-lob', ...auth, saveProcessLob);
router.put('/process-lob/:id', ...auth, updateProcessLob);
router.delete('/process-lob/:id', ...auth, deleteProcessLob);

router.get('/batches', ...auth, listBatches);
router.post('/batches', ...auth, validate(batchSchema), adminCreateBatch);
router.get('/batches/:batchNo/classrooms', ...auth, listBatchClassrooms);
router.post('/batches/:batchNo/classrooms', ...auth, addBatchClassrooms);
router.put('/batches/:batchNo/classrooms/:classroomId/primary', ...auth, setPrimaryBatchClassroom);
router.delete('/batches/:batchNo/classrooms/:classroomId', ...auth, removeBatchClassroom);
router.post('/batches/:batchNo/trainees/bulk', ...auth, adminBulkAddTrainees);
router.post('/batches/:batchNo/trainees/enroll-existing', ...auth, enrollExistingTraineeAdmin);
router.get('/batches/:batchNo', ...auth, getBatchDetail);
router.get('/batches/:batchNo/analytics', ...auth, getBatchAnalytics);
router.get('/batches/:batchNo/content-progress', ...auth, getBatchContentProgress);
router.put('/batches/:batchNo', ...auth, adminUpdateBatch);
router.put('/batches/:batchNo/coordinator', ...auth, adminUpdateBatchCoordinator);
router.post('/batches/:batchNo/close', ...auth, closeBatch);
router.delete('/batches/:batchNo', ...superElevatedAuth, deleteBatch);

router.get('/coordinators', ...auth, listCoordinators);
router.post('/coordinators', ...auth, createCoordinator);
router.get('/coordinators/all', ...auth, listAllCoordinators);
router.get('/coordinators/:loginId', ...auth, getCoordinatorDetail);
router.get('/risk/:level', ...auth, getRiskLevel);
router.post('/kpi/sync', ...superElevatedAuth, syncHistoricalKpi);
router.put('/content/:contentId/lock', ...auth, setContentLock);
router.post('/content/:contentId/unlock/:employeeId', ...auth, unlockContentForTrainee);
router.get('/branches', ...auth, listBranches);
router.get('/branches/:branch', ...auth, getBranchDetail);

// Visibility and PIN/password reset are open to any Admin (parity with Coordinators access).
// Role changes, account creation/deletion and bulk import stay super-admin + elevation-gated.
router.get('/portal-users', ...auth, listPortalUsers);
router.post('/portal-users', ...superElevatedAuth, createPortalUser);
router.post('/portal-users/bulk', ...superElevatedAuth, bulkCreatePortalUsers);
router.put('/portal-users/:id', ...superElevatedAuth, updatePortalUser);
router.post('/portal-users/:id/change-role', ...superElevatedAuth, changeUserRole);
router.delete('/portal-users/:id', ...superElevatedAuth, deletePortalUser);
router.post('/portal-users/:id/reset-pin', ...auth, resetPortalUserPin);

// Organization-master mutations are centrally governed and elevation-gated.
router.get('/org/branches', ...superAuth, listBranchMaster);
router.post('/org/branches', ...superElevatedAuth, createBranchMaster);
router.put('/org/branches/:id', ...superElevatedAuth, updateBranchMaster);
router.delete('/org/branches/:id', ...superElevatedAuth, deleteBranchMaster);
router.get('/org/designations', ...superAuth, listDesignations);
router.post('/org/designations', ...superElevatedAuth, createDesignation);
router.put('/org/designations/:id', ...superElevatedAuth, updateDesignation);
router.delete('/org/designations/:id', ...superElevatedAuth, deleteDesignation);
router.get('/org/departments', ...superAuth, listDepartments);
router.post('/org/departments', ...superElevatedAuth, createDepartment);
router.put('/org/departments/:id', ...superElevatedAuth, updateDepartment);
router.delete('/org/departments/:id', ...superElevatedAuth, deleteDepartment);

// Credentials and delivery-channel mutations require recent elevation.
router.get('/notif-config', ...superAuth, getNotifConfig);
router.post('/notif-config', ...superElevatedAuth, saveNotifConfig);
router.get('/comm-config', ...superAuth, getCommConfig);
router.post('/comm-config', ...superElevatedAuth, saveCommConfig);
router.post('/comm-config/test-email', ...superElevatedAuth, testEmailConfig);
router.post('/comm-config/test-sms', ...superElevatedAuth, testSmsConfig);
router.post('/comm-config/test-whatsapp', ...superElevatedAuth, testWhatsAppConfig);
router.get('/audit-logs', ...superAuth, listAuditLogs);
router.get('/audit-logs/:id', ...superAuth, getAuditLogDetail);

router.get('/leaderboard', ...auth, getLeaderboardAdmin);

router.get('/certificates/:employeeId/generate', ...auth, generateCertificate);
router.get('/certificates/verify/:code', ...auth, verifyCertificate);
router.post('/trainees/import/preview', ...auth, bulkImportPreview);
router.post('/trainees/import/execute', ...auth, bulkImportExecute);

// HRMS topology is readable by super admins; sync and configuration writes
// require recent password-backed elevation with a recorded justification.
router.get('/hrms/status', ...superAuth, hrmsStatus);
router.get('/hrms/detect', ...superAuth, detectHRMSTables);
router.post('/hrms/sync/branches', ...superElevatedAuth, syncBranches);
router.post('/hrms/sync/departments', ...superElevatedAuth, syncDepartments);
router.post('/hrms/sync/designations', ...superElevatedAuth, syncDesignations);
router.post('/hrms/sync/processlob', ...superElevatedAuth, syncProcessLob);
router.post('/hrms/sync/employees', ...superElevatedAuth, syncEmployees);
router.get('/hrms/config', ...superAuth, getHrmsConfig);
router.put('/hrms/config', ...superElevatedAuth, setHrmsConfig);

// ── Send sample emails (admin-only, for QA / template preview) ─────────────────
router.post('/send-sample-emails', ...superAuth, async (req, res) => {
  const targets = (req.body?.emails || []).filter(e => typeof e === 'string' && e.includes('@'));
  if (targets.length === 0) return res.status(400).json({ ok: false, message: 'Provide at least one valid email in body.emails[]' });

  const sample = {
    traineeName: 'Harneet Kaur',
    employeeId: 'MCN-TEST-001',
    batchNo: 'BATCH-2026-Q3-01',
    batchName: 'Onfido Process Batch — Q3 2026',
    process: 'Onfido KYC Verification',
    lob: 'KYC Operations',
    classroomName: 'Onfido Foundation Module',
    moduleName: 'Onfido Identity Verification — Module 3',
    broadcastTitle: 'Refresher: AML Compliance Update',
    assessmentName: 'PKT — Onfido KYC Module 3',
    tempPassword: 'TempP@ss#2026',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  const results = [];

  for (const to of targets) {
    const r = { to, emails: {} };

    const run = async (name, fn) => {
      try { const out = await fn(); r.emails[name] = out ?? { ok: true }; }
      catch (err) { r.emails[name] = { ok: false, error: err.message }; }
    };

    await run('onboarding', () => notifyOnboarding({ ...sample, email: to }));
    await run('batch_assignment', () => notifyBatchAssignment({ ...sample, email: to }));
    await run('certification', () => notifyCertification({ ...sample, email: to }));
    await run('password_reset', () => notifyPasswordReset({ ...sample, email: to }));
    await run('module_assigned', () => notifyModuleAssigned({ ...sample, email: to, assignmentType: 'Mandatory' }));
    await run('assessment_assigned', () => notifyAssessmentAssigned({ ...sample, email: to }));
    await run('certification_mailer', () => sendCertificationEmail({ ...sample, email: to }));

    // Custom templates sent via sendEmail directly
    await run('password_recovery', () => sendEmail({
      to,
      subject: 'Reset your MCN LMS password',
      html: `<p>Hi <b>${sample.traineeName}</b>,</p><p>A password reset was requested. Your temporary password is: <b>${sample.tempPassword}</b></p><p>Log in at <a href="https://mcnlms.teammas.in">mcnlms.teammas.in</a> and change it immediately.</p><p style="color:#6b7280;font-size:12px">— MCN LMS</p>`,
      text: `MCN LMS password reset. Temp password: ${sample.tempPassword}. Login at mcnlms.teammas.in.`,
    }));

    await run('welcome_credential_reminder', () => sendEmail({
      to,
      subject: 'Your MCN LMS Account is Ready — Login Details',
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <div style="background:#1e40af;padding:24px 28px"><h2 style="color:#fff;margin:0">Welcome to MCN LMS</h2><p style="color:#bfdbfe;margin:6px 0 0;font-size:13px">Your learning journey begins today</p></div>
          <div style="padding:28px">
            <p>Hi <b>${sample.traineeName}</b>,</p>
            <p>Your MCN LMS account is ready. Use the credentials below to log in:</p>
            <table style="width:100%;font-size:14px;border:1px solid #e2e8f0;border-radius:6px;padding:16px">
              <tr><td><b>Employee ID</b></td><td>${sample.employeeId}</td></tr>
              <tr><td><b>Temp Password</b></td><td><b>${sample.tempPassword}</b></td></tr>
              <tr><td><b>Batch</b></td><td>${sample.batchNo}</td></tr>
              <tr><td><b>Process</b></td><td>${sample.process}</td></tr>
            </table>
            <p style="margin-top:16px">Log in at <a href="https://mcnlms.teammas.in">mcnlms.teammas.in</a> and change your password on first login.</p>
          </div>
          <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#94a3b8">MCN T&amp;Q Training Operations · Automated Notification</p></div>
        </div></body></html>`,
      text: `Welcome to MCN LMS. Employee ID: ${sample.employeeId}, Temp Password: ${sample.tempPassword}. Login at mcnlms.teammas.in.`,
    }));

    await run('typing_test_reminder', () => sendEmail({
      to,
      subject: 'Reminder: Complete Your Daily Typing Test — MCN LMS',
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <div style="background:#7c3aed;padding:24px 28px"><h2 style="color:#fff;margin:0">⌨️ Daily Typing Test Reminder</h2><p style="color:#ddd6fe;margin:6px 0 0;font-size:13px">MCN T&amp;Q Training Operations</p></div>
          <div style="padding:28px">
            <p>Hi <b>${sample.traineeName}</b>,</p>
            <p>You have not yet completed today's Typing Test. Remember:</p>
            <ul style="font-size:14px;color:#475569;line-height:2">
              <li>Target: <b>35 WPM</b> / <b>95% Accuracy</b></li>
              <li>Duration: <b>5 minutes</b></li>
              <li>One attempt per day</li>
            </ul>
            <p>Log in to <a href="https://mcnlms.teammas.in">mcnlms.teammas.in</a> → Typing → Daily Test to complete it before midnight.</p>
          </div>
          <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#94a3b8">MCN T&amp;Q Training Operations · Automated Reminder</p></div>
        </div></body></html>`,
      text: `Hi ${sample.traineeName}, you haven't completed today's typing test. Target 35 WPM / 95% accuracy. Login at mcnlms.teammas.in.`,
    }));

    await run('assessment_result_pass', () => sendEmail({
      to,
      subject: `✅ PKT Result: You Passed — ${sample.assessmentName}`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <div style="background:#15803d;padding:24px 28px"><h2 style="color:#fff;margin:0">✅ PKT Passed!</h2><p style="color:#bbf7d0;margin:6px 0 0;font-size:13px">MCN T&amp;Q Training Operations</p></div>
          <div style="padding:28px">
            <p>Hi <b>${sample.traineeName}</b>,</p>
            <p>Congratulations! You have <b style="color:#15803d">passed</b> the following assessment:</p>
            <table style="width:100%;font-size:13px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px">
              <tr><td><b>Assessment</b></td><td>${sample.assessmentName}</td></tr>
              <tr><td><b>Module</b></td><td>${sample.moduleName}</td></tr>
              <tr><td><b>Score</b></td><td><b style="color:#15803d">82 / 100</b></td></tr>
              <tr><td><b>Date</b></td><td>${new Date().toLocaleDateString('en-IN')}</td></tr>
            </table>
            <p style="margin-top:16px">Keep up the great work. Your next module is now unlocked.</p>
          </div>
          <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#94a3b8">MCN T&amp;Q · Automated Notification</p></div>
        </div></body></html>`,
      text: `Congratulations ${sample.traineeName}! You passed the PKT for ${sample.assessmentName} with 82/100.`,
    }));

    await run('assessment_result_fail', () => sendEmail({
      to,
      subject: `⚠️ PKT Result: Retest Required — ${sample.assessmentName}`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <div style="background:#b91c1c;padding:24px 28px"><h2 style="color:#fff;margin:0">⚠️ PKT Retest Required</h2><p style="color:#fecaca;margin:6px 0 0;font-size:13px">MCN T&amp;Q Training Operations</p></div>
          <div style="padding:28px">
            <p>Hi <b>${sample.traineeName}</b>,</p>
            <p>You did not meet the passing threshold for the following assessment:</p>
            <table style="width:100%;font-size:13px;background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;padding:16px">
              <tr><td><b>Assessment</b></td><td>${sample.assessmentName}</td></tr>
              <tr><td><b>Your Score</b></td><td><b style="color:#b91c1c">38 / 100</b></td></tr>
              <tr><td><b>Passing Score</b></td><td>60 / 100</td></tr>
              <tr><td><b>Date</b></td><td>${new Date().toLocaleDateString('en-IN')}</td></tr>
            </table>
            <p style="margin-top:16px">Please review the material and speak to your coordinator for a retest. You can still pass!</p>
          </div>
          <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#94a3b8">MCN T&amp;Q · Automated Notification</p></div>
        </div></body></html>`,
      text: `Hi ${sample.traineeName}, you scored 38/100 on ${sample.assessmentName} (pass: 60). Please review and retest.`,
    }));

    await run('attendance_alert', () => sendEmail({
      to,
      subject: `⚠️ Low Attendance Alert — ${sample.traineeName} (${sample.batchNo})`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <div style="background:#d97706;padding:24px 28px"><h2 style="color:#fff;margin:0">⚠️ Low Attendance Alert</h2><p style="color:#fef3c7;margin:6px 0 0;font-size:13px">MCN T&amp;Q Training Operations — For Coordinator</p></div>
          <div style="padding:28px">
            <p>This is an automated alert for your attention:</p>
            <table style="width:100%;font-size:14px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:16px">
              <tr><td><b>Trainee</b></td><td>${sample.traineeName}</td></tr>
              <tr><td><b>Employee ID</b></td><td>${sample.employeeId}</td></tr>
              <tr><td><b>Batch</b></td><td>${sample.batchNo}</td></tr>
              <tr><td><b>Attendance This Week</b></td><td><b style="color:#b91c1c">52%</b></td></tr>
              <tr><td><b>Consecutive Absences</b></td><td><b style="color:#b91c1c">3 days</b></td></tr>
            </table>
            <p style="margin-top:16px">Please follow up with the trainee and document the reason in MCN LMS.</p>
          </div>
          <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#94a3b8">MCN T&amp;Q · Automated Alert · Reply to your coordinator</p></div>
        </div></body></html>`,
      text: `Attendance alert: ${sample.traineeName} (${sample.employeeId}) in ${sample.batchNo} has 52% attendance and 3 consecutive absences.`,
    }));

    results.push(r);
  }

  res.json({ ok: true, results });
});

export default router;
