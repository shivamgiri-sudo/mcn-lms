import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { syncEmployeeSkills, syncLearningPaths } from './talentGovernance.js';

function fail(status, message, code = 'PRACTICAL_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalize(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

export { normalize };

async function addEvent(db, assignmentId, eventType, fromStatus, toStatus, actorId, actorType, details = null) {
  await db.$executeRawUnsafe(
    `INSERT INTO practical_assessment_event
       (event_id, assignment_id, event_type, from_status, to_status,
        actor_id, actor_type, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), String(assignmentId), String(eventType), fromStatus || null, toStatus || null,
    actorId ? String(actorId) : null, actorType ? String(actorType) : null,
    details ? JSON.stringify(details) : null,
  );
}

export async function getTemplateDetail(templateId, db = prisma) {
  const templates = await db.$queryRawUnsafe(
    `SELECT template_id AS templateId, template_code AS templateCode,
            template_name AS templateName, version_no AS versionNo,
            supersedes_template_id AS supersedesTemplateId,
            description, learner_instructions AS learnerInstructions,
            evaluator_instructions AS evaluatorInstructions,
            audience_branch AS audienceBranch, audience_process AS audienceProcess,
            audience_lob AS audienceLob, classroom_id AS classroomId,
            module_id AS moduleId, ilt_session_id AS iltSessionId,
            passing_pct AS passingPct, max_attempts AS maxAttempts,
            evaluator_count AS evaluatorCount, blind_evaluation AS blindEvaluation,
            moderation_threshold_pct AS moderationThresholdPct,
            status, active, created_by AS createdBy, published_by AS publishedBy,
            published_at AS publishedAt, retired_at AS retiredAt,
            created_at AS createdAt, updated_at AS updatedAt
       FROM practical_assessment_template WHERE template_id = ? LIMIT 1`,
    String(templateId),
  );
  const template = normalize(templates[0] || null);
  if (!template) return null;

  const sections = normalize(await db.$queryRawUnsafe(
    `SELECT section_id AS sectionId, template_id AS templateId,
            section_code AS sectionCode, section_title AS sectionTitle,
            description, sort_order AS sortOrder, weight_pct AS weightPct
       FROM practical_rubric_section
      WHERE template_id = ? ORDER BY sort_order, section_title`,
    String(templateId),
  ));
  const sectionIds = sections.map(item => item.sectionId);
  let criteria = [];
  if (sectionIds.length) {
    const placeholders = sectionIds.map(() => '?').join(',');
    criteria = normalize(await db.$queryRawUnsafe(
      `SELECT c.criterion_id AS criterionId, c.section_id AS sectionId,
              c.criterion_code AS criterionCode, c.criterion_title AS criterionTitle,
              c.description, c.observable_behavior AS observableBehavior,
              c.sort_order AS sortOrder, c.max_score AS maxScore,
              c.weight_pct AS weightPct, c.critical, c.critical_min_score AS criticalMinScore,
              c.evidence_required AS evidenceRequired, c.skill_id AS skillId,
              c.skill_level_awarded AS skillLevelAwarded, c.rating_scale_json AS ratingScaleJson,
              s.skill_code AS skillCode, s.skill_name AS skillName
         FROM practical_rubric_criterion c
         LEFT JOIN skill_master s ON s.skill_id = c.skill_id
        WHERE c.section_id IN (${placeholders})
        ORDER BY c.section_id, c.sort_order, c.criterion_title`,
      ...sectionIds,
    ));
  }
  return {
    ...template,
    sections: sections.map(section => ({
      ...section,
      criteria: criteria.filter(item => item.sectionId === section.sectionId),
    })),
  };
}

function validateRubric(template) {
  if (!template.sections.length) fail(409, 'Add at least one rubric section before publishing.', 'RUBRIC_EMPTY');
  const sectionWeight = template.sections.reduce((sum, section) => sum + numeric(section.weightPct), 0);
  if (Math.abs(sectionWeight - 100) > 0.01) {
    fail(409, 'Rubric section weights must total exactly 100%.', 'SECTION_WEIGHT_TOTAL', { actual: sectionWeight });
  }
  let criterionCount = 0;
  for (const section of template.sections) {
    if (!section.criteria.length) fail(409, `Section “${section.sectionTitle}” has no criteria.`, 'SECTION_CRITERIA_EMPTY');
    criterionCount += section.criteria.length;
    const criterionWeight = section.criteria.reduce((sum, item) => sum + numeric(item.weightPct), 0);
    if (Math.abs(criterionWeight - 100) > 0.01) {
      fail(409, `Criterion weights in “${section.sectionTitle}” must total exactly 100%.`, 'CRITERION_WEIGHT_TOTAL', {
        sectionId: section.sectionId,
        actual: criterionWeight,
      });
    }
    for (const criterion of section.criteria) {
      if (criterion.critical && criterion.criticalMinScore == null) {
        fail(409, `Critical criterion “${criterion.criterionTitle}” requires a minimum score.`, 'CRITICAL_MIN_REQUIRED');
      }
      if (criterion.skillId && !criterion.skillLevelAwarded) {
        fail(409, `Skill-linked criterion “${criterion.criterionTitle}” requires a level award.`, 'SKILL_LEVEL_REQUIRED');
      }
    }
  }
  return { sectionWeight, criterionCount };
}

export async function publishTemplate(templateId, actorId) {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRawUnsafe(
      `SELECT template_id AS templateId, status
         FROM practical_assessment_template WHERE template_id = ? LIMIT 1 FOR UPDATE`,
      String(templateId),
    );
    if (!locked.length) fail(404, 'Practical assessment template not found.', 'TEMPLATE_NOT_FOUND');
    if (locked[0].status === 'PUBLISHED') return getTemplateDetail(templateId, tx);
    if (locked[0].status !== 'DRAFT') fail(409, 'Only draft templates can be published.', 'TEMPLATE_NOT_DRAFT');
    const template = await getTemplateDetail(templateId, tx);
    validateRubric(template);
    await tx.$executeRawUnsafe(
      `UPDATE practical_assessment_template
          SET status = 'PUBLISHED', published_by = ?, published_at = UTC_TIMESTAMP(3)
        WHERE template_id = ?`,
      String(actorId), String(templateId),
    );
    return getTemplateDetail(templateId, tx);
  });
}

export async function createTemplateVersion(templateId, actorId) {
  return prisma.$transaction(async tx => {
    const source = await getTemplateDetail(templateId, tx);
    if (!source) fail(404, 'Practical assessment template not found.', 'TEMPLATE_NOT_FOUND');
    if (source.status !== 'PUBLISHED') fail(409, 'Only published templates can be versioned.', 'VERSION_SOURCE_NOT_PUBLISHED');
    const existing = await tx.$queryRawUnsafe(
      `SELECT COALESCE(MAX(version_no),0) AS maxVersion
         FROM practical_assessment_template WHERE template_code = ? FOR UPDATE`,
      String(source.templateCode),
    );
    const nextVersion = numeric(existing[0]?.maxVersion) + 1;
    const nextId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO practical_assessment_template
         (template_id, template_code, template_name, version_no, supersedes_template_id,
          description, learner_instructions, evaluator_instructions,
          audience_branch, audience_process, audience_lob, classroom_id, module_id,
          ilt_session_id, passing_pct, max_attempts, evaluator_count,
          blind_evaluation, moderation_threshold_pct, status, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?)`,
      nextId, source.templateCode, source.templateName, nextVersion, source.templateId,
      source.description || null, source.learnerInstructions || null, source.evaluatorInstructions || null,
      source.audienceBranch || '', source.audienceProcess || '', source.audienceLob || '',
      source.classroomId || null, source.moduleId || null, source.iltSessionId || null,
      numeric(source.passingPct, 70), numeric(source.maxAttempts, 2), numeric(source.evaluatorCount, 1),
      source.blindEvaluation ? 1 : 0, numeric(source.moderationThresholdPct, 15), String(actorId),
    );
    for (const section of source.sections) {
      const sectionId = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO practical_rubric_section
           (section_id, template_id, section_code, section_title, description, sort_order, weight_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        sectionId, nextId, section.sectionCode, section.sectionTitle, section.description || null,
        numeric(section.sortOrder, 1), numeric(section.weightPct),
      );
      for (const criterion of section.criteria) {
        await tx.$executeRawUnsafe(
          `INSERT INTO practical_rubric_criterion
             (criterion_id, section_id, criterion_code, criterion_title, description,
              observable_behavior, sort_order, max_score, weight_pct, critical,
              critical_min_score, evidence_required, skill_id, skill_level_awarded, rating_scale_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(), sectionId, criterion.criterionCode, criterion.criterionTitle,
          criterion.description || null, criterion.observableBehavior || null,
          numeric(criterion.sortOrder, 1), numeric(criterion.maxScore, 5), numeric(criterion.weightPct),
          criterion.critical ? 1 : 0, criterion.criticalMinScore == null ? null : numeric(criterion.criticalMinScore),
          criterion.evidenceRequired ? 1 : 0, criterion.skillId || null,
          criterion.skillLevelAwarded == null ? null : numeric(criterion.skillLevelAwarded),
          criterion.ratingScaleJson ? JSON.stringify(criterion.ratingScaleJson) : null,
        );
      }
    }
    return getTemplateDetail(nextId, tx);
  });
}

export async function getAssignmentDetail(assignmentId, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.template_id AS templateId,
            a.employee_id AS employeeId, a.batch_no AS batchNo, a.branch,
            a.process_name AS processName, a.lob_name AS lobName,
            a.classroom_id AS classroomId, a.module_id AS moduleId,
            a.ilt_session_id AS iltSessionId, a.attempt_no AS attemptNo,
            a.status, a.assigned_by AS assignedBy, a.assigned_at AS assignedAt,
            a.due_at AS dueAt, a.started_at AS startedAt, a.submitted_at AS submittedAt,
            a.final_score AS finalScore, a.final_percentage AS finalPercentage,
            a.final_result AS finalResult, a.critical_fail AS criticalFail,
            a.finalized_by AS finalizedBy, a.finalized_at AS finalizedAt,
            t.trainee_name AS traineeName, t.email, t.mobile,
            p.template_code AS templateCode, p.template_name AS templateName,
            p.version_no AS versionNo, p.passing_pct AS passingPct,
            p.evaluator_count AS evaluatorCount, p.blind_evaluation AS blindEvaluation,
            p.moderation_threshold_pct AS moderationThresholdPct,
            p.learner_instructions AS learnerInstructions,
            p.evaluator_instructions AS evaluatorInstructions
       FROM practical_assessment_assignment a
       INNER JOIN practical_assessment_template p ON p.template_id = a.template_id
       LEFT JOIN trainee_master t ON t.employee_id = a.employee_id
      WHERE a.assignment_id = ? LIMIT 1`,
    String(assignmentId),
  );
  const assignment = normalize(rows[0] || null);
  if (!assignment) return null;
  const [template, submissions, evidence, evaluations, scores, moderation, events] = await Promise.all([
    getTemplateDetail(assignment.templateId, db),
    db.$queryRawUnsafe(
      `SELECT submission_id AS submissionId, assignment_id AS assignmentId, status,
              learner_statement AS learnerStatement, submitted_by AS submittedBy,
              submitted_at AS submittedAt, withdrawn_at AS withdrawnAt,
              withdrawal_reason AS withdrawalReason, created_at AS createdAt
         FROM practical_assessment_submission WHERE assignment_id = ? ORDER BY created_at DESC`,
      String(assignmentId),
    ),
    db.$queryRawUnsafe(
      `SELECT e.evidence_id AS evidenceId, e.submission_id AS submissionId,
              e.evidence_type AS evidenceType, e.evidence_title AS evidenceTitle,
              e.reference_id AS referenceId, e.reference_url AS referenceUrl,
              e.notes, e.submitted_by AS submittedBy, e.created_at AS createdAt
         FROM practical_submission_evidence e
         INNER JOIN practical_assessment_submission s ON s.submission_id = e.submission_id
        WHERE s.assignment_id = ? ORDER BY e.created_at`,
      String(assignmentId),
    ),
    db.$queryRawUnsafe(
      `SELECT evaluation_id AS evaluationId, assignment_id AS assignmentId,
              submission_id AS submissionId, evaluator_id AS evaluatorId,
              evaluator_type AS evaluatorType, evaluator_slot AS evaluatorSlot,
              status, total_score AS totalScore, percentage, result, critical_fail AS criticalFail,
              summary, strengths, development_notes AS developmentNotes,
              submitted_at AS submittedAt, locked_at AS lockedAt
         FROM practical_evaluation WHERE assignment_id = ? ORDER BY evaluator_slot`,
      String(assignmentId),
    ),
    db.$queryRawUnsafe(
      `SELECT s.score_id AS scoreId, s.evaluation_id AS evaluationId,
              s.criterion_id AS criterionId, s.raw_score AS rawScore,
              s.weighted_score AS weightedScore, s.rating_label AS ratingLabel,
              s.observation_notes AS observationNotes, s.evidence_reference AS evidenceReference,
              s.critical_fail AS criticalFail
         FROM practical_criterion_score s
         INNER JOIN practical_evaluation e ON e.evaluation_id = s.evaluation_id
        WHERE e.assignment_id = ?`,
      String(assignmentId),
    ),
    db.$queryRawUnsafe(
      `SELECT case_id AS caseId, assignment_id AS assignmentId, reason_code AS reasonCode,
              status, score_variance_pct AS scoreVariancePct,
              critical_disagreement AS criticalDisagreement, opened_by AS openedBy,
              opened_at AS openedAt, moderator_id AS moderatorId,
              resolution_summary AS resolutionSummary, final_percentage AS finalPercentage,
              final_result AS finalResult, resolved_at AS resolvedAt,
              waived_by AS waivedBy, waived_at AS waivedAt, waiver_reason AS waiverReason
         FROM practical_moderation_case WHERE assignment_id = ? LIMIT 1`,
      String(assignmentId),
    ),
    db.$queryRawUnsafe(
      `SELECT event_id AS eventId, event_type AS eventType, from_status AS fromStatus,
              to_status AS toStatus, actor_id AS actorId, actor_type AS actorType,
              details_json AS detailsJson, created_at AS createdAt
         FROM practical_assessment_event WHERE assignment_id = ? ORDER BY created_at`,
      String(assignmentId),
    ),
  ]);
  const normalizedEvaluations = normalize(evaluations).map(item => ({
    ...item,
    scores: normalize(scores).filter(score => score.evaluationId === item.evaluationId),
  }));
  return {
    ...assignment,
    template,
    submission: normalize(submissions[0] || null),
    evidence: normalize(evidence),
    evaluations: normalizedEvaluations,
    moderation: normalize(moderation[0] || null),
    events: normalize(events),
  };
}

export async function createAssignment({ templateId, employeeId, dueAt, actorId, actorType, source = {} }) {
  return prisma.$transaction(async tx => {
    const templateRows = await tx.$queryRawUnsafe(
      `SELECT template_id AS templateId, max_attempts AS maxAttempts, status,
              audience_branch AS audienceBranch, audience_process AS audienceProcess,
              audience_lob AS audienceLob, classroom_id AS classroomId,
              module_id AS moduleId, ilt_session_id AS iltSessionId
         FROM practical_assessment_template WHERE template_id = ? LIMIT 1 FOR UPDATE`,
      String(templateId),
    );
    const template = normalize(templateRows[0] || null);
    if (!template || template.status !== 'PUBLISHED') fail(409, 'Select a published practical assessment template.', 'TEMPLATE_NOT_PUBLISHED');
    const trainee = await tx.traineeMaster.findUnique({ where: { employeeId: String(employeeId) } });
    if (!trainee || trainee.status !== 'Active') fail(404, 'Active learner not found.', 'LEARNER_NOT_FOUND');
    if (template.audienceBranch && template.audienceBranch !== String(trainee.branch || '')) fail(409, 'Learner is outside the template branch audience.', 'AUDIENCE_BRANCH_MISMATCH');
    if (template.audienceProcess && template.audienceProcess !== String(trainee.process || '')) fail(409, 'Learner is outside the template process audience.', 'AUDIENCE_PROCESS_MISMATCH');
    if (template.audienceLob && template.audienceLob !== String(trainee.lob || '')) fail(409, 'Learner is outside the template LOB audience.', 'AUDIENCE_LOB_MISMATCH');
    const attempts = await tx.$queryRawUnsafe(
      `SELECT COALESCE(MAX(attempt_no),0) AS lastAttempt
         FROM practical_assessment_assignment
        WHERE template_id = ? AND employee_id = ? FOR UPDATE`,
      String(templateId), String(employeeId),
    );
    const attemptNo = numeric(attempts[0]?.lastAttempt) + 1;
    if (attemptNo > numeric(template.maxAttempts, 1)) fail(409, 'Maximum practical assessment attempts have been reached.', 'ATTEMPT_LIMIT_REACHED');
    const assignmentId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO practical_assessment_assignment
         (assignment_id, template_id, employee_id, batch_no, branch, process_name,
          lob_name, classroom_id, module_id, ilt_session_id, attempt_no,
          status, assigned_by, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ASSIGNED', ?, ?)`,
      assignmentId, String(templateId), String(employeeId), trainee.batchNo || source.batchNo || null,
      trainee.branch || source.branch || null, trainee.process || source.processName || null,
      trainee.lob || source.lobName || null, source.classroomId || template.classroomId || trainee.classroomId || null,
      source.moduleId || template.moduleId || null, source.iltSessionId || template.iltSessionId || null,
      attemptNo, String(actorId), dueAt || null,
    );
    await addEvent(tx, assignmentId, 'ASSIGNED', null, 'ASSIGNED', actorId, actorType, { attemptNo });
    return getAssignmentDetail(assignmentId, tx);
  });
}

export async function saveSubmission({ assignmentId, employeeId, learnerStatement, evidence = [], submit = false }) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT assignment_id AS assignmentId, employee_id AS employeeId, status
         FROM practical_assessment_assignment WHERE assignment_id = ? LIMIT 1 FOR UPDATE`,
      String(assignmentId),
    );
    const assignment = normalize(rows[0] || null);
    if (!assignment || assignment.employeeId !== String(employeeId)) fail(404, 'Practical assessment assignment not found.', 'ASSIGNMENT_NOT_FOUND');
    if (!['ASSIGNED', 'IN_PROGRESS'].includes(assignment.status)) fail(409, 'This assignment no longer accepts learner submissions.', 'SUBMISSION_CLOSED');
    const statement = clean(learnerStatement, 20000);
    const validEvidence = Array.isArray(evidence) ? evidence.slice(0, 50).filter(item => clean(item?.evidenceTitle, 220)) : [];
    if (submit && statement.length < 20 && !validEvidence.length) {
      fail(400, 'Provide a learner statement of at least 20 characters or attach evidence references.', 'SUBMISSION_EVIDENCE_REQUIRED');
    }
    const existing = await tx.$queryRawUnsafe(
      `SELECT submission_id AS submissionId FROM practical_assessment_submission
        WHERE assignment_id = ? LIMIT 1 FOR UPDATE`,
      String(assignmentId),
    );
    const submissionId = existing[0]?.submissionId || randomUUID();
    if (existing.length) {
      await tx.$executeRawUnsafe(
        `UPDATE practical_assessment_submission
            SET learner_statement = ?, status = ?, submitted_at = ?
          WHERE submission_id = ?`,
        statement || null, submit ? 'SUBMITTED' : 'DRAFT', submit ? new Date() : null, submissionId,
      );
      await tx.$executeRawUnsafe(`DELETE FROM practical_submission_evidence WHERE submission_id = ?`, submissionId);
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO practical_assessment_submission
           (submission_id, assignment_id, status, learner_statement, submitted_by, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        submissionId, String(assignmentId), submit ? 'SUBMITTED' : 'DRAFT',
        statement || null, String(employeeId), submit ? new Date() : null,
      );
    }
    for (const item of validEvidence) {
      const type = ['FILE_REFERENCE','URL','OBSERVATION','NOTE','RECORDING_REFERENCE'].includes(clean(item.evidenceType, 30).toUpperCase())
        ? clean(item.evidenceType, 30).toUpperCase() : 'NOTE';
      const referenceId = clean(item.referenceId, 240) || null;
      const referenceUrl = clean(item.referenceUrl, 4000) || null;
      const notes = clean(item.notes, 20000) || null;
      if (!referenceId && !referenceUrl && !notes) continue;
      await tx.$executeRawUnsafe(
        `INSERT INTO practical_submission_evidence
           (evidence_id, submission_id, evidence_type, evidence_title,
            reference_id, reference_url, notes, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), submissionId, type, clean(item.evidenceTitle, 220),
        referenceId, referenceUrl, notes, String(employeeId),
      );
    }
    const nextStatus = submit ? 'SUBMITTED' : 'IN_PROGRESS';
    await tx.$executeRawUnsafe(
      `UPDATE practical_assessment_assignment
          SET status = ?, started_at = COALESCE(started_at, UTC_TIMESTAMP(3)),
              submitted_at = ?
        WHERE assignment_id = ?`,
      nextStatus, submit ? new Date() : null, String(assignmentId),
    );
    await addEvent(tx, assignmentId, submit ? 'SUBMISSION_SUBMITTED' : 'SUBMISSION_SAVED', assignment.status, nextStatus, employeeId, 'trainee', {
      evidenceCount: validEvidence.length,
    });
    return getAssignmentDetail(assignmentId, tx);
  });
}

