import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { notificationRuntime } from '../middleware/notificationRuntime.js';
import { notificationEventHooks } from '../middleware/notificationHooks.js';
import notificationRoutes from './notifications.js';
import calendarRoutes from './calendar.js';
import practicalRoutes from './practical.js';
import { syncCertificationLifecycleForEmployee } from '../services/developmentGovernance.js';

const router = Router();

// Platform middleware is mounted here because this router is registered at /api
// before every product route in server.js. This preserves post-response event
// capture and keeps new governed modules on the existing authentication topology.
router.use(notificationRuntime);
router.use(notificationEventHooks);
router.use('/notifications', notificationRoutes);
router.use('/calendar', calendarRoutes);
router.use('/practical', practicalRoutes);

router.post(
  '/coordinator/batches/:batchNo/certification/certify',
  requireSession,
  requireRole('coordinator'),
  (req, res, next) => {
    const employeeId = String(req.body?.employeeId || '').trim();
    if (employeeId) {
      res.once('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          syncCertificationLifecycleForEmployee(employeeId, req.userId)
            .catch(error => console.error(`[Certification] Post-certification sync failed for ${employeeId}:`, error.message));
        }
      });
    }
    next();
  },
);

export default router;
