import { prisma } from '../utils/db.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pathStatus(progressPct, dueAt, started) {
  if (progressPct >= 100) return 'COMPLETED';
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return 'OVERDUE';
  if (started || progressPct > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

async function insertAutomaticEvidence(employeeId, actor) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO skill_evidence
       (id, employee_id, skill_id, evidence_type, reference_id, score_pct,
        level_awarded, evidence_status, recorded_by, evidence_at)
     SELECT UUID(), cp.employee_id, csm.skill_id, 'CONTENT', cp.content_id,
            cp.completion_pct, csm.target_level, 'VALID', ?,
            COALESCE(cp.completed_at, cp.updated_at, UTC_TIMESTAMP(3))
       FROM content_progress cp
       INNER JOIN content_skill_map csm
               ON csm.content_id = cp.content_id AND csm.active = 1
      WHERE cp.employee_id = ?
        AND (cp.completion_status = 'Completed' OR cp.completion_pct >= 100)
     ON DUPLICATE KEY UPDATE
       score_pct = VALUES(score_pct),
       level_awarded = VALUES(level_awarded),
       evidence_status = 'VALID',
       evidence_at = VALUES(evidence_at),
       recorded_by = VALUES(recorded_by)`,
    String(actor || 'talent-engine'), String(employeeId),
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO skill_evidence
       (id, employee_id, skill_id, evidence_type, reference_id, score_pct,
        level_awarded, evidence_status, recorded_by, evidence_at)
     SELECT UUID(), ar.employee_id, asm.skill_id, 'ASSESSMENT', ar.assessment_id,
            ar.best_percentage,
            CASE
              WHEN ar.result = 'Pass' THEN asm.target_level
              ELSE GREATEST(0, asm.target_level - 1)
            END,
            CASE WHEN ar.result = 'Pass' THEN 'VALID' ELSE 'DEVELOPING' END,
            ?, COALESCE(ar.last_attempt_at, ar.updated_at, UTC_TIMESTAMP(3))
       FROM assessment_results ar
       INNER JOIN assessment_skill_map asm
               ON asm.assessment_id = ar.assessment_id AND asm.active = 1
      WHERE ar.employee_id = ?
     ON DUPLICATE KEY UPDATE
       score_pct = VALUES(score_pct),
       level_awarded = VALUES(level_awarded),
       evidence_status = VALUES(evidence_status),
       evidence_at = VALUES(evidence_at),
       recorded_by = VALUES(recorded_by)`,
    String(actor || 'talent-engine'), String(employeeId),
  );
}

async function loadApplicableRequirements(trainee) {
  return prisma.$queryRawUnsafe(
    `SELECT rsr.id, rsr.skill_id AS skillId, sm.skill_code AS skillCode,
            sm.skill_name AS skillName, sm.category, sm.description,
            rsr.required_level AS requiredLevel, rsr.critical, rsr.weight,
            rsr.department, rsr.designation,
            rsr.process_name AS processName, rsr.lob_name AS lobName
       FROM role_skill_requirement rsr
       INNER JOIN skill_master sm ON sm.skill_id = rsr.skill_id AND sm.active = 1
      WHERE rsr.active = 1
        AND (rsr.process_name = '' OR rsr.process_name = ?)
        AND (rsr.lob_name = '' OR rsr.lob_name = ?)
        AND rsr.department = ''
        AND rsr.designation = ''
      ORDER BY rsr.critical DESC, rsr.weight DESC, sm.category, sm.skill_name`,
    String(trainee?.process || ''), String(trainee?.lob || ''),
  );
}