export async function claimEvaluation({ assignmentId, evaluatorId, evaluatorType }) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT a.assignment_id AS assignmentId, a.employee_id AS employeeId,
              a.status, p.evaluator_count AS evaluatorCount,
              s.submission_id AS submissionId, s.status AS submissionStatus
         FROM practical_assessment_assignment a
         INNER JOIN practical_assessment_template p ON p.template_id = a.template_id
         LEFT JOIN practical_assessment_submission s ON s.assignment_id = a.assignment_id
        WHERE a.assignment_id = ? LIMIT 1 FOR UPDATE`,
      String(assignmentId),
    );
    const assignment = normalize(rows[0] || null);
    if (!assignment) fail(404, 'Practical assessment assignment not found.', 'ASSIGNMENT_NOT_FOUND');
    if (assignment.employeeId === String(evaluatorId)) fail(403, 'Learners cannot evaluate their own practical assessment.', 'SELF_EVALUATION_BLOCKED');
    if (!assignment.submissionId || assignment.submissionStatus !== 'SUBMITTED') fail(409, 'The learner submission is not ready for evaluation.', 'SUBMISSION_NOT_READY');
    if (!['SUBMITTED', 'EVALUATING'].includes(assignment.status)) fail(409, 'This assignment is not open for evaluation.', 'EVALUATION_CLOSED');
    const existing = await tx.$queryRawUnsafe(
      `SELECT evaluation_id AS evaluationId FROM practical_evaluation
        WHERE assignment_id = ? AND evaluator_id = ? AND evaluator_type = ? LIMIT 1 FOR UPDATE`,
      String(assignmentId), String(evaluatorId), String(evaluatorType),
    );
    if (existing.length) return getAssignmentDetail(assignmentId, tx);
    const slots = await tx.$queryRawUnsafe(
      `SELECT evaluator_slot AS evaluatorSlot FROM practical_evaluation
        WHERE assignment_id = ? ORDER BY evaluator_slot FOR UPDATE`,
      String(assignmentId),
    );
    const used = new Set(slots.map(item => numeric(item.evaluatorSlot)));
    let slot = 1;
    while (used.has(slot)) slot += 1;
    if (slot > numeric(assignment.evaluatorCount, 1)) fail(409, 'All evaluator slots are already assigned.', 'EVALUATOR_SLOTS_FULL');
    await tx.$executeRawUnsafe(
      `INSERT INTO practical_evaluation
         (evaluation_id, assignment_id, submission_id, evaluator_id, evaluator_type, evaluator_slot)
       VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(), String(assignmentId), assignment.submissionId,
      String(evaluatorId), String(evaluatorType), slot,
    );
    await tx.$executeRawUnsafe(
      `UPDATE practical_assessment_assignment SET status = 'EVALUATING' WHERE assignment_id = ?`,
      String(assignmentId),
    );
    await addEvent(tx, assignmentId, 'EVALUATION_CLAIMED', assignment.status, 'EVALUATING', evaluatorId, evaluatorType, { evaluatorSlot: slot });
    return getAssignmentDetail(assignmentId, tx);
  });
}

