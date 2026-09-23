import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { previewDailyBatchReport, sendDailyBatchReport } from '../services/dailyBatchReport.js';

function branchScope(req) {
  return req.userBranch ? { branch: req.userBranch } : {};
}

// ─── Activity configuration (per process/LOB) ──────────────────────────────────

export async function listActivityConfigs(req, res) {
  try {
    const rows = await prisma.dailyBatchActivityConfig.findMany({ orderBy: [{ process: 'asc' }, { lob: 'asc' }] });
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[dailyBatchReport] list activity configs failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function saveActivityConfig(req, res) {
  try {
    const { process, lob, ...flags } = req.body;
    if (!process || !lob) return res.status(400).json({ ok: false, message: 'Process and LOB are required.' });
    const data = {
      typingTest: !!flags.typingTest, classroomCurriculum: !!flags.classroomCurriculum, videoCourse: !!flags.videoCourse,
      assessment: !!flags.assessment, learningNugget: !!flags.learningNugget, pkt: !!flags.pkt,
      calibration: !!flags.calibration, certification: !!flags.certification, eLearning: !!flags.eLearning,
      updatedBy: req.userId,
    };
    const row = await prisma.dailyBatchActivityConfig.upsert({
      where: { process_lob: { process, lob } },
      create: { process, lob, ...data },
      update: data,
    });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'SAVE_DAILY_REPORT_ACTIVITY_CONFIG', module: 'DailyBatchReport', referenceId: `${process}/${lob}`, newValue: data });
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[dailyBatchReport] save activity config failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ─── Settings (singleton) ───────────────────────────────────────────────────────

export async function getReportSettings(req, res) {
  try {
    const settings = await prisma.dailyBatchReportSettings.findUnique({ where: { id: 'default' } });
    res.json({ ok: true, data: settings });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function updateReportSettings(req, res) {
  try {
    const b = req.body || {};
    const data = {};
    if (b.enabled !== undefined) data.enabled = !!b.enabled;
    if (b.sendTime !== undefined && /^\d{2}:\d{2}$/.test(b.sendTime)) data.sendTime = b.sendTime;
    if (b.typingWpmTarget !== undefined) data.typingWpmTarget = Math.max(0, Math.round(Number(b.typingWpmTarget) || 0));
    if (b.typingAccuracyTarget !== undefined) data.typingAccuracyTarget = Math.max(0, Math.min(100, Number(b.typingAccuracyTarget) || 0));
    if (b.tniMinTraineeCount !== undefined) data.tniMinTraineeCount = Math.max(1, Math.round(Number(b.tniMinTraineeCount) || 1));
    if (b.tniMinPct !== undefined) data.tniMinPct = Math.max(0, Math.min(100, Number(b.tniMinPct) || 0));
    if (b.requirePreviewApproval !== undefined) data.requirePreviewApproval = !!b.requirePreviewApproval;
    if (b.superAdminEmails !== undefined) data.superAdminEmails = b.superAdminEmails || null;
    data.updatedBy = req.userId;

    const row = await prisma.dailyBatchReportSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_DAILY_REPORT_SETTINGS', module: 'DailyBatchReport', referenceId: 'default', newValue: data });
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[dailyBatchReport] update settings failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ─── Preview / Send / Resend ─────────────────────────────────────────────────────

export async function previewReport(req, res) {
  try {
    const { batchNo } = req.params;
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const preview = await previewDailyBatchReport(batchNo, date);
    res.json({ ok: true, data: preview });
  } catch (err) {
    console.error('[dailyBatchReport] preview failed:', err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function sendReport(req, res) {
  try {
    const { batchNo } = req.params;
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    const result = await sendDailyBatchReport(batchNo, date, { trigger: 'Manual', sentBy: req.userId });
    if (!result.ok && result.status === 'Flagged') return res.status(422).json({ ok: false, message: result.message });
    if (!result.ok) return res.status(502).json({ ok: false, message: result.message || 'Email delivery failed.' });
    res.json({ ok: true, message: `Report sent to ${result.log.recipientTo}.`, data: result.log });
  } catch (err) {
    console.error('[dailyBatchReport] send failed:', err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

export async function resendReport(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.dailyBatchReportLog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Report log entry not found.' });
    const result = await sendDailyBatchReport(existing.batchNo, existing.reportDate, { trigger: 'Manual', sentBy: req.userId });
    if (!result.ok && result.status === 'Flagged') return res.status(422).json({ ok: false, message: result.message });
    if (!result.ok) return res.status(502).json({ ok: false, message: result.message || 'Email delivery failed.' });
    res.json({ ok: true, message: 'Report resent.', data: result.log });
  } catch (err) {
    console.error('[dailyBatchReport] resend failed:', err);
    res.status(500).json({ ok: false, message: err.message || 'Server error' });
  }
}

// ─── Dashboard + history ─────────────────────────────────────────────────────────

export async function getDashboard(req, res) {
  try {
    const batches = await prisma.batchMaster.findMany({ where: { batchStatus: 'Active', ...branchScope(req) } });
    const todayStart = new Date(new Date().toDateString());
    const logs = await prisma.dailyBatchReportLog.findMany({ where: { reportDate: todayStart, batchNo: { in: batches.map(b => b.batchNo) } } });
    const logByBatch = new Map(logs.map(l => [l.batchNo, l]));

    const rows = await Promise.all(batches.map(async b => {
      const traineeCount = await prisma.traineeMaster.count({ where: { batchNo: b.batchNo, status: { not: 'Deleted' } } });
      const presentCount = await prisma.attendanceInference.count({ where: { batchNo: b.batchNo, date: todayStart, finalAttendance: 'Present' } });
      const log = logByBatch.get(b.batchNo);
      return {
        batchNo: b.batchNo, batchName: b.batchName, process: b.process, branch: b.branch,
        coordinatorName: b.coordinatorName, strength: traineeCount, present: presentCount,
        reportStatus: log?.status || 'Not Generated', emailStatus: log?.status || 'Not Sent',
        activitiesIncluded: log?.activitiesIncluded || null,
      };
    }));
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[dailyBatchReport] dashboard failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getReportHistory(req, res) {
  try {
    const q = req.query || {};
    const where = { ...branchScope(req) };
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.dateFrom || q.dateTo) {
      where.reportDate = {};
      if (q.dateFrom) where.reportDate.gte = new Date(q.dateFrom);
      if (q.dateTo) where.reportDate.lte = new Date(q.dateTo);
    }
    if (q.status) where.status = q.status;
    const rows = await prisma.dailyBatchReportLog.findMany({ where, orderBy: { reportDate: 'desc' }, take: 500 });
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[dailyBatchReport] history failed:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getReportHistoryDetail(req, res) {
  try {
    const { id } = req.params;
    const row = await prisma.dailyBatchReportLog.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ ok: false, message: 'Not found.' });
    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
