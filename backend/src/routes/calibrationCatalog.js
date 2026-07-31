import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { normalizeCalibration } from '../services/calibrationGovernance.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];

function companyScope(req) {
  return req.permissionScope === 'company'
    || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

router.get('/admin/templates/:templateId/criteria', ...adminAuth, requirePermission('calibration.manage'), async (req, res) => {
  try {
    const templates = await prisma.$queryRawUnsafe(
      `SELECT template_id AS templateId, template_code AS templateCode,
              template_name AS templateName, version_no AS versionNo,
              status, audience_branch AS audienceBranch
         FROM practical_assessment_template WHERE template_id = ? LIMIT 1`,
      String(req.params.templateId),
    );
    const template = normalizeCalibration(templates[0] || null);
    if (!template || template.status !== 'PUBLISHED'
        || (!companyScope(req) && template.audienceBranch && template.audienceBranch !== String(req.userBranch || ''))) {
      return res.status(404).json({ ok: false, message: 'Published rubric version not found.' });
    }
    const criteria = await prisma.$queryRawUnsafe(
      `SELECT c.criterion_id AS criterionId, c.criterion_code AS criterionCode,
              c.criterion_title AS criterionTitle, c.max_score AS maxScore,
              c.critical, c.critical_min_score AS criticalMinScore,
              s.section_id AS sectionId, s.section_code AS sectionCode,
              s.section_title AS sectionTitle, s.sort_order AS sectionOrder,
              c.sort_order AS criterionOrder
         FROM practical_rubric_criterion c
         INNER JOIN practical_rubric_section s ON s.section_id = c.section_id
        WHERE s.template_id = ?
        ORDER BY s.sort_order, c.sort_order`,
      String(req.params.templateId),
    );
    return res.json({ ok: true, data: normalizeCalibration({ template, criteria }) });
  } catch (error) {
    console.error('[CALIBRATION-CATALOG] criteria:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load rubric criteria.' });
  }
});

export default router;
