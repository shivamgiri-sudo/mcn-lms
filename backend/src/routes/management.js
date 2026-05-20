import { Router } from 'express';
import { requireSession } from '../middleware/auth.js';
import {
  getManagementDashboard, getBranchSummaries, getProcessSummaries,
  getHistoricalKpis, getTraineeRiskList, getRiskStats,
  getBatchSummaries, getCoordinatorPerformance, getBatchTrainees,
  mgmtExportTrainees, mgmtExportBatchKpi, mgmtExportCertEvidence,
} from '../controllers/management.js';

const router = Router();

const auth = [requireSession];

router.get('/dashboard', ...auth, getManagementDashboard);
router.get('/branch-summaries', ...auth, getBranchSummaries);
router.get('/process-summaries', ...auth, getProcessSummaries);
router.get('/historical-kpis', ...auth, getHistoricalKpis);
router.get('/risk-list', ...auth, getTraineeRiskList);
router.get('/risk-stats', ...auth, getRiskStats);
router.get('/batch-summaries', ...auth, getBatchSummaries);
router.get('/coordinator-performance', ...auth, getCoordinatorPerformance);
router.get('/batches/:batchNo/trainees', ...auth, getBatchTrainees);

// Reports
router.get('/reports/trainee-progress', ...auth, mgmtExportTrainees);
router.get('/reports/batch-kpi', ...auth, mgmtExportBatchKpi);
router.get('/reports/cert-evidence', ...auth, mgmtExportCertEvidence);

export default router;
