import { randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';
import {
  AssessmentIntelligenceError,
  blueprintSupplyPreview,
  loadLearnerAssessment,
  recalculateAssessmentAnalytics,
  submitLearnerAssessment,
} from '../services/assessmentIntelligence.js';

const router = Router();
const learnerAuth = [requireSession, requireRole('trainee')];
const adminAuth = [requireSession, requireRole('admin')];
const coordinatorAuth = [requireSession, requireRole('coordinator')];

const BLUEPRINT_STATUSES = new Set(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED']);
const REVIEW_STATUSES = new Set(['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED', 'REJECTED']);
const QUESTION_TYPES = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE', 'TRUE_FALSE', 'SCENARIO', 'CASE_STUDY', 'AUDIO', 'VIDEO']);
const COGNITIVE_LEVELS = new Set(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE']);
const ALERT_STATUSES = new Set(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']);

function text(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function number(value, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function dateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return JSON.stringify(value);
}

function scopeFor(req) {
  return String(req.permissionScope || 'self');
}

function respondError(res, error, label) {
  if (error instanceof AssessmentIntelligenceError) {
    return res.status(error.status).json({ ok: false, code: error.code, message: error.message, details: error.details });
  }
  console.error(`[assessmentIntelligence] ${label}:`, error);
  return res.status(500).json({ ok: false, message: 'Server error' });
}

async function assessmentRecord(assessmentId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT a.assessment_id AS assessmentId, a.assessment_name AS assessmentName,
            a.classroom_id AS classroomId, a.module_id AS moduleId, a.day_no AS dayNo,
            a.passing_pct AS passingPct, a.attempt_limit AS attemptLimit,
            a.time_limit_mins AS timeLimitMins, a.active,
            c.classroom_name AS classroomName, c.branch, c.process, c.lob
       FROM assessment_master a
       INNER JOIN classroom_master c ON c.classroom_id = a.classroom_id
      WHERE a.assessment_id = ?
      LIMIT 1`,
    assessmentId,
  );
  return rows[0] || null;
}

async function adminAssessment(req, assessmentId) {
  const assessment = await assessmentRecord(assessmentId);
  if (!assessment) return null;
  if (scopeFor(req) !== 'company' && req.userBranch && String(assessment.branch || '') !== String(req.userBranch)) return null;
  return assessment;
}

async function coordinatorAssessment(req, assessmentId) {
  const assessment = await assessmentRecord(assessmentId);
  if (!assessment) return null;
  const owned = await prisma.batchMaster.count({
    where: {
      coordinatorLoginId: req.userId,
      classroomId: assessment.classroomId,
      batchStatus: 'Active',
    },
  });
  return owned ? assessment : null;
}

async function blueprintRecord(blueprintId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT blueprint_id AS blueprintId, assessment_id AS assessmentId, blueprint_name AS blueprintName,
            version_no AS versionNo, status, total_questions AS totalQuestions,
            randomize_questions AS randomizeQuestions, randomize_options AS randomizeOptions,
            selection_strategy AS selectionStrategy, effective_from AS effectiveFrom,
            effective_to AS effectiveTo, active, created_by AS createdBy,
            reviewed_by AS reviewedBy, reviewed_at AS reviewedAt,
            published_by AS publishedBy, published_at AS publishedAt,
            created_at AS createdAt, updated_at AS updatedAt
       FROM assessment_blueprint
      WHERE blueprint_id = ?
      LIMIT 1`,
    blueprintId,
  );
  return rows[0] || null;
}

async function scopedAdminBlueprint(req, blueprintId, allowedStatuses = null) {
  const blueprint = await blueprintRecord(blueprintId);
  if (!blueprint) return null;
  if (allowedStatuses && !allowedStatuses.includes(blueprint.status)) return null;
  const assessment = await adminAssessment(req, blueprint.assessmentId);
  return assessment ? { blueprint, assessment } : null;
}

async function questionRecord(questionId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT q.question_id AS questionId, q.assessment_id AS assessmentId,
            q.question_text AS questionText, q.difficulty, q.active
       FROM question_bank q
      WHERE q.question_id = ?
      LIMIT 1`,
    questionId,
  );
  return rows[0] || null;
}

async function scopedAdminQuestion(req, questionId) {
  const question = await questionRecord(questionId);
  if (!question) return null;
  const assessment = await adminAssessment(req, question.assessmentId);
  return assessment ? { question, assessment } : null;
}

async function scopedEmployee(req, employeeId) {
  const trainee = await prisma.traineeMaster.findUnique({
    where: { employeeId },
    select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, lob: true, status: true },
  });
  if (!trainee) return null;
  if (scopeFor(req) !== 'company' && req.userBranch && String(trainee.branch || '') !== String(req.userBranch)) return null;
  return trainee;
}

router.get('/learner/assessment/:assessmentId', ...learnerAuth, async (req, res) => {
  try {
    const data = await loadLearnerAssessment(req.userId, text(req.params.assessmentId, 191));
    return res.json({ ok: true, data });
  } catch (error) {
    return respondError(res, error, 'learner assessment load failed');
  }
});

router.post('/learner/assessment/:assessmentId/submit', ...learnerAuth, async (req, res) => {
  try {
    const data = await submitLearnerAssessment(req.userId, text(req.params.assessmentId, 191), req.body || {});
    return res.json({ ok: true, data });
  } catch (error) {
    return respondError(res, error, 'learner assessment submission failed');
  }
});

router.get('/learner/remediation', ...learnerAuth, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT recommendation_id AS recommendationId, attempt_id AS attemptId,
              assessment_id AS assessmentId, recommendation_type AS recommendationType,
              reference_id AS referenceId, title, reason, priority, status,
              created_at AS createdAt, completed_at AS completedAt
         FROM assessment_remedial_recommendation
        WHERE employee_id = ?
        ORDER BY FIELD(status, 'OPEN','IN_PROGRESS','COMPLETED','DISMISSED'),
                 FIELD(priority, 'CRITICAL','HIGH','MEDIUM','LOW'), created_at DESC
        LIMIT 200`,
      req.userId,
    );
    return res.json({ ok: true, data: rows });
  } catch (error) {
    return respondError(res, error, 'learner remediation load failed');
  }
});

router.get(
  '/admin/assessments',
  ...adminAuth,
  requirePermission('assessment.analytics.view'),
  async (req, res) => {
    try {
      const params = [];
      let branchClause = '';
      if (scopeFor(req) !== 'company' && req.userBranch) {
        branchClause = 'AND c.branch = ?';
        params.push(req.userBranch);
      }
      const rows = await prisma.$queryRawUnsafe(
        `SELECT a.assessment_id AS assessmentId, a.assessment_name AS assessmentName,
                a.classroom_id AS classroomId, c.classroom_name AS classroomName,
                c.branch, c.process, c.lob, a.passing_pct AS passingPct,
                a.attempt_limit AS attemptLimit, a.time_limit_mins AS timeLimitMins,
                a.active,
                (SELECT COUNT(*) FROM question_bank q WHERE q.assessment_id = a.assessment_id AND q.active = 1) AS activeQuestions,
                (SELECT COUNT(*) FROM assessment_question_metadata m
                   INNER JOIN question_bank q2 ON q2.question_id = m.question_id
                  WHERE q2.assessment_id = a.assessment_id AND m.review_status = 'APPROVED' AND q2.active = 1) AS approvedQuestions,
                b.blueprint_id AS blueprintId, b.version_no AS blueprintVersion,
                b.status AS blueprintStatus, b.total_questions AS blueprintQuestions,
                (SELECT COUNT(*) FROM assessment_item_analytics ia WHERE ia.assessment_id = a.assessment_id) AS analysedItems,
                (SELECT COUNT(*) FROM assessment_quality_alert qa WHERE qa.assessment_id = a.assessment_id AND qa.status IN ('OPEN','REVIEWING')) AS openQualityAlerts
           FROM assessment_master a
           INNER JOIN classroom_master c ON c.classroom_id = a.classroom_id
           LEFT JOIN assessment_blueprint b ON b.assessment_id = a.assessment_id AND b.status = 'PUBLISHED' AND b.active = 1
          WHERE 1 = 1 ${branchClause}
          ORDER BY c.branch, c.process, c.classroom_name, a.assessment_name`,
        ...params,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      return respondError(res, error, 'admin assessment catalogue failed');
    }
  },
);

router.get(
  '/admin/assessments/:assessmentId/studio',
  ...adminAuth,
  requirePermission('assessment.analytics.view'),
  async (req, res) => {
    try {
      const assessment = await adminAssessment(req, text(req.params.assessmentId, 191));
      if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found in your scope.' });
      const [blueprints, rules, questions, analytics, alerts, skills] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT blueprint_id AS blueprintId, blueprint_name AS blueprintName, version_no AS versionNo,
                  status, total_questions AS totalQuestions, randomize_questions AS randomizeQuestions,
                  randomize_options AS randomizeOptions, selection_strategy AS selectionStrategy,
                  effective_from AS effectiveFrom, effective_to AS effectiveTo,
                  reviewed_by AS reviewedBy, reviewed_at AS reviewedAt,
                  published_by AS publishedBy, published_at AS publishedAt,
                  created_at AS createdAt, updated_at AS updatedAt
             FROM assessment_blueprint WHERE assessment_id = ? ORDER BY version_no DESC`,
          assessment.assessmentId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT r.rule_id AS ruleId, r.blueprint_id AS blueprintId, r.rule_order AS ruleOrder,
                  r.topic, r.objective_code AS objectiveCode, r.skill_id AS skillId,
                  s.skill_name AS skillName, r.difficulty, r.question_type AS questionType,
                  r.cognitive_level AS cognitiveLevel, r.language_code AS languageCode,
                  r.question_count AS questionCount, r.marks_each AS marksEach,
                  r.negative_marks_each AS negativeMarksEach, r.required
             FROM assessment_blueprint_rule r
             LEFT JOIN skill_master s ON s.skill_id = r.skill_id
             INNER JOIN assessment_blueprint b ON b.blueprint_id = r.blueprint_id
            WHERE b.assessment_id = ?
            ORDER BY b.version_no DESC, r.rule_order`,
          assessment.assessmentId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT q.question_id AS questionId, q.question_text AS questionText, q.difficulty AS legacyDifficulty,
                  q.marks, q.negative_marks AS negativeMarks, q.active,
                  COALESCE(m.topic, '') AS topic, COALESCE(m.objective_code, '') AS objectiveCode,
                  m.skill_id AS skillId, s.skill_name AS skillName,
                  COALESCE(NULLIF(m.difficulty, ''), q.difficulty) AS difficulty,
                  COALESCE(m.question_type, 'SINGLE_CHOICE') AS questionType,
                  COALESCE(m.cognitive_level, 'UNDERSTAND') AS cognitiveLevel,
                  COALESCE(m.language_code, 'en-IN') AS languageCode,
                  COALESCE(m.review_status, 'APPROVED') AS reviewStatus,
                  COALESCE(m.version_no, 1) AS versionNo, m.source_reference AS sourceReference,
                  m.max_exposure_count AS maxExposureCount, COALESCE(m.usage_count, 0) AS usageCount,
                  m.last_used_at AS lastUsedAt, m.reviewed_by AS reviewedBy, m.reviewed_at AS reviewedAt,
                  m.review_notes AS reviewNotes
             FROM question_bank q
             LEFT JOIN assessment_question_metadata m ON m.question_id = q.question_id
             LEFT JOIN skill_master s ON s.skill_id = m.skill_id
            WHERE q.assessment_id = ?
            ORDER BY q.created_at, q.question_id`,
          assessment.assessmentId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT a.analytics_id AS analyticsId, a.question_id AS questionId,
                  a.sample_size AS sampleSize, a.correct_pct AS correctPct, a.blank_pct AS blankPct,
                  a.avg_response_seconds AS avgResponseSeconds,
                  a.discrimination_index AS discriminationIndex,
                  a.distractor_json AS distractorJson, a.quality_status AS qualityStatus,
                  a.calculated_at AS calculatedAt
             FROM assessment_item_analytics a WHERE a.assessment_id = ? ORDER BY a.question_id`,
          assessment.assessmentId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT alert_id AS alertId, question_id AS questionId, alert_type AS alertType,
                  severity, evidence_json AS evidence, status, owner_id AS ownerId,
                  resolution_notes AS resolutionNotes, opened_at AS openedAt,
                  resolved_by AS resolvedBy, resolved_at AS resolvedAt, updated_at AS updatedAt
             FROM assessment_quality_alert WHERE assessment_id = ?
            ORDER BY FIELD(status, 'OPEN','REVIEWING','RESOLVED','DISMISSED'),
                     FIELD(severity, 'CRITICAL','HIGH','MEDIUM','WATCH'), opened_at DESC`,
          assessment.assessmentId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT skill_id AS skillId, skill_code AS skillCode, skill_name AS skillName,
                  category, level_scale AS levelScale
             FROM skill_master WHERE active = 1 ORDER BY category, skill_name`,
        ),
      ]);
      const rulesByBlueprint = {};
      for (const rule of rules) {
        if (!rulesByBlueprint[rule.blueprintId]) rulesByBlueprint[rule.blueprintId] = [];
        rulesByBlueprint[rule.blueprintId].push(rule);
      }
      return res.json({
        ok: true,
        data: {
          assessment,
          blueprints: blueprints.map(blueprint => ({ ...blueprint, rules: rulesByBlueprint[blueprint.blueprintId] || [] })),
          questions,
          analytics,
          alerts,
          skills,
        },
      });
    } catch (error) {
      return respondError(res, error, 'assessment studio failed');
    }
  },
);

