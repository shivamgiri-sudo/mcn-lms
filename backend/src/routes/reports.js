import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import { getBatchReport, exportTraineesCsv, sendDailySummary } from '../controllers/reports.js';

const router = Router();

router.get('/batch/:batchNo', requireSession, requireRole('admin', 'coordinator', 'management'), getBatchReport);
router.get('/trainees/export', requireSession, requireRole('admin', 'management'), exportTraineesCsv);
router.post('/send-daily-summary', requireSession, requireRole('admin'), requireSuperAdmin, sendDailySummary);

export default router;
