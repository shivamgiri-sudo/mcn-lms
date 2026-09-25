import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import {
  getFinancialQuarter, getIsmsQuarterlyReport, runQuarterlyAssignment,
} from '../services/ismsQuarterlyAssessment.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function toIST(v) { return new Date(new Date(v).getTime() + IST_OFFSET_MS); }
function fmtDt(v) { if (!v) return ''; return toIST(v).toISOString().replace('T', ' ').slice(0, 19); }
function fmtDate(v) { if (!v) return ''; return toIST(v).toISOString().slice(0, 10); }
function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
function csvRes(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

export async function exportIsmsQuarterlyReport(req, res) {
  try {
    const rows = await getIsmsQuarterlyReport({
      quarterKey: req.query?.quarterKey || null,
      employeeId: req.query?.employeeId || null,
    });
    const headers = [
      'Employee Name', 'Employee ID', 'Designation', 'Department',
      'Financial Year', 'Quarter', 'Assignment Date',
      'Completion Status', 'Score', 'Pass/Fail', 'Attempt Date',
    ];
    const csvRows = rows.map(r => [
      r.traineeName, r.employeeId, r.designation, r.department,
      r.fyLabel, `Q${r.quarter}`, fmtDt(r.assignmentDate),
      r.completionStatus, r.score ?? '', r.passFail || '', fmtDt(r.attemptDate),
    ]);
    csvRes(res, `isms-quarterly-${req.query?.quarterKey || 'all'}-${fmtDate(new Date())}.csv`, headers, csvRows);
  } catch (err) {
    console.error('[ismsQuarterly] export failed:', err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

export async function getIsmsQuarterlyStatus(req, res) {
  try {
    const currentQuarter = getFinancialQuarter();
    const [runLog, assignedThisQuarter] = await Promise.all([
      prisma.ismsQuarterlyRunLog.findUnique({ where: { quarterKey: currentQuarter.key } }),
      prisma.ismsQuarterlyAssignment.count({ where: { quarterKey: currentQuarter.key } }),
    ]);
    const recentRuns = await prisma.ismsQuarterlyRunLog.findMany({ orderBy: { runAt: 'desc' }, take: 8 });
    res.json({ ok: true, data: { currentQuarter: currentQuarter.key, runLog, assignedThisQuarter, recentRuns } });
  } catch (err) {
    console.error('[ismsQuarterly] status failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// Not required for the automation to function (the scheduler runs this
// itself at the start of every quarter, with no admin action needed) --
// exposed purely as a recovery/verification tool, e.g. if a deploy missed
// the scheduler's boot-time check for some reason.
export async function triggerIsmsQuarterlyRun(req, res) {
  try {
    const quarter = getFinancialQuarter();
    const result = await runQuarterlyAssignment({ assignedBy: req.userId, triggerSource: 'ManualBulkRun', quarter });
    await prisma.ismsQuarterlyRunLog.upsert({
      where: { quarterKey: quarter.key },
      create: { quarterKey: quarter.key, triggerType: 'Manual', totalEmployees: result.total, assignedCount: result.assigned, skippedSummary: result.skippedByReason, triggeredBy: req.userId },
      update: { totalEmployees: result.total, assignedCount: result.assigned, skippedSummary: result.skippedByReason, triggeredBy: req.userId },
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'MANUAL_RUN_ISMS_QUARTERLY', module: 'IsmsQuarterly', referenceId: quarter.key, newValue: result });
    res.json({ ok: true, data: result, message: `${result.assigned} of ${result.total} employee(s) newly assigned for ${quarter.key}.` });
  } catch (err) {
    console.error('[ismsQuarterly] manual trigger failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
