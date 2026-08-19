import { createHmac, randomInt, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';

const DISPLAY_KEYS = ['A', 'B', 'C', 'D'];
const VALID_ANSWERS = new Set(DISPLAY_KEYS);

export class AssessmentIntelligenceError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AssessmentIntelligenceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function integrityKey() {
  const key = String(process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET || '').trim();
  if (key.length < 32) {
    throw new AssessmentIntelligenceError('ASSESSMENT_INTEGRITY_KEY_MISSING', 'Assessment integrity configuration is unavailable.', 503);
  }
  return key;
}

// Validate key at module load time so bad config fails fast instead of at first learner request
if (!process.env.APP_ENCRYPTION_KEY && !process.env.SESSION_SECRET) {
  console.warn('[assessmentIntelligence] WARNING: APP_ENCRYPTION_KEY is not set. Assessment integrity will fail at runtime.');
}

function signAttemptForm({ attemptId, assessmentId, snapshot, accommodation, effectiveTimeLimitSeconds }) {
  return createHmac('sha256', integrityKey())
    .update(canonicalJson({ attemptId, assessmentId, snapshot, accommodation, effectiveTimeLimitSeconds }))
    .digest('hex');
}

function secureShuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normalizedText(value) {
  return String(value || '').trim();
}

function normalizedUpper(value) {
  return normalizedText(value).toUpperCase();
}

function normalizedQuestion(row, overrides = {}) {
  const options = {
    A: row.optionA,
    B: row.optionB,
    C: row.optionC,
    D: row.optionD,
  };
  const availableOptionKeys = DISPLAY_KEYS.filter(key => normalizedText(options[key]));
  return {
    questionId: row.questionId,
    questionText: row.questionText,
    options,
    availableOptionKeys,
    correctOption: normalizedUpper(row.correctOption),
    marks: overrides.marksEach !== null && overrides.marksEach !== undefined ? asNumber(overrides.marksEach, 1) : asNumber(row.marks, 1),
    negativeMarks: overrides.negativeMarksEach !== null && overrides.negativeMarksEach !== undefined ? asNumber(overrides.negativeMarksEach, 0) : asNumber(row.negativeMarks, 0),
    difficulty: normalizedText(row.metadataDifficulty || row.difficulty || 'Medium'),
    topic: normalizedText(row.topic),
    objectiveCode: normalizedText(row.objectiveCode),
    skillId: row.skillId || null,
    questionType: normalizedText(row.questionType || 'SINGLE_CHOICE'),
    cognitiveLevel: normalizedText(row.cognitiveLevel || 'UNDERSTAND'),
    languageCode: normalizedText(row.languageCode || 'en-IN'),
    explanation: row.explanation || null,
  };
}

async function activeAccommodation(employeeId, client = prisma) {
  const rows = await client.$queryRawUnsafe(
    `SELECT accommodation_id AS accommodationId,
            accommodation_type AS accommodationType,
            time_multiplier AS timeMultiplier,
            extra_break_minutes AS extraBreakMinutes,
            display_preferences_json AS displayPreferences,
            language_code AS languageCode,
            effective_from AS effectiveFrom,
            effective_to AS effectiveTo
       FROM assessment_accommodation
      WHERE employee_id = ?
        AND status = 'APPROVED'
        AND effective_from <= CURRENT_TIMESTAMP(3)
        AND (effective_to IS NULL OR effective_to >= CURRENT_TIMESTAMP(3))
      ORDER BY approved_at DESC, created_at DESC
      LIMIT 1`,
    employeeId,
  );
  const row = rows[0];
  if (!row) {
    return {
      accommodationId: null,
      accommodationType: null,
      timeMultiplier: 1,
      extraBreakMinutes: 0,
      displayPreferences: {},
      languageCode: null,
    };
  }
  return {
    accommodationId: row.accommodationId,
    accommodationType: row.accommodationType,
    timeMultiplier: clamp(asNumber(row.timeMultiplier, 1), 1, 3),
    extraBreakMinutes: clamp(Math.round(asNumber(row.extraBreakMinutes, 0)), 0, 120),
    displayPreferences: parseJson(row.displayPreferences, {}),
    languageCode: row.languageCode || null,
  };
}

function effectiveTimeLimitSeconds(assessment, accommodation) {
  const baseSeconds = Math.max(60, Math.round(asNumber(assessment.timeLimitMins, 30) * 60));
  return clamp(
    Math.round(baseSeconds * accommodation.timeMultiplier) + accommodation.extraBreakMinutes * 60,
    60,
    86400,
  );
}

async function publishedBlueprint(assessmentId, client = prisma) {
  const blueprints = await client.$queryRawUnsafe(
    `SELECT blueprint_id AS blueprintId,
            assessment_id AS assessmentId,
            blueprint_name AS blueprintName,
            version_no AS versionNo,
            total_questions AS totalQuestions,
            randomize_questions AS randomizeQuestions,
            randomize_options AS randomizeOptions,
            selection_strategy AS selectionStrategy,
            effective_from AS effectiveFrom,
            effective_to AS effectiveTo
       FROM assessment_blueprint
      WHERE assessment_id = ?
        AND status = 'PUBLISHED'
        AND active = 1
        AND (effective_from IS NULL OR effective_from <= CURRENT_TIMESTAMP(3))
        AND (effective_to IS NULL OR effective_to >= CURRENT_TIMESTAMP(3))
      ORDER BY version_no DESC
      LIMIT 1`,
    assessmentId,
  );
  const blueprint = blueprints[0];
  if (!blueprint) return null;
  const rules = await client.$queryRawUnsafe(
    `SELECT rule_id AS ruleId,
            blueprint_id AS blueprintId,
            rule_order AS ruleOrder,
            topic,
            objective_code AS objectiveCode,
            skill_id AS skillId,
            difficulty,
            question_type AS questionType,
            cognitive_level AS cognitiveLevel,
            language_code AS languageCode,
            question_count AS questionCount,
            marks_each AS marksEach,
            negative_marks_each AS negativeMarksEach,
            required
       FROM assessment_blueprint_rule
      WHERE blueprint_id = ?
      ORDER BY rule_order ASC`,
    blueprint.blueprintId,
  );
  return { ...blueprint, rules };
}

async function questionCandidates(assessmentId, client = prisma) {
  return client.$queryRawUnsafe(
    `SELECT q.question_id AS questionId,
            q.question_text AS questionText,
            q.option_a AS optionA,
            q.option_b AS optionB,
            q.option_c AS optionC,
            q.option_d AS optionD,
            q.correct_option AS correctOption,
            q.marks,
            q.negative_marks AS negativeMarks,
            q.difficulty,
            q.explanation,
            COALESCE(m.topic, '') AS topic,
            COALESCE(m.objective_code, '') AS objectiveCode,
            m.skill_id AS skillId,
            COALESCE(NULLIF(m.difficulty, ''), q.difficulty, '') AS metadataDifficulty,
            COALESCE(m.question_type, 'SINGLE_CHOICE') AS questionType,
            COALESCE(m.cognitive_level, 'UNDERSTAND') AS cognitiveLevel,
            COALESCE(m.language_code, 'en-IN') AS languageCode,
            COALESCE(m.review_status, 'APPROVED') AS reviewStatus,
            m.max_exposure_count AS maxExposureCount,
            COALESCE(m.usage_count, 0) AS usageCount
       FROM question_bank q
       LEFT JOIN assessment_question_metadata m ON m.question_id = q.question_id
      WHERE q.assessment_id = ?
        AND q.active = 1
        AND COALESCE(m.review_status, 'APPROVED') = 'APPROVED'
        AND (m.max_exposure_count IS NULL OR COALESCE(m.usage_count, 0) < m.max_exposure_count)
      ORDER BY q.created_at ASC, q.question_id ASC`,
    assessmentId,
  );
}

function matchesRule(question, rule) {
  if (normalizedText(rule.topic) && normalizedText(question.topic).toLowerCase() !== normalizedText(rule.topic).toLowerCase()) return false;
  if (normalizedText(rule.objectiveCode) && normalizedText(question.objectiveCode).toLowerCase() !== normalizedText(rule.objectiveCode).toLowerCase()) return false;
  if (rule.skillId && question.skillId !== rule.skillId) return false;
  if (normalizedText(rule.difficulty) && normalizedText(question.metadataDifficulty || question.difficulty).toLowerCase() !== normalizedText(rule.difficulty).toLowerCase()) return false;
  if (normalizedText(rule.questionType) && normalizedText(question.questionType).toLowerCase() !== normalizedText(rule.questionType).toLowerCase()) return false;
  if (normalizedText(rule.cognitiveLevel) && normalizedText(question.cognitiveLevel).toLowerCase() !== normalizedText(rule.cognitiveLevel).toLowerCase()) return false;
  if (normalizedText(rule.languageCode) && normalizedText(question.languageCode).toLowerCase() !== normalizedText(rule.languageCode).toLowerCase()) return false;
  return true;
}

function buildQuestionSnapshot(candidates, blueprint) {
  if (!candidates.length) {
    throw new AssessmentIntelligenceError('ASSESSMENT_EMPTY', 'This assessment has no approved active questions.', 409);
  }

  let selected = [];
  if (blueprint) {
    const used = new Set();
    for (const rule of blueprint.rules) {
      const eligible = candidates.filter(question => !used.has(question.questionId) && matchesRule(question, rule));
      const requiredCount = Math.max(1, Math.round(asNumber(rule.questionCount, 1)));
      if (eligible.length < requiredCount) {
        throw new AssessmentIntelligenceError(
          'BLUEPRINT_SUPPLY_SHORTAGE',
          `Blueprint rule ${rule.ruleOrder} requires ${requiredCount} question(s), but only ${eligible.length} approved unused question(s) match.`,
          409,
          { ruleId: rule.ruleId, ruleOrder: rule.ruleOrder, requiredCount, eligibleCount: eligible.length },
        );
      }
      const chosen = secureShuffle(eligible).slice(0, requiredCount);
      chosen.forEach(question => used.add(question.questionId));
      selected.push(...chosen.map(question => normalizedQuestion(question, rule)));
    }
    if (blueprint.totalQuestions != null && selected.length !== asNumber(blueprint.totalQuestions, selected.length)) {
      throw new AssessmentIntelligenceError(
        'BLUEPRINT_TOTAL_MISMATCH',
        `Published blueprint expects ${blueprint.totalQuestions} questions, but its rules generate ${selected.length}.`,
        409,
      );
    }
  } else {
    selected = candidates.map(question => normalizedQuestion(question));
  }

  if (!blueprint || Boolean(blueprint.randomizeQuestions)) selected = secureShuffle(selected);

  return selected.map(question => {
    const displayOrder = blueprint && !Boolean(blueprint.randomizeOptions)
      ? [...question.availableOptionKeys]
      : secureShuffle(question.availableOptionKeys);
    return { ...question, displayOrder };
  });
}

function safeQuestionForLearner(question) {
  const displayed = {};
  question.displayOrder.forEach((originalKey, index) => {
    displayed[DISPLAY_KEYS[index]] = question.options[originalKey];
  });
  return {
    questionId: question.questionId,
    questionText: question.questionText,
    optionA: displayed.A || null,
    optionB: displayed.B || null,
    optionC: displayed.C || null,
    optionD: displayed.D || null,
    marks: question.marks,
    difficulty: question.difficulty,
    topic: question.topic || null,
    objectiveCode: question.objectiveCode || null,
    questionType: question.questionType,
    cognitiveLevel: question.cognitiveLevel,
  };
}

function mapDisplayedAnswer(question, displayedAnswer) {
  const displayKey = normalizedUpper(displayedAnswer);
  if (!VALID_ANSWERS.has(displayKey)) return { displayKey: null, originalKey: null };
  const index = DISPLAY_KEYS.indexOf(displayKey);
  const originalKey = question.displayOrder[index] || null;
  return { displayKey, originalKey };
}

function correctDisplayedAnswer(question) {
  const index = question.displayOrder.indexOf(question.correctOption);
  return index >= 0 ? DISPLAY_KEYS[index] : null;
}

async function readAttemptForm(attemptId, client = prisma) {
  const rows = await client.$queryRawUnsafe(
    `SELECT form_id AS formId,
            attempt_id AS attemptId,
            assessment_id AS assessmentId,
            blueprint_id AS blueprintId,
            blueprint_version AS blueprintVersion,
            question_snapshot_json AS questionSnapshot,
            accommodation_snapshot_json AS accommodationSnapshot,
            total_marks AS totalMarks,
            effective_time_limit_seconds AS effectiveTimeLimitSeconds,
            integrity_hash AS integrityHash,
            generated_at AS generatedAt
       FROM assessment_attempt_form
      WHERE attempt_id = ?
      LIMIT 1`,
    attemptId,
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const snapshot = parseJson(row.questionSnapshot, []);
  const accommodation = parseJson(row.accommodationSnapshot, {});
  const effectiveSeconds = asNumber(row.effectiveTimeLimitSeconds, 0);
  const expectedHash = signAttemptForm({
    attemptId: row.attemptId,
    assessmentId: row.assessmentId,
    snapshot,
    accommodation,
    effectiveTimeLimitSeconds: effectiveSeconds,
  });
  if (expectedHash !== row.integrityHash) {
    throw new AssessmentIntelligenceError('ATTEMPT_FORM_INTEGRITY_FAILED', 'Assessment form integrity validation failed.', 409);
  }
  return { ...row, snapshot, accommodation, effectiveTimeLimitSeconds: effectiveSeconds };
}

async function ensureAttemptForm({ employeeId, assessment, attempt }, client = prisma) {
  const existing = await readAttemptForm(attempt.attemptId, client);
  if (existing) return existing;

  const [accommodation, blueprint, candidates] = await Promise.all([
    activeAccommodation(employeeId, client),
    publishedBlueprint(assessment.assessmentId, client),
    questionCandidates(assessment.assessmentId, client),
  ]);
  const snapshot = buildQuestionSnapshot(candidates, blueprint);
  const effectiveSeconds = effectiveTimeLimitSeconds(assessment, accommodation);
  const totalMarks = snapshot.reduce((sum, question) => sum + asNumber(question.marks, 0), 0);
  const integrityHash = signAttemptForm({
    attemptId: attempt.attemptId,
    assessmentId: assessment.assessmentId,
    snapshot,
    accommodation,
    effectiveTimeLimitSeconds: effectiveSeconds,
  });

  await client.$executeRawUnsafe(
    `INSERT IGNORE INTO assessment_attempt_form
       (form_id, attempt_id, assessment_id, blueprint_id, blueprint_version,
        question_snapshot_json, accommodation_snapshot_json, total_marks,
        effective_time_limit_seconds, integrity_hash)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)`,
    randomUUID(),
    attempt.attemptId,
    assessment.assessmentId,
    blueprint?.blueprintId || null,
    blueprint ? asNumber(blueprint.versionNo, 1) : null,
    JSON.stringify(snapshot),
    JSON.stringify(accommodation),
    totalMarks,
    effectiveSeconds,
    integrityHash,
  );
  await client.assessmentAttempt.updateMany({
    where: { attemptId: attempt.attemptId, submittedAt: null },
    data: { totalQuestions: snapshot.length },
  });

  const created = await readAttemptForm(attempt.attemptId, client);
  if (!created) throw new AssessmentIntelligenceError('ATTEMPT_FORM_CREATE_FAILED', 'Unable to create the assessment form.', 500);
  return created;
}

function contentSort(a, b) {
  const dayDifference = asNumber(a.module?.dayNo, 0) - asNumber(b.module?.dayNo, 0);
  if (dayDifference) return dayDifference;
  const moduleDifference = asNumber(a.module?.moduleOrder, 0) - asNumber(b.module?.moduleOrder, 0);
  if (moduleDifference) return moduleDifference;
  return asNumber(a.contentOrder, 0) - asNumber(b.contentOrder, 0);
}

function completed(progress) {
  return progress?.completionStatus === 'Completed' || asNumber(progress?.completionPct, 0) >= 100;
}

async function learnerAssessmentAccess(employeeId, assessmentId) {
  const [trainee, assessment] = await Promise.all([
    prisma.traineeMaster.findUnique({ where: { employeeId } }),
    prisma.assessmentMaster.findUnique({ where: { assessmentId } }),
  ]);
  if (!trainee) throw new AssessmentIntelligenceError('TRAINEE_NOT_FOUND', 'Trainee not found.', 404);
  if (!assessment || !assessment.active) throw new AssessmentIntelligenceError('ASSESSMENT_NOT_FOUND', 'Assessment not found.', 404);

  let classroomAccess = trainee.classroomId === assessment.classroomId;
  if (!classroomAccess) {
    const mapping = await prisma.traineeClassroomMap.findFirst({
      where: { employeeId, classroomId: assessment.classroomId, active: true },
      select: { id: true },
    });
    classroomAccess = Boolean(mapping);
  }

  // Broadcast/refresher access: an active AssignedModule row (individual / batch / process /
  // branch / company scope) that carries this assessmentId as its attached PKT. This is what
  // lets a graduated/refresher trainee with no classroomId — or no membership in this
  // assessment's classroom — take a broadcast-attached MCQ.
  let viaBroadcastOnly = false;
  if (!classroomAccess) {
    const broadcastAccess = await prisma.assignedModule.findFirst({
      where: {
        assessmentId,
        active: true,
        OR: [
          { assignedTo: employeeId, assignedToType: 'individual' },
          { assignedTo: trainee.batchNo || '', assignedToType: 'batch' },
          { assignedTo: trainee.process || '', assignedToType: 'process' },
          { assignedTo: trainee.branch || '', assignedToType: 'branch' },
          { assignedToType: 'company' },
        ],
      },
      select: { id: true },
    });
    if (broadcastAccess) {
      classroomAccess = true;
      viaBroadcastOnly = true;
    }
  }

  if (!classroomAccess) {
    throw new AssessmentIntelligenceError('ASSESSMENT_SCOPE_DENIED', 'This assessment is not assigned to your classroom.', 403);
  }

  // Content-completion prerequisites are classroom curriculum content — meaningless (and
  // wrongly blocking) for a trainee who only has broadcast access to this assessment, since
  // they have no ContentProgress rows against that classroom's content at all.
  if (viaBroadcastOnly) return { trainee, assessment };

  const contentWhere = { active: true, required: true };
  if (assessment.moduleId) contentWhere.moduleId = assessment.moduleId;
  else if (assessment.dayNo) contentWhere.module = { classroomId: assessment.classroomId, dayNo: { lte: assessment.dayNo } };
  else contentWhere.module = { classroomId: assessment.classroomId };

  const prerequisiteContent = await prisma.contentMaster.findMany({ where: contentWhere, include: { module: true } });
  if (prerequisiteContent.length && process.env.LMS_SEQUENTIAL_UNLOCK_DISABLED !== 'true') {
    const progressRows = await prisma.contentProgress.findMany({
      where: { employeeId, contentId: { in: prerequisiteContent.map(content => content.contentId) } },
    });
    const progressMap = new Map(progressRows.map(progress => [progress.contentId, progress]));
    const missing = prerequisiteContent.sort(contentSort).find(content => !completed(progressMap.get(content.contentId)));
    if (missing) {
      throw new AssessmentIntelligenceError(
        'ASSESSMENT_PREREQUISITE_MISSING',
        `Complete "${missing.contentTitle}" before attempting this assessment.`,
        403,
        { prerequisiteContentId: missing.contentId, prerequisiteTitle: missing.contentTitle },
      );
    }
  }
  return { trainee, assessment };
}

async function currentOrNewAttempt(employeeId, assessment) {
  let attempt = await prisma.assessmentAttempt.findFirst({
    where: { employeeId, assessmentId: assessment.assessmentId, submittedAt: null },
    orderBy: { startedAt: 'desc' },
  });

  if (attempt) {
    const form = await readAttemptForm(attempt.attemptId);
    const accommodation = form ? form.accommodation : await activeAccommodation(employeeId);
    const limitSeconds = form ? form.effectiveTimeLimitSeconds : effectiveTimeLimitSeconds(assessment, accommodation);
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000));
    if (elapsed > limitSeconds + 30) {
      await prisma.assessmentAttempt.update({
        where: { id: attempt.id },
        data: { submittedAt: new Date(), timeTakenSeconds: limitSeconds, result: 'Expired' },
      });
      attempt = null;
    }
  }

  if (attempt) return attempt;
  return prisma.$transaction(async (tx) => {
    const [attemptsUsed, grantsAgg] = await Promise.all([
      tx.assessmentAttempt.count({ where: { employeeId, assessmentId: assessment.assessmentId, result: { not: 'Expired' } } }),
      tx.assessmentAttemptGrant.aggregate({ where: { employeeId, assessmentId: assessment.assessmentId, active: true }, _sum: { extraAttempts: true } }),
    ]);
    const attemptLimit = Math.max(1, asNumber(assessment.attemptLimit, 3)) + (grantsAgg._sum.extraAttempts || 0);
    if (attemptsUsed >= attemptLimit) {
      throw new AssessmentIntelligenceError('ATTEMPT_LIMIT_REACHED', 'Maximum attempts reached.', 409);
    }
    return tx.assessmentAttempt.create({
      data: {
        attemptId: `ATT-${randomUUID()}`,
        employeeId,
        assessmentId: assessment.assessmentId,
        attemptNo: attemptsUsed + 1,
        startedAt: new Date(),
        totalQuestions: 0,
        result: 'In Progress',
      },
    });
  });
}

