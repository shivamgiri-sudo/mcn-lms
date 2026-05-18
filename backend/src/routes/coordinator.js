import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  getDashboard, getBatches, createBatch, getBatchDetails,
  addTrainee, bulkAddTrainees, searchTrainees,
  getPendingActivities, updatePendingActivity,
  answerQuery, getQueryLog,
  updateRiskAction,
  getCertificationData, saveCertificationEvidence, certifyTrainee, handoverTrainee, updateTraineeFinalStatus,
  getProcessLobList, getClassrooms, closeBatchByCoordinator,
} from '../controllers/coordinator.js';

const auth = [requireSession, requireRole('coordinator')];

const router = Router();

router.get('/dashboard', ...auth, getDashboard);
router.get('/batches', ...auth, getBatches);
router.post('/batches', ...auth, createBatch);
router.get('/batches/:batchNo', ...auth, getBatchDetails);

router.get('/trainees/search', ...auth, searchTrainees);
router.post('/batches/:batchNo/trainees', ...auth, addTrainee);
router.post('/batches/:batchNo/trainees/bulk', ...auth, bulkAddTrainees);

router.get('/pending-activities', ...auth, getPendingActivities);
router.patch('/pending-activities/:id', ...auth, updatePendingActivity);

router.get('/queries', ...auth, getQueryLog);
router.patch('/queries/:id', ...auth, answerQuery);

router.patch('/risks/:id', ...auth, updateRiskAction);

router.get('/batches/:batchNo/certification', ...auth, getCertificationData);
router.post('/batches/:batchNo/certification/evidence', ...auth, saveCertificationEvidence);
router.post('/batches/:batchNo/certification/certify', ...auth, certifyTrainee);
router.post('/batches/:batchNo/certification/handover', ...auth, handoverTrainee);
router.patch('/batches/:batchNo/trainees/:employeeId/final-status', ...auth, updateTraineeFinalStatus);

router.get('/process-lob', ...auth, getProcessLobList);
router.get('/classrooms', ...auth, getClassrooms);
router.post('/batches/:batchNo/close', ...auth, closeBatchByCoordinator);

export default router;
