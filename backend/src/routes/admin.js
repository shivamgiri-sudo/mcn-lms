import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
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
  assignModule, broadcastModule, getBroadcastTargets,
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
  listPortalUsers, createPortalUser, updatePortalUser, deletePortalUser, resetPortalUserPin,
  bulkCreatePortalUsers,
  exportBatchSummary, exportAtRisk,
  exportModuleCompletion, exportAssessmentResults, exportAttendanceLog,
  exportCertificationEvidence, exportBroadcastAssignments, exportQAActivity,
  listBranchMaster, createBranchMaster, updateBranchMaster, deleteBranchMaster,
  listDesignations, createDesignation, updateDesignation, deleteDesignation,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  adminMapSingleEmpId, adminBulkMapEmpIds, getTempTrainees,
} from '../controllers/admin.js';
import { getCommConfig, saveCommConfig, testEmailConfig, testSmsConfig, testWhatsAppConfig } from '../controllers/commConfig.js';
import { contentUpload } from '../utils/upload.js';

const auth = [requireSession, requireRole('admin')];
const router = Router();

router.get('/dashboard', ...auth, getAdminDashboard);
router.post('/reset-password', ...auth, resetAdminPassword);

// Curriculum
router.get('/classrooms', ...auth, listClassrooms);
router.post('/classrooms', ...auth, createClassroom);
router.put('/classrooms/:classroomId', ...auth, updateClassroom);
router.delete('/classrooms/:classroomId', ...auth, deleteClassroom);

router.get('/classrooms/:classroomId/modules', ...auth, listModules);
router.post('/classrooms/:classroomId/modules', ...auth, createModule);
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
    next();
  });
}, bulkUploadFaqs);
router.put('/faqs/:faqId', ...auth, updateFaq);
router.delete('/faqs/:faqId', ...auth, deleteFaq);

// Assessments
router.get('/assessments', ...auth, listAssessments);
router.post('/assessments', ...auth, createAssessment);
router.put('/assessments/:assessmentId', ...auth, updateAssessment);
router.delete('/assessments/:assessmentId', ...auth, deleteAssessment);

router.get('/assessments/:assessmentId/questions', ...auth, listQuestions);
router.post('/assessments/:assessmentId/questions/upload', ...auth, uploadQuestions);
router.post('/assessments/:assessmentId/questions/upload-csv', ...auth, uploadQuestionsCSV);
router.put('/questions/:questionId', ...auth, updateQuestion);
router.delete('/questions/:questionId', ...auth, deleteQuestion);

// Trainee accounts
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
router.post('/trainees/:employeeId/reset-password', ...auth, resetTraineePassword);
router.post('/trainees/:employeeId/unlock', ...auth, unlockTrainee);
router.delete('/trainees/:employeeId', ...auth, deleteTraineeAccount);

// Trainee detail
router.get('/trainees/:empId/detail', ...auth, getTraineeDetail);

// Emp ID lifecycle mapping
router.get('/emp-mapping/temp-trainees', ...auth, getTempTrainees);
router.post('/trainees/:employeeId/map-emp-id', ...auth, adminMapSingleEmpId);
router.post('/emp-mapping/bulk', ...auth, adminBulkMapEmpIds);

// Cert rules
router.get('/cert-rules', ...auth, listCertificationRules);
router.post('/cert-rules', ...auth, saveCertificationRule);
router.put('/cert-rules/:id', ...auth, updateCertificationRule);
router.delete('/cert-rules/:id', ...auth, deleteCertificationRule);

// Drive sync
router.post('/classrooms/:classroomId/sync-drive', ...auth, syncClassroomFromDrive);

// Assigned modules
router.post('/assign-module', ...auth, assignModule);
router.post('/broadcast-module', ...auth, broadcastModule);
router.get('/broadcast-targets', ...auth, getBroadcastTargets);

// Process/LOB
router.get('/process-lob', ...auth, getProcessLobList);
router.post('/process-lob', ...auth, saveProcessLob);
router.put('/process-lob/:id', ...auth, updateProcessLob);
router.delete('/process-lob/:id', ...auth, deleteProcessLob);

// Batches
router.get('/batches', ...auth, listBatches);
router.post('/batches', ...auth, adminCreateBatch);
router.post('/batches/:batchNo/trainees/bulk', ...auth, adminBulkAddTrainees);
router.get('/batches/:batchNo', ...auth, getBatchDetail);
router.get('/batches/:batchNo/analytics', ...auth, getBatchAnalytics);
router.get('/batches/:batchNo/content-progress', ...auth, getBatchContentProgress);
router.put('/batches/:batchNo', ...auth, adminUpdateBatch);
router.put('/batches/:batchNo/coordinator', ...auth, adminUpdateBatchCoordinator);
router.post('/batches/:batchNo/close', ...auth, closeBatch);
router.delete('/batches/:batchNo', ...auth, deleteBatch);

// Coordinators
router.get('/coordinators', ...auth, listCoordinators);
router.get('/coordinators/all', ...auth, listAllCoordinators);
router.get('/coordinators/:loginId', ...auth, getCoordinatorDetail);

// Risk drilldown
router.get('/risk/:level', ...auth, getRiskLevel);

// Historical KPI sync
router.post('/kpi/sync', ...auth, syncHistoricalKpi);

// Content sequential lock management
router.put('/content/:contentId/lock', ...auth, setContentLock);
router.post('/content/:contentId/unlock/:employeeId', ...auth, unlockContentForTrainee);

// Branch management
router.get('/branches', ...auth, listBranches);
router.get('/branches/:branch', ...auth, getBranchDetail);

// Portal user management
router.get('/portal-users', ...auth, listPortalUsers);
router.post('/portal-users', ...auth, createPortalUser);
router.post('/portal-users/bulk', ...auth, bulkCreatePortalUsers);
router.put('/portal-users/:id', ...auth, updatePortalUser);
router.delete('/portal-users/:id', ...auth, deletePortalUser);
router.post('/portal-users/:id/reset-pin', ...auth, resetPortalUserPin);

// Org master data
router.get('/org/branches', ...auth, listBranchMaster);
router.post('/org/branches', ...auth, createBranchMaster);
router.put('/org/branches/:id', ...auth, updateBranchMaster);
router.delete('/org/branches/:id', ...auth, deleteBranchMaster);

router.get('/org/designations', ...auth, listDesignations);
router.post('/org/designations', ...auth, createDesignation);
router.put('/org/designations/:id', ...auth, updateDesignation);
router.delete('/org/designations/:id', ...auth, deleteDesignation);

router.get('/org/departments', ...auth, listDepartments);
router.post('/org/departments', ...auth, createDepartment);
router.put('/org/departments/:id', ...auth, updateDepartment);
router.delete('/org/departments/:id', ...auth, deleteDepartment);

// Communication Config
router.get('/comm-config', ...auth, getCommConfig);
router.post('/comm-config', ...auth, saveCommConfig);
router.post('/comm-config/test-email', ...auth, testEmailConfig);
router.post('/comm-config/test-sms', ...auth, testSmsConfig);
router.post('/comm-config/test-whatsapp', ...auth, testWhatsAppConfig);

export default router;