export async function loadLearnerAssessment(employeeId, assessmentId) {
  const { assessment } = await learnerAssessmentAccess(employeeId, assessmentId);
  const attempt = await currentOrNewAttempt(employeeId, assessment);
  const form = await ensureAttemptForm({ employeeId, assessment, attempt });
  const [bestResult, attemptsUsed, grantsAgg] = await Promise.all([
    prisma.assessmentResult.findUnique({ where: { employeeId_assessmentId: { employeeId, assessmentId } } }),
    prisma.assessmentAttempt.count({ where: { employeeId, assessmentId } }),
    prisma.assessmentAttemptGrant.aggregate({ where: { employeeId, assessmentId, active: true }, _sum: { extraAttempts: true } }),
  ]);
  const effectiveAttemptLimit = Math.max(1, asNumber(assessment.attemptLimit, 3)) + (grantsAgg._sum.extraAttempts || 0);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000));
  const timeLeftSeconds = Math.max(0, form.effectiveTimeLimitSeconds - elapsedSeconds);

  return {
    assessment: {
      assessmentId: assessment.assessmentId,
      assessmentName: assessment.assessmentName,
      passingPct: assessment.passingPct,
      attemptLimit: effectiveAttemptLimit,
      attemptsUsed,
      baseTimeLimitMins: assessment.timeLimitMins,
      timeLimitMins: Math.ceil(form.effectiveTimeLimitSeconds / 60),
      effectiveTimeLimitSeconds: form.effectiveTimeLimitSeconds,
      timeLeftSeconds,
      instructions: assessment.instructions,
      attemptId: attempt.attemptId,
      attemptNo: attempt.attemptNo,
      startedAt: attempt.startedAt,
      engine: 'ASSESSMENT_INTELLIGENCE_V1',
      blueprintId: form.blueprintId,
      blueprintVersion: form.blueprintVersion,
      accommodation: form.accommodation?.accommodationId ? {
        accommodationType: form.accommodation.accommodationType,
        timeMultiplier: form.accommodation.timeMultiplier,
        extraBreakMinutes: form.accommodation.extraBreakMinutes,
        displayPreferences: form.accommodation.displayPreferences,
        languageCode: form.accommodation.languageCode,
      } : null,
    },
    questions: form.snapshot.map(safeQuestionForLearner),
    bestResult,
  };
}

