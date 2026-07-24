import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requireContentSequence, requireAssessmentSequence } from '../middleware/learningAccess.js';
import { validate, querySchema } from '../utils/validate.js';
import {
  getLearnerDashboard,
  logContentOpen, logContentHeartbeat, logContentClose,
  getAssessment, submitAssessment,
  raiseQuestion, getMyQuestions,
  getAssignedModules,
  updateProfile,
} from '../controllers/trainee.js';
import { getLearningJourney } from '../controllers/traineeJourney.js';

const auth = [requireSession, requireRole('trainee')];
const router = Router();

router.get('/dashboard', ...auth, getLearnerDashboard);
router.get('/journey', ...auth, getLearningJourney);

router.post('/content/:contentId/open', ...auth, requireContentSequence, logContentOpen);
router.post('/content/:contentId/heartbeat', ...auth, logContentHeartbeat);
router.post('/content/:contentId/close', ...auth, logContentClose);

router.get('/assessment/:assessmentId', ...auth, requireAssessmentSequence, getAssessment);
router.post('/assessment/:assessmentId/submit', ...auth, requireAssessmentSequence, submitAssessment);

router.get('/questions', ...auth, getMyQuestions);
router.post('/questions', ...auth, validate(querySchema), raiseQuestion);
router.get('/assigned-modules', ...auth, getAssignedModules);
router.patch('/profile', ...auth, updateProfile);

export default router;
