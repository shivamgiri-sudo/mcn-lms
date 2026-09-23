import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import {
  listActivityConfigs, saveActivityConfig,
  getReportSettings, updateReportSettings,
  previewReport, sendReport, resendReport,
  getDashboard, getReportHistory, getReportHistoryDetail,
} from '../controllers/dailyBatchReport.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];
// Configuring activity mapping/targets/thresholds is Super Admin only, matching
// how other org-wide governance config (branch/process masters, comms config) is
// gated -- but NOT superElevatedAuth, since this isn't a portal-user/role/HRMS
// change and would 403 with no UI re-entry prompt (see CLAUDE.md's auth notes).
const superAuth = [requireSession, requireRole('admin'), requireSuperAdmin];

router.get('/activity-config', ...auth, listActivityConfigs);
router.post('/activity-config', ...superAuth, saveActivityConfig);

router.get('/settings', ...auth, getReportSettings);
router.put('/settings', ...superAuth, updateReportSettings);

router.get('/batches/:batchNo/preview', ...auth, previewReport);
router.post('/batches/:batchNo/send', ...auth, sendReport);
router.post('/history/:id/resend', ...auth, resendReport);

router.get('/dashboard', ...auth, getDashboard);
router.get('/history', ...auth, getReportHistory);
router.get('/history/:id', ...auth, getReportHistoryDetail);

export default router;