router.post(
  '/admin/assessments/:assessmentId/blueprints',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const assessment = await adminAssessment(req, text(req.params.assessmentId, 191));
      if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found in your scope.' });
      const name = text(req.body?.blueprintName, 200);
      const totalQuestions = Math.round(number(req.body?.totalQuestions, 0, 1, 500));
      if (!name || !totalQuestions) return res.status(400).json({ ok: false, message: 'Blueprint name and total questions are required.' });
      const existingDraft = await prisma.$queryRawUnsafe(
        `SELECT blueprint_id FROM assessment_blueprint WHERE assessment_id = ? AND status = 'DRAFT' AND active = 1 LIMIT 1`,
        assessment.assessmentId,
      );
      if (existingDraft.length) return res.status(409).json({ ok: false, message: 'Complete or retire the existing draft blueprint first.' });
      const versions = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(MAX(version_no), 0) AS maxVersion FROM assessment_blueprint WHERE assessment_id = ?`,
        assessment.assessmentId,
      );
      const blueprintId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO assessment_blueprint
           (blueprint_id, assessment_id, blueprint_name, version_no, status, total_questions,
            randomize_questions, randomize_options, selection_strategy, effective_from, effective_to, created_by)
         VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'SECURE_RANDOM', ?, ?, ?)`,
        blueprintId, assessment.assessmentId, name, number(versions[0]?.maxVersion, 0) + 1,
        totalQuestions, bool(req.body?.randomizeQuestions, true) ? 1 : 0,
        bool(req.body?.randomizeOptions, true) ? 1 : 0,
        dateOrNull(req.body?.effectiveFrom), dateOrNull(req.body?.effectiveTo), req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_ASSESSMENT_BLUEPRINT', module: 'Assessment Intelligence', referenceId: blueprintId, details: name });
      return res.status(201).json({ ok: true, data: await blueprintRecord(blueprintId) });
    } catch (error) {
      return respondError(res, error, 'blueprint create failed');
    }
  },
);

