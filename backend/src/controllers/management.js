import { prisma } from '../utils/db.js';

export async function getManagementDashboard(req, res) {
  try {
    const [
      activeBatches, totalActiveTrainees, closedBatches,
      certified, handedOver, attritionCount,
      openRisks, criticalRisks,
      avgCourseRaw, avgMcqRaw, avgAttendanceRaw,
    ] = await Promise.all([
      prisma.batchMaster.count({ where: { batchStatus: 'Active' } }),
      prisma.traineeMaster.count({ where: { status: 'Active' } }),
      prisma.batchMaster.count({ where: { batchStatus: 'Completed' } }),
      prisma.traineeMaster.count({ where: { certificationStatus: 'Certified' } }),
      prisma.traineeMaster.count({ where: { handoverToOps: true } }),
      prisma.traineeMaster.count({ where: { certificationStatus: 'Attrition' } }),
      prisma.trainingRiskLog.count({ where: { status: 'Open' } }),
      prisma.trainingRiskLog.count({ where: { status: 'Open', severity: 'CRITICAL' } }),
      prisma.traineeMaster.aggregate({ _avg: { courseCompletionPct: true }, where: { status: 'Active' } }),
      prisma.traineeMaster.aggregate({ _avg: { assessmentPassPct: true }, where: { status: 'Active' } }),
      prisma.traineeMaster.aggregate({ _avg: { attendancePct: true }, where: { status: 'Active' } }),
    ]);

    // For throughput we use ALL trainees (active + recently closed batches)
    const allResolved = await prisma.traineeMaster.count({
      where: { certificationStatus: { in: ['Certified', 'Not Certified', 'Attrition'] } },
    });
    const totalEver = await prisma.traineeMaster.count();

    const avgCourse = Math.round(avgCourseRaw._avg.courseCompletionPct || 0);
    const avgMcq = Math.round(avgMcqRaw._avg.assessmentPassPct || 0);
    const avgAttendance = Math.round(avgAttendanceRaw._avg.attendancePct || 0);
    const certPct = totalEver > 0 ? Math.round((certified / totalEver) * 100) : 0;
    const throughputPct = totalEver > 0 ? Math.round((handedOver / totalEver) * 100) : 0;
    const attritionPct = totalEver > 0 ? Math.round((attritionCount / totalEver) * 100) : 0;

    res.json({
      ok: true,
      data: {
        activeBatches, totalActiveTrainees, closedBatches, certified, handedOver,
        attritionCount, openRisks, criticalRisks,
        avgCourse, avgMcq, avgAttendance,
        certPct, throughputPct, attritionPct, totalEver,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getBatchSummaries(req, res) {
  try {
    const batches = await prisma.batchMaster.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const batchNos = batches.map(b => b.batchNo);

    const [traineeCounts, certCounts, attritionCounts, handoverCounts] = await Promise.all([
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos } },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, certificationStatus: 'Certified' },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, certificationStatus: 'Attrition' },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, handoverToOps: true },
        _count: { employeeId: true },
      }),
    ]);

    const traineeMap = Object.fromEntries(traineeCounts.map(r => [r.batchNo, r._count.employeeId]));
    const certMap = Object.fromEntries(certCounts.map(r => [r.batchNo, r._count.employeeId]));
    const attrMap = Object.fromEntries(attritionCounts.map(r => [r.batchNo, r._count.employeeId]));
    const hoMap = Object.fromEntries(handoverCounts.map(r => [r.batchNo, r._count.employeeId]));

    const summaries = batches.map(b => {
      const total = traineeMap[b.batchNo] || 0;
      const cert = certMap[b.batchNo] || 0;
      const attr = attrMap[b.batchNo] || 0;
      const ho = hoMap[b.batchNo] || 0;
      return {
        batchNo: b.batchNo,
        status: b.batchStatus,
        process: b.process,
        lob: b.lob,
        coordinatorName: b.coordinatorName || '—',
        coordinatorLoginId: b.coordinatorLoginId,
        startDate: b.startDate,
        totalTrainees: total,
        certified: cert,
        attrition: attr,
        handedOver: ho,
        certPct: total > 0 ? Math.round((cert / total) * 100) : 0,
        attritionPct: total > 0 ? Math.round((attr / total) * 100) : 0,
        throughputPct: total > 0 ? Math.round((ho / total) * 100) : 0,
      };
    });

    res.json({ ok: true, data: summaries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getCoordinatorPerformance(req, res) {
  try {
    const batches = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: { not: null } },
      select: { batchNo: true, batchStatus: true, coordinatorLoginId: true, coordinatorName: true, process: true, lob: true },
    });

    const coordMap = {};
    for (const b of batches) {
      const id = b.coordinatorLoginId;
      if (!coordMap[id]) {
        coordMap[id] = {
          loginId: id,
          name: b.coordinatorName || id,
          totalBatches: 0,
          activeBatches: 0,
          closedBatches: 0,
          batchNos: [],
        };
      }
      coordMap[id].totalBatches++;
      if (b.batchStatus === 'Active') coordMap[id].activeBatches++;
      if (b.batchStatus === 'Completed') coordMap[id].closedBatches++;
      coordMap[id].batchNos.push(b.batchNo);
    }

    const allBatchNos = batches.map(b => b.batchNo);

    const [traineeCounts, certCounts, attrCounts, hoCounts, avgRaw] = await Promise.all([
      prisma.traineeMaster.groupBy({ by: ['batchNo'], where: { batchNo: { in: allBatchNos } }, _count: { employeeId: true } }),
      prisma.traineeMaster.groupBy({ by: ['batchNo'], where: { batchNo: { in: allBatchNos }, certificationStatus: 'Certified' }, _count: { employeeId: true } }),
      prisma.traineeMaster.groupBy({ by: ['batchNo'], where: { batchNo: { in: allBatchNos }, certificationStatus: 'Attrition' }, _count: { employeeId: true } }),
      prisma.traineeMaster.groupBy({ by: ['batchNo'], where: { batchNo: { in: allBatchNos }, handoverToOps: true }, _count: { employeeId: true } }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: allBatchNos }, status: 'Active' },
        _avg: { courseCompletionPct: true, assessmentPassPct: true },
      }),
    ]);

    const tcMap = Object.fromEntries(traineeCounts.map(r => [r.batchNo, r._count.employeeId]));
    const certMap = Object.fromEntries(certCounts.map(r => [r.batchNo, r._count.employeeId]));
    const attrMap = Object.fromEntries(attrCounts.map(r => [r.batchNo, r._count.employeeId]));
    const hoMap = Object.fromEntries(hoCounts.map(r => [r.batchNo, r._count.employeeId]));
    const avgMap = Object.fromEntries(avgRaw.map(r => [r.batchNo, r._avg]));

    const result = Object.values(coordMap).map(c => {
      let total = 0, cert = 0, attr = 0, ho = 0, sumCourse = 0, sumMcq = 0, countAvg = 0;
      for (const bn of c.batchNos) {
        total += tcMap[bn] || 0;
        cert += certMap[bn] || 0;
        attr += attrMap[bn] || 0;
        ho += hoMap[bn] || 0;
        if (avgMap[bn]) {
          sumCourse += avgMap[bn].courseCompletionPct || 0;
          sumMcq += avgMap[bn].assessmentPassPct || 0;
          countAvg++;
        }
      }
      return {
        loginId: c.loginId,
        name: c.name,
        totalBatches: c.totalBatches,
        activeBatches: c.activeBatches,
        closedBatches: c.closedBatches,
        totalTrainees: total,
        certified: cert,
        attrition: attr,
        handedOver: ho,
        certPct: total > 0 ? Math.round((cert / total) * 100) : 0,
        attritionPct: total > 0 ? Math.round((attr / total) * 100) : 0,
        throughputPct: total > 0 ? Math.round((ho / total) * 100) : 0,
        avgCourse: countAvg > 0 ? Math.round(sumCourse / countAvg) : 0,
        avgMcq: countAvg > 0 ? Math.round(sumMcq / countAvg) : 0,
      };
    }).sort((a, b) => b.throughputPct - a.throughputPct);

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getBranchSummaries(req, res) {
  try {
    const trainees = await prisma.traineeMaster.findMany({
      where: { status: { not: 'Deleted' } },
      select: {
        branch: true, status: true,
        courseCompletionPct: true, assessmentPassPct: true, attendancePct: true,
        certificationStatus: true, riskStatus: true, handoverToOps: true,
      },
    });

    const branchMap = {};
    for (const t of trainees) {
      const b = t.branch || 'Unknown';
      if (!branchMap[b]) branchMap[b] = { branch: b, active: 0, count: 0, totalCourse: 0, totalMcq: 0, totalAttendance: 0, certified: 0, attrition: 0, handedOver: 0, critical: 0 };
      branchMap[b].count++;
      if (t.status === 'Active') {
        branchMap[b].active++;
        branchMap[b].totalCourse += t.courseCompletionPct || 0;
        branchMap[b].totalMcq += t.assessmentPassPct || 0;
        branchMap[b].totalAttendance += t.attendancePct || 0;
        if (t.riskStatus === 'CRITICAL') branchMap[b].critical++;
      }
      if (t.certificationStatus === 'Certified') branchMap[b].certified++;
      if (t.certificationStatus === 'Attrition') branchMap[b].attrition++;
      if (t.handoverToOps) branchMap[b].handedOver++;
    }

    const summaries = Object.values(branchMap).map(b => ({
      branch: b.branch,
      count: b.count,
      active: b.active,
      avgCourse: b.active > 0 ? Math.round(b.totalCourse / b.active) : 0,
      avgMcq: b.active > 0 ? Math.round(b.totalMcq / b.active) : 0,
      avgAttendance: b.active > 0 ? Math.round(b.totalAttendance / b.active) : 0,
      certified: b.certified,
      attrition: b.attrition,
      handedOver: b.handedOver,
      certPct: b.count > 0 ? Math.round((b.certified / b.count) * 100) : 0,
      attritionPct: b.count > 0 ? Math.round((b.attrition / b.count) * 100) : 0,
      throughputPct: b.count > 0 ? Math.round((b.handedOver / b.count) * 100) : 0,
      critical: b.critical,
    })).sort((a, b) => b.count - a.count);

    res.json({ ok: true, data: summaries });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getProcessSummaries(req, res) {
  try {
    const trainees = await prisma.traineeMaster.findMany({
      where: { status: { not: 'Deleted' } },
      select: {
        process: true, lob: true, status: true,
        courseCompletionPct: true, assessmentPassPct: true, attendancePct: true,
        certificationStatus: true, riskStatus: true, handoverToOps: true,
      },
    });

    const map = {};
    for (const t of trainees) {
      const key = `${t.process || 'Unknown'} / ${t.lob || 'All'}`;
      if (!map[key]) map[key] = { process: t.process, lob: t.lob, active: 0, count: 0, totalCourse: 0, totalMcq: 0, totalAttendance: 0, certified: 0, attrition: 0, handedOver: 0, critical: 0 };
      map[key].count++;
      if (t.status === 'Active') {
        map[key].active++;
        map[key].totalCourse += t.courseCompletionPct || 0;
        map[key].totalMcq += t.assessmentPassPct || 0;
        map[key].totalAttendance += t.attendancePct || 0;
        if (t.riskStatus === 'CRITICAL') map[key].critical++;
      }
      if (t.certificationStatus === 'Certified') map[key].certified++;
      if (t.certificationStatus === 'Attrition') map[key].attrition++;
      if (t.handoverToOps) map[key].handedOver++;
    }

    const summaries = Object.values(map).map(p => ({
      process: p.process,
      lob: p.lob,
      count: p.count,
      active: p.active,
      avgCourse: p.active > 0 ? Math.round(p.totalCourse / p.active) : 0,
      avgMcq: p.active > 0 ? Math.round(p.totalMcq / p.active) : 0,
      avgAttendance: p.active > 0 ? Math.round(p.totalAttendance / p.active) : 0,
      certified: p.certified,
      attrition: p.attrition,
      handedOver: p.handedOver,
      certPct: p.count > 0 ? Math.round((p.certified / p.count) * 100) : 0,
      attritionPct: p.count > 0 ? Math.round((p.attrition / p.count) * 100) : 0,
      throughputPct: p.count > 0 ? Math.round((p.handedOver / p.count) * 100) : 0,
      critical: p.critical,
    })).sort((a, b) => b.count - a.count);

    res.json({ ok: true, data: summaries });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getHistoricalKpis(req, res) {
  try {
    const { months = 12 } = req.query;
    const kpis = await prisma.historicalTrainingKpi.findMany({
      orderBy: { period: 'desc' },
      take: parseInt(months) * 3,
    });
    res.json({ ok: true, data: kpis });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getTraineeRiskList(req, res) {
  try {
    const { severity, batchNo, branch, process } = req.query;
    const where = { status: 'Open' };
    if (severity && severity !== 'ALL') where.severity = severity;
    if (batchNo) where.batchNo = batchNo;
    if (branch) where.branch = branch;
    if (process) where.process = process;

    const risks = await prisma.trainingRiskLog.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
      take: 300,
    });
    res.json({ ok: true, data: risks });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getRiskStats(req, res) {
  try {
    const [critical, high, watch] = await Promise.all([
      prisma.trainingRiskLog.count({ where: { severity: 'CRITICAL', status: 'Open' } }),
      prisma.trainingRiskLog.count({ where: { severity: 'HIGH', status: 'Open' } }),
      prisma.trainingRiskLog.count({ where: { severity: 'WATCH', status: 'Open' } }),
    ]);
    res.json({ ok: true, data: { critical, high, watch, total: critical + high + watch } });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

export async function getBatchTrainees(req, res) {
  try {
    const { batchNo } = req.params;
    const trainees = await prisma.traineeMaster.findMany({
      where: { batchNo },
      orderBy: { traineeName: 'asc' },
      select: {
        employeeId: true, traineeName: true, branch: true, process: true, lob: true,
        status: true, certificationStatus: true, riskStatus: true,
        courseCompletionPct: true, assessmentPassPct: true, attendancePct: true,
        handoverToOps: true, batchNo: true,
      },
    });
    res.json({ ok: true, data: trainees });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// ── Management Report Exports ──────────────────────────────────────────────────

function fmtDt(v) { if (!v) return ''; return new Date(v).toISOString().replace('T', ' ').slice(0, 19); }
function fmtDate(v) { if (!v) return ''; return new Date(v).toISOString().slice(0, 10); }

function toCsv(headers, rows) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
}

function csvRes(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

// ── Mgmt Export 1: Full Trainee Progress (all batches) ────────────────────────
export async function mgmtExportTrainees(req, res) {
  try {
    const { branch, process: proc } = req.query;
    const where = { status: { not: 'Deleted' } };
    if (branch) where.branch = branch;
    if (proc) where.process = proc;

    const [trainees, batches] = await Promise.all([
      prisma.traineeMaster.findMany({ where, orderBy: [{ batchNo: 'asc' }, { employeeId: 'asc' }] }),
      prisma.batchMaster.findMany({ select: { batchNo: true, startDate: true, endDate: true, coordinatorLoginId: true } }),
    ]);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.batchNo] = b; });

    const headers = [
      'Employee ID', 'Name', 'Batch No', 'Branch', 'Process', 'LOB',
      'Batch Start Date', 'Batch End Date', 'Coordinator',
      'Onboarding Date', 'Last Updated At',
      'Course Completion %', 'MCQ Pass %', 'Attendance %',
      'Risk Status', 'OJT Ready', 'Certification Status', 'Status',
      'Export Generated At',
    ];
    const genAt = fmtDt(new Date());
    const rows = trainees.map(t => {
      const b = batchMap[t.batchNo] || {};
      return [
        t.employeeId, t.traineeName, t.batchNo, t.branch, t.process, t.lob,
        fmtDate(b.startDate), fmtDate(b.endDate), b.coordinatorLoginId || '',
        fmtDate(t.onboardingDate), fmtDt(t.lastUpdatedAt),
        t.courseCompletionPct || 0, t.assessmentPassPct || 0, t.attendancePct || 0,
        t.riskStatus, t.ojtReady ? 'Yes' : 'No', t.certificationStatus, t.status,
        genAt,
      ];
    });
    csvRes(res, `all-trainees-${branch || proc || 'company'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── Mgmt Export 2: Batch KPI Summary ──────────────────────────────────────────
export async function mgmtExportBatchKpi(req, res) {
  try {
    const batches = await prisma.batchMaster.findMany({ orderBy: { createdAt: 'desc' } });
    const batchNos = batches.map(b => b.batchNo);
    const [stats, certCounts, riskCounts] = await Promise.all([
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos } },
        _count: { employeeId: true },
        _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, certificationStatus: 'Certified' },
        _count: { employeeId: true },
      }),
      prisma.traineeMaster.groupBy({
        by: ['batchNo'],
        where: { batchNo: { in: batchNos }, riskStatus: { in: ['CRITICAL', 'HIGH'] } },
        _count: { employeeId: true },
      }),
    ]);
    const sMap = {};
    stats.forEach(s => { sMap[s.batchNo] = { count: s._count.employeeId, avgCourse: Math.round(s._avg.courseCompletionPct || 0), avgMcq: Math.round(s._avg.assessmentPassPct || 0), avgAtt: Math.round(s._avg.attendancePct || 0) }; });
    const certMap = {};
    certCounts.forEach(c => { certMap[c.batchNo] = c._count.employeeId; });
    const riskMap = {};
    riskCounts.forEach(r => { riskMap[r.batchNo] = r._count.employeeId; });

    const headers = [
      'Batch No', 'Batch Name', 'Branch', 'Process', 'LOB', 'Coordinator',
      'Status', 'Batch Start Date', 'Batch End Date', 'Created At',
      'Total Trainees', 'Avg Course %', 'Avg MCQ %', 'Avg Attendance %',
      'Certified Count', 'At-Risk Count', 'Certification Rate %',
    ];
    const rows = batches.map(b => {
      const s = sMap[b.batchNo] || {};
      const certCount = certMap[b.batchNo] || 0;
      const total = s.count || 0;
      const certRate = total > 0 ? Math.round((certCount / total) * 1000) / 10 : 0;
      return [
        b.batchNo, b.batchName || '', b.branch, b.process, b.lob || '', b.coordinatorLoginId || '',
        b.batchStatus, fmtDate(b.startDate), fmtDate(b.endDate), fmtDt(b.createdAt),
        total, s.avgCourse || 0, s.avgMcq || 0, s.avgAtt || 0,
        certCount, riskMap[b.batchNo] || 0, certRate,
      ];
    });
    csvRes(res, `batch-kpi-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}

// ── Mgmt Export 3: Certification Evidence Audit ───────────────────────────────
export async function mgmtExportCertEvidence(req, res) {
  try {
    const { branch, process: proc } = req.query;
    const traineeWhere = { status: { not: 'Deleted' } };
    if (branch) traineeWhere.branch = branch;
    if (proc) traineeWhere.process = proc;

    const trainees = await prisma.traineeMaster.findMany({ where: traineeWhere, select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true } });
    const empIds = trainees.map(t => t.employeeId);
    const traineeMap = {};
    trainees.forEach(t => { traineeMap[t.employeeId] = t; });

    const evidence = await prisma.certificationEvidence.findMany({
      where: { employeeId: { in: empIds } },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Employee ID', 'Trainee Name', 'Batch No', 'Branch', 'Process',
      'Evidence Type', 'Score %', 'Result', 'Conducted At',
      'Conducted By', 'Remarks', 'Created At',
    ];
    const rows = evidence.map(e => {
      const t = traineeMap[e.employeeId] || {};
      return [
        e.employeeId, t.traineeName || '', t.batchNo || '', t.branch || '', t.process || '',
        e.evidenceType, e.scorePct ?? '', e.result || '', fmtDt(e.conductedAt),
        e.conductedBy || '', e.remarks || '', fmtDt(e.createdAt),
      ];
    });
    csvRes(res, `cert-evidence-${branch || proc || 'company'}-${fmtDate(new Date())}.csv`, headers, rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Export failed.' });
  }
}
