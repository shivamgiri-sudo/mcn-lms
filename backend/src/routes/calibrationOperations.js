import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  calculateReliabilityCohorts,
  getCertificateByCode,
  getEvaluatorReliabilityTrend,
  listCohortBenchmarks,
  listEvaluatorCertificates,
  normalize,
  runEvaluatorQualityOperationsCycle,
} from '../services/calibrationOperations.js';

const router = Router();
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[CALIBRATION-OPS] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        code: error.code || 'CALIBRATION_OPERATIONS_ERROR',
        message: status >= 500 ? 'Evaluator-quality operations service failed.' : error.message,
        details: status < 500 ? error.details || null : null,
      });
    }
  };
}

function text(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function number(value, fallback = null, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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

async function roleScope(userId) {
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT login_id AS loginId, name, role, branch, process, lob
       FROM role_access_matrix WHERE login_id = ? AND active = 1 LIMIT 1`,
    String(userId),
  ));
  return rows[0] || { loginId: userId, name: userId, branch: '', process: '', lob: '' };
}

async function anchorInScope(req, anchorId) {
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT a.anchor_id AS anchorId, a.anchor_title AS anchorTitle,
            a.program_id AS programId, p.status AS programStatus,
            p.audience_branch AS audienceBranch
       FROM evaluator_calibration_anchor a
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
      WHERE a.anchor_id = ? LIMIT 1`,
    String(anchorId),
  ));
  const anchor = rows[0] || null;
  if (!anchor) return null;
  if (!companyScope(req) && anchor.audienceBranch !== String(req.userBranch || '')) return null;
  return anchor;
}

function validateEvidencePayload(body) {
  const evidenceType = text(body.evidenceType, 30).toUpperCase();
  if (!['DOCUMENT', 'IMAGE', 'VIDEO', 'AUDIO', 'LINK', 'TEXT', 'DATASET'].includes(evidenceType)) {
    throw Object.assign(new Error('Select a supported evidence type.'), { status: 400 });
  }
  const sourceUrl = text(body.sourceUrl, 4000) || null;
  const storageReference = text(body.storageReference, 500) || null;
  const textContent = text(body.textContent, 50000) || null;
  if (!sourceUrl && !storageReference && !textContent) {
    throw Object.assign(new Error('Evidence requires a secure URL, storage reference or text content.'), { status: 400 });
  }
  if (sourceUrl && !/^(https:\/\/|\/)/i.test(sourceUrl)) {
    throw Object.assign(new Error('Evidence URLs must use HTTPS or an application-relative path.'), { status: 400 });
  }
  const contentHash = text(body.contentHash, 64).toLowerCase() || null;
  if (contentHash && !/^[a-f0-9]{64}$/.test(contentHash)) {
    throw Object.assign(new Error('Content hash must be a SHA-256 hexadecimal value.'), { status: 400 });
  }
  const visibility = text(body.visibility, 40).toUpperCase() || 'EVALUATOR';
  if (!['EVALUATOR', 'AFTER_SUBMISSION', 'ADMIN_ONLY'].includes(visibility)) {
    throw Object.assign(new Error('Select a supported evidence visibility.'), { status: 400 });
  }
  return {
    evidenceCode: text(body.evidenceCode, 100).toUpperCase().replace(/[^A-Z0-9_-]/g, '-'),
    evidenceTitle: text(body.evidenceTitle, 220),
    evidenceType,
    sourceUrl,
    storageReference,
    textContent,
    contentHash,
    mimeType: text(body.mimeType, 160) || null,
    fileSizeBytes: number(body.fileSizeBytes, null, 0, 10737418240),
    visibility,
    retentionUntil: date(body.retentionUntil),
  };
}

