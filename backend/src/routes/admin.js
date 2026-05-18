import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  getAdminDashboard,
  listClassrooms, createClassroom, updateClassroom,
  listModules, createModule, updateModule, deleteModule,
  listContents, createContent, updateContent, deleteContent,
  listFaqs, createFaq, bulkUploadFaqs, updateFaq, deleteFaq,
  listAssessments, createAssessment, updateAssessment,
  listQuestions, uploadQuestions, updateQuestion, deleteQuestion,
  searchTrainees, resetTraineePassword, unlockTrainee, deleteTraineeAccount,
  listCertificationRules, saveCertificationRule, updateCertificationRule, deleteCertificationRule,
  syncClassroomFromDrive,
  assignModule,
  getProcessLobList, saveProcessLob, updateProcessLob, deleteProcessLob,
  exportTrainees,
  syncHistoricalKpi,
  listBatches, getBatchDetail, getBatchAnalytics,
  listCoordinators, getCoordinatorDetail,
  getTraineeDetail,
  getRiskLevel,
  uploadQuestionsCSV,
  adminCreateBatch, adminUpdateBatchCoordinator, listAllCoordinators, closeBatch, deleteBatch,
  adminBulkAddTrainees, resetAdminPassword,
  setContentLock, unlockContentForTrainee,
  listBranches, getBranchDetail,
  listPortalUsers, createPortalUser, updatePortalUser, deletePortalUser, resetPortalUserPin,
} from '../controllers/admin.js';
import { contentUpload } from '../utils/upload.js';

const auth = [requireSession, requireRole('admin')];
const router = Router();

router.get('/dashboard', ...auth, getAdminDashboard);
router.post('/reset-password', ...auth, resetAdminPassword);

// Curriculum
router.get('/classrooms', ...auth, listClassrooms);
router.post('/classrooms', ...auth, createClassroom);
router.put('/classrooms/:classroomId', ...auth, updateClassroom);

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
router.post('/modules/:moduleId/faqs/bulk-upload', ...auth, contentUpload.array('files', 20), bulkUploadFaqs);
router.put('/faqs/:faqId', ...auth, updateFaq);
router.delete('/faqs/:faqId', ...auth, deleteFaq);

// Assessments
router.get('/assessments', ...auth, listAssessments);
router.post('/assessments', ...auth, createAssessment);
router.put('/assessments/:assessmentId', ...auth, updateAssessment);

router.get('/assessments/:assessmentId/questions', ...auth, listQuestions);
router.post('/assessments/:assessmentId/questions/upload', ...auth, uploadQuestions);
router.post('/assessments/:assessmentId/questions/upload-csv', ...auth, uploadQuestionsCSV);
router.put('/questions/:questionId', ...auth, updateQuestion);
router.delete('/questions/:questionId', ...auth, deleteQuestion);

// Trainee accounts
router.get('/trainees/search', ...auth, searchTrainees);
router.get('/trainees/export', ...auth, exportTrainees);
router.post('/trainees/:employeeId/reset-password', ...auth, resetTraineePassword);
router.post('/trainees/:employeeId/unlock', ...auth, unlockTrainee);
router.delete('/trainees/:employeeId', ...auth, deleteTraineeAccount);

// Trainee detail
router.get('/trainees/:empId/detail', ...auth, getTraineeDetail);

// Cert rules
router.get('/cert-rules', ...auth, listCertificationRules);
router.post('/cert-rules', ...auth, saveCertificationRule);
router.put('/cert-rules/:id', ...auth, updateCertificationRule);
router.delete('/cert-rules/:id', ...auth, deleteCertificationRule);

// Drive sync
router.post('/classrooms/:classroomId/sync-drive', ...auth, syncClassroomFromDrive);

// Assigned modules
router.post('/assign-module', ...auth, assignModule);

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
router.put('/portal-users/:id', ...auth, updatePortalUser);
router.delete('/portal-users/:id', ...auth, deletePortalUser);
router.post('/portal-users/:id/reset-pin', ...auth, resetPortalUserPin);

export default router;