function scoreAttempt(snapshot, answers, responseSeconds, flags) {
  let totalMarks = 0;
  let scored = 0;
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  const responses = [];

  for (const question of snapshot) {
    const displayedAnswer = answers[question.questionId];
    const mapping = mapDisplayedAnswer(question, displayedAnswer);
    const isBlank = !mapping.originalKey;
    const isCorrect = Boolean(mapping.originalKey && mapping.originalKey === question.correctOption);
    const marksAvailable = asNumber(question.marks, 0);
    let marksAwarded = 0;
    totalMarks += marksAvailable;
    if (isBlank) blank += 1;
    else if (isCorrect) {
      correct += 1;
      marksAwarded = marksAvailable;
      scored += marksAwarded;
    } else {
      wrong += 1;
      marksAwarded = -Math.max(0, asNumber(question.negativeMarks, 0));
      scored += marksAwarded;
    }
    responses.push({
      question,
      displayedOption: mapping.displayKey,
      selectedOption: mapping.originalKey,
      isCorrect,
      isBlank,
      marksAvailable,
      marksAwarded,
      responseSeconds: clamp(Math.round(asNumber(responseSeconds?.[question.questionId], 0)), 0, 86400),
      learnerFlagged: Boolean(flags?.[question.questionId]),
    });
  }
  const percentage = totalMarks > 0 ? Math.max(0, Math.round((scored / totalMarks) * 100)) : 0;
  return { totalMarks, scored, percentage, correct, wrong, blank, responses };
}

