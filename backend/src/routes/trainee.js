import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  getLearnerDashboard,
  logContentOpen, logContentHeartbeat, logContentClose,
  getAssessment, submitAssessment,
  raiseQuestion, getMyQuestions,
  getAssignedModules,
  updateProfile,
} from '../controllers/trainee.js';

const auth = [requireSession, requireRole('trainee')];
const router = Router();

router.get('/dashboard', ...auth, getLearnerDashboard);

router.post('/content/:contentId/open', ...auth, logContentOpen);
router.post('/content/:contentId/heartbeat', ...auth, logContentHeartbeat);
router.post('/content/:contentId/close', ...auth, logContentClose);

router.get('/assessment/:assessmentId', ...auth, getAssessment);
router.post('/assessment/:assessmentId/submit', ...auth, submitAssessment);

router.get('/questions', ...auth, getMyQuestions);
router.post('/questions', ...auth, raiseQuestion);

router.get('/assigned-modules', ...auth, getAssignedModules);

// FIX 7: Profile update
router.patch('/profile', ...auth, updateProfile);

export default router;
