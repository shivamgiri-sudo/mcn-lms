import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  listPrompts, getPrompt, saveSession, getMySessions, getMyStats,
  getAnalytics, getAnalyticsTrainees, getAnalyticsTrainee,
  getHeatmap, getTrend,
  adminListPrompts, adminImportPrompts, adminTogglePrompt,
} from '../controllers/typingPractice.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const reviewerAuth = [requireSession, requireRole('admin', 'coordinator')];
const adminAuth = [requireSession, requireRole('admin', 'super_admin')];

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

// Admin passage management
router.get('/admin/passages', ...adminAuth, adminListPrompts);
router.post('/admin/passages', ...adminAuth, adminImportPrompts);
router.patch('/admin/passages/:id/toggle', ...adminAuth, adminTogglePrompt);

export default router;