async function refreshAssessmentAnalytics(assessmentId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.question_id AS questionId,
            r.attempt_id AS attemptId,
            r.selected_option AS selectedOption,
            r.is_correct AS isCorrect,
            r.is_blank AS isBlank,
            r.response_seconds AS responseSeconds,
            a.percentage
       FROM assessment_question_response r
       INNER JOIN assessment_attempts a ON a.attempt_id = r.attempt_id
      WHERE r.assessment_id = ?
        AND a.submitted_at IS NOT NULL
        AND a.result IN ('Pass','Fail')`,
    assessmentId,
  );
  if (!rows.length) return;

  const attemptScores = new Map();
  rows.forEach(row => attemptScores.set(row.attemptId, asNumber(row.percentage, 0)));
  const rankedAttemptIds = [...attemptScores.entries()].sort((a, b) => b[1] - a[1]).map(([attemptId]) => attemptId);
  const groupSize = rankedAttemptIds.length >= 10 ? Math.max(1, Math.ceil(rankedAttemptIds.length * 0.27)) : 0;
  const top = new Set(groupSize ? rankedAttemptIds.slice(0, groupSize) : []);
  const bottom = new Set(groupSize ? rankedAttemptIds.slice(-groupSize) : []);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.questionId)) grouped.set(row.questionId, []);
    grouped.get(row.questionId).push(row);
  }

  for (const [questionId, questionRows] of grouped.entries()) {
    const sampleSize = questionRows.length;
    const correctCount = questionRows.filter(row => Boolean(row.isCorrect)).length;
    const blankCount = questionRows.filter(row => Boolean(row.isBlank)).length;
    const correctPct = Number(((correctCount / sampleSize) * 100).toFixed(2));
    const blankPct = Number(((blankCount / sampleSize) * 100).toFixed(2));
    const avgResponseSeconds = Number((questionRows.reduce((sum, row) => sum + asNumber(row.responseSeconds, 0), 0) / sampleSize).toFixed(2));
    const distractors = {};
    questionRows.forEach(row => {
      const key = row.selectedOption || 'BLANK';
      distractors[key] = (distractors[key] || 0) + 1;
    });

    let discriminationIndex = null;
    if (groupSize) {
      const topRows = questionRows.filter(row => top.has(row.attemptId));
      const bottomRows = questionRows.filter(row => bottom.has(row.attemptId));
      if (topRows.length && bottomRows.length) {
        const topRate = topRows.filter(row => Boolean(row.isCorrect)).length / topRows.length;
        const bottomRate = bottomRows.filter(row => Boolean(row.isCorrect)).length / bottomRows.length;
        discriminationIndex = Number(((topRate - bottomRate) * 100).toFixed(3));
      }
    }

    let qualityStatus = 'HEALTHY';
    if (sampleSize < 10) qualityStatus = 'INSUFFICIENT_DATA';
    else if (blankPct >= 30) qualityStatus = 'HIGH_BLANK_RATE';
    else if (correctPct <= 25) qualityStatus = 'TOO_HARD';
    else if (correctPct >= 95) qualityStatus = 'TOO_EASY';
    else if (discriminationIndex !== null && discriminationIndex < 10) qualityStatus = 'LOW_DISCRIMINATION';

    await prisma.$executeRawUnsafe(
      `INSERT INTO assessment_item_analytics
         (analytics_id, assessment_id, question_id, sample_size, correct_pct, blank_pct,
          avg_response_seconds, discrimination_index, distractor_json, quality_status, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         sample_size = VALUES(sample_size),
         correct_pct = VALUES(correct_pct),
         blank_pct = VALUES(blank_pct),
         avg_response_seconds = VALUES(avg_response_seconds),
         discrimination_index = VALUES(discrimination_index),
         distractor_json = VALUES(distractor_json),
         quality_status = VALUES(quality_status),
         calculated_at = CURRENT_TIMESTAMP(3)`,
      randomUUID(), assessmentId, questionId, sampleSize, correctPct, blankPct,
      avgResponseSeconds, discriminationIndex, JSON.stringify(distractors), qualityStatus,
    );

    if (qualityStatus === 'HEALTHY' || qualityStatus === 'INSUFFICIENT_DATA') {
      await prisma.$executeRawUnsafe(
        `UPDATE assessment_quality_alert
            SET status = 'RESOLVED', resolved_by = 'system', resolved_at = CURRENT_TIMESTAMP(3),
                resolution_notes = 'Current item evidence no longer meets the alert threshold.'
          WHERE assessment_id = ? AND question_id = ? AND status IN ('OPEN','REVIEWING')`,
        assessmentId, questionId,
      );
    } else {
      const severity = ['TOO_HARD', 'LOW_DISCRIMINATION'].includes(qualityStatus) ? 'HIGH' : 'MEDIUM';
      const evidence = { sampleSize, correctPct, blankPct, avgResponseSeconds, discriminationIndex, distractors };
      await prisma.$executeRawUnsafe(
        `INSERT INTO assessment_quality_alert
           (alert_id, assessment_id, question_id, alert_type, severity, evidence_json, status)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), 'OPEN')
         ON DUPLICATE KEY UPDATE
           severity = VALUES(severity), evidence_json = VALUES(evidence_json), updated_at = CURRENT_TIMESTAMP(3)`,
        randomUUID(), assessmentId, questionId, qualityStatus, severity, JSON.stringify(evidence),
      );
    }
  }
}

async function createRemedialRecommendations({ employeeId, assessmentId, attemptId, responses }) {
  const missed = responses.filter(response => !response.isCorrect);
  const groups = new Map();
  for (const response of missed) {
    const question = response.question;
    const ruleKey = question.skillId
      ? `SKILL:${question.skillId}`
      : question.topic
        ? `TOPIC:${question.topic}`
        : question.objectiveCode
          ? `OBJECTIVE:${question.objectiveCode}`
          : `QUESTION:${question.questionId}`;
    if (!groups.has(ruleKey)) groups.set(ruleKey, []);
    groups.get(ruleKey).push(response);
  }

  for (const [ruleKey, group] of groups.entries()) {
    const question = group[0].question;
    let recommendationType = 'REVIEW_QUESTION';
    let referenceId = question.questionId;
    let title = `Review: ${question.topic || question.objectiveCode || 'missed concept'}`;

    if (question.skillId) {
      recommendationType = 'REVIEW_CONTENT';
      const contentRows = await prisma.$queryRawUnsafe(
        `SELECT c.content_id AS contentId, c.content_title AS contentTitle
           FROM content_skill_map m
           INNER JOIN content_master c ON c.content_id = m.content_id
          WHERE m.skill_id = ? AND m.active = 1 AND c.active = 1
          ORDER BY m.weight DESC, c.created_at ASC
          LIMIT 1`,
        question.skillId,
      );
      if (contentRows[0]) {
        referenceId = contentRows[0].contentId;
        title = `Recommended review: ${contentRows[0].contentTitle}`;
      } else {
        recommendationType = 'REVIEW_SKILL';
        referenceId = question.skillId;
        title = `Review skill gap: ${question.topic || question.objectiveCode || question.skillId}`;
      }
    } else if (question.topic) {
      recommendationType = 'REVIEW_TOPIC';
      referenceId = question.topic;
    } else if (question.objectiveCode) {
      recommendationType = 'REVIEW_OBJECTIVE';
      referenceId = question.objectiveCode;
    }

    const priority = group.length >= 3 ? 'HIGH' : group.length === 2 ? 'MEDIUM' : 'LOW';
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO assessment_remedial_recommendation
         (recommendation_id, attempt_id, employee_id, assessment_id, rule_key,
          recommendation_type, reference_id, title, reason, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      randomUUID(), attemptId, employeeId, assessmentId, ruleKey,
      recommendationType, referenceId, title,
      `${group.length} missed or blank question(s) indicate reinforcement is required.`,
      priority,
    );
  }

  return prisma.$queryRawUnsafe(
    `SELECT recommendation_id AS recommendationId,
            recommendation_type AS recommendationType,
            reference_id AS referenceId,
            title,
            reason,
            priority,
            status
       FROM assessment_remedial_recommendation
      WHERE attempt_id = ?
      ORDER BY FIELD(priority, 'CRITICAL','HIGH','MEDIUM','LOW'), created_at ASC`,
    attemptId,
  );
}

export async function submitLearnerAssessment(employeeId, assessmentId, payload = {}) {
  const { trainee, assessment } = await learnerAssessmentAccess(employeeId, assessmentId);
  const attemptId = normalizedText(payload.attemptId);
  if (!attemptId) throw new AssessmentIntelligenceError('ATTEMPT_ID_REQUIRED', 'Assessment attempt ID is required.', 400);
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { attemptId, employeeId, assessmentId, submittedAt: null },
  });
  if (!attempt) throw new AssessmentIntelligenceError('ATTEMPT_NOT_ACTIVE', 'No active assessment attempt found. Reopen the assessment.', 409);

  const form = await readAttemptForm(attemptId);
  if (!form) throw new AssessmentIntelligenceError('ATTEMPT_FORM_NOT_FOUND', 'Assessment form not found. Reopen the assessment.', 409);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000));
  if (elapsedSeconds > form.effectiveTimeLimitSeconds + 30) {
    await prisma.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { submittedAt: new Date(), timeTakenSeconds: form.effectiveTimeLimitSeconds, result: 'Expired' },
    });
    throw new AssessmentIntelligenceError('ATTEMPT_EXPIRED', 'Assessment time limit exceeded. This attempt has expired.', 409);
  }

  const answers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers) ? payload.answers : {};
  const responseSeconds = payload.responseSeconds && typeof payload.responseSeconds === 'object' ? payload.responseSeconds : {};
  const flags = payload.flags && typeof payload.flags === 'object' ? payload.flags : {};
  const scored = scoreAttempt(form.snapshot, answers, responseSeconds, flags);
  const result = scored.percentage >= asNumber(assessment.passingPct, 60) ? 'Pass' : 'Fail';
  const submittedAt = new Date();

  const transactionResult = await prisma.$transaction(async tx => {
    const claimed = await tx.assessmentAttempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: {
        submittedAt,
        timeTakenSeconds: Math.min(elapsedSeconds, form.effectiveTimeLimitSeconds),
        totalQuestions: form.snapshot.length,
        correctAnswers: scored.correct,
        wrongAnswers: scored.wrong,
        blankAnswers: scored.blank,
        score: scored.scored,
        percentage: scored.percentage,
        result,
        answerJson: answers,
      },
    });
    if (!claimed.count) return false;

    for (const response of scored.responses) {
      const question = response.question;
      await tx.$executeRawUnsafe(
        `INSERT INTO assessment_question_response
           (response_id, attempt_id, assessment_id, question_id, displayed_option,
            selected_option, correct_option, is_correct, is_blank, marks_available,
            marks_awarded, response_seconds, learner_flagged, topic, objective_code,
            skill_id, difficulty, question_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), attemptId, assessmentId, question.questionId, response.displayedOption,
        response.selectedOption, question.correctOption, response.isCorrect ? 1 : 0, response.isBlank ? 1 : 0,
        response.marksAvailable, response.marksAwarded, response.responseSeconds, response.learnerFlagged ? 1 : 0,
        question.topic || '', question.objectiveCode || '', question.skillId || null,
        question.difficulty || '', question.questionType || 'SINGLE_CHOICE',
      );
    }

    const existing = await tx.assessmentResult.findUnique({
      where: { employeeId_assessmentId: { employeeId, assessmentId } },
    });
    const isBest = !existing || scored.percentage > asNumber(existing.bestPercentage, 0);
    await tx.assessmentResult.upsert({
      where: { employeeId_assessmentId: { employeeId, assessmentId } },
      create: {
        employeeId,
        batchNo: trainee.batchNo || null,
        classroomId: assessment.classroomId,
        assessmentId,
        bestScore: scored.scored,
        bestPercentage: scored.percentage,
        result,
        totalAttempts: 1,
        lastAttemptAt: submittedAt,
      },
      update: {
        totalAttempts: { increment: 1 },
        lastAttemptAt: submittedAt,
        ...(isBest ? { bestScore: scored.scored, bestPercentage: scored.percentage, result } : {}),
      },
    });
    return true;
  });

  if (!transactionResult) throw new AssessmentIntelligenceError('ATTEMPT_ALREADY_SUBMITTED', 'This attempt was already submitted.', 409);

  const questionIds = form.snapshot.map(question => question.questionId);
  if (questionIds.length) {
    const placeholders = questionIds.map(() => '?').join(',');
    await prisma.$executeRawUnsafe(
      `UPDATE assessment_question_metadata
          SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP(3)
        WHERE question_id IN (${placeholders})`,
      ...questionIds,
    );
  }

  const [attemptsUsed, grantsAggSubmit, recommendations] = await Promise.all([
    prisma.assessmentAttempt.count({ where: { employeeId, assessmentId } }),
    prisma.assessmentAttemptGrant.aggregate({ where: { employeeId, assessmentId, active: true }, _sum: { extraAttempts: true } }),
    createRemedialRecommendations({ employeeId, assessmentId, attemptId, responses: scored.responses }).catch(() => []),
    refreshAssessmentAnalytics(assessmentId).catch(error => console.error('[assessmentIntelligence] analytics refresh failed:', error.message)),
  ]);
  const effectiveLimitSubmit = Math.max(1, asNumber(assessment.attemptLimit, 3)) + (grantsAggSubmit._sum.extraAttempts || 0);
  const attemptsLeft = Math.max(0, effectiveLimitSubmit - attemptsUsed);
  const revealAnswers = result === 'Pass' || attemptsLeft === 0;

  const review = form.snapshot.map(question => {
    const response = scored.responses.find(item => item.question.questionId === question.questionId);
    return {
      questionId: question.questionId,
      questionText: question.questionText,
      topic: question.topic || null,
      objectiveCode: question.objectiveCode || null,
      difficulty: question.difficulty,
      correctOption: revealAnswers ? correctDisplayedAnswer(question) : null,
      yourAnswer: response?.displayedOption || null,
      explanation: revealAnswers ? question.explanation : null,
      isCorrect: revealAnswers ? Boolean(response?.isCorrect) : null,
    };
  });

  return {
    result,
    percentage: scored.percentage,
    scored: scored.scored,
    totalMarks: scored.totalMarks,
    correct: scored.correct,
    wrong: scored.wrong,
    blank: scored.blank,
    attemptNo: attempt.attemptNo,
    passingPct: assessment.passingPct,
    attemptsLeft,
    review,
    recommendations,
    engine: 'ASSESSMENT_INTELLIGENCE_V1',
  };
}

