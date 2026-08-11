import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin, requireRecentElevation } from '../middleware/auth.js';
import { validate, classroomSchema, moduleSchema, assessmentSchema, batchSchema } from '../utils/validate.js';
import {
  getAdminDashboard,
  listClassrooms, createClassroom, updateClassroom, deleteClassroom,
  listModules, createModule, updateModule, deleteModule,
  listContents, createContent, updateContent, deleteContent,
  listFaqs, createFaq, bulkUploadFaqs, updateFaq, deleteFaq,
  listAssessments, createAssessment, updateAssessment, deleteAssessment,
  listQuestions, uploadQuestions, updateQuestion, deleteQuestion,
  searchTrainees, resetTraineePassword, unlockTrainee, deleteTraineeAccount,
  listCertificationRules, saveCertificationRule, updateCertificationRule, deleteCertificationRule,
  syncClassroomFromDrive,
  assignModule, broadcastModule, broadcastModuleBulk, validateEmployeeIds, getBroadcastTargets,
  getProcessLobList, saveProcessLob, updateProcessLob, deleteProcessLob,
  exportTrainees,
  syncHistoricalKpi,
  listBatches, getBatchDetail, getBatchAnalytics, getBatchContentProgress,
  listCoordinators, getCoordinatorDetail,
  getTraineeDetail,
  getRiskLevel,
  uploadQuestionsCSV,
  adminCreateBatch, adminUpdateBatch, adminUpdateBatchCoordinator, listAllCoordinators, closeBatch, deleteBatch,
  adminBulkAddTrainees, resetAdminPassword,
  setContentLock, unlockContentForTrainee,
  listBranches, getBranchDetail,
  listPortalUsers, createPortalUser, updatePortalUser, changeUserRole, deletePortalUser, resetPortalUserPin,
  listBroadcastAssignments, withdrawBroadcastAssignment,
  bulkCreatePortalUsers,
  exportBatchSummary, exportAtRisk,
  exportModuleCompletion, exportAssessmentResults, exportAttendanceLog,
  exportCertificationEvidence, exportBroadcastAssignments, exportQAActivity,
  listBranchMaster, createBranchMaster, updateBranchMaster, deleteBranchMaster,
  listDesignations, createDesignation, updateDesignation, deleteDesignation,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  adminMapSingleEmpId, adminBulkMapEmpIds, getTempTrainees,
  listAuditLogs, getAuditLogDetail, generateCertificate,
  bulkImportPreview, bulkImportExecute,
} from '../controllers/admin.js';
import { getCommConfig, saveCommConfig, testEmailConfig, testSmsConfig, testWhatsAppConfig } from '../controllers/commConfig.js';
import { getNotifConfig, saveNotifConfig } from '../controllers/notifConfig.js';
import { contentUpload } from '../utils/upload.js';
import { syncBranches, syncDepartments, syncDesignations, syncProcessLob, syncEmployees, detectHRMSTables, hrmsStatus } from '../controllers/hrmsSeed.js';
import { getHrmsConfig, setHrmsConfig } from '../controllers/hrmsConfigController.js';

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

router.get('/classrooms/:classroomId/modules', ...auth, listModules);
router.post('/classrooms/:classroomId/modules', ...auth, validate(moduleSchema), createModule);
router.put('/modules/:moduleId', ...auth, updateModule);
router.delete('/modules/:moduleId', ...auth, deleteModule);

router.get('/modules/:moduleId/contents', ...auth, listContents);
router.post('/modules/:moduleId/contents', ...auth, contentUpload.single('file'), createContent);
router.put('/contents/:contentId', ...auth, updateContent);
router.delete('/contents/:contentId', ...auth, deleteContent);

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
router.get('/reports/assessment-results', ...auth, exportAssessmentResults);
router.get('/reports/attendance-log', ...auth, exportAttendanceLog);
router.get('/reports/certification-evidence', ...auth, exportCertificationEvidence);
router.get('/reports/broadcast-assignments', ...auth, exportBroadcastAssignments);
router.get('/reports/qa-activity', ...auth, exportQAActivity);
router.post('/trainees/:employeeId/reset-password', ...superElevatedAuth, resetTraineePassword);
router.post('/trainees/:employeeId/unlock', ...auth, unlockTrainee);
router.delete('/trainees/:employeeId', ...superElevatedAuth, deleteTraineeAccount);
router.get('/trainees/:empId/detail', ...auth, getTraineeDetail);

