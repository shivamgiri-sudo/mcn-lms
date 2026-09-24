import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import { getSettings, updateSettings, triggerBulkAssign } from '../controllers/complianceTrainingSettings.js';

const router = Router();
const auth = [requireSession, requireRole('admin')];
// Configuring which module/assessment is mandatory for every new trainee is
// org-wide governance config, gated the same way as Daily Batch Report's own
// settings -- Super Admin, but not superElevatedAuth (this isn't a
// portal-user/role/HRMS change).
const superAuth = [requireSession, requireRole('admin'), requireSuperAdmin];

router.get('/settings', ...auth, getSettings);
router.put('/settings', ...superAuth, updateSettings);
router.post('/bulk-assign', ...superAuth, triggerBulkAssign);

export default router;