async function selfAssignmentEvidence(req, res, evaluatorType) {
  const assignmentId = String(req.params.assignmentId);
  const assignments = normalize(await prisma.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.status, a.evaluator_id AS evaluatorId,
            a.evaluator_type AS evaluatorType, a.program_id AS programId
       FROM evaluator_calibration_assignment a
      WHERE a.assignment_id = ? LIMIT 1`,
    assignmentId,
  ));
  const assignment = assignments[0];
  if (!assignment || assignment.evaluatorId !== String(req.userId) || assignment.evaluatorType !== evaluatorType) {
    return res.status(404).json({ ok: false, message: 'Calibration assignment not found.' });
  }
  const editable = ['ASSIGNED', 'IN_PROGRESS'].includes(assignment.status);
  const visibility = editable ? `e.visibility = 'EVALUATOR'` : `e.visibility IN ('EVALUATOR','AFTER_SUBMISSION')`;
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT e.evidence_id AS evidenceId, e.anchor_id AS anchorId,
            e.evidence_code AS evidenceCode, e.evidence_title AS evidenceTitle,
            e.evidence_type AS evidenceType, e.source_url AS sourceUrl,
            e.storage_reference AS storageReference, e.text_content AS textContent,
            e.content_hash AS contentHash, e.mime_type AS mimeType,
            e.file_size_bytes AS fileSizeBytes, e.version_no AS versionNo,
            e.visibility, e.retention_until AS retentionUntil,
            a.anchor_title AS anchorTitle, a.sort_order AS anchorOrder
       FROM evaluator_calibration_anchor_evidence e
       INNER JOIN evaluator_calibration_anchor a ON a.anchor_id = e.anchor_id
      WHERE a.program_id = ? AND e.status = 'APPROVED' AND ${visibility}
        AND (e.retention_until IS NULL OR e.retention_until > UTC_TIMESTAMP(3))
      ORDER BY a.sort_order, e.evidence_code, e.version_no DESC`,
    assignment.programId,
  ));
  return res.json({ ok: true, data: rows });
}

// Minimal public verification. No login ID, email, phone or protected calibration standard is exposed.
router.get('/certificates/verify/:certificateCode', route(async (req, res) => {
  const certificate = await getCertificateByCode(req.params.certificateCode);
  if (!certificate) return res.status(404).json({ ok: false, message: 'Certificate not found.' });
  const current = certificate.status === 'ACTIVE' && new Date(certificate.validUntil).getTime() > Date.now();
  const snapshot = certificate.snapshotJson || {};
  return res.json({
    ok: true,
    data: {
      certificateCode: certificate.certificateCode,
      status: current ? 'ACTIVE' : certificate.status === 'ACTIVE' ? 'EXPIRED' : certificate.status,
      valid: current,
      evaluatorName: snapshot.evaluatorName || null,
      evaluatorRole: snapshot.evaluatorRole || null,
      branch: snapshot.branch || null,
      templateName: certificate.templateName,
      templateVersion: certificate.templateVersion,
      programName: certificate.programName,
      issuedAt: certificate.issuedAt,
      validFrom: certificate.validFrom,
      validUntil: certificate.validUntil,
      verificationHash: certificate.verificationHash,
    },
  });
}));

router.get('/coordinator/operations', ...coordinatorAuth, requirePermission('calibration.view_self'), route(async (req, res) => {
  const scope = await roleScope(req.userId);
  const [certificates, trends, benchmarks] = await Promise.all([
    listEvaluatorCertificates(req.userId, 'coordinator'),
    getEvaluatorReliabilityTrend(req.userId, 'coordinator', req.query.templateId || null, req.query.limit || 24),
    listCohortBenchmarks({ branch: scope.branch, process: scope.process, lob: scope.lob, templateId: req.query.templateId || null }),
  ]);
  res.json({ ok: true, data: { scope, certificates, trends, benchmarks } });
}));

router.get('/admin/operations/self', ...adminAuth, requirePermission('calibration.view_self'), route(async (req, res) => {
  const scope = await roleScope(req.userId);
  const [certificates, trends, benchmarks] = await Promise.all([
    listEvaluatorCertificates(req.userId, 'admin'),
    getEvaluatorReliabilityTrend(req.userId, 'admin', req.query.templateId || null, req.query.limit || 24),
    listCohortBenchmarks({ branch: scope.branch, process: scope.process, lob: scope.lob, templateId: req.query.templateId || null }),
  ]);
  res.json({ ok: true, data: { scope, certificates, trends, benchmarks } });
}));

