import { prisma } from '../utils/db.js';
import { checkEvaluatorAuthorization } from '../services/calibrationGovernance.js';

async function templateForRequest(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const claim = path.match(/^\/api\/practical\/(coordinator|admin)\/assignments\/([^/]+)\/claim$/);
  if (req.method === 'POST' && claim) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT template_id AS templateId FROM practical_assessment_assignment
        WHERE assignment_id = ? LIMIT 1`,
      String(claim[2]),
    );
    return rows[0]?.templateId || null;
  }
  const submit = path.match(/^\/api\/practical\/(coordinator|admin)\/evaluations\/([^/]+)\/submit$/);
  if (req.method === 'POST' && submit) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT a.template_id AS templateId
         FROM practical_evaluation e
         INNER JOIN practical_assessment_assignment a ON a.assignment_id = e.assignment_id
        WHERE e.evaluation_id = ? LIMIT 1`,
      String(submit[2]),
    );
    return rows[0]?.templateId || null;
  }
  return null;
}

export async function evaluatorAuthorizationGate(req, res, next) {
  try {
    if (!['coordinator', 'admin'].includes(req.userType)) return next();
    const templateId = await templateForRequest(req);
    if (!templateId) return next();
    const authorization = await checkEvaluatorAuthorization({
      evaluatorId: req.userId,
      evaluatorType: req.userType,
      templateId,
    });
    if (authorization.allowed) {
      req.evaluatorAuthorization = authorization.authorization || null;
      return next();
    }
    return res.status(403).json({
      ok: false,
      code: 'EVALUATOR_CALIBRATION_REQUIRED',
      message: authorization.reason || 'Current evaluator calibration is required for this rubric version.',
      data: {
        templateId,
        authorizationStatus: authorization.authorization?.status || 'NOT_AUTHORIZED',
        validUntil: authorization.authorization?.validUntil || null,
        actionUrl: `/evaluator-quality?role=${req.userType}`,
      },
    });
  } catch (error) {
    console.error('[CALIBRATION] Authorization gate failed:', error.message);
    return res.status(503).json({
      ok: false,
      code: 'CALIBRATION_SERVICE_UNAVAILABLE',
      message: 'Evaluator authorization could not be verified. Apply the latest migrations and try again.',
    });
  }
}