function calculateEvaluation(template, scoreInput, submit) {
  const scoreMap = new Map((Array.isArray(scoreInput) ? scoreInput : []).map(item => [String(item.criterionId), item]));
  const calculated = [];
  let totalScore = 0;
  let overallPercentage = 0;
  let criticalFail = false;
  for (const section of template.sections) {
    let sectionPercentage = 0;
    for (const criterion of section.criteria) {
      const input = scoreMap.get(String(criterion.criterionId));
      if (!input && submit) fail(400, `Score every criterion before submitting. Missing: ${criterion.criterionTitle}`, 'CRITERION_SCORE_MISSING');
      if (!input) continue;
      const rawScore = Number(input.rawScore);
      if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > numeric(criterion.maxScore)) {
        fail(400, `Score for “${criterion.criterionTitle}” must be between 0 and ${criterion.maxScore}.`, 'CRITERION_SCORE_RANGE');
      }
      const evidenceReference = clean(input.evidenceReference, 500) || null;
      if (submit && criterion.evidenceRequired && !evidenceReference) {
        fail(400, `Evidence is required for “${criterion.criterionTitle}”.`, 'CRITERION_EVIDENCE_REQUIRED');
      }
      const criterionPct = numeric(criterion.maxScore) > 0 ? (rawScore / numeric(criterion.maxScore)) * 100 : 0;
      const criterionContribution = criterionPct * (numeric(criterion.weightPct) / 100);
      sectionPercentage += criterionContribution;
      totalScore += rawScore;
      const criterionCriticalFail = Boolean(criterion.critical)
        && criterion.criticalMinScore != null
        && rawScore < numeric(criterion.criticalMinScore);
      criticalFail = criticalFail || criterionCriticalFail;
      calculated.push({
        criterionId: criterion.criterionId,
        rawScore,
        weightedScore: criterionContribution,
        ratingLabel: clean(input.ratingLabel, 120) || null,
        observationNotes: clean(input.observationNotes, 20000) || null,
        evidenceReference,
        criticalFail: criterionCriticalFail,
      });
    }
    overallPercentage += sectionPercentage * (numeric(section.weightPct) / 100);
  }
  const percentage = Math.round(overallPercentage * 100) / 100;
  const result = !criticalFail && percentage >= numeric(template.passingPct, 70) ? 'PASS' : 'FAIL';
  return { scores: calculated, totalScore, percentage, result, criticalFail };
}