export async function syncEmployeeSkills(employeeId, actor = 'talent-engine') {
  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId } });
  if (!trainee) return { trainee: null, requirements: [], profiles: [], evidence: [] };

  await insertAutomaticEvidence(employeeId, actor);

  const [requirements, evidenceRows, existingRows] = await Promise.all([
    loadApplicableRequirements(trainee),
    prisma.$queryRawUnsafe(
      `SELECT se.skill_id AS skillId,
              MAX(CASE WHEN se.expires_at IS NULL OR se.expires_at > UTC_TIMESTAMP(3)
                       THEN se.level_awarded ELSE 0 END) AS evidenceLevel,
              ROUND(AVG(CASE WHEN se.score_pct IS NOT NULL THEN se.score_pct END), 2) AS confidenceScore,
              MAX(se.evidence_at) AS lastEvidenceAt,
              COUNT(*) AS evidenceCount
         FROM skill_evidence se
        WHERE se.employee_id = ?
          AND se.evidence_status IN ('VALID', 'DEVELOPING')
        GROUP BY se.skill_id`,
      String(employeeId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT skill_id AS skillId, current_level AS currentLevel,
              target_level AS targetLevel, confidence_score AS confidenceScore,
              source, verified_by AS verifiedBy, verified_at AS verifiedAt,
              expires_at AS expiresAt
         FROM employee_skill_profile
        WHERE employee_id = ?`,
      String(employeeId),
    ),
  ]);

  const requirementBySkill = new Map();
  for (const row of requirements) {
    const current = requirementBySkill.get(row.skillId);
    if (!current || number(row.requiredLevel) > number(current.requiredLevel)) {
      requirementBySkill.set(row.skillId, row);
    }
  }
  const evidenceBySkill = new Map(evidenceRows.map(row => [row.skillId, row]));
  const existingBySkill = new Map(existingRows.map(row => [row.skillId, row]));
  const skillIds = new Set([...requirementBySkill.keys(), ...evidenceBySkill.keys(), ...existingBySkill.keys()]);

  for (const skillId of skillIds) {
    const requirement = requirementBySkill.get(skillId);
    const evidence = evidenceBySkill.get(skillId);
    const existing = existingBySkill.get(skillId);
    const verifiedAndCurrent = existing?.verifiedBy && (!existing.expiresAt || new Date(existing.expiresAt) > new Date());
    const evidenceLevel = number(evidence?.evidenceLevel);
    const existingLevel = number(existing?.currentLevel);
    const currentLevel = verifiedAndCurrent ? existingLevel : Math.max(existingLevel, evidenceLevel);
    const targetLevel = Math.max(number(existing?.targetLevel), number(requirement?.requiredLevel));
    const confidenceScore = verifiedAndCurrent
      ? number(existing?.confidenceScore)
      : Math.max(number(existing?.confidenceScore), number(evidence?.confidenceScore));
    const status = targetLevel > 0
      ? (currentLevel >= targetLevel ? 'READY' : 'GAP')
      : (currentLevel > 0 ? 'DEVELOPING' : 'UNASSESSED');

    await prisma.$executeRawUnsafe(
      `INSERT INTO employee_skill_profile
         (id, employee_id, skill_id, current_level, target_level,
          confidence_score, status, source, last_evidence_at,
          verified_by, verified_at, expires_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         current_level = VALUES(current_level),
         target_level = VALUES(target_level),
         confidence_score = VALUES(confidence_score),
         status = VALUES(status),
         source = VALUES(source),
         last_evidence_at = VALUES(last_evidence_at),
         verified_by = VALUES(verified_by),
         verified_at = VALUES(verified_at),
         expires_at = VALUES(expires_at)`,
      String(employeeId), String(skillId), currentLevel, targetLevel,
      confidenceScore, status, verifiedAndCurrent ? String(existing.source || 'VERIFIED') : 'LMS_EVIDENCE',
      evidence?.lastEvidenceAt || null,
      existing?.verifiedBy || null, existing?.verifiedAt || null, existing?.expiresAt || null,
    );
  }

  const [profiles, evidence] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT esp.skill_id AS skillId, sm.skill_code AS skillCode,
              sm.skill_name AS skillName, sm.category, sm.description,
              esp.current_level AS currentLevel, esp.target_level AS targetLevel,
              esp.confidence_score AS confidenceScore, esp.status, esp.source,
              esp.last_evidence_at AS lastEvidenceAt,
              esp.verified_by AS verifiedBy, esp.verified_at AS verifiedAt,
              esp.expires_at AS expiresAt
         FROM employee_skill_profile esp
         INNER JOIN skill_master sm ON sm.skill_id = esp.skill_id
        WHERE esp.employee_id = ? AND sm.active = 1
        ORDER BY FIELD(esp.status, 'GAP', 'UNASSESSED', 'DEVELOPING', 'READY'),
                 sm.category, sm.skill_name`,
      String(employeeId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT se.id, se.skill_id AS skillId, sm.skill_name AS skillName,
              se.evidence_type AS evidenceType, se.reference_id AS referenceId,
              se.score_pct AS scorePct, se.level_awarded AS levelAwarded,
              se.evidence_status AS evidenceStatus, se.notes,
              se.recorded_by AS recordedBy, se.evidence_at AS evidenceAt,
              se.expires_at AS expiresAt
         FROM skill_evidence se
         INNER JOIN skill_master sm ON sm.skill_id = se.skill_id
        WHERE se.employee_id = ?
        ORDER BY se.evidence_at DESC
        LIMIT 200`,
      String(employeeId),
    ),
  ]);

  return { trainee, requirements, profiles, evidence };
}

function completionForStep(step, context) {
  const type = String(step.stepType || '').toUpperCase();
  if (type === 'CONTENT') {
    const progress = context.content.get(step.referenceId);
    const complete = progress && (progress.completionStatus === 'Completed' || number(progress.completionPct) >= 100);
    return { complete: Boolean(complete), score: number(progress?.completionPct), evidence: complete ? `content:${step.referenceId}` : null };
  }
  if (type === 'ASSESSMENT') {
    const result = context.assessments.get(step.referenceId);
    const minScore = number(step.minScore, 0);
    const complete = result && result.result === 'Pass' && number(result.bestPercentage) >= minScore;
    return { complete: Boolean(complete), score: number(result?.bestPercentage), evidence: complete ? `assessment:${step.referenceId}` : null };
  }
  if (type === 'SKILL') {
    const profile = context.skills.get(step.referenceId);
    const minLevel = number(step.minLevel, 1);
    const complete = profile && number(profile.currentLevel) >= minLevel;
    return { complete: Boolean(complete), score: number(profile?.currentLevel), evidence: complete ? `skill:${step.referenceId}` : null };
  }
  if (type === 'CLASSROOM') {
    const complete = context.classrooms.has(step.referenceId);
    return { complete, score: complete ? 100 : 0, evidence: complete ? `classroom:${step.referenceId}` : null };
  }
  const stored = context.manualProgress.get(step.stepId);
  return {
    complete: stored?.status === 'COMPLETED',
    score: number(stored?.score),
    evidence: stored?.evidenceReference || null,
  };
}

export async function syncLearningPaths(employeeId) {
  const enrollments = await prisma.$queryRawUnsafe(
    `SELECT lpe.enrollment_id AS enrollmentId, lpe.path_id AS pathId,
            lpe.status, lpe.progress_pct AS progressPct,
            lpe.assigned_at AS assignedAt, lpe.due_at AS dueAt,
            lpe.started_at AS startedAt, lpe.completed_at AS completedAt,
            lpe.assigned_by AS assignedBy, lpe.source,
            lpm.path_code AS pathCode, lpm.path_name AS pathName,
            lpm.description, lpm.version_no AS versionNo,
            lpm.mandatory, lpm.status AS pathStatus
       FROM learning_path_enrollment lpe
       INNER JOIN learning_path_master lpm ON lpm.path_id = lpe.path_id
      WHERE lpe.employee_id = ? AND lpm.active = 1
      ORDER BY lpe.assigned_at DESC`,
    String(employeeId),
  );
  if (!enrollments.length) return [];

  const pathIds = enrollments.map(row => row.pathId);
  const placeholders = pathIds.map(() => '?').join(',');
  const steps = await prisma.$queryRawUnsafe(
    `SELECT lps.step_id AS stepId, lps.path_id AS pathId,
            lps.step_order AS stepOrder, lps.step_type AS stepType,
            lps.reference_id AS referenceId, lps.step_title AS stepTitle,
            lps.required, lps.min_score AS minScore, lps.min_level AS minLevel,
            lps.prerequisite_step_id AS prerequisiteStepId, lps.due_days AS dueDays,
            lps.completion_rule_json AS completionRule,
            lpp.status AS storedStatus, lpp.score AS storedScore,
            lpp.evidence_reference AS evidenceReference,
            lpp.started_at AS stepStartedAt, lpp.completed_at AS stepCompletedAt
       FROM learning_path_step lps
       LEFT JOIN learning_path_enrollment lpe
              ON lpe.path_id = lps.path_id AND lpe.employee_id = ?
       LEFT JOIN learning_path_step_progress lpp
              ON lpp.enrollment_id = lpe.enrollment_id AND lpp.step_id = lps.step_id
      WHERE lps.path_id IN (${placeholders})
      ORDER BY lps.path_id, lps.step_order`,
    String(employeeId), ...pathIds,
  );

  const contentIds = [...new Set(steps.filter(s => String(s.stepType).toUpperCase() === 'CONTENT').map(s => s.referenceId))];
  const assessmentIds = [...new Set(steps.filter(s => String(s.stepType).toUpperCase() === 'ASSESSMENT').map(s => s.referenceId))];
  const skillIds = [...new Set(steps.filter(s => String(s.stepType).toUpperCase() === 'SKILL').map(s => s.referenceId))];
  const classroomIds = [...new Set(steps.filter(s => String(s.stepType).toUpperCase() === 'CLASSROOM').map(s => s.referenceId))];

  const [contentRows, assessmentRows, skillRows, classroomRows] = await Promise.all([
    contentIds.length ? prisma.contentProgress.findMany({ where: { employeeId, contentId: { in: contentIds } } }) : [],
    assessmentIds.length ? prisma.assessmentResult.findMany({ where: { employeeId, assessmentId: { in: assessmentIds } } }) : [],
    skillIds.length ? prisma.$queryRawUnsafe(
      `SELECT skill_id AS skillId, current_level AS currentLevel
         FROM employee_skill_profile
        WHERE employee_id = ? AND skill_id IN (${skillIds.map(() => '?').join(',')})`,
      String(employeeId), ...skillIds,
    ) : [],
    classroomIds.length ? prisma.traineeClassroomMap.findMany({
      where: { employeeId, classroomId: { in: classroomIds }, active: true },
      select: { classroomId: true },
    }) : [],
  ]);

  const context = {
    content: new Map(contentRows.map(row => [row.contentId, row])),
    assessments: new Map(assessmentRows.map(row => [row.assessmentId, row])),
    skills: new Map(skillRows.map(row => [row.skillId, row])),
    classrooms: new Set(classroomRows.map(row => row.classroomId)),
    manualProgress: new Map(steps.map(row => [row.stepId, {
      status: row.storedStatus,
      score: row.storedScore,
      evidenceReference: row.evidenceReference,
    }])),
  };

  const stepsByPath = new Map();
  for (const step of steps) {
    if (!stepsByPath.has(step.pathId)) stepsByPath.set(step.pathId, []);
    stepsByPath.get(step.pathId).push(step);
  }

  const output = [];
  for (const enrollment of enrollments) {
    const pathSteps = stepsByPath.get(enrollment.pathId) || [];
    const statusByStep = new Map();
    const enrichedSteps = [];

    for (const step of pathSteps) {
      const prerequisiteComplete = !step.prerequisiteStepId || statusByStep.get(step.prerequisiteStepId) === 'COMPLETED';
      const completion = completionForStep(step, context);
      let status = completion.complete ? 'COMPLETED' : prerequisiteComplete ? 'AVAILABLE' : 'LOCKED';
      if (!completion.complete && prerequisiteComplete && step.storedStatus === 'IN_PROGRESS') status = 'IN_PROGRESS';
      statusByStep.set(step.stepId, status);

      await prisma.$executeRawUnsafe(
        `INSERT INTO learning_path_step_progress
           (id, enrollment_id, step_id, status, score, evidence_reference,
            started_at, completed_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           score = VALUES(score),
           evidence_reference = VALUES(evidence_reference),
           started_at = COALESCE(learning_path_step_progress.started_at, VALUES(started_at)),
           completed_at = CASE
             WHEN VALUES(status) = 'COMPLETED'
               THEN COALESCE(learning_path_step_progress.completed_at, VALUES(completed_at))
             ELSE NULL
           END`,
        String(enrollment.enrollmentId), String(step.stepId), status,
        completion.score || null, completion.evidence,
        status !== 'LOCKED' ? (step.stepStartedAt || new Date()) : null,
        status === 'COMPLETED' ? (step.stepCompletedAt || new Date()) : null,
      );

      enrichedSteps.push({
        ...step,
        status,
        score: completion.score,
        evidenceReference: completion.evidence,
        prerequisiteComplete,
      });
    }

    const requiredSteps = enrichedSteps.filter(step => Boolean(step.required));
    const completedRequired = requiredSteps.filter(step => step.status === 'COMPLETED').length;
    const progressPct = requiredSteps.length ? Math.round((completedRequired / requiredSteps.length) * 10000) / 100 : 100;
    const nextStatus = pathStatus(progressPct, enrollment.dueAt, enrichedSteps.some(step => ['IN_PROGRESS', 'COMPLETED'].includes(step.status)));
    const startedAt = enrollment.startedAt || (nextStatus !== 'NOT_STARTED' ? new Date() : null);
    const completedAt = nextStatus === 'COMPLETED' ? (enrollment.completedAt || new Date()) : null;

    await prisma.$executeRawUnsafe(
      `UPDATE learning_path_enrollment
          SET status = ?, progress_pct = ?, started_at = ?, completed_at = ?
        WHERE enrollment_id = ?`,
      nextStatus, progressPct, startedAt, completedAt, String(enrollment.enrollmentId),
    );

    output.push({ ...enrollment, status: nextStatus, progressPct, startedAt, completedAt, steps: enrichedSteps });
  }

  return output;
}

export async function getTalentSnapshot(employeeId, actor = 'talent-engine') {
  const skillData = await syncEmployeeSkills(employeeId, actor);
  const learningPaths = await syncLearningPaths(employeeId);
  const profiles = skillData.profiles || [];
  const gapCount = profiles.filter(profile => profile.status === 'GAP').length;
  const readyCount = profiles.filter(profile => profile.status === 'READY').length;
  const criticalGaps = (skillData.requirements || []).filter(requirement => {
    if (!requirement.critical) return false;
    const profile = profiles.find(item => item.skillId === requirement.skillId);
    return number(profile?.currentLevel) < number(requirement.requiredLevel);
  }).length;

  return {
    trainee: skillData.trainee,
    summary: {
      totalSkills: profiles.length,
      readyCount,
      gapCount,
      criticalGaps,
      assignedPaths: learningPaths.length,
      completedPaths: learningPaths.filter(path => path.status === 'COMPLETED').length,
      overduePaths: learningPaths.filter(path => path.status === 'OVERDUE').length,
    },
    requirements: skillData.requirements,
    profiles,
    evidence: skillData.evidence,
    learningPaths,
  };
}