// Permanent employee-ID mapping changes the identity key and requires elevation.
router.get('/emp-mapping/temp-trainees', ...superAuth, getTempTrainees);
router.post('/trainees/:employeeId/map-emp-id', ...superElevatedAuth, adminMapSingleEmpId);
router.post('/emp-mapping/bulk', ...superElevatedAuth, adminBulkMapEmpIds);

// Certification policy is centrally governed and requires elevated approval.
router.get('/cert-rules', ...auth, listCertificationRules);
router.post('/cert-rules', ...superElevatedAuth, saveCertificationRule);
router.put('/cert-rules/:id', ...superElevatedAuth, updateCertificationRule);
router.delete('/cert-rules/:id', ...superElevatedAuth, deleteCertificationRule);

router.post('/classrooms/:classroomId/sync-drive', ...auth, syncClassroomFromDrive);
router.post('/assign-module', ...auth, assignModule);
router.post('/broadcast-module', ...auth, broadcastModule);
router.post('/broadcast-module-bulk', ...auth, broadcastModuleBulk);
router.post('/validate-employee-ids', ...auth, validateEmployeeIds);
router.get('/broadcast-targets', ...auth, getBroadcastTargets);
router.get('/broadcast-assignments', ...auth, listBroadcastAssignments);
router.delete('/broadcast-assignments/:batchKey', ...auth, withdrawBroadcastAssignment);

router.get('/process-lob', ...auth, getProcessLobList);
router.post('/process-lob', ...superElevatedAuth, saveProcessLob);
router.put('/process-lob/:id', ...superElevatedAuth, updateProcessLob);
router.delete('/process-lob/:id', ...superElevatedAuth, deleteProcessLob);

router.get('/batches', ...auth, listBatches);
router.post('/batches', ...auth, validate(batchSchema), adminCreateBatch);
router.post('/batches/:batchNo/trainees/bulk', ...auth, adminBulkAddTrainees);
router.get('/batches/:batchNo', ...auth, getBatchDetail);
router.get('/batches/:batchNo/analytics', ...auth, getBatchAnalytics);
router.get('/batches/:batchNo/content-progress', ...auth, getBatchContentProgress);
router.put('/batches/:batchNo', ...auth, adminUpdateBatch);
router.put('/batches/:batchNo/coordinator', ...auth, adminUpdateBatchCoordinator);
router.post('/batches/:batchNo/close', ...auth, closeBatch);
router.delete('/batches/:batchNo', ...superElevatedAuth, deleteBatch);

router.get('/coordinators', ...auth, listCoordinators);
router.get('/coordinators/all', ...auth, listAllCoordinators);
router.get('/coordinators/:loginId', ...auth, getCoordinatorDetail);
router.get('/risk/:level', ...auth, getRiskLevel);
router.post('/kpi/sync', ...superElevatedAuth, syncHistoricalKpi);
router.put('/content/:contentId/lock', ...auth, setContentLock);
router.post('/content/:contentId/unlock/:employeeId', ...auth, unlockContentForTrainee);
router.get('/branches', ...auth, listBranches);
router.get('/branches/:branch', ...auth, getBranchDetail);

// Identity and role mutations are super-admin-only and elevation-gated.
router.get('/portal-users', ...superAuth, listPortalUsers);
router.post('/portal-users', ...superElevatedAuth, createPortalUser);
router.post('/portal-users/bulk', ...superElevatedAuth, bulkCreatePortalUsers);
router.put('/portal-users/:id', ...superElevatedAuth, updatePortalUser);
router.post('/portal-users/:id/change-role', ...superElevatedAuth, changeUserRole);
router.delete('/portal-users/:id', ...superElevatedAuth, deletePortalUser);
router.post('/portal-users/:id/reset-pin', ...superElevatedAuth, resetPortalUserPin);

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

router.get('/certificates/:employeeId/generate', ...auth, generateCertificate);
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

export default router;
