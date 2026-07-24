import { prisma } from '../utils/db.js';
import {
  syncEmployeeSkills as syncEmployeeSkillsBase,
  syncLearningPaths,
} from './talent.js';

async function expireStaleVerifications(employeeId) {
  await prisma.$executeRawUnsafe(
    `UPDATE employee_skill_profile
        SET current_level = 0,
            confidence_score = 0,
            status = CASE WHEN target_level > 0 THEN 'GAP' ELSE 'UNASSESSED' END,
            source = 'LMS_EVIDENCE',
            verified_by = NULL,
            verified_at = NULL,
            expires_at = NULL
      WHERE employee_id = ?
        AND verified_by IS NOT NULL
        AND expires_at IS NOT NULL
        AND expires_at <= UTC_TIMESTAMP(3)`,
    String(employeeId),
  );

  await prisma.$executeRawUnsafe(
    `UPDATE skill_evidence
        SET evidence_status = 'EXPIRED'
      WHERE employee_id = ?
        AND evidence_type = 'MANUAL_VERIFICATION'
        AND evidence_status = 'VALID'
        AND expires_at IS NOT NULL
        AND expires_at <= UTC_TIMESTAMP(3)`,
    String(employeeId),
  );
}

export async function syncEmployeeSkills(employeeId, actor = 'talent-engine') {
  await expireStaleVerifications(employeeId);
  return syncEmployeeSkillsBase(employeeId, actor);
}

export { syncLearningPaths };

export async function getTalentSnapshot(employeeId, actor = 'talent-engine') {
  const skillData = await syncEmployeeSkills(employeeId, actor);
  const learningPaths = await syncLearningPaths(employeeId);
  const profiles = skillData.profiles || [];
  const gapCount = profiles.filter(profile => profile.status === 'GAP').length;
  const readyCount = profiles.filter(profile => profile.status === 'READY').length;
  const criticalGaps = (skillData.requirements || []).filter(requirement => {
    if (!requirement.critical) return false;
    const profile = profiles.find(item => item.skillId === requirement.skillId);
    return Number(profile?.currentLevel || 0) < Number(requirement.requiredLevel || 0);
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
