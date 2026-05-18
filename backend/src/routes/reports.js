import { Router } from 'express';
import { requireSession } from '../middleware/auth.js';
import { getBatchReport, exportTraineesCsv, sendDailySummary } from '../controllers/reports.js';

const router = Router();

router.get('/batch/:batchNo', requireSession, getBatchReport);
router.get('/trainees/export', requireSession, exportTraineesCsv);
router.post('/send-daily-summary', requireSession, sendDailySummary);

export default router;
