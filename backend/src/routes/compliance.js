import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  previewCompliance,
  exportTrainees,
  exportAttendanceLogin,
  exportLearning,
  exportRiskEscalation,
  exportCertification,
} from '../controllers/compliance.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];

router.get('/preview', ...auth, previewCompliance);
router.get('/export/trainees', ...auth, exportTrainees);
router.get('/export/attendance-login', ...auth, exportAttendanceLogin);
router.get('/export/learning', ...auth, exportLearning);
router.get('/export/risk-escalation', ...auth, exportRiskEscalation);
router.get('/export/certification', ...auth, exportCertification);

export default router;
