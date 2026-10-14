import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { ensureIndependentWrapperForAssessment } from './independentModules.js';

// The existing, already-configured assessment this whole feature assigns --
// looked up by name (never created/duplicated/modified) so the automation
// keeps working even if its assessmentId differs across environments.
const ASSESSMENT_NAME = 'ISMS Test - Quarterly';
const EXCLUDED_DESIGNATIONS = ['CEO', 'Chairman', 'COO'];

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// April-March financial year. Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar
// (Jan-Mar belongs to the financial year that started the PREVIOUS April).
// Computed against IST (same idiom as istDayBounds/nowIST elsewhere) rather
// than the server's local clock, so a quarter boundary lands on the correct
// calendar day regardless of what timezone the server itself runs in.
export function getFinancialQuarter(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-11
  let quarter, fyStartYear;
  if (m >= 3 && m <= 5) { quarter = 1; fyStartYear = y; }
  else if (m >= 6 && m <= 8) { quarter = 2; fyStartYear = y; }
  else if (m >= 9 && m <= 11) { quarter = 3; fyStartYear = y; }
  else { quarter = 4; fyStartYear = m <= 2 ? y - 1 : y; }
  const fyLabel = `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
  return { quarter, fyStartYear, fyLabel, key: `Q${quarter} ${fyLabel}` };
}

function isExcludedDesignation(designation) {
  const d = clean(designation);
  if (!d) return false;
  return EXCLUDED_DESIGNATIONS.some(excluded => excluded.toLowerCase() === d.toLowerCase());
}

async function getAssessment() {
  return prisma.assessmentMaster.findFirst({ where: { assessmentName: ASSESSMENT_NAME } });
}

async function getDepartmentForDesignation(designation) {
  const d = clean(designation);
  if (!d) return null;
  const row = await prisma.designationMaster.findFirst({ where: { title: d } });
  return row?.department || null;
}

// Mirrors resolveBroadcastTarget's own logic in controllers/admin.js: if the
// assessment already belongs to a real classroom module, assign THAT module
// (it carries real content); otherwise get-or-create the thin wrapper module
// that lets a standalone assessment still ride on assigned_modules.moduleId
// (NOT NULL). Never creates or touches the assessment itself.
async function resolveAssignmentTarget(assessment, createdBy) {
  if (assessment.moduleId) {
    const mod = await prisma.moduleMaster.findUnique({ where: { moduleId: assessment.moduleId } });
    if (mod) return { moduleId: mod.moduleId, moduleName: mod.moduleTitle };
  }
  const wrapperModuleId = await ensureIndependentWrapperForAssessment({
    assessmentId: assessment.assessmentId, assessmentName: assessment.assessmentName, createdBy,
  });
  return { moduleId: wrapperModuleId, moduleName: assessment.assessmentName };
}

// Assigns the current (or given) quarter's ISMS Test - Quarterly to a single
// employee, exactly once per quarter. Safe to call repeatedly, including for
// a past quarter -- de-dupes on the isms_quarterly_assignment unique
// constraint (employeeId, quarterKey), so a new quarter always gets its own
// fresh record without touching or hiding any previous quarter's row.
export async function assignIsmsQuarterlyToEmployee({
  employeeId, traineeName = null, designation = null, status = 'Active',
  assignedBy = null, triggerSource, quarter = null,
}) {
  if (status && status !== 'Active') return { assigned: false, reason: 'NotActive' };
  if (isExcludedDesignation(designation)) return { assigned: false, reason: 'ExcludedDesignation' };

  const assessment = await getAssessment();
  if (!assessment) return { assigned: false, reason: 'AssessmentNotFound' };

  const q = quarter || getFinancialQuarter();

  const existing = await prisma.ismsQuarterlyAssignment.findUnique({
    where: { employeeId_quarterKey: { employeeId, quarterKey: q.key } },
  });
  if (existing) return { assigned: false, reason: 'AlreadyAssignedThisQuarter' };

  const { moduleId, moduleName } = await resolveAssignmentTarget(assessment, assignedBy);
  const broadcastTitle = `${ASSESSMENT_NAME} | ${q.key}`;

  const assignment = await prisma.assignedModule.create({
    data: {
      moduleId, moduleName, broadcastTitle,
      assignedTo: employeeId, assignedToType: 'individual',
      assignmentType: 'Mandatory',
      message: `${ASSESSMENT_NAME} for ${q.key} — assigned automatically.`,
      assignedBy, active: true,
      assessmentId: assessment.assessmentId,
    },
  });

  // One live ISMS assignment per employee: retire the earlier quarters' assigned_modules
  // rows (kept, just inactive) so the learner sees only this quarter's. The ledger and
  // every attempt record stay as they are.
  if (q.key === getFinancialQuarter().key) await prisma.assignedModule.updateMany({
    where: {
      assignedTo: employeeId, assignedToType: 'individual', assessmentId: assessment.assessmentId,
      active: true, id: { not: assignment.id }, broadcastTitle: { startsWith: `${ASSESSMENT_NAME} | ` },
    },
    data: { active: false },
  });

  const department = await getDepartmentForDesignation(designation);
  await prisma.ismsQuarterlyAssignment.create({
    data: {
      employeeId, traineeName, designation: clean(designation), department,
      fyLabel: q.fyLabel, quarter: q.quarter, quarterKey: q.key,
      assessmentId: assessment.assessmentId, moduleId,
      assignedModuleId: assignment.id, assignedBy, triggerSource,
    },
  });

  await audit({
    userIdentity: assignedBy || 'system', userRole: assignedBy ? 'Admin' : 'system',
    action: 'AUTO_ASSIGN_ISMS_QUARTERLY', module: 'IsmsQuarterly', referenceId: employeeId,
    newValue: { quarter: q.key, assessmentId: assessment.assessmentId, assignmentId: assignment.id, triggerSource },
  });

  return { assigned: true, assignmentId: assignment.id, quarter: q.key };
}

// Runs the quarterly bulk assignment for every active, eligible employee.
// Called by the scheduler at the start of each quarter (and available for a
// manual admin re-run) -- safe to re-run because the per-employee de-dupe
// above prevents duplicates for the same quarter.
export async function runQuarterlyAssignment({ assignedBy = null, triggerSource = 'QuarterlyScheduler', quarter = null } = {}) {
  const q = quarter || getFinancialQuarter();
  const employees = await prisma.traineeMaster.findMany({
    where: { status: 'Active' },
    select: { employeeId: true, traineeName: true, designation: true },
  });

  let assigned = 0;
  const skippedByReason = {};
  for (const emp of employees) {
    const result = await assignIsmsQuarterlyToEmployee({
      employeeId: emp.employeeId, traineeName: emp.traineeName, designation: emp.designation,
      status: 'Active', assignedBy, triggerSource, quarter: q,
    });
    if (result.assigned) assigned++;
    else skippedByReason[result.reason] = (skippedByReason[result.reason] || 0) + 1;
  }
  return { quarter: q.key, total: employees.length, assigned, skippedByReason };
}

// Reporting: because the same assessmentId is reused unchanged every
// quarter, assessment_results (one running best-ever row per employee+
// assessment) cannot tell "this employee's Q1 result" apart from their Q2
// result on that identical assessment. This correlates each ledger row
// (a fixed, known assignment window: from its assignedAt to the NEXT
// quarter's assignedAt for that employee, or open-ended for the current
// quarter) against the employee's real, submitted AssessmentAttempt rows that
// fall inside that window. Nothing here reads or alters assessment_results, so
// every quarter stays separately reportable.
//
// completionStatus: 'Completed' = passed in that quarter; 'Attempted' = submitted
// but not (yet) passed; 'Not Attempted' = nothing submitted in that quarter.
export const ISMS_COMPLETION_STATUSES = ['Completed', 'Attempted', 'Not Attempted'];

export async function getIsmsQuarterlyReport({
  quarterKey = null, fyLabel = null, quarter = null, employeeId = null,
  status = null, minScore = null, maxScore = null,
} = {}) {
  const where = {};
  if (quarterKey) where.quarterKey = quarterKey;
  if (fyLabel) where.fyLabel = fyLabel;
  if (quarter) where.quarter = Number(quarter);
  if (employeeId) where.employeeId = employeeId;

  // The window for a row ends at the employee's NEXT assignment, which may fall outside
  // the filter (e.g. filtering to Q2 still needs Q3's start), so windows are built from
  // every ledger row of the matching employees, then filtered afterwards.
  const matched = await prisma.ismsQuarterlyAssignment.findMany({ where, select: { id: true, employeeId: true } });
  if (!matched.length) return [];
  const employeeIds = [...new Set(matched.map(r => r.employeeId))];
  const ledgerRows = await prisma.ismsQuarterlyAssignment.findMany({
    where: { employeeId: { in: employeeIds } }, orderBy: [{ employeeId: 'asc' }, { assignedAt: 'asc' }],
  });
  const assessmentIds = [...new Set(ledgerRows.map(r => r.assessmentId))];
  const attempts = await prisma.assessmentAttempt.findMany({
    where: {
      employeeId: { in: employeeIds }, assessmentId: { in: assessmentIds },
      submittedAt: { not: null }, result: { in: ['Pass', 'Fail'] },
    },
    orderBy: [{ startedAt: 'asc' }],
  });

  const key = row => `${row.employeeId}|${row.assessmentId}`;
  const ledgerByKey = new Map();
  for (const row of ledgerRows) {
    if (!ledgerByKey.has(key(row))) ledgerByKey.set(key(row), []);
    ledgerByKey.get(key(row)).push(row);
  }
  const attemptsByKey = new Map();
  for (const a of attempts) {
    if (!attemptsByKey.has(key(a))) attemptsByKey.set(key(a), []);
    attemptsByKey.get(key(a)).push(a);
  }

  const wanted = new Set(matched.map(r => r.id));
  const results = [];
  for (const [k, rows] of ledgerByKey.entries()) {
    const sorted = [...rows].sort((a, b) => a.assignedAt - b.assignedAt);
    const allAttempts = attemptsByKey.get(k) || [];
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      if (!wanted.has(row.id)) continue;
      const windowStart = row.assignedAt;
      const windowEnd = sorted[i + 1]?.assignedAt || null; // null = open-ended (their current quarter)
      const windowAttempts = allAttempts.filter(a => a.startedAt >= windowStart && (!windowEnd || a.startedAt < windowEnd));

      let completionStatus = 'Not Attempted', score = null, passFail = null, attemptDate = null;
      if (windowAttempts.length) {
        const best = windowAttempts.reduce((b, a) => (!b || a.percentage > b.percentage ? a : b), null);
        const passed = windowAttempts.find(a => a.result === 'Pass');
        completionStatus = passed ? 'Completed' : 'Attempted';
        score = Math.round(best.percentage || 0);
        passFail = passed ? 'Pass' : 'Fail';
        const dated = passed || windowAttempts[windowAttempts.length - 1];
        attemptDate = dated.submittedAt || dated.startedAt;
      }

      results.push({
        employeeId: row.employeeId, traineeName: row.traineeName,
        designation: row.designation, department: row.department,
        fyLabel: row.fyLabel, quarter: row.quarter, quarterKey: row.quarterKey,
        assignmentDate: row.assignedAt, attempts: windowAttempts.length,
        completionStatus, score, passFail, attemptDate,
      });
    }
  }

  const min = minScore === null || minScore === '' ? null : Number(minScore);
  const max = maxScore === null || maxScore === '' ? null : Number(maxScore);
  return results.filter(r => {
    if (status && r.completionStatus !== status) return false;
    // A score range only makes sense for rows that have a score.
    if (min !== null && Number.isFinite(min) && (r.score === null || r.score < min)) return false;
    if (max !== null && Number.isFinite(max) && (r.score === null || r.score > max)) return false;
    return true;
  }).sort((a, b) => a.fyLabel.localeCompare(b.fyLabel) || a.quarter - b.quarter || String(a.traineeName || '').localeCompare(String(b.traineeName || '')));
}

export { EXCLUDED_DESIGNATIONS, ASSESSMENT_NAME };
