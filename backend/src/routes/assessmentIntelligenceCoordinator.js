import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();
const auth = [requireSession, requireRole('coordinator'), requirePermission('assessment.analytics.view')];

function text(value, max = 191) {
  return String(value || '').trim().slice(0, max);
}

router.get('/summary', ...auth, async (req, res) => {
  try {
    const assessmentId = text(req.query?.assessmentId);
    const params = [req.userId];
    let assessmentClause = '';
    if (assessmentId) {
      assessmentClause = 'AND a.assessment_id = ?';
      params.push(assessmentId);
    }

    const rows = await prisma.$queryRawUnsafe(
      `SELECT a.assessment_id AS assessmentId,
              a.assessment_name AS assessmentName,
              c.classroom_name AS classroomName,
              c.branch,
              c.process,
              c.lob,
              (SELECT COUNT(*)
                 FROM assessment_attempts at
                 INNER JOIN trainee_master t ON t.employee_id = at.employee_id
                WHERE at.assessment_id = a.assessment_id
                  AND at.submitted_at IS NOT NULL
                  AND t.batch_no IN (
                    SELECT owned.batch_no FROM batch_master owned
                     WHERE owned.coordinator_login_id = ? AND owned.batch_status = 'Active'
                  )) AS submittedAttempts,
              (SELECT ROUND(AVG(at.percentage), 2)
                 FROM assessment_attempts at
                 INNER JOIN trainee_master t ON t.employee_id = at.employee_id
                WHERE at.assessment_id = a.assessment_id
                  AND at.submitted_at IS NOT NULL
                  AND t.batch_no IN (
                    SELECT owned.batch_no FROM batch_master owned
                     WHERE owned.coordinator_login_id = ? AND owned.batch_status = 'Active'
                  )) AS averagePercentage,
              (SELECT COUNT(*)
                 FROM assessment_attempts at
                 INNER JOIN trainee_master t ON t.employee_id = at.employee_id
                WHERE at.assessment_id = a.assessment_id
                  AND at.submitted_at IS NOT NULL
                  AND at.result = 'Pass'
                  AND t.batch_no IN (
                    SELECT owned.batch_no FROM batch_master owned
                     WHERE owned.coordinator_login_id = ? AND owned.batch_status = 'Active'
                  )) AS passedAttempts,
              (SELECT COUNT(*) FROM assessment_item_analytics ia
                WHERE ia.assessment_id = a.assessment_id) AS analysedItems,
              (SELECT COUNT(*) FROM assessment_item_analytics ia
                WHERE ia.assessment_id = a.assessment_id
                  AND ia.quality_status NOT IN ('HEALTHY','INSUFFICIENT_DATA')) AS qualityIssues,
              (SELECT COUNT(*) FROM assessment_quality_alert qa
                WHERE qa.assessment_id = a.assessment_id
                  AND qa.status IN ('OPEN','REVIEWING')) AS openAlerts
         FROM assessment_master a
         INNER JOIN classroom_master c ON c.classroom_id = a.classroom_id
        WHERE a.classroom_id IN (
          SELECT DISTINCT b.classroom_id
            FROM batch_master b
           WHERE b.coordinator_login_id = ?
             AND b.batch_status = 'Active'
             AND b.classroom_id IS NOT NULL
        ) ${assessmentClause}
        ORDER BY c.classroom_name, a.assessment_name`,
      req.userId,
      req.userId,
      req.userId,
      ...params,
    );

    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('[assessmentIntelligenceCoordinator] summary failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to load assessment analytics.' });
  }
});

export default router;
