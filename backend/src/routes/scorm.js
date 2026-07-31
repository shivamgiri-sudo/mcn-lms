import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { scormUpload } from '../utils/upload.js';
import {
  uploadScorm,
  getScormPackage,
  deleteScormPackage,
  getScormSession,
  saveScormSession,
} from '../controllers/scorm.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];
const learnerAuth = [requireSession, requireRole('trainee')];

router.post('/upload', ...adminAuth, scormUpload.single('file'), uploadScorm);
router.get('/packages/:packageId', ...adminAuth, getScormPackage);
router.delete('/packages/:packageId', ...adminAuth, deleteScormPackage);

router.get('/session/:packageId', ...learnerAuth, getScormSession);
router.post('/session/:packageId', ...learnerAuth, saveScormSession);

export default router;
