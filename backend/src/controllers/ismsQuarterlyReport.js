import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { xlsxRes } from '../utils/xlsx.js';
import {
  getFinancialQuarter, getIsmsQuarterlyReport, runQuarterlyAssignment, reassignCurrentQuarter, ISMS_COMPLETION_STATUSES,
} from '../services/ismsQuarterlyAssessment.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const PREVIEW_LIMIT = 5000;
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

// Filters: fy ("FY 2026-27"), quarter (1-4), quarterKey, employeeId, status
// (Completed | Attempted | Not Attempted), minScore / maxScore (0-100).
// format: json (preview table) | xlsx | csv (default, unchanged for existing callers).
export async function exportIsmsQuarterlyReport(req, res) {
  try {
    const q = req.query || {};
    const quarter = q.quarter ? Number(q.quarter) : null;
    if (quarter !== null && ![1, 2, 3, 4].includes(quarter)) return res.status(400).json({ ok: false, message: 'Quarter must be 1, 2, 3 or 4.' });
    const status = q.status ? String(q.status) : null;
    if (status && !ISMS_COMPLETION_STATUSES.includes(status)) return res.status(400).json({ ok: false, message: 'Invalid completion status.' });
    for (const k of ['minScore', 'maxScore']) {
      if (q[k] !== undefined && q[k] !== '' && !Number.isFinite(Number(q[k]))) return res.status(400).json({ ok: false, message: `${k} must be a number.` });
    }

    const rows = await getIsmsQuarterlyReport({
      quarterKey: q.quarterKey || null,
      fyLabel: q.fy ? String(q.fy) : null,
      quarter,
      employeeId: q.employeeId ? String(q.employeeId).trim() : null,
      status,
      minScore: q.minScore ?? null,
      maxScore: q.maxScore ?? null,
    });
    const headers = [
      'Employee Name', 'Employee ID', 'Designation', 'Department',
      'Financial Year', 'Quarter', 'Assignment Date',
      'Completion Status', 'Attempts', 'Score', 'Pass/Fail', 'Attempt Date',
    ];
    const tableRows = rows.map(r => [
      r.traineeName || '', r.employeeId, r.designation || '', r.department || '',
      r.fyLabel, `Q${r.quarter}`, fmtDt(r.assignmentDate),
      r.completionStatus, r.attempts, r.score ?? '', r.passFail || '', fmtDt(r.attemptDate),
    ]);
    const label = [q.fy, quarter ? `Q${quarter}` : null].filter(Boolean).join('-').replace(/\s+/g, '') || 'all';
    const format = String(q.format || 'csv').toLowerCase();
    if (format === 'json') {
      return res.json({ ok: true, data: { headers, rows: tableRows.slice(0, PREVIEW_LIMIT), total: tableRows.length, truncated: tableRows.length > PREVIEW_LIMIT } });
    }
    if (format === 'xlsx') return xlsxRes(res, `isms-quarterly-${label}-${fmtDate(new Date())}.xlsx`, 'ISMS Quarterly', headers, tableRows);
    return csvRes(res, `isms-quarterly-${q.quarterKey || label}-${fmtDate(new Date())}.csv`, headers, tableRows);
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

// Restarts the current quarter for every eligible employee so they can attempt it
// afresh (see reassignCurrentQuarter). Super admin only, like run-now.
export async function reassignIsmsQuarterly(req, res) {
  try {
    const result = await reassignCurrentQuarter({ assignedBy: req.userId });
    if (result.error) return res.status(409).json({ ok: false, message: 'The ISMS Test - Quarterly assessment was not found.' });
    return res.json({
      ok: true, data: result,
      message: `${result.quarter}: ${result.restarted} employee(s) restarted for a fresh attempt, ${result.newlyAssigned} newly assigned.`,
    });
  } catch (err) {
    console.error('[ismsQuarterly] reassign failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
