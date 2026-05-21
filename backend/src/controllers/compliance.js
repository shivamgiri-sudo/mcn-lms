import { prisma } from '../utils/db.js';

function fmtDt(v) {
  if (!v) return '';
  return new Date(v).toISOString().replace('T', ' ').slice(0, 19);
}

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toISOString().slice(0, 10);
}

function csvRes(res, filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers, ...rows].map(r => r.map(escape).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
}

function buildDateRange(field, dateFrom, dateTo) {
  const where = {};
  if (dateFrom || dateTo) {
    where[field] = {};
    if (dateFrom) where[field].gte = new Date(dateFrom);
    if (dateTo) where[field].lte = new Date(dateTo + 'T23:59:59Z');
  }
  return where;
}

export async function previewCompliance(req, res) {
  try {
    const { dateFrom, dateTo, branch, process: proc } = req.query;

    if (dateFrom && isNaN(new Date(dateFrom))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateFrom — expected ISO date e.g. 2026-01-15' });
    }
    if (dateTo && isNaN(new Date(dateTo))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateTo — expected ISO date e.g. 2026-01-15' });
    }

    const traineeWhere = {};
    if (branch) traineeWhere.branch = branch;
    if (proc) traineeWhere.process = proc;

    const scopedTrainees = (branch || proc)
      ? await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true } })
      : null;
    const empIds = scopedTrainees ? scopedTrainees.map(t => t.employeeId) : null;

    const attDateRange = buildDateRange('date', dateFrom, dateTo);
    const loginDateRange = buildDateRange('createdAt', dateFrom, dateTo);
    const contentDateRange = buildDateRange('lastOpenedAt', dateFrom, dateTo);
    const attemptDateRange = buildDateRange('startedAt', dateFrom, dateTo);
    const riskDateRange = buildDateRange('createdAt', dateFrom, dateTo);
    const evidenceDateRange = buildDateRange('conductedAt', dateFrom, dateTo);

    const empFilter = empIds ? { employeeId: { in: empIds } } : {};
    const userFilter = empIds ? { userId: { in: empIds } } : {};

    const [trainees, attendance, logins, content, attempts, risks, pending, queries, evidence, results] = await Promise.all([
      prisma.traineeMaster.count({ where: traineeWhere }),
      prisma.attendanceInference.count({ where: { ...attDateRange, ...empFilter } }),
      prisma.loginSessionLog.count({ where: { ...loginDateRange, ...userFilter } }),
      prisma.contentProgress.count({ where: { ...contentDateRange, ...empFilter } }),
      prisma.assessmentAttempt.count({ where: { ...attemptDateRange, ...empFilter } }),
      prisma.trainingRiskLog.count({ where: { ...riskDateRange, ...empFilter } }),
      prisma.pendingActivityLog.count({ where: { ...riskDateRange, ...empFilter } }),
      prisma.traineeQueryLog.count({ where: { ...riskDateRange, ...empFilter } }),
      prisma.certificationEvidence.count({ where: { ...evidenceDateRange, ...empFilter } }),
      prisma.assessmentResult.count({ where: empIds ? { employeeId: { in: empIds } } : {} }),
    ]);

    res.json({
      ok: true,
      data: {
        trainees,
        attendanceAndLogin: attendance + logins,
        learningActivity: content + attempts,
        riskAndEscalation: risks + pending + queries,
        certificationChain: evidence + results,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportTrainees(req, res) {
  try {
    const { branch, process: proc } = req.query;
    const where = {};
    if (branch) where.branch = branch;
    if (proc) where.process = proc;

    const trainees = await prisma.traineeMaster.findMany({
      where,
      include: { batch: true },
      orderBy: { createdAt: 'asc' },
    });

    const headers = [
      'Employee ID', 'ID Type', 'Name', 'Email', 'Mobile',
      'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date', 'Coordinator',
      'Onboarding Date', 'Status', 'Certification Status',
      'OJT Ready', 'Handover to Ops', 'Course Completion %',
      'MCQ Pass %', 'Attendance %', 'Risk Status', 'Last Updated At',
    ];

    const rows = trainees.map(t => [
      t.employeeId,
      t.empIdType || 'PERMANENT',
      t.traineeName || '',
      t.email || '',
      t.mobile || '',
      t.batchNo || '',
      t.branch || '',
      t.process || '',
      t.lob || '',
      fmtDate(t.batch?.startDate),
      fmtDate(t.batch?.endDate),
      t.batch?.coordinatorLoginId || '',
      fmtDate(t.onboardingDate),
      t.status || '',
      t.certificationStatus || '',
      t.ojtReady ? 'Yes' : 'No',
      t.handoverToOps ? 'Yes' : 'No',
      Math.round(t.courseCompletionPct || 0),
      Math.round(t.assessmentPassPct || 0),
      Math.round(t.attendancePct || 0),
      t.riskStatus || '',
      fmtDt(t.lastUpdatedAt),
    ]);

    csvRes(res, `compliance-trainees-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportAttendanceLogin(req, res) {
  try {
    const { dateFrom, dateTo, branch, process: proc } = req.query;

    if (dateFrom && isNaN(new Date(dateFrom))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateFrom — expected ISO date e.g. 2026-01-15' });
    }
    if (dateTo && isNaN(new Date(dateTo))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateTo — expected ISO date e.g. 2026-01-15' });
    }

    const traineeWhere = {};
    if (branch) traineeWhere.branch = branch;
    if (proc) traineeWhere.process = proc;
    const allTrainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true } });
    const traineeMap = new Map(allTrainees.map(t => [t.employeeId, t]));
    const empIds = allTrainees.map(t => t.employeeId);

    const attWhere = { ...buildDateRange('date', dateFrom, dateTo) };
    if (branch || proc) attWhere.employeeId = { in: empIds };

    const loginWhere = { ...buildDateRange('createdAt', dateFrom, dateTo) };
    if (branch || proc) loginWhere.userId = { in: empIds };

    const [attendance, logins] = await Promise.all([
      prisma.attendanceInference.findMany({ where: attWhere, orderBy: { date: 'asc' } }),
      prisma.loginSessionLog.findMany({ where: loginWhere, orderBy: { createdAt: 'asc' } }),
    ]);

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process',
      'Record Type', 'Date', 'Attendance Status', 'Attendance Source',
      'Course Activity', 'MCQ Activity', 'Login Action', 'Login Status',
      'IP Address', 'Created At',
    ];

    const attRows = attendance.map(a => {
      const t = traineeMap.get(a.employeeId) || {};
      return [
        a.employeeId, t.traineeName || '', t.batchNo || '', t.branch || '', t.process || '',
        'Attendance', fmtDate(a.date), a.finalAttendance, a.attendanceSource,
        a.courseActivity ? 'Yes' : 'No', a.mcqActivity ? 'Yes' : 'No',
        '', '', '', fmtDt(a.createdAt),
      ];
    });

    const loginRows = logins.map(l => {
      const t = traineeMap.get(l.userId) || {};
      return [
        l.userId, t.traineeName || '', t.batchNo || '', t.branch || '', t.process || '',
        'Login', fmtDate(l.createdAt), '', '',
        '', '', l.action, l.status,
        l.ipAddress || '', fmtDt(l.createdAt),
      ];
    });

    csvRes(res, `compliance-attendance-login-${fmtDate(new Date())}.csv`, headers, [...attRows, ...loginRows]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportLearning(req, res) {
  try {
    const { dateFrom, dateTo, branch, process: proc } = req.query;

    if (dateFrom && isNaN(new Date(dateFrom))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateFrom — expected ISO date e.g. 2026-01-15' });
    }
    if (dateTo && isNaN(new Date(dateTo))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateTo — expected ISO date e.g. 2026-01-15' });
    }

    const traineeWhere = {};
    if (branch) traineeWhere.branch = branch;
    if (proc) traineeWhere.process = proc;
    const allTrainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true } });
    const traineeMap = new Map(allTrainees.map(t => [t.employeeId, t]));
    const empIds = allTrainees.map(t => t.employeeId);

    const contentWhere = { ...buildDateRange('lastOpenedAt', dateFrom, dateTo) };
    if (branch || proc) contentWhere.employeeId = { in: empIds };

    const attemptWhere = { ...buildDateRange('startedAt', dateFrom, dateTo) };
    if (branch || proc) attemptWhere.employeeId = { in: empIds };

    const [content, attempts] = await Promise.all([
      prisma.contentProgress.findMany({ where: contentWhere, orderBy: { lastOpenedAt: 'asc' } }),
      prisma.assessmentAttempt.findMany({ where: attemptWhere, include: { assessment: true }, orderBy: { startedAt: 'asc' } }),
    ]);

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process',
      'Record Type', 'Module ID', 'Content/Assessment Title',
      'Status', 'Completion %', 'Score %', 'Pass/Fail',
      'First Opened At', 'Last Opened At', 'Completed At',
      'Time Spent (mins)', 'Attempt No', 'Started At', 'Submitted At',
    ];

    const contentRows = content.map(c => {
      const t = traineeMap.get(c.employeeId) || {};
      return [
        c.employeeId, t.traineeName || '', t.batchNo || '', t.branch || '', t.process || '',
        'Content', c.moduleId, c.contentId,
        c.completionStatus, Math.round(c.completionPct), '', '',
        fmtDt(c.firstOpenedAt), fmtDt(c.lastOpenedAt), fmtDt(c.completedAt),
        Math.round((c.totalSecondsSpent || 0) / 60), '', '', '',
      ];
    });

    const attemptRows = attempts.map(a => {
      const t = traineeMap.get(a.employeeId) || {};
      return [
        a.employeeId, t.traineeName || '', t.batchNo || '', t.branch || '', t.process || '',
        'Assessment', a.assessmentId, a.assessment?.assessmentName || a.assessmentId,
        '', '', Math.round(a.percentage), a.result,
        '', '', '',
        Math.round((a.timeTakenSeconds || 0) / 60), a.attemptNo, fmtDt(a.startedAt), fmtDt(a.submittedAt),
      ];
    });

    csvRes(res, `compliance-learning-${fmtDate(new Date())}.csv`, headers, [...contentRows, ...attemptRows]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportRiskEscalation(req, res) {
  try {
    const { dateFrom, dateTo, branch, process: proc } = req.query;

    if (dateFrom && isNaN(new Date(dateFrom))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateFrom — expected ISO date e.g. 2026-01-15' });
    }
    if (dateTo && isNaN(new Date(dateTo))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateTo — expected ISO date e.g. 2026-01-15' });
    }

    const traineeWhere = {};
    if (branch) traineeWhere.branch = branch;
    if (proc) traineeWhere.process = proc;
    const allTrainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true } });
    const traineeMap = new Map(allTrainees.map(t => [t.employeeId, t]));
    const empIds = allTrainees.map(t => t.employeeId);

    const dateRange = buildDateRange('createdAt', dateFrom, dateTo);
    const empFilter = (branch || proc) ? { employeeId: { in: empIds } } : {};

    const [risks, pending, queries] = await Promise.all([
      prisma.trainingRiskLog.findMany({ where: { ...dateRange, ...empFilter }, orderBy: { createdAt: 'asc' } }),
      prisma.pendingActivityLog.findMany({ where: { ...dateRange, ...empFilter }, orderBy: { createdAt: 'asc' } }),
      prisma.traineeQueryLog.findMany({ where: { ...dateRange, ...empFilter }, orderBy: { createdAt: 'asc' } }),
    ]);

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process',
      'Record Type', 'Category / Type', 'Description / Query Text',
      'Status', 'Priority / Severity', 'Raised / Created At',
      'Actioned At', 'Resolved / Closed At', 'Actioned By', 'Remarks / Answer',
    ];

    const riskRows = risks.map(r => {
      const t = traineeMap.get(r.employeeId) || {};
      return [
        r.employeeId, t.traineeName || r.traineeName || '', t.batchNo || r.batchNo || '', t.branch || r.branch || '', t.process || r.process || '',
        'Risk', r.riskType, r.riskTitle + (r.details ? ': ' + r.details : ''),
        r.status, r.severity, fmtDt(r.createdAt),
        fmtDt(r.actionAt), '', r.actionBy || '', r.closureRemarks || '',
      ];
    });

    const pendingRows = pending.map(p => {
      const t = traineeMap.get(p.employeeId) || {};
      return [
        p.employeeId || '', t.traineeName || p.traineeName || '', t.batchNo || p.batchNo || '', t.branch || p.branch || '', t.process || p.process || '',
        'Pending Activity', p.activityType, p.activityTitle + (p.details ? ': ' + p.details : ''),
        p.status, p.severity, fmtDt(p.createdAt),
        fmtDt(p.actionAt), fmtDt(p.closedAt), p.actionBy || '', p.closureRemarks || '',
      ];
    });

    const queryRows = queries.map(q => {
      const t = traineeMap.get(q.employeeId) || {};
      return [
        q.employeeId, t.traineeName || q.traineeName || '', t.batchNo || q.batchNo || '', t.branch || '', t.process || '',
        'Query', q.category, q.question,
        q.status, q.priority, fmtDt(q.createdAt),
        fmtDt(q.answeredAt), fmtDt(q.closedAt), q.answeredBy || '', q.coordinatorAnswer || '',
      ];
    });

    csvRes(res, `compliance-risk-escalation-${fmtDate(new Date())}.csv`, headers, [...riskRows, ...pendingRows, ...queryRows]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function exportCertification(req, res) {
  try {
    const { dateFrom, dateTo, branch, process: proc } = req.query;

    if (dateFrom && isNaN(new Date(dateFrom))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateFrom — expected ISO date e.g. 2026-01-15' });
    }
    if (dateTo && isNaN(new Date(dateTo))) {
      return res.status(400).json({ ok: false, message: 'Invalid dateTo — expected ISO date e.g. 2026-01-15' });
    }

    const traineeWhere = {};
    if (branch) traineeWhere.branch = branch;
    if (proc) traineeWhere.process = proc;
    const allTrainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, certificationStatus: true } });
    const traineeMap = new Map(allTrainees.map(t => [t.employeeId, t]));
    const empIds = allTrainees.map(t => t.employeeId);

    const evidenceDateRange = buildDateRange('conductedAt', dateFrom, dateTo);
    const empFilter = (branch || proc) ? { employeeId: { in: empIds } } : {};

    const [evidence, results] = await Promise.all([
      prisma.certificationEvidence.findMany({ where: { ...evidenceDateRange, ...empFilter }, orderBy: { conductedAt: 'asc' } }),
      prisma.assessmentResult.findMany({ where: empFilter }),
    ]);

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process',
      'Record Type', 'Evidence Type / Assessment ID',
      'Score %', 'Result (Pass/Fail)',
      'Conducted / Completed At', 'Assessor / Conducted By',
      'Total Attempts', 'Last Attempt At',
      'Certification Status', 'Remarks',
    ];

    const evidenceRows = evidence.map(e => {
      const t = traineeMap.get(e.employeeId) || {};
      return [
        e.employeeId, t.traineeName || '', t.batchNo || e.batchNo || '', t.branch || '', t.process || '',
        'Evidence', e.evidenceType,
        Math.round(e.scorePct), e.result,
        fmtDt(e.conductedAt), e.conductedBy || '',
        '', '', t.certificationStatus || '', e.remarks || '',
      ];
    });

    const resultRows = results.map(r => {
      const t = traineeMap.get(r.employeeId) || {};
      return [
        r.employeeId, t.traineeName || '', t.batchNo || r.batchNo || '', t.branch || '', t.process || '',
        'Assessment Result', r.assessmentId,
        Math.round(r.bestPercentage), r.result,
        fmtDt(r.lastAttemptAt), '',
        r.totalAttempts, fmtDt(r.lastAttemptAt),
        t.certificationStatus || '', '',
      ];
    });

    csvRes(res, `compliance-certification-${fmtDate(new Date())}.csv`, headers, [...evidenceRows, ...resultRows]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}
