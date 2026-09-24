import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { getIndependentModuleById } from '../services/independentModules.js';
import { bulkAssignComplianceTraining } from '../services/complianceTraining.js';

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export async function getSettings(req, res) {
  try {
    const settings = await prisma.complianceTrainingSettings.findUnique({ where: { id: 'default' } });
    res.json({ ok: true, data: settings });
  } catch (err) {
    console.error('[complianceTraining] get settings failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateSettings(req, res) {
  try {
    const b = req.body || {};
    const data = {};
    if (b.enabled !== undefined) data.enabled = !!b.enabled;

    if (b.moduleId !== undefined) {
      const moduleId = clean(b.moduleId);
      if (moduleId) {
        const module = await getIndependentModuleById(moduleId);
        if (!module) return res.status(400).json({ ok: false, message: 'Selected compliance module was not found or is inactive.' });
        data.moduleId = moduleId;
        data.moduleName = module.module_name;
      } else {
        data.moduleId = null;
        data.moduleName = null;
      }
    }

    if (b.assessmentId !== undefined) {
      const assessmentId = clean(b.assessmentId);
      if (assessmentId) {
        const assessment = await prisma.assessmentMaster.findUnique({ where: { assessmentId } });
        if (!assessment) return res.status(400).json({ ok: false, message: 'Selected compliance assessment was not found.' });
        data.assessmentId = assessmentId;
        data.assessmentName = assessment.assessmentName;
      } else {
        data.assessmentId = null;
        data.assessmentName = null;
      }
    }

    if (b.assignmentType !== undefined) data.assignmentType = clean(b.assignmentType) || 'Mandatory';
    if (b.dueDays !== undefined) data.dueDays = Math.max(0, Math.round(Number(b.dueDays) || 0));
    if (b.eligibleProcesses !== undefined) data.eligibleProcesses = clean(b.eligibleProcesses);
    if (b.eligibleLobs !== undefined) data.eligibleLobs = clean(b.eligibleLobs);
    if (b.eligibleBranches !== undefined) data.eligibleBranches = clean(b.eligibleBranches);
    data.updatedBy = req.userId;

    const row = await prisma.complianceTrainingSettings.upsert({
      where: { id: 'default' }, create: { id: 'default', ...data }, update: data,
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_COMPLIANCE_TRAINING_SETTINGS', module: 'ComplianceTraining', referenceId: 'default', newValue: data });
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[complianceTraining] update settings failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Backfill for trainees who already existed when compliance training was
// configured/enabled -- the auto-trigger deliberately never runs for anyone
// but a brand-new trainee (see services/complianceTraining.js), so this is
// the only way those trainees ever get the mandatory assignment.
export async function triggerBulkAssign(req, res) {
  try {
    const settings = await prisma.complianceTrainingSettings.findUnique({ where: { id: 'default' } });
    if (!settings?.enabled || !settings.moduleId) {
      return res.status(400).json({ ok: false, message: 'Configure and enable Compliance Training before running a bulk assignment.' });
    }
    const result = await bulkAssignComplianceTraining({
      assignedBy: req.userId,
      processFilter: clean(req.body?.process),
      lobFilter: clean(req.body?.lob),
      branchFilter: clean(req.body?.branch),
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'BULK_ASSIGN_COMPLIANCE_TRAINING', module: 'ComplianceTraining', referenceId: 'default', newValue: result });
    res.json({ ok: true, data: result, message: `${result.assigned} of ${result.total} trainee(s) newly assigned.` });
  } catch (err) {
    console.error('[complianceTraining] bulk assign failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