router.post(
  '/admin/blueprints/:blueprintId/rules',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const scoped = await scopedAdminBlueprint(req, text(req.params.blueprintId, 36), ['DRAFT']);
      if (!scoped) return res.status(404).json({ ok: false, message: 'Editable blueprint not found in your scope.' });
      const questionCount = Math.round(number(req.body?.questionCount, 0, 1, 500));
      const ruleOrder = Math.round(number(req.body?.ruleOrder, 0, 1, 500));
      if (!questionCount || !ruleOrder) return res.status(400).json({ ok: false, message: 'Rule order and question count are required.' });
      const questionType = text(req.body?.questionType, 40).toUpperCase();
      const cognitiveLevel = text(req.body?.cognitiveLevel, 40).toUpperCase();
      if (questionType && !QUESTION_TYPES.has(questionType)) return res.status(400).json({ ok: false, message: 'Invalid question type.' });
      if (cognitiveLevel && !COGNITIVE_LEVELS.has(cognitiveLevel)) return res.status(400).json({ ok: false, message: 'Invalid cognitive level.' });
      const ruleId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO assessment_blueprint_rule
           (rule_id, blueprint_id, rule_order, topic, objective_code, skill_id, difficulty,
            question_type, cognitive_level, language_code, question_count, marks_each,
            negative_marks_each, required, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ruleId, scoped.blueprint.blueprintId, ruleOrder, text(req.body?.topic, 160),
        text(req.body?.objectiveCode, 100), text(req.body?.skillId, 36) || null,
        text(req.body?.difficulty, 30), questionType, cognitiveLevel,
        text(req.body?.languageCode, 20), questionCount,
        req.body?.marksEach === '' || req.body?.marksEach === undefined ? null : number(req.body.marksEach, 1, 0.01, 1000),
        req.body?.negativeMarksEach === '' || req.body?.negativeMarksEach === undefined ? null : number(req.body.negativeMarksEach, 0, 0, 1000),
        bool(req.body?.required, true) ? 1 : 0, req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'ADD_ASSESSMENT_BLUEPRINT_RULE', module: 'Assessment Intelligence', referenceId: ruleId, details: scoped.blueprint.blueprintId });
      return res.status(201).json({ ok: true, data: { ruleId } });
    } catch (error) {
      return respondError(res, error, 'blueprint rule create failed');
    }
  },
);

