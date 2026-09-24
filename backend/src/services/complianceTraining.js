import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { getIndependentModuleById } from './independentModules.js';

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

// Empty/null eligibility list means "no restriction on this dimension" --
// per the feature spec, auto-assignment applies regardless of process/LOB
// unless an admin has explicitly configured a rule.
function matchesEligibility(value, csvList) {
  const allowed = String(csvList || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.length) return true;
  return allowed.includes(clean(value) || '');
}

export async function getComplianceTrainingSettings() {
  return prisma.complianceTrainingSettings.findUnique({ where: { id: 'default' } });
}

async function logDecision(entry) {
  // The audit trail is diagnostic, not authoritative -- a logging failure
  // must never block or roll back the actual assignment decision above it.
  await prisma.complianceAssignmentLog.create({ data: entry }).catch(err => {
    console.error('[ComplianceTraining] failed to write assignment log:', err.message);
  });
}

// Auto-assigns the configured Compliance Training module + assessment to a
// single trainee, exactly once. There is no single transactional choke point
// across the trainee-creation code paths (HRMS sync, admin LMS-user
// creation, admin bulk-add, bulk import, coordinator onboarding each run
// their own separate prisma.$transaction), so every one of those call sites
// invokes this the same way independentModules.js's
// autoAssignModulesForNewUser already is -- awaited, after the creation
// transaction commits, using the top-level prisma client rather than a tx
// handle.
//
// Deliberately NOT called for reactivation or batch-transfer of an existing
// trainee, and never for bulk-importing/onboarding someone who already has a
// row -- only a genuinely brand-new trainee should receive a fresh mandatory
// assignment. (Existing trainees are only ever backfilled via the explicit
// admin "bulk assign" action below.)
export async function autoAssignComplianceTraining({
  employeeId, traineeName = null, batchNo = null, branch = null, process = null, lob = null,
  assignedBy = null, triggerSource,
}) {
  const settings = await getComplianceTrainingSettings();
  const base = { employeeId, traineeName, batchNo, branch, process, lob, triggerSource };

  if (!settings?.enabled || !settings.moduleId) {
    await logDecision({ ...base, moduleId: settings?.moduleId || null, assessmentId: settings?.assessmentId || null, status: 'NotConfigured', reason: 'Compliance training auto-assignment is not enabled/configured.' });
    return { assigned: false, reason: 'Not configured' };
  }

  if (!matchesEligibility(process, settings.eligibleProcesses)
    || !matchesEligibility(lob, settings.eligibleLobs)
    || !matchesEligibility(branch, settings.eligibleBranches)) {
    await logDecision({ ...base, moduleId: settings.moduleId, assessmentId: settings.assessmentId, status: 'NotEligible', reason: 'Trainee does not match the configured eligibility rule (process/LOB/branch).' });
    return { assigned: false, reason: 'Not eligible' };
  }

  const existing = await prisma.assignedModule.findFirst({
    where: { moduleId: settings.moduleId, assignedTo: employeeId, assignedToType: 'individual', active: true },
  });
  if (existing) {
    await logDecision({ ...base, moduleId: settings.moduleId, assessmentId: settings.assessmentId, status: 'AlreadyAssigned', reason: 'Trainee already has an active assignment for the configured compliance module.' });
    return { assigned: false, reason: 'Already assigned' };
  }

  const module = await getIndependentModuleById(settings.moduleId);
  if (!module) {
    await logDecision({ ...base, moduleId: settings.moduleId, assessmentId: settings.assessmentId, status: 'NotConfigured', reason: 'Configured compliance module no longer exists or is inactive.' });
    return { assigned: false, reason: 'Module not found' };
  }

  const dueDate = settings.dueDays > 0 ? new Date(Date.now() + settings.dueDays * 24 * 60 * 60 * 1000) : null;
  const assignment = await prisma.assignedModule.create({
    data: {
      moduleId: settings.moduleId,
      moduleName: module.module_name,
      broadcastTitle: module.module_name,
      assignedTo: employeeId,
      assignedToType: 'individual',
      assignmentType: settings.assignmentType || 'Mandatory',
      message: 'Mandatory Compliance Training — assigned automatically at onboarding.',
      assignedBy,
      dueDate,
      active: true,
      assessmentId: settings.assessmentId || null,
    },
  });

  await logDecision({ ...base, moduleId: settings.moduleId, assessmentId: settings.assessmentId, status: 'Assigned', reason: null });
  await audit({
    userIdentity: assignedBy || 'system',
    userRole: assignedBy ? 'Admin' : 'system',
    action: 'AUTO_ASSIGN_COMPLIANCE_TRAINING',
    module: 'ComplianceTraining',
    referenceId: employeeId,
    newValue: { moduleId: settings.moduleId, assessmentId: settings.assessmentId, assignmentId: assignment.id, triggerSource },
  });

  return { assigned: true, assignmentId: assignment.id, moduleId: settings.moduleId, assessmentId: settings.assessmentId };
}

// Admin-triggered bulk assignment for EXISTING trainees. The auto-trigger
// deliberately never fires for anyone but a brand-new trainee, so this is
// the only way to backfill compliance training onto people who already
// existed when the feature was configured/enabled. Reuses the same
// eligibility + de-dupe logic as the auto-trigger so the two paths can never
// disagree about who qualifies.
export async function bulkAssignComplianceTraining({ assignedBy = null, processFilter = null, lobFilter = null, branchFilter = null } = {}) {
  const where = { status: { not: 'Deleted' } };
  if (processFilter) where.process = processFilter;
  if (lobFilter) where.lob = lobFilter;
  if (branchFilter) where.branch = branchFilter;

  const trainees = await prisma.traineeMaster.findMany({
    where,
    select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, lob: true },
  });

  let assigned = 0;
  const skippedByReason = {};
  for (const t of trainees) {
    const result = await autoAssignComplianceTraining({
      employeeId: t.employeeId, traineeName: t.traineeName, batchNo: t.batchNo,
      branch: t.branch, process: t.process, lob: t.lob,
      assignedBy, triggerSource: 'AdminBulkAssign',
    });
    if (result.assigned) assigned++;
    else skippedByReason[result.reason] = (skippedByReason[result.reason] || 0) + 1;
  }
  return { total: trainees.length, assigned, skippedByReason };
}