async function writeSkillEvidence(db, assignmentId, employeeId, actorId) {
  const rows = normalize(await db.$queryRawUnsafe(
    `SELECT c.skill_id AS skillId,
            MAX(c.skill_level_awarded) AS configuredLevel,
            SUM((s.raw_score / c.max_score) * c.weight_pct) / NULLIF(SUM(c.weight_pct),0) * 100 AS scorePct
       FROM practical_evaluation e
       INNER JOIN practical_criterion_score s ON s.evaluation_id = e.evaluation_id
       INNER JOIN practical_rubric_criterion c ON c.criterion_id = s.criterion_id
      WHERE e.assignment_id = ? AND e.status = 'SUBMITTED' AND c.skill_id IS NOT NULL
      GROUP BY c.skill_id`,
    String(assignmentId),
  ));
  for (const row of rows) {
    const scorePct = Math.max(0, Math.min(100, numeric(row.scorePct)));
    const levelAwarded = Math.max(0, Math.min(10, numeric(row.configuredLevel) * scorePct / 100));
    await db.$executeRawUnsafe(
      `INSERT INTO skill_evidence
         (id, employee_id, skill_id, evidence_type, reference_id,
          score_pct, level_awarded, evidence_status, notes, recorded_by)
       VALUES (?, ?, ?, 'PRACTICAL_ASSESSMENT', ?, ?, ?, 'VALID', ?, ?)
       ON DUPLICATE KEY UPDATE
         score_pct = VALUES(score_pct), level_awarded = VALUES(level_awarded),
         evidence_status = 'VALID', notes = VALUES(notes), recorded_by = VALUES(recorded_by),
         evidence_at = UTC_TIMESTAMP(3)`,
      randomUUID(), String(employeeId), String(row.skillId), String(assignmentId),
      scorePct, levelAwarded, 'Finalized practical assessment rubric evidence.', String(actorId),
    );
  }
}