export async function blueprintSupplyPreview(assessmentId, blueprintId = null) {
  const [candidates, blueprintRows] = await Promise.all([
    questionCandidates(assessmentId),
    blueprintId
      ? prisma.$queryRawUnsafe(
        `SELECT blueprint_id AS blueprintId, assessment_id AS assessmentId, blueprint_name AS blueprintName,
                version_no AS versionNo, total_questions AS totalQuestions,
                randomize_questions AS randomizeQuestions, randomize_options AS randomizeOptions,
                selection_strategy AS selectionStrategy
           FROM assessment_blueprint WHERE blueprint_id = ? LIMIT 1`,
        blueprintId,
      )
      : Promise.resolve([]),
  ]);
  let blueprint = blueprintRows[0] || null;
  if (blueprint) {
    blueprint.rules = await prisma.$queryRawUnsafe(
      `SELECT rule_id AS ruleId, rule_order AS ruleOrder, topic, objective_code AS objectiveCode,
              skill_id AS skillId, difficulty, question_type AS questionType,
              cognitive_level AS cognitiveLevel, language_code AS languageCode,
              question_count AS questionCount, marks_each AS marksEach,
              negative_marks_each AS negativeMarksEach, required
         FROM assessment_blueprint_rule WHERE blueprint_id = ? ORDER BY rule_order`,
      blueprintId,
    );
  }
  const snapshot = buildQuestionSnapshot(candidates, blueprint);
  return {
    approvedQuestionCount: candidates.length,
    generatedQuestionCount: snapshot.length,
    totalMarks: snapshot.reduce((sum, question) => sum + asNumber(question.marks, 0), 0),
    questionIds: snapshot.map(question => question.questionId),
  };
}

export async function recalculateAssessmentAnalytics(assessmentId) {
  await refreshAssessmentAnalytics(assessmentId);
  return prisma.$queryRawUnsafe(
    `SELECT a.analytics_id AS analyticsId, a.assessment_id AS assessmentId, a.question_id AS questionId,
            q.question_text AS questionText, a.sample_size AS sampleSize, a.correct_pct AS correctPct,
            a.blank_pct AS blankPct, a.avg_response_seconds AS avgResponseSeconds,
            a.discrimination_index AS discriminationIndex, a.distractor_json AS distractorJson,
            a.quality_status AS qualityStatus, a.calculated_at AS calculatedAt
       FROM assessment_item_analytics a
       LEFT JOIN question_bank q ON q.question_id = a.question_id
      WHERE a.assessment_id = ?
      ORDER BY FIELD(a.quality_status, 'TOO_HARD','LOW_DISCRIMINATION','HIGH_BLANK_RATE','TOO_EASY','HEALTHY','INSUFFICIENT_DATA'),
               a.question_id`,
    assessmentId,
  );
}