router.put(
  '/admin/blueprint-rules/:ruleId',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT r.rule_id AS ruleId, r.blueprint_id AS blueprintId, b.assessment_id AS assessmentId, b.status
           FROM assessment_blueprint_rule r
           INNER JOIN assessment_blueprint b ON b.blueprint_id = r.blueprint_id
          WHERE r.rule_id = ? LIMIT 1`,
        text(req.params.ruleId, 36),
      );
      const row = rows[0];
      if (!row || row.status !== 'DRAFT' || !await adminAssessment(req, row.assessmentId)) {
        return res.status(404).json({ ok: false, message: 'Editable blueprint rule not found in your scope.' });
      }
      const questionType = text(req.body?.questionType, 40).toUpperCase();
      const cognitiveLevel = text(req.body?.cognitiveLevel, 40).toUpperCase();
      if (questionType && !QUESTION_TYPES.has(questionType)) return res.status(400).json({ ok: false, message: 'Invalid question type.' });
      if (cognitiveLevel && !COGNITIVE_LEVELS.has(cognitiveLevel)) return res.status(400).json({ ok: false, message: 'Invalid cognitive level.' });
      await prisma.$executeRawUnsafe(
        `UPDATE assessment_blueprint_rule
            SET rule_order = ?, topic = ?, objective_code = ?, skill_id = ?, difficulty = ?,
                question_type = ?, cognitive_level = ?, language_code = ?, question_count = ?,
                marks_each = ?, negative_marks_each = ?, required = ?
          WHERE rule_id = ?`,
        Math.round(number(req.body?.ruleOrder, 1, 1, 500)), text(req.body?.topic, 160),
        text(req.body?.objectiveCode, 100), text(req.body?.skillId, 36) || null,
        text(req.body?.difficulty, 30), questionType, cognitiveLevel,
        text(req.body?.languageCode, 20), Math.round(number(req.body?.questionCount, 1, 1, 500)),
        req.body?.marksEach === '' || req.body?.marksEach === undefined ? null : number(req.body.marksEach, 1, 0.01, 1000),
        req.body?.negativeMarksEach === '' || req.body?.negativeMarksEach === undefined ? null : number(req.body.negativeMarksEach, 0, 0, 1000),
        bool(req.body?.required, true) ? 1 : 0, row.ruleId,
      );
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error, 'blueprint rule update failed');
    }
  },
);

router.delete(
  '/admin/blueprint-rules/:ruleId',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT r.rule_id AS ruleId, b.assessment_id AS assessmentId, b.status
           FROM assessment_blueprint_rule r
           INNER JOIN assessment_blueprint b ON b.blueprint_id = r.blueprint_id
          WHERE r.rule_id = ? LIMIT 1`,
        text(req.params.ruleId, 36),
      );
      const row = rows[0];
      if (!row || row.status !== 'DRAFT' || !await adminAssessment(req, row.assessmentId)) {
        return res.status(404).json({ ok: false, message: 'Editable blueprint rule not found in your scope.' });
      }
      await prisma.$executeRawUnsafe(`DELETE FROM assessment_blueprint_rule WHERE rule_id = ?`, row.ruleId);
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error, 'blueprint rule delete failed');
    }
  },
);