router.get('/coordinator/assignments/:assignmentId/evidence', ...coordinatorAuth, requirePermission('calibration.view_self'), route((req, res) => selfAssignmentEvidence(req, res, 'coordinator')));
router.get('/admin/assignments/:assignmentId/self/evidence', ...adminAuth, requirePermission('calibration.view_self'), route((req, res) => selfAssignmentEvidence(req, res, 'admin')));

router.get('/admin/operations/dashboard', ...adminAuth, requirePermission('calibration.report'), route(async (req, res) => {
  const branch = companyScope(req) ? text(req.query.branch, 120) || null : String(req.userBranch || '');
  const process = text(req.query.process, 120) || null;
  const lob = text(req.query.lob, 120) || null;
  const templateId = text(req.query.templateId, 36) || null;
  const benchmarks = await listCohortBenchmarks({ branch, process, lob, templateId, limit: req.query.limit || 500 });
  const certificateParams = [];
  let certificateScope = '';
  if (branch) {
    certificateScope += ' AND r.branch = ?';
    certificateParams.push(branch);
  }
  if (process) {
    certificateScope += ' AND r.process = ?';
    certificateParams.push(process);
  }
  if (lob) {
    certificateScope += ' AND r.lob = ?';
    certificateParams.push(lob);
  }
  if (templateId) {
    certificateScope += ' AND c.template_id = ?';
    certificateParams.push(templateId);
  }
  const certificates = normalize(await prisma.$queryRawUnsafe(
    `SELECT c.certificate_id AS certificateId, c.certificate_code AS certificateCode,
            c.evaluator_id AS evaluatorId, c.evaluator_type AS evaluatorType,
            r.name AS evaluatorName, r.role AS evaluatorRole, r.branch, r.process, r.lob,
            c.status, c.issued_at AS issuedAt, c.valid_until AS validUntil,
            t.template_name AS templateName, t.version_no AS templateVersion
       FROM evaluator_authorization_certificate c
       INNER JOIN practical_assessment_template t ON t.template_id = c.template_id
       LEFT JOIN role_access_matrix r ON r.login_id = c.evaluator_id
      WHERE 1 = 1${certificateScope}
      ORDER BY c.valid_until DESC LIMIT 1000`,
    ...certificateParams,
  ));
  res.json({ ok: true, data: { filters: { branch, process, lob, templateId }, benchmarks, certificates } });
}));

router.post('/admin/operations/run', ...adminAuth, requirePermission('calibration.report'), route(async (req, res) => {
  const result = await runEvaluatorQualityOperationsCycle(`admin-${req.userId}`);
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RUN_EVALUATOR_QUALITY_OPERATIONS', module: 'EvaluatorQuality', newValue: result });
  res.json({ ok: true, message: 'Evaluator-quality operations cycle completed.', data: result });
}));

router.post('/admin/cohorts/calculate', ...adminAuth, requirePermission('calibration.report'), route(async (req, res) => {
  const result = await calculateReliabilityCohorts({
    periodStart: req.body?.periodStart,
    periodEnd: req.body?.periodEnd,
    actorId: req.userId,
  });
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CALCULATE_EVALUATOR_COHORTS', module: 'EvaluatorQuality', newValue: result });
  res.json({ ok: true, message: 'Reliability cohorts calculated.', data: result });
}));

