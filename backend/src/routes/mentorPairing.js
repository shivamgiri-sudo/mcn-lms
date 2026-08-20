import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  listPairings,
  suggestMentors,
  createPairing,
  endPairing,
  listCheckinsAdmin,
  logCheckinAdmin,
  getMyPairing,
  logCheckinSelf,
} from '../controllers/mentorPairing.js';

const router = Router();
const managerAuth = [requireSession, requireRole('admin', 'coordinator')];
const traineeAuth = [requireSession, requireRole('trainee')];

// Admin/Coordinator: create + manage pairings
router.get('/admin/list', ...managerAuth, listPairings);
router.get('/admin/suggest-mentors', ...managerAuth, suggestMentors);
router.post('/admin', ...managerAuth, createPairing);
router.patch('/admin/:id/end', ...managerAuth, endPairing);
router.get('/admin/:id/checkins', ...managerAuth, listCheckinsAdmin);
router.post('/admin/:id/checkins', ...managerAuth, logCheckinAdmin);

// Trainee-facing: read-only "my mentor" / "my mentees" + self check-in log
router.get('/me', ...traineeAuth, getMyPairing);
router.post('/me/checkins', ...traineeAuth, logCheckinSelf);

export default router;
