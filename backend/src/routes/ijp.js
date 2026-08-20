import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  createPosting,
  listPostingsAdmin,
  closePosting,
  fillPosting,
  listApplicationsAdmin,
  reviewApplication,
  listOpenPostingsSelf,
  applyToPosting,
  myApplications,
} from '../controllers/ijp.js';

const router = Router();
const managerAuth = [requireSession, requireRole('admin', 'coordinator')];
const traineeAuth = [requireSession, requireRole('trainee')];

// Admin/Coordinator: create + manage postings, review applications
router.get('/admin/list', ...managerAuth, listPostingsAdmin);
router.post('/admin', ...managerAuth, createPosting);
router.patch('/admin/:id/close', ...managerAuth, closePosting);
router.patch('/admin/:id/fill', ...managerAuth, fillPosting);
router.get('/admin/:id/applications', ...managerAuth, listApplicationsAdmin);
router.patch('/admin/applications/:id', ...managerAuth, reviewApplication);

// Trainee-facing: browse open postings, apply once, see own history
router.get('/me/postings', ...traineeAuth, listOpenPostingsSelf);
router.post('/me/postings/:id/apply', ...traineeAuth, applyToPosting);
router.get('/me/applications', ...traineeAuth, myApplications);

export default router;
