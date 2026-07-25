import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  createCalibrationAppeal,
  generateGovernanceEvidencePack,
  getAppeal,
  getAppealDashboard,
  getEvidencePack,
  getSelfGovernance,
  manageCalibrationAppeal,
  normalizeAppeal,
  provideAppealInformation,
  recordEvidencePackDownload,
  revokeEvidencePack,
  runAppealGovernanceCycle,
  withdrawAppeal,
} from '../services/calibrationAppeals.js';

const router = Router();
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[CALIBRATION-APPEAL] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        code: error.code || 'CALIBRATION_APPEAL_ERROR',
        message: status >= 500 ? 'Calibration appeal governance service failed.' : error.message,
        details: status < 500 ? error.details || null : null,
      });
    }
  };
}

function text(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function companyScope(req) {
  return req.permissionScope === 'company'
    || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

async function appealInScope(req, appealId) {
  const rows = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT appeal_id AS appealId, evaluator_id AS evaluatorId,
            evaluator_type AS evaluatorType, branch, assignment_id AS assignmentId
       FROM evaluator_calibration_appeal WHERE appeal_id = ? LIMIT 1`,
    String(appealId),
  ));
  const appeal = rows[0] || null;
  if (!appeal) return null;
  if (!companyScope(req) && appeal.branch !== String(req.userBranch || '')) return null;
  return appeal;
}

async function packInScope(req, packId) {
  const pack = await getEvidencePack(packId);
  if (!pack) return null;
  if (!companyScope(req) && pack.branch !== String(req.userBranch || '')) return null;
  return pack;
}

async function reviewerInScope(req, reviewerId) {
  const rows = normalizeAppeal(await prisma.$queryRawUnsafe(
    `SELECT login_id AS reviewerId, branch
       FROM role_access_matrix
      WHERE login_id = ? AND active = 1 AND portal_access = 'Admin' LIMIT 1`,
    String(reviewerId),
  ));
  const reviewer = rows[0] || null;
  if (!reviewer) return null;
  if (!companyScope(req) && reviewer.branch !== String(req.userBranch || '')) return null;
  return reviewer;
}

function mountSelfRoutes(prefix, auth, role) {
  const selfPrefix = `${prefix}/governance/self`;

  router.get(selfPrefix, ...auth, requirePermission('calibration.appeal_self'), route(async (req, res) => {
    const data = await getSelfGovernance({ evaluatorId: req.userId, evaluatorType: role });
    res.json({ ok: true, data });
  }));

  router.get(`${selfPrefix}/appeals/:appealId`, ...auth, requirePermission('calibration.appeal_self'), route(async (req, res) => {
    const appeal = await getAppeal(req.params.appealId);
    if (!appeal || appeal.evaluatorId !== String(req.userId) || appeal.evaluatorType !== role) {
      return res.status(404).json({ ok: false, message: 'Appeal not found.' });
    }
    res.json({ ok: true, data: appeal });
  }));

  router.post(`${selfPrefix}/appeals`, ...auth, requirePermission('calibration.appeal_self'), route(async (req, res) => {
    const appeal = await createCalibrationAppeal({
      assignmentId: text(req.body?.assignmentId, 36),
      evaluatorId: req.userId,
      evaluatorType: role,
      category: req.body?.category,
      desiredOutcome: req.body?.desiredOutcome,
      statement: req.body?.statement,
    });
    await audit({
      userIdentity: req.userId,
      userRole: role,
      action: 'SUBMIT_CALIBRATION_APPEAL',
      module: 'EvaluatorQuality',
      referenceId: appeal.appealId,
      newValue: { appealCode: appeal.appealCode, assignmentId: appeal.assignmentId, category: appeal.category },
    });
    res.status(201).json({ ok: true, message: `Appeal ${appeal.appealCode} submitted.`, data: appeal });
  }));

  router.post(`${selfPrefix}/appeals/:appealId/information`, ...auth, requirePermission('calibration.appeal_self'), route(async (req, res) => {
    const appeal = await provideAppealInformation({
      appealId: req.params.appealId,
      evaluatorId: req.userId,
      evaluatorType: role,
      response: req.body?.response,
    });
    await audit({ userIdentity: req.userId, userRole: role, action: 'PROVIDE_CALIBRATION_APPEAL_INFORMATION', module: 'EvaluatorQuality', referenceId: appeal.appealId });
    res.json({ ok: true, message: 'Additional appeal information submitted.', data: appeal });
  }));

  router.post(`${selfPrefix}/appeals/:appealId/withdraw`, ...auth, requirePermission('calibration.appeal_self'), route(async (req, res) => {
    const appeal = await withdrawAppeal({
      appealId: req.params.appealId,
      evaluatorId: req.userId,
      evaluatorType: role,
      reason: req.body?.reason,
    });
    await audit({ userIdentity: req.userId, userRole: role, action: 'WITHDRAW_CALIBRATION_APPEAL', module: 'EvaluatorQuality', referenceId: appeal.appealId });
    res.json({ ok: true, message: 'Calibration appeal withdrawn.', data: appeal });
  }));

  router.get(`${selfPrefix}/packs/:packId`, ...auth, requirePermission('calibration.appeal_self'), route(async (req, res) => {
    const pack = await getEvidencePack(req.params.packId);
    if (!pack || pack.evaluatorId !== String(req.userId) || pack.evaluatorType !== role || pack.status !== 'ACTIVE') {
      return res.status(404).json({ ok: false, message: 'Active evidence pack not found.' });
    }
    if (!pack.integrityVerified) return res.status(409).json({ ok: false, message: 'Evidence pack integrity verification failed.' });
    const downloaded = await recordEvidencePackDownload(pack.packId);
    res.setHeader('Content-Disposition', `attachment; filename="${downloaded.packCode}.json"`);
    res.json({
      packCode: downloaded.packCode,
      manifestHash: downloaded.manifestHash,
      integrityVerified: downloaded.integrityVerified,
      generatedAt: downloaded.generatedAt,
      manifest: downloaded.manifestJson,
    });
  }));
}

mountSelfRoutes('/coordinator', coordinatorAuth, 'coordinator');
mountSelfRoutes('/admin', adminAuth, 'admin');

router.get('/admin/governance/dashboard', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const data = await getAppealDashboard({ branch: req.userBranch, company: companyScope(req) });
  res.json({ ok: true, data });
}));

router.get('/admin/governance/appeals/:appealId', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const scoped = await appealInScope(req, req.params.appealId);
  if (!scoped) return res.status(404).json({ ok: false, message: 'Appeal not found in your governance scope.' });
  const appeal = await getAppeal(scoped.appealId);
  res.json({ ok: true, data: appeal });
}));

router.post('/admin/governance/appeals/:appealId/acknowledge', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const scoped = await appealInScope(req, req.params.appealId);
  if (!scoped) return res.status(404).json({ ok: false, message: 'Appeal not found in your governance scope.' });
  const appeal = await manageCalibrationAppeal({ appealId: scoped.appealId, action: 'ACKNOWLEDGE', actorId: req.userId, payload: { comment: req.body?.comment } });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ACKNOWLEDGE_CALIBRATION_APPEAL', module: 'EvaluatorQuality', referenceId: appeal.appealId });
  res.json({ ok: true, message: 'Appeal acknowledged.', data: appeal });
}));

router.post('/admin/governance/appeals/:appealId/assign', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const scoped = await appealInScope(req, req.params.appealId);
  if (!scoped) return res.status(404).json({ ok: false, message: 'Appeal not found in your governance scope.' });
  const reviewerId = text(req.body?.reviewerId, 120);
  if (!await reviewerInScope(req, reviewerId)) return res.status(404).json({ ok: false, message: 'Active reviewer not found in your governance scope.' });
  const appeal = await manageCalibrationAppeal({ appealId: scoped.appealId, action: 'ASSIGN', actorId: req.userId, payload: { reviewerId, comment: req.body?.comment } });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ASSIGN_CALIBRATION_APPEAL_REVIEWER', module: 'EvaluatorQuality', referenceId: appeal.appealId, newValue: { reviewerId } });
  res.json({ ok: true, message: 'Appeal reviewer assigned.', data: appeal });
}));

router.post('/admin/governance/appeals/:appealId/request-information', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const scoped = await appealInScope(req, req.params.appealId);
  if (!scoped) return res.status(404).json({ ok: false, message: 'Appeal not found in your governance scope.' });
  const appeal = await manageCalibrationAppeal({ appealId: scoped.appealId, action: 'REQUEST_INFORMATION', actorId: req.userId, payload: { comment: req.body?.comment } });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'REQUEST_CALIBRATION_APPEAL_INFORMATION', module: 'EvaluatorQuality', referenceId: appeal.appealId });
  res.json({ ok: true, message: 'Additional information requested.', data: appeal });
}));

router.post('/admin/governance/appeals/:appealId/resolve', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const scoped = await appealInScope(req, req.params.appealId);
  if (!scoped) return res.status(404).json({ ok: false, message: 'Appeal not found in your governance scope.' });
  const appeal = await manageCalibrationAppeal({
    appealId: scoped.appealId,
    action: 'RESOLVE',
    actorId: req.userId,
    payload: {
      resolutionType: req.body?.resolutionType,
      resolutionSummary: req.body?.resolutionSummary,
      recommendedAction: req.body?.recommendedAction,
    },
  });
  await audit({
    userIdentity: req.userId,
    userRole: 'Admin',
    action: 'RESOLVE_CALIBRATION_APPEAL',
    module: 'EvaluatorQuality',
    referenceId: appeal.appealId,
    newValue: { resolutionType: appeal.resolutionType, recommendedAction: appeal.recommendedAction, reassessmentAssignmentId: appeal.reassessmentAssignmentId },
  });
  res.json({ ok: true, message: 'Appeal resolved without altering the original calibration evidence.', data: appeal });
}));

router.post('/admin/governance/packs', ...adminAuth, requirePermission('calibration.evidence_export'), route(async (req, res) => {
  const assignmentId = text(req.body?.assignmentId, 36);
  const appealId = text(req.body?.appealId, 36) || null;
  if (appealId && !await appealInScope(req, appealId)) return res.status(404).json({ ok: false, message: 'Appeal not found in your governance scope.' });
  if (!appealId) {
    const rows = normalizeAppeal(await prisma.$queryRawUnsafe(
      `SELECT COALESCE(r.branch, p.audience_branch, '') AS branch
         FROM evaluator_calibration_assignment a
         INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
         LEFT JOIN role_access_matrix r ON r.login_id = a.evaluator_id
        WHERE a.assignment_id = ? LIMIT 1`,
      assignmentId,
    ));
    if (!rows[0] || (!companyScope(req) && rows[0].branch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Assignment not found in your governance scope.' });
  }
  const scopeLevel = companyScope(req) ? 'COMPANY' : 'BRANCH';
  const pack = await generateGovernanceEvidencePack({
    assignmentId,
    appealId,
    packType: req.body?.packType,
    actorId: req.userId,
    scopeLevel,
    expiresAt: date(req.body?.expiresAt),
  });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'GENERATE_CALIBRATION_GOVERNANCE_PACK', module: 'EvaluatorQuality', referenceId: pack.packId, newValue: { packCode: pack.packCode, manifestHash: pack.manifestHash } });
  res.status(201).json({ ok: true, message: `Evidence pack ${pack.packCode} generated.`, data: pack });
}));

router.get('/admin/governance/packs/:packId', ...adminAuth, requirePermission('calibration.evidence_export'), route(async (req, res) => {
  const pack = await packInScope(req, req.params.packId);
  if (!pack || pack.status !== 'ACTIVE') return res.status(404).json({ ok: false, message: 'Active evidence pack not found in your governance scope.' });
  if (!pack.integrityVerified) return res.status(409).json({ ok: false, message: 'Evidence pack integrity verification failed.' });
  const downloaded = await recordEvidencePackDownload(pack.packId);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'DOWNLOAD_CALIBRATION_GOVERNANCE_PACK', module: 'EvaluatorQuality', referenceId: pack.packId });
  res.setHeader('Content-Disposition', `attachment; filename="${downloaded.packCode}.json"`);
  res.json({ packCode: downloaded.packCode, manifestHash: downloaded.manifestHash, integrityVerified: downloaded.integrityVerified, generatedAt: downloaded.generatedAt, manifest: downloaded.manifestJson });
}));

router.post('/admin/governance/packs/:packId/revoke', ...adminAuth, requirePermission('calibration.evidence_export'), route(async (req, res) => {
  const scoped = await packInScope(req, req.params.packId);
  if (!scoped) return res.status(404).json({ ok: false, message: 'Evidence pack not found in your governance scope.' });
  const pack = await revokeEvidencePack({ packId: scoped.packId, actorId: req.userId, reason: req.body?.reason });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'REVOKE_CALIBRATION_GOVERNANCE_PACK', module: 'EvaluatorQuality', referenceId: pack.packId, newValue: { status: pack.status } });
  res.json({ ok: true, message: 'Evidence pack revoked.', data: pack });
}));

router.post('/admin/governance/run', ...adminAuth, requirePermission('calibration.appeal_manage'), route(async (req, res) => {
  const data = await runAppealGovernanceCycle(`manual-${req.userId}`);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RUN_CALIBRATION_APPEAL_GOVERNANCE', module: 'EvaluatorQuality', newValue: data });
  res.json({ ok: true, message: 'Appeal SLA and evidence-pack lifecycle cycle completed.', data });
}));

export default router;
