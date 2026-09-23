import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  listPrompts, getPrompt, saveSession, getMySessions, getMyStats,
  getAnalytics, getAnalyticsTrainees, getAnalyticsTrainee,
  getHeatmap, getTrend,
} from '../controllers/typingPractice.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const reviewerAuth = [requireSession, requireRole('admin', 'coordinator')];

// Trainee
router.get('/prompts', ...traineeAuth, listPrompts);
router.get('/prompts/:id', ...traineeAuth, getPrompt);
router.post('/sessions', ...traineeAuth, saveSession);
router.get('/me/sessions', ...traineeAuth, getMySessions);
router.get('/me/stats', ...traineeAuth, getMyStats);

// Analytics (coordinator / admin / super admin)
router.get('/analytics', ...reviewerAuth, getAnalytics);
router.get('/analytics/trainees', ...reviewerAuth, getAnalyticsTrainees);
router.get('/analytics/trainee/:traineeId', ...reviewerAuth, getAnalyticsTrainee);
router.get('/analytics/heatmap', ...reviewerAuth, getHeatmap);
router.get('/analytics/trend', ...reviewerAuth, getTrend);

export default router;
