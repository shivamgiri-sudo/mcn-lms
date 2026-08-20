import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { voiceUpload } from '../utils/upload.js';
import {
  listPrompts,
  createPrompt,
  updatePrompt,
  listActivePrompts,
  submitRecording,
  getMySubmissions,
  listSubmissions,
  scoreSubmission,
  streamAudio,
} from '../controllers/voiceAccent.js';

const router = Router();
const managerAuth = [requireSession, requireRole('admin', 'coordinator')];
const traineeAuth = [requireSession, requireRole('trainee')];

// Admin/Coordinator: manage prompts + review queue
router.get('/admin/prompts', ...managerAuth, listPrompts);
router.post('/admin/prompts', ...managerAuth, createPrompt);
router.patch('/admin/prompts/:id', ...managerAuth, updatePrompt);
router.get('/admin/submissions', ...managerAuth, listSubmissions);
router.patch('/admin/submissions/:id/score', ...managerAuth, scoreSubmission);

// Trainee-facing: pick a prompt, submit a recording, view own history
router.get('/prompts', ...traineeAuth, listActivePrompts);
router.post('/submissions', ...traineeAuth, voiceUpload.single('audio'), submitRecording);
router.get('/me/submissions', ...traineeAuth, getMySubmissions);

// Protected audio streaming — trainee (own recording) or admin/coordinator
// (within review scope); never a public URL.
router.get('/audio/:id', requireSession, requireRole('trainee', 'coordinator', 'admin'), streamAudio);

export default router;
