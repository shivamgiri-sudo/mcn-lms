import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { notificationRuntime } from '../middleware/notificationRuntime.js';
import { notificationEventHooks } from '../middleware/notificationHooks.js';
import { practicalNotificationHooks } from '../middleware/practicalNotificationHooks.js';
import { calibrationRuntime } from '../middleware/calibrationRuntime.js';
import { calibrationStandardsGuard } from '../middleware/calibrationStandardsGuard.js';
import { evaluatorAuthorizationGate } from '../middleware/evaluatorAuthorizationGate.js';
import notificationRoutes from './notifications.js';
import calendarRoutes from './calendar.js';
import practicalRoutes from './practical.js';
import practicalCatalogRoutes from './practicalCatalog.js';
import calibrationRoutes from './calibration.js';
import calibrationCatalogRoutes from './calibrationCatalog.js';
import { syncCertificationLifecycleForEmployee } from '../services/developmentGovernance.js';

const router = Router();

// Platform middleware is mounted here because this router is registered at /api
// before every product route in server.js. This preserves post-response event
// capture and keeps new governed modules on the existing authentication topology.
router.use(notificationRuntime);
router.use(calibrationRuntime);
router.use(notificationEventHooks);
router.use(practicalNotificationHooks);
router.use(calibrationStandardsGuard);
router.use('/notifications', notificationRoutes);
router.use('/calendar', calendarRoutes);
router.use('/calibration', calibrationCatalogRoutes);
router.use('/calibration', calibrationRoutes);

// Evaluator authorization must run after the existing role session is resolved
// and before practical claim/submission handlers execute. These route-specific
// preflights preserve backward compatibility when no published calibration
// program exists for the rubric version.
router.post(
  '/practical/coordinator/assignments/:assignmentId/claim',
  requireSession,
  requireRole('coordinator'),
  evaluatorAuthorizationGate,
  (_req, _res, next) => next(),
);
router.post(
  '/practical/coordinator/evaluations/:evaluationId/submit',
  requireSession,
  requireRole('coordinator'),
  evaluatorAuthorizationGate,
  (_req, _res, next) => next(),
);
router.post(
  '/practical/admin/assignments/:assignmentId/claim',
  requireSession,
  requireRole('admin'),
  evaluatorAuthorizationGate,
  (_req, _res, next) => next(),
);
router.post(
  '/practical/admin/evaluations/:evaluationId/submit',
  requireSession,
  requireRole('admin'),
  evaluatorAuthorizationGate,
  (_req, _res, next) => next(),
);

router.use('/practical', practicalCatalogRoutes);
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