router.post(
  '/admin/blueprints/:blueprintId/submit-review',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const scoped = await scopedAdminBlueprint(req, text(req.params.blueprintId, 36), ['DRAFT']);
      if (!scoped) return res.status(404).json({ ok: false, message: 'Draft blueprint not found in your scope.' });
      const totals = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS ruleCount, COALESCE(SUM(question_count), 0) AS generatedQuestions
           FROM assessment_blueprint_rule WHERE blueprint_id = ?`,
        scoped.blueprint.blueprintId,
      );
      if (!number(totals[0]?.ruleCount, 0)) return res.status(409).json({ ok: false, message: 'Add at least one blueprint rule.' });
      if (number(totals[0]?.generatedQuestions, 0) !== number(scoped.blueprint.totalQuestions, 0)) {
        return res.status(409).json({ ok: false, message: 'Blueprint rule counts must equal total questions.' });
      }
      const supply = await blueprintSupplyPreview(scoped.assessment.assessmentId, scoped.blueprint.blueprintId);
      await prisma.$executeRawUnsafe(
        `UPDATE assessment_blueprint
            SET status = 'IN_REVIEW', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3)
          WHERE blueprint_id = ? AND status = 'DRAFT'`,
        req.userId, scoped.blueprint.blueprintId,
      );
      return res.json({ ok: true, data: { supply } });
    } catch (error) {
      return respondError(res, error, 'blueprint review submission failed');
    }
  },
);

router.post(
  '/admin/blueprints/:blueprintId/publish',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const scoped = await scopedAdminBlueprint(req, text(req.params.blueprintId, 36), ['IN_REVIEW']);
      if (!scoped) return res.status(404).json({ ok: false, message: 'Reviewed blueprint not found in your scope.' });
      const supply = await blueprintSupplyPreview(scoped.assessment.assessmentId, scoped.blueprint.blueprintId);
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(
          `UPDATE assessment_blueprint
              SET status = 'RETIRED', retired_by = ?, retired_at = CURRENT_TIMESTAMP(3)
            WHERE assessment_id = ? AND status = 'PUBLISHED' AND active = 1`,
          req.userId, scoped.assessment.assessmentId,
        );
        await tx.$executeRawUnsafe(
          `UPDATE assessment_blueprint
              SET status = 'PUBLISHED', published_by = ?, published_at = CURRENT_TIMESTAMP(3)
            WHERE blueprint_id = ? AND status = 'IN_REVIEW'`,
          req.userId, scoped.blueprint.blueprintId,
        );
      });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'PUBLISH_ASSESSMENT_BLUEPRINT', module: 'Assessment Intelligence', referenceId: scoped.blueprint.blueprintId, details: JSON.stringify(supply) });
      return res.json({ ok: true, data: { supply, blueprint: await blueprintRecord(scoped.blueprint.blueprintId) } });
    } catch (error) {
      return respondError(res, error, 'blueprint publish failed');
    }
  },
);

router.post(
  '/admin/blueprints/:blueprintId/retire',
  ...adminAuth,
  requirePermission('assessment.blueprint.manage'),
  async (req, res) => {
    try {
      const scoped = await scopedAdminBlueprint(req, text(req.params.blueprintId, 36), ['PUBLISHED', 'DRAFT', 'IN_REVIEW']);
      if (!scoped) return res.status(404).json({ ok: false, message: 'Blueprint not found in your scope.' });
      await prisma.$executeRawUnsafe(
        `UPDATE assessment_blueprint
            SET status = 'RETIRED', retired_by = ?, retired_at = CURRENT_TIMESTAMP(3)
          WHERE blueprint_id = ?`,
        req.userId, scoped.blueprint.blueprintId,
      );
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error, 'blueprint retire failed');
    }
  },
);

router.put(
  '/admin/questions/:questionId/metadata',
  ...adminAuth,
  requirePermission('assessment.question.review'),
  async (req, res) => {
    try {
      const scoped = await scopedAdminQuestion(req, text(req.params.questionId, 191));
      if (!scoped) return res.status(404).json({ ok: false, message: 'Question not found in your scope.' });
      const reviewStatus = text(req.body?.reviewStatus, 30).toUpperCase() || 'DRAFT';
      const questionType = text(req.body?.questionType, 40).toUpperCase() || 'SINGLE_CHOICE';
      const cognitiveLevel = text(req.body?.cognitiveLevel, 40).toUpperCase() || 'UNDERSTAND';
      if (!REVIEW_STATUSES.has(reviewStatus) || !QUESTION_TYPES.has(questionType) || !COGNITIVE_LEVELS.has(cognitiveLevel)) {
        return res.status(400).json({ ok: false, message: 'Invalid question governance values.' });
      }
      const reviewed = ['APPROVED', 'REJECTED', 'RETIRED'].includes(reviewStatus);
      await prisma.$executeRawUnsafe(
        `INSERT INTO assessment_question_metadata
           (question_id, topic, objective_code, skill_id, difficulty, question_type,
            cognitive_level, language_code, review_status, version_no, source_reference,
            max_exposure_count, reviewed_by, reviewed_at, review_notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           topic = VALUES(topic), objective_code = VALUES(objective_code), skill_id = VALUES(skill_id),
           difficulty = VALUES(difficulty), question_type = VALUES(question_type),
           cognitive_level = VALUES(cognitive_level), language_code = VALUES(language_code),
           review_status = VALUES(review_status), version_no = VALUES(version_no),
           source_reference = VALUES(source_reference), max_exposure_count = VALUES(max_exposure_count),
           reviewed_by = VALUES(reviewed_by), reviewed_at = VALUES(reviewed_at),
           review_notes = VALUES(review_notes), updated_at = CURRENT_TIMESTAMP(3)`,
        scoped.question.questionId, text(req.body?.topic, 160), text(req.body?.objectiveCode, 100),
        text(req.body?.skillId, 36) || null, text(req.body?.difficulty, 30), questionType,
        cognitiveLevel, text(req.body?.languageCode, 20) || 'en-IN', reviewStatus,
        Math.round(number(req.body?.versionNo, 1, 1, 100000)), text(req.body?.sourceReference, 500) || null,
        req.body?.maxExposureCount === '' || req.body?.maxExposureCount === undefined ? null : Math.round(number(req.body.maxExposureCount, 0, 1, 1000000)),
        reviewed ? req.userId : null, reviewed ? new Date() : null,
        text(req.body?.reviewNotes, 4000) || null, req.userId,
      );
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'REVIEW_ASSESSMENT_QUESTION', module: 'Assessment Intelligence', referenceId: scoped.question.questionId, details: reviewStatus });
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error, 'question metadata update failed');
    }
  },
);

router.post(
  '/admin/assessments/:assessmentId/recalculate-analytics',
  ...adminAuth,
  requirePermission('assessment.analytics.view'),
  async (req, res) => {
    try {
      const assessment = await adminAssessment(req, text(req.params.assessmentId, 191));
      if (!assessment) return res.status(404).json({ ok: false, message: 'Assessment not found in your scope.' });
      const analytics = await recalculateAssessmentAnalytics(assessment.assessmentId);
      return res.json({ ok: true, data: analytics });
    } catch (error) {
      return respondError(res, error, 'analytics recalculation failed');
    }
  },
);

router.put(
  '/admin/quality-alerts/:alertId',
  ...adminAuth,
  requirePermission('assessment.question.review'),
  async (req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT alert_id AS alertId, assessment_id AS assessmentId, status
           FROM assessment_quality_alert WHERE alert_id = ? LIMIT 1`,
        text(req.params.alertId, 36),
      );
      const alert = rows[0];
      if (!alert || !await adminAssessment(req, alert.assessmentId)) return res.status(404).json({ ok: false, message: 'Quality alert not found in your scope.' });
      const status = text(req.body?.status, 30).toUpperCase();
      if (!ALERT_STATUSES.has(status)) return res.status(400).json({ ok: false, message: 'Invalid alert status.' });
      const notes = text(req.body?.resolutionNotes, 4000);
      if (['RESOLVED', 'DISMISSED'].includes(status) && notes.length < 20) {
        return res.status(400).json({ ok: false, message: 'Detailed resolution notes are required.' });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE assessment_quality_alert
            SET status = ?, owner_id = ?, resolution_notes = ?,
                resolved_by = ?, resolved_at = ?
          WHERE alert_id = ?`,
        status, text(req.body?.ownerId, 120) || req.userId, notes || null,
        ['RESOLVED', 'DISMISSED'].includes(status) ? req.userId : null,
        ['RESOLVED', 'DISMISSED'].includes(status) ? new Date() : null,
        alert.alertId,
      );
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error, 'quality alert update failed');
    }
  },
);

router.get(
  '/admin/accommodations',
  ...adminAuth,
  requirePermission('assessment.accommodation.manage'),
  async (req, res) => {
    try {
      const query = text(req.query?.q, 120);
      const params = [];
      const clauses = [];
      if (scopeFor(req) !== 'company' && req.userBranch) {
        clauses.push('t.branch = ?');
        params.push(req.userBranch);
      }
      if (query) {
        clauses.push('(a.employee_id LIKE ? OR t.trainee_name LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await prisma.$queryRawUnsafe(
        `SELECT a.accommodation_id AS accommodationId, a.employee_id AS employeeId,
                t.trainee_name AS traineeName, t.batch_no AS batchNo, t.branch, t.process, t.lob,
                a.accommodation_type AS accommodationType, a.time_multiplier AS timeMultiplier,
                a.extra_break_minutes AS extraBreakMinutes,
                a.display_preferences_json AS displayPreferences, a.language_code AS languageCode,
                a.effective_from AS effectiveFrom, a.effective_to AS effectiveTo,
                a.status, a.reason, a.approved_by AS approvedBy, a.approved_at AS approvedAt,
                a.revoked_by AS revokedBy, a.revoked_at AS revokedAt,
                a.revocation_reason AS revocationReason
           FROM assessment_accommodation a
           LEFT JOIN trainee_master t ON t.employee_id = a.employee_id
           ${where}
          ORDER BY a.created_at DESC LIMIT 500`,
        ...params,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      return respondError(res, error, 'accommodation list failed');
    }
  },
);

router.post(
  '/admin/accommodations',
  ...adminAuth,
  requirePermission('assessment.accommodation.manage'),
  async (req, res) => {
    try {
      const employeeId = text(req.body?.employeeId, 191);
      const trainee = await scopedEmployee(req, employeeId);
      if (!trainee) return res.status(404).json({ ok: false, message: 'Employee not found in your scope.' });
      const reason = text(req.body?.reason, 4000);
      if (reason.length < 20) return res.status(400).json({ ok: false, message: 'A detailed accommodation reason is required.' });
      const timeMultiplier = number(req.body?.timeMultiplier, 1, 1, 3);
      const extraBreakMinutes = Math.round(number(req.body?.extraBreakMinutes, 0, 0, 120));
      const effectiveFrom = dateOrNull(req.body?.effectiveFrom) || new Date();
      const effectiveTo = dateOrNull(req.body?.effectiveTo);
      if (effectiveTo && effectiveTo <= effectiveFrom) return res.status(400).json({ ok: false, message: 'Effective-to must be after effective-from.' });
      const accommodationId = randomUUID();
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(
          `UPDATE assessment_accommodation
              SET status = 'REVOKED', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP(3),
                  revocation_reason = 'Superseded by a newly approved accommodation.'
            WHERE employee_id = ? AND status = 'APPROVED'`,
          req.userId, employeeId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO assessment_accommodation
             (accommodation_id, employee_id, accommodation_type, time_multiplier,
              extra_break_minutes, display_preferences_json, language_code,
              effective_from, effective_to, status, reason, approved_by)
           VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, 'APPROVED', ?, ?)`,
          accommodationId, employeeId, text(req.body?.accommodationType, 40) || 'TIME_EXTENSION',
          timeMultiplier, extraBreakMinutes, jsonOrNull(req.body?.displayPreferences) || '{}',
          text(req.body?.languageCode, 20) || null, effectiveFrom, effectiveTo, reason, req.userId,
        );
      });
      await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'APPROVE_ASSESSMENT_ACCOMMODATION', module: 'Assessment Intelligence', referenceId: accommodationId, details: employeeId });
      return res.status(201).json({ ok: true, data: { accommodationId } });
    } catch (error) {
      return respondError(res, error, 'accommodation create failed');
    }
  },
);