router.get('/admin/anchors/:anchorId/evidence', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const anchor = await anchorInScope(req, req.params.anchorId);
  if (!anchor) return res.status(404).json({ ok: false, message: 'Calibration anchor not found.' });
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT evidence_id AS evidenceId, anchor_id AS anchorId,
            evidence_code AS evidenceCode, evidence_title AS evidenceTitle,
            evidence_type AS evidenceType, source_url AS sourceUrl,
            storage_reference AS storageReference, text_content AS textContent,
            content_hash AS contentHash, mime_type AS mimeType,
            file_size_bytes AS fileSizeBytes, version_no AS versionNo,
            status, visibility, retention_until AS retentionUntil,
            approved_by AS approvedBy, approved_at AS approvedAt,
            retired_by AS retiredBy, retired_at AS retiredAt,
            retirement_reason AS retirementReason, created_by AS createdBy,
            created_at AS createdAt, updated_at AS updatedAt
       FROM evaluator_calibration_anchor_evidence
      WHERE anchor_id = ? ORDER BY evidence_code, version_no DESC`,
    anchor.anchorId,
  ));
  res.json({ ok: true, data: { anchor, evidence: rows } });
}));

router.post('/admin/anchors/:anchorId/evidence', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const anchor = await anchorInScope(req, req.params.anchorId);
  if (!anchor) return res.status(404).json({ ok: false, message: 'Calibration anchor not found.' });
  if (anchor.programStatus !== 'DRAFT') return res.status(409).json({ ok: false, message: 'Published calibration evidence is version-locked. Create a new draft programme version.' });
  const input = validateEvidencePayload(req.body || {});
  if (!input.evidenceCode || !input.evidenceTitle) return res.status(400).json({ ok: false, message: 'Evidence code and title are required.' });
  const versions = normalize(await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX(version_no),0) AS versionNo
       FROM evaluator_calibration_anchor_evidence
      WHERE anchor_id = ? AND evidence_code = ?`,
    anchor.anchorId, input.evidenceCode,
  ));
  const evidenceId = randomUUID();
  const versionNo = Number(versions[0]?.versionNo || 0) + 1;
  await prisma.$executeRawUnsafe(
    `INSERT INTO evaluator_calibration_anchor_evidence
       (evidence_id, anchor_id, evidence_code, evidence_title, evidence_type,
        source_url, storage_reference, text_content, content_hash, mime_type,
        file_size_bytes, version_no, status, visibility, retention_until, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
    evidenceId, anchor.anchorId, input.evidenceCode, input.evidenceTitle, input.evidenceType,
    input.sourceUrl, input.storageReference, input.textContent, input.contentHash,
    input.mimeType, input.fileSizeBytes, versionNo, input.visibility,
    input.retentionUntil, String(req.userId),
  );
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_CALIBRATION_ANCHOR_EVIDENCE', module: 'EvaluatorQuality', referenceId: evidenceId, newValue: { anchorId: anchor.anchorId, evidenceCode: input.evidenceCode, versionNo } });
  res.status(201).json({ ok: true, message: 'Governed anchor evidence created as a draft.', data: { evidenceId, anchorId: anchor.anchorId, ...input, versionNo, status: 'DRAFT' } });
}));

router.put('/admin/evidence/:evidenceId', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT e.evidence_id AS evidenceId, e.anchor_id AS anchorId, e.status,
            p.status AS programStatus, p.audience_branch AS audienceBranch
       FROM evaluator_calibration_anchor_evidence e
       INNER JOIN evaluator_calibration_anchor a ON a.anchor_id = e.anchor_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
      WHERE e.evidence_id = ? LIMIT 1`,
    String(req.params.evidenceId),
  ));
  const existing = rows[0];
  if (!existing || (!companyScope(req) && existing.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Anchor evidence not found.' });
  if (existing.status !== 'DRAFT' || existing.programStatus !== 'DRAFT') return res.status(409).json({ ok: false, message: 'Only evidence in a draft calibration programme may be edited.' });
  const input = validateEvidencePayload(req.body || {});
  if (!input.evidenceTitle) return res.status(400).json({ ok: false, message: 'Evidence title is required.' });
  await prisma.$executeRawUnsafe(
    `UPDATE evaluator_calibration_anchor_evidence
        SET evidence_title = ?, evidence_type = ?, source_url = ?,
            storage_reference = ?, text_content = ?, content_hash = ?,
            mime_type = ?, file_size_bytes = ?, visibility = ?, retention_until = ?
      WHERE evidence_id = ?`,
    input.evidenceTitle, input.evidenceType, input.sourceUrl, input.storageReference,
    input.textContent, input.contentHash, input.mimeType, input.fileSizeBytes,
    input.visibility, input.retentionUntil, existing.evidenceId,
  );
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_CALIBRATION_ANCHOR_EVIDENCE', module: 'EvaluatorQuality', referenceId: existing.evidenceId });
  res.json({ ok: true, message: 'Governed anchor evidence updated.', data: { evidenceId: existing.evidenceId, ...input } });
}));

