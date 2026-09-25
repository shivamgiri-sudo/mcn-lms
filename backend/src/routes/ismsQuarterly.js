import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import { exportIsmsQuarterlyReport, getIsmsQuarterlyStatus, triggerIsmsQuarterlyRun } from '../controllers/ismsQuarterlyReport.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];
const superAuth = [requireSession, requireRole('admin'), requireSuperAdmin];

router.get('/status', ...auth, getIsmsQuarterlyStatus);
router.get('/report', ...auth, exportIsmsQuarterlyReport);
// Recovery/verification only -- the scheduler runs this automatically at the
// start of every quarter with no admin action required.
router.post('/run-now', ...superAuth, triggerIsmsQuarterlyRun);

export default router;
