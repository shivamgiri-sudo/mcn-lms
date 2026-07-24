import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { syncCertificationLifecycleForEmployee } from '../services/developmentGovernance.js';

const router = Router();

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
