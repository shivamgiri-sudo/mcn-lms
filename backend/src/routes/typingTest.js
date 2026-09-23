import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  getTypingTestStatus, startTypingTest, submitTypingTest, getTypingAttemptMistakes, getMyTypingHistory,
  listTypingParagraphs, createTypingParagraph, updateTypingParagraph,
  getTypingSettings, updateTypingSettings,
  getTypingDashboard, getTypingReport, exportTypingReport,
} from '../controllers/typingTest.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const adminAuth = [requireSession, requireRole('admin')];

// Trainee-facing: take the test, view own history/mistakes
router.get('/status', ...traineeAuth, getTypingTestStatus);
router.post('/start', ...traineeAuth, startTypingTest);
router.post('/attempts/:attemptId/submit', ...traineeAuth, submitTypingTest);
router.get('/attempts/:attemptId/mistakes', ...traineeAuth, getTypingAttemptMistakes);
router.get('/me/history', ...traineeAuth, getMyTypingHistory);

// Admin: paragraph bank
router.get('/admin/paragraphs', ...adminAuth, listTypingParagraphs);
router.post('/admin/paragraphs', ...adminAuth, createTypingParagraph);
router.patch('/admin/paragraphs/:id', ...adminAuth, updateTypingParagraph);

// Admin: settings
router.get('/admin/settings', ...adminAuth, getTypingSettings);
router.put('/admin/settings', ...adminAuth, updateTypingSettings);

// Admin: dashboard + report + export
router.get('/admin/dashboard', ...adminAuth, getTypingDashboard);
router.get('/admin/report', ...adminAuth, getTypingReport);
router.get('/admin/report/export', ...adminAuth, exportTypingReport);

export default router;
