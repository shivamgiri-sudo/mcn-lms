import { prisma } from '../utils/db.js';
import {
  getDevelopmentSnapshot as getDevelopmentSnapshotBase,
  issueRenewedCertification as issueRenewedCertificationBase,
  syncCertificationLifecycleForEmployee as syncCertificationLifecycleBase,
  syncCoachingPlan,
} from './developmentLifecycle.js';

async function latestCredential(employeeId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT certification_id AS certificationId, status,
            expires_at AS expiresAt, version_no AS versionNo
       FROM employee_certification
      WHERE employee_id = ?
      ORDER BY version_no DESC LIMIT 1`,
    String(employeeId),
  );
  return rows[0] || null;
}

async function alignTraineeStatus(employeeId, credential) {
  if (!credential) return;
  const certificationStatus = ['ACTIVE', 'EXPIRING'].includes(credential.status)
    ? 'Certified'
    : credential.status === 'EXPIRED'
      ? 'Expired'
      : credential.status === 'REVOKED'
        ? 'Revoked'
        : null;
  if (!certificationStatus) return;
  await prisma.traineeMaster.updateMany({
    where: { employeeId },
    data: { certificationStatus },
  });
}

export async function syncCertificationLifecycleForEmployee(employeeId, actor = 'certification-engine') {
  const result = await syncCertificationLifecycleBase(employeeId, actor);
  const latest = await latestCredential(employeeId);
  await alignTraineeStatus(employeeId, latest);
  return result;
}

export async function issueRenewedCertification(caseId, actor, options = {}) {
  const renewed = await issueRenewedCertificationBase(caseId, actor, options);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT employee_id AS employeeId
       FROM employee_certification
      WHERE certification_id = ? LIMIT 1`,
    String(renewed.certificationId),
  );
  if (rows[0]?.employeeId) {
    await prisma.traineeMaster.updateMany({
      where: { employeeId: rows[0].employeeId },
      data: { certificationStatus: 'Certified' },
    });
  }
  return renewed;
}

export async function getDevelopmentSnapshot(employeeId, actor = 'development-engine') {
  await syncCertificationLifecycleForEmployee(employeeId, actor);
  return getDevelopmentSnapshotBase(employeeId, actor);
}

export { syncCoachingPlan };
