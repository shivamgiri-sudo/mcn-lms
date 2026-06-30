// backend/src/utils/empIdMapping.js
import { prisma } from './db.js';
import { audit } from './audit.js';

async function nextTempId(tx) {
  const counter = await tx.sequenceCounter.update({
    where: { key: 'EMP_TEMP' },
    data: { value: { increment: 1 } },
  });
  return `EMP${String(counter.value).padStart(4, '0')}`;
}

export async function generateTempEmpId() {
  for (let attempt = 0; attempt < 5; attempt++) {
    let empId;
    await prisma.$transaction(async (tx) => {
      empId = await nextTempId(tx);
      const exists = await tx.traineeMaster.findUnique({ where: { employeeId: empId } });
      if (exists) {
        empId = null;
      }
    });
    if (empId) return empId;
  }
  throw new Error('Failed to generate unique temp employee ID after 5 attempts');
}

export async function mapEmployeeId({ mobile, permanentEmpId, triggeredBy, triggeredByRole }) {
  const cleanMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : null;
  if (!cleanMobile) return { ok: false, error: 'INVALID_MOBILE' };
  if (!permanentEmpId || !permanentEmpId.trim()) return { ok: false, error: 'INVALID_PERMANENT_ID' };

  const normPerm = permanentEmpId.trim().toUpperCase();

  const trainee = await prisma.traineeMaster.findFirst({ where: { mobile: cleanMobile } });
  if (!trainee) return { ok: false, error: 'MOBILE_NOT_FOUND' };
  if (trainee.empIdType === 'PERMANENT') return { ok: false, error: 'ALREADY_MAPPED' };

  const conflict = await prisma.traineeMaster.findFirst({
    where: { OR: [{ employeeId: normPerm }, { permanentEmpId: normPerm }] },
  });
  if (conflict) return { ok: false, error: 'PERMANENT_ID_CONFLICT' };

  const oldEmpId = trainee.employeeId;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userMaster.update({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.contentProgress.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.videoWatchLog.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.assessmentAttempt.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.assessmentResult.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.traineeQueryLog.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.trainingRiskLog.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.pendingActivityLog.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.onboardingLog.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.certificationEvidence.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.assignedModule.updateMany({ where: { assignedTo: oldEmpId, assignedToType: 'individual' }, data: { assignedTo: normPerm } });
      await tx.attendanceInference.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });
      await tx.loginSessionLog.updateMany({ where: { userId: oldEmpId }, data: { userId: normPerm } });
      await tx.traineeClassroomMap.updateMany({ where: { employeeId: oldEmpId }, data: { employeeId: normPerm } });

      await tx.traineeMaster.update({
        where: { employeeId: oldEmpId },
        data: {
          employeeId: normPerm,
          empIdType: 'PERMANENT',
          permanentEmpId: normPerm,
          empIdMappedAt: new Date(),
        },
      });
    });

    await audit({
      userIdentity: triggeredBy,
      userRole: triggeredByRole,
      action: 'EMP_ID_MAPPED',
      module: 'Trainee',
      referenceId: normPerm,
      oldValue: { employeeId: oldEmpId },
      newValue: { employeeId: normPerm, mappedAt: new Date().toISOString() },
    });

    return { ok: true, oldEmpId, newEmpId: normPerm, traineeId: trainee.id };
  } catch (err) {
    console.error('mapEmployeeId transaction failed:', err);
    return { ok: false, error: 'TRANSACTION_FAILED', detail: err.message };
  }
}