router.post(
  '/admin/accommodations/:accommodationId/revoke',
  ...adminAuth,
  requirePermission('assessment.accommodation.manage'),
  async (req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT accommodation_id AS accommodationId, employee_id AS employeeId, status
           FROM assessment_accommodation WHERE accommodation_id = ? LIMIT 1`,
        text(req.params.accommodationId, 36),
      );
      const accommodation = rows[0];
      if (!accommodation || !await scopedEmployee(req, accommodation.employeeId)) return res.status(404).json({ ok: false, message: 'Accommodation not found in your scope.' });
      const reason = text(req.body?.reason, 4000);
      if (reason.length < 20) return res.status(400).json({ ok: false, message: 'A detailed revocation reason is required.' });
      await prisma.$executeRawUnsafe(
        `UPDATE assessment_accommodation
            SET status = 'REVOKED', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP(3), revocation_reason = ?
          WHERE accommodation_id = ? AND status = 'APPROVED'`,
        req.userId, reason, accommodation.accommodationId,
      );
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error, 'accommodation revoke failed');
    }
  },
);

router.get(
  '/coordinator/analytics',
  ...coordinatorAuth,
  requirePermission('assessment.analytics.view'),
  async (req, res) => {
    try {
      const assessmentId = text(req.query?.assessmentId, 191);
      if (assessmentId && !await coordinatorAssessment(req, assessmentId)) {
        return res.status(404).json({ ok: false, message: 'Assessment not found in your owned batches.' });
      }
      const params = [req.userId];
      let assessmentClause = '';
      if (assessmentId) {
        assessmentClause = 'AND a.assessment_id = ?';
        params.push(assessmentId);
      }
      const rows = await prisma.$queryRawUnsafe(
        `SELECT a.assessment_id AS assessmentId, a.assessment_name AS assessmentName,
                c.classroom_name AS classroomName, c.branch, c.process, c.lob,
                COUNT(DISTINCT at.attempt_id) AS submittedAttempts,
                ROUND(AVG(at.percentage), 2) AS averagePercentage,
                SUM(CASE WHEN at.result = 'Pass' THEN 1 ELSE 0 END) AS passedAttempts,
                COUNT(DISTINCT ia.question_id) AS analysedItems,
                SUM(CASE WHEN ia.quality_status NOT IN ('HEALTHY','INSUFFICIENT_DATA') THEN 1 ELSE 0 END) AS qualityIssues,
                SUM(CASE WHEN qa.status IN ('OPEN','REVIEWING') THEN 1 ELSE 0 END) AS openAlerts
           FROM batch_master b
           INNER JOIN assessment_master a ON a.classroom_id = b.classroom_id
           INNER JOIN classroom_master c ON c.classroom_id = a.classroom_id
           LEFT JOIN assessment_attempts at ON at.assessment_id = a.assessment_id AND at.submitted_at IS NOT NULL
           LEFT JOIN assessment_item_analytics ia ON ia.assessment_id = a.assessment_id
           LEFT JOIN assessment_quality_alert qa ON qa.assessment_id = a.assessment_id
          WHERE b.coordinator_login_id = ? AND b.batch_status = 'Active' ${assessmentClause}
          GROUP BY a.assessment_id, a.assessment_name, c.classroom_name, c.branch, c.process, c.lob
          ORDER BY c.classroom_name, a.assessment_name`,
        ...params,
      );
      return res.json({ ok: true, data: rows });
    } catch (error) {
      return respondError(res, error, 'coordinator analytics failed');
    }
  },
);

export default router;