async function finalizeAssignment(db, assignment, percentage, result, criticalFail, actorId, actorType, eventType = 'ASSESSMENT_FINALIZED') {
  const status = result === 'PASS' ? 'PASSED' : 'FAILED';
  await db.$executeRawUnsafe(
    `UPDATE practical_assessment_assignment
        SET status = ?, final_score = ?, final_percentage = ?, final_result = ?,
            critical_fail = ?, finalized_by = ?, finalized_at = UTC_TIMESTAMP(3)
      WHERE assignment_id = ?`,
    status, percentage, percentage, result, criticalFail ? 1 : 0,
    String(actorId), String(assignment.assignmentId),
  );
  await writeSkillEvidence(db, assignment.assignmentId, assignment.employeeId, actorId);
  await addEvent(db, assignment.assignmentId, eventType, assignment.status, status, actorId, actorType, {
    percentage, result, criticalFail: Boolean(criticalFail),
  });
  return { employeeId: assignment.employeeId, status, percentage, result, criticalFail: Boolean(criticalFail) };
}

async function reconcileEvaluations(db, assignmentId, actorId, actorType) {
  const rows = await db.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.employee_id AS employeeId, a.status,
            p.evaluator_count AS evaluatorCount, p.passing_pct AS passingPct,
            p.moderation_threshold_pct AS moderationThresholdPct
       FROM practical_assessment_assignment a
       INNER JOIN practical_assessment_template p ON p.template_id = a.template_id
      WHERE a.assignment_id = ? LIMIT 1 FOR UPDATE`,
    String(assignmentId),
  );
  const assignment = normalize(rows[0] || null);
  const evaluations = normalize(await db.$queryRawUnsafe(
    `SELECT evaluation_id AS evaluationId, evaluator_slot AS evaluatorSlot,
            percentage, result, critical_fail AS criticalFail
       FROM practical_evaluation
      WHERE assignment_id = ? AND status = 'SUBMITTED' ORDER BY evaluator_slot`,
    String(assignmentId),
  ));
  if (evaluations.length < numeric(assignment.evaluatorCount, 1)) return { pending: true, employeeId: assignment.employeeId };
  if (evaluations.length === 1) {
    const evaluation = evaluations[0];
    return finalizeAssignment(db, assignment, numeric(evaluation.percentage), evaluation.result, evaluation.criticalFail, actorId, actorType);
  }
  const variance = Math.abs(numeric(evaluations[0].percentage) - numeric(evaluations[1].percentage));
  const criticalDisagreement = Boolean(evaluations[0].criticalFail) !== Boolean(evaluations[1].criticalFail);
  if (variance > numeric(assignment.moderationThresholdPct, 15) || criticalDisagreement) {
    const reasonCode = criticalDisagreement ? 'CRITICAL_DISAGREEMENT' : 'SCORE_VARIANCE';
    await db.$executeRawUnsafe(
      `INSERT INTO practical_moderation_case
         (case_id, assignment_id, reason_code, status, score_variance_pct,
          critical_disagreement, opened_by)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason_code = VALUES(reason_code), status = 'OPEN',
         score_variance_pct = VALUES(score_variance_pct),
         critical_disagreement = VALUES(critical_disagreement), opened_by = VALUES(opened_by),
         opened_at = UTC_TIMESTAMP(3)`,
      randomUUID(), String(assignmentId), reasonCode, variance,
      criticalDisagreement ? 1 : 0, String(actorId),
    );
    await db.$executeRawUnsafe(
      `UPDATE practical_assessment_assignment SET status = 'MODERATION_REQUIRED' WHERE assignment_id = ?`,
      String(assignmentId),
    );
    await addEvent(db, assignmentId, 'MODERATION_OPENED', assignment.status, 'MODERATION_REQUIRED', actorId, actorType, {
      reasonCode, variance, criticalDisagreement,
    });
    return { moderationRequired: true, employeeId: assignment.employeeId, variance, criticalDisagreement };
  }
  const percentage = Math.round(((numeric(evaluations[0].percentage) + numeric(evaluations[1].percentage)) / 2) * 100) / 100;
  const criticalFail = evaluations.some(item => Boolean(item.criticalFail));
  const result = !criticalFail && percentage >= numeric(assignment.passingPct, 70) ? 'PASS' : 'FAIL';
  return finalizeAssignment(db, assignment, percentage, result, criticalFail, actorId, actorType);
}

export async function saveEvaluation({ evaluationId, evaluatorId, evaluatorType, scores, summary, strengths, developmentNotes, submit = false }) {
  let refreshEmployeeId = null;
  const result = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT e.evaluation_id AS evaluationId, e.assignment_id AS assignmentId,
              e.evaluator_id AS evaluatorId, e.evaluator_type AS evaluatorType,
              e.status, a.template_id AS templateId
         FROM practical_evaluation e
         INNER JOIN practical_assessment_assignment a ON a.assignment_id = e.assignment_id
        WHERE e.evaluation_id = ? LIMIT 1 FOR UPDATE`,
      String(evaluationId),
    );
    const evaluation = normalize(rows[0] || null);
    if (!evaluation || evaluation.evaluatorId !== String(evaluatorId) || evaluation.evaluatorType !== String(evaluatorType)) {
      fail(404, 'Evaluation assignment not found.', 'EVALUATION_NOT_FOUND');
    }
    if (evaluation.status !== 'DRAFT') fail(409, 'Submitted evaluations are locked and cannot be edited.', 'EVALUATION_LOCKED');
    const template = await getTemplateDetail(evaluation.templateId, tx);
    const calculated = calculateEvaluation(template, scores, submit);
    const summaryText = clean(summary, 20000);
    if (submit && summaryText.length < 20) fail(400, 'Evaluator summary must contain at least 20 characters.', 'EVALUATION_SUMMARY_REQUIRED');
    await tx.$executeRawUnsafe(`DELETE FROM practical_criterion_score WHERE evaluation_id = ?`, String(evaluationId));
    for (const item of calculated.scores) {
      await tx.$executeRawUnsafe(
        `INSERT INTO practical_criterion_score
           (score_id, evaluation_id, criterion_id, raw_score, weighted_score,
            rating_label, observation_notes, evidence_reference, critical_fail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), String(evaluationId), String(item.criterionId), item.rawScore,
        item.weightedScore, item.ratingLabel, item.observationNotes,
        item.evidenceReference, item.criticalFail ? 1 : 0,
      );
    }
    await tx.$executeRawUnsafe(
      `UPDATE practical_evaluation
          SET total_score = ?, percentage = ?, result = ?, critical_fail = ?,
              summary = ?, strengths = ?, development_notes = ?, status = ?,
              submitted_at = ?, locked_at = ?
        WHERE evaluation_id = ?`,
      calculated.totalScore, calculated.percentage, calculated.result,
      calculated.criticalFail ? 1 : 0, summaryText || null,
      clean(strengths, 20000) || null, clean(developmentNotes, 20000) || null,
      submit ? 'SUBMITTED' : 'DRAFT', submit ? new Date() : null,
      submit ? new Date() : null, String(evaluationId),
    );
    await addEvent(tx, evaluation.assignmentId, submit ? 'EVALUATION_SUBMITTED' : 'EVALUATION_SAVED', 'EVALUATING', 'EVALUATING', evaluatorId, evaluatorType, {
      evaluationId, percentage: calculated.percentage, result: calculated.result,
    });
    if (submit) {
      const reconciliation = await reconcileEvaluations(tx, evaluation.assignmentId, evaluatorId, evaluatorType);
      refreshEmployeeId = reconciliation.employeeId || null;
    }
    return getAssignmentDetail(evaluation.assignmentId, tx);
  });
  if (refreshEmployeeId) {
    await syncEmployeeSkills(refreshEmployeeId, `practical:${evaluatorId}`);
    await syncLearningPaths(refreshEmployeeId);
  }
  return result;
}

export async function resolveModeration({ caseId, moderatorId, moderatorType, finalPercentage, finalResult, resolutionSummary }) {
  const percentage = Number(finalPercentage);
  const resultValue = String(finalResult || '').toUpperCase();
  const summary = clean(resolutionSummary, 20000);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) fail(400, 'Final moderation percentage must be between 0 and 100.', 'MODERATION_PERCENTAGE_RANGE');
  if (!['PASS', 'FAIL'].includes(resultValue)) fail(400, 'Final moderation result must be PASS or FAIL.', 'MODERATION_RESULT_REQUIRED');
  if (summary.length < 30) fail(400, 'Moderation resolution summary must contain at least 30 characters.', 'MODERATION_SUMMARY_REQUIRED');
  let employeeId = null;
  const detail = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT m.case_id AS caseId, m.assignment_id AS assignmentId, m.status,
              a.employee_id AS employeeId, a.status AS assignmentStatus
         FROM practical_moderation_case m
         INNER JOIN practical_assessment_assignment a ON a.assignment_id = m.assignment_id
        WHERE m.case_id = ? LIMIT 1 FOR UPDATE`,
      String(caseId),
    );
    const item = normalize(rows[0] || null);
    if (!item) fail(404, 'Moderation case not found.', 'MODERATION_NOT_FOUND');
    if (item.status !== 'OPEN' || item.assignmentStatus !== 'MODERATION_REQUIRED') fail(409, 'Moderation case is already resolved.', 'MODERATION_CLOSED');
    await tx.$executeRawUnsafe(
      `UPDATE practical_moderation_case
          SET status = 'RESOLVED', moderator_id = ?, resolution_summary = ?,
              final_percentage = ?, final_result = ?, resolved_at = UTC_TIMESTAMP(3)
        WHERE case_id = ?`,
      String(moderatorId), summary, percentage, resultValue, String(caseId),
    );
    await finalizeAssignment(tx, {
      assignmentId: item.assignmentId,
      employeeId: item.employeeId,
      status: item.assignmentStatus,
    }, percentage, resultValue, false, moderatorId, moderatorType, 'MODERATION_RESOLVED');
    employeeId = item.employeeId;
    return getAssignmentDetail(item.assignmentId, tx);
  });
  if (employeeId) {
    await syncEmployeeSkills(employeeId, `practical-moderation:${moderatorId}`);
    await syncLearningPaths(employeeId);
  }
  return detail;
}