router.post('/admin/evidence/:evidenceId/approve', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT e.evidence_id AS evidenceId, e.status, p.status AS programStatus,
            p.audience_branch AS audienceBranch
       FROM evaluator_calibration_anchor_evidence e
       INNER JOIN evaluator_calibration_anchor a ON a.anchor_id = e.anchor_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
      WHERE e.evidence_id = ? LIMIT 1`,
    String(req.params.evidenceId),
  ));
  const evidence = rows[0];
  if (!evidence || (!companyScope(req) && evidence.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Anchor evidence not found.' });
  if (evidence.status !== 'DRAFT' || evidence.programStatus !== 'DRAFT') return res.status(409).json({ ok: false, message: 'Only draft evidence in a draft programme may be approved.' });
  await prisma.$executeRawUnsafe(
    `UPDATE evaluator_calibration_anchor_evidence
        SET status = 'APPROVED', approved_by = ?, approved_at = UTC_TIMESTAMP(3)
      WHERE evidence_id = ?`,
    String(req.userId), evidence.evidenceId,
  );
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'APPROVE_CALIBRATION_ANCHOR_EVIDENCE', module: 'EvaluatorQuality', referenceId: evidence.evidenceId });
  res.json({ ok: true, message: 'Anchor evidence approved and locked.', data: { evidenceId: evidence.evidenceId, status: 'APPROVED' } });
}));

router.post('/admin/evidence/:evidenceId/retire', ...adminAuth, requirePermission('calibration.manage'), route(async (req, res) => {
  const reason = text(req.body?.reason, 20000);
  if (reason.length < 20) return res.status(400).json({ ok: false, message: 'Provide a retirement reason of at least 20 characters.' });
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT e.evidence_id AS evidenceId, e.status, p.audience_branch AS audienceBranch
       FROM evaluator_calibration_anchor_evidence e
       INNER JOIN evaluator_calibration_anchor a ON a.anchor_id = e.anchor_id
       INNER JOIN evaluator_calibration_program p ON p.program_id = a.program_id
      WHERE e.evidence_id = ? LIMIT 1`,
    String(req.params.evidenceId),
  ));
  const evidence = rows[0];
  if (!evidence || (!companyScope(req) && evidence.audienceBranch !== String(req.userBranch || ''))) return res.status(404).json({ ok: false, message: 'Anchor evidence not found.' });
  if (evidence.status === 'RETIRED') return res.json({ ok: true, message: 'Anchor evidence is already retired.', data: { evidenceId: evidence.evidenceId, status: 'RETIRED' } });
  await prisma.$executeRawUnsafe(
    `UPDATE evaluator_calibration_anchor_evidence
        SET status = 'RETIRED', retired_by = ?, retired_at = UTC_TIMESTAMP(3), retirement_reason = ?
      WHERE evidence_id = ?`,
    String(req.userId), reason, evidence.evidenceId,
  );
  await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RETIRE_CALIBRATION_ANCHOR_EVIDENCE', module: 'EvaluatorQuality', referenceId: evidence.evidenceId, newValue: { reason } });
  res.json({ ok: true, message: 'Anchor evidence retired with an audit reason.', data: { evidenceId: evidence.evidenceId, status: 'RETIRED' } });
}));

export default router;