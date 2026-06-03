import { useState, useEffect } from 'react';
import { api, downloadCsv } from '../../utils/api.js';
import {
  Chart as ChartJS,
  ArcElement, BarElement, CategoryScale, LinearScale,
  Tooltip, Legend,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const CHART_COLORS = {
  blue: '#1d4ed8', green: '#16a34a', red: '#dc2626',
  amber: '#d97706', purple: '#7c3aed', gray: '#6b7280',
};

function StatCard({ label, value, sub, color = '#1d4ed8' }) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
      padding: '16px 20px', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ExportCard({ icon, title, desc, cols, count, btnColor, onExport, loading }) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)',
      padding: '20px 22px', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `${btnColor || CHART_COLORS.blue}22`,
          display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
      {cols && (
        <div style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--card)', borderRadius: 8, padding: '6px 10px', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--ink)' }}>Columns:</b> {cols}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>CSV{count != null ? ` · ${count} records` : ''}</span>
        <button
          className="btn"
          style={{ background: btnColor || CHART_COLORS.blue, padding: '7px 18px', fontSize: 12 }}
          onClick={onExport}
          disabled={loading}
        >
          {loading ? 'Exporting…' : '⬇ Export CSV'}
        </button>
      </div>
    </div>
  );
}

export default function ReportsTab() {
  const [batches, setBatches] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [selectedClassroom, setSelectedClassroom] = useState('');
  const [summary, setSummary] = useState(null);
  const [riskStats, setRiskStats] = useState(null);
  const [batchStats, setBatchStats] = useState([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [exportLoading, setExportLoading] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/admin/batches', 'admin').then(r => r.ok && setBatches(r.data));
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
  }, []);

  useEffect(() => { loadSummary(); }, [selectedBatch, selectedClassroom]);

  async function loadSummary() {
    setLoadingChart(true);
    const params = new URLSearchParams();
    if (selectedBatch) params.set('batchNo', selectedBatch);
    if (selectedClassroom) params.set('classroomId', selectedClassroom);

    const [traineeRes, riskRes, batchRes] = await Promise.all([
      api.get(`/admin/trainees/search?${params}&limit=2000`, 'admin'),
      api.get('/admin/risk/ALL', 'admin').catch(() => ({ ok: false })),
      api.get('/admin/batches', 'admin'),
    ]);

    if (traineeRes.ok) {
      const data = traineeRes.data || [];
      const total = data.length;
      const certified = data.filter(t => t.certificationStatus === 'Certified').length;
      const atRisk = data.filter(t => ['CRITICAL', 'HIGH'].includes(t.riskStatus)).length;
      const watch = data.filter(t => t.riskStatus === 'WATCH').length;
      const avgCourse = total ? Math.round(data.reduce((s, t) => s + (t.courseCompletionPct || 0), 0) / total) : 0;
      const avgMcq = total ? Math.round(data.reduce((s, t) => s + (t.assessmentPassPct || 0), 0) / total) : 0;
      const avgAtt = total ? Math.round(data.reduce((s, t) => s + (t.attendancePct || 0), 0) / total) : 0;
      setSummary({ total, certified, atRisk, watch, avgCourse, avgMcq, avgAtt });
      setRiskStats({ atRisk, watch, ok: total - atRisk - watch });
    }

    if (batchRes.ok && batchRes.data.length > 0) {
      const top = batchRes.data.slice(0, 8);
      setBatchStats(top);
    }
    setLoadingChart(false);
  }

  async function doExport(key, url, filename) {
    setExportLoading(s => ({ ...s, [key]: true }));
    setMsg(null);
    try {
      await downloadCsv(url, filename, 'admin');
    } catch {
      setMsg({ type: 'bad', text: 'Download failed. Check your connection.' });
    }
    setExportLoading(s => ({ ...s, [key]: false }));
  }

  const p = new URLSearchParams();
  if (selectedBatch) p.set('batchNo', selectedBatch);
  if (selectedClassroom) p.set('classroomId', selectedClassroom);
  const d = new Date().toISOString().slice(0, 10);
  const bl = selectedBatch || 'all';

  const exports = [
    {
      key: 'trainee-progress',
      icon: '👥', title: 'All Trainees Report', btnColor: CHART_COLORS.blue,
      desc: 'All trainees (active + inactive) with KPI metrics and certification status.',
      cols: 'Employee ID, Name, Email, Mobile, Batch, Branch, Process, LOB, Batch Start/End, Onboarding Date, Last Updated, Course %, MCQ %, Attendance %, Risk, Cert Status, Status',
      url: `/admin/trainees/export?${p}`, filename: `trainees-all-${bl}-${d}.csv`,
    },
    {
      key: 'trainees-active',
      icon: '✅', title: 'Active Trainees Database', btnColor: CHART_COLORS.green,
      desc: 'Export all currently Active trainees with full profile and KPI data.',
      cols: 'Employee ID, Name, Email, Mobile, Batch, Branch, Process, LOB, Batch Start/End, Onboarding Date, Last Updated, Course %, MCQ %, Attendance %, Risk, Cert Status',
      url: `/admin/trainees/export?status=Active&${p}`, filename: `trainees-active-${bl}-${d}.csv`,
    },
    {
      key: 'trainees-inactive',
      icon: '🔴', title: 'Inactive Trainees Database', btnColor: CHART_COLORS.red,
      desc: 'Export all Inactive/deactivated trainees for records and compliance.',
      cols: 'Employee ID, Name, Email, Mobile, Batch, Branch, Process, LOB, Batch Start/End, Onboarding Date, Last Updated, Course %, MCQ %, Attendance %, Risk, Cert Status',
      url: `/admin/trainees/export?status=Inactive&${p}`, filename: `trainees-inactive-${bl}-${d}.csv`,
    },
    {
      key: 'batch-summary',
      icon: '🏢', title: 'Batch Summary', btnColor: CHART_COLORS.green,
      desc: 'One row per batch with KPI averages, risk count, certified count.',
      cols: 'Batch No, Name, Branch, Process, Coordinator, Status, Start Date, End Date, Created At, Total Trainees, Avg Course %, Avg MCQ %, Avg Attendance %, At-Risk, Certified',
      url: `/admin/reports/batch-summary`, filename: `batch-summary-${d}.csv`,
    },
    {
      key: 'at-risk',
      icon: '⚠️', title: 'At-Risk Trainees', btnColor: CHART_COLORS.red,
      desc: 'CRITICAL, HIGH, and WATCH risk trainees with risk type and flag timestamps.',
      cols: 'Employee ID, Name, Batch, Branch, Process, Batch Start/End, Risk Level, Risk Reason, Risk Type, Risk Flagged At, Course %, MCQ %, Attendance %, Cert Status',
      url: `/admin/reports/at-risk?${p}`, filename: `at-risk-${bl}-${d}.csv`,
    },
    {
      key: 'module-completion',
      icon: '📚', title: 'Module Completion Detail', btnColor: CHART_COLORS.purple,
      desc: 'Per-content progress rows with first opened, last opened, completed at, and time spent.',
      cols: 'Employee ID, Name, Batch, Branch, Process, Batch Start/End, Classroom, Day No, Module, Content Title, Type, Status, Completion %, First Opened, Last Opened, Completed At, Time Spent (mins)',
      url: `/admin/reports/module-completion?${p}`, filename: `module-completion-${bl}-${d}.csv`,
    },
    {
      key: 'assessment-results',
      icon: '📝', title: 'Assessment Results', btnColor: CHART_COLORS.amber,
      desc: 'Every MCQ attempt with score, time taken, started at, submitted at, correct/wrong/blank.',
      cols: 'Employee ID, Name, Batch, Module, Assessment, Attempt No, Score %, Correct, Wrong, Blank, Total Qs, Started At, Submitted At, Time Taken (mins), Pass/Fail',
      url: `/admin/reports/assessment-results?${p}`, filename: `assessment-results-${bl}-${d}.csv`,
    },
    {
      key: 'attendance-log',
      icon: '📅', title: 'Attendance Log', btnColor: '#0891b2',
      desc: 'Daily attendance inferences per trainee showing activity source and flags.',
      cols: 'Employee ID, Name, Batch, Date, Status, Source, Course Activity, MCQ Activity, Created At',
      url: `/admin/reports/attendance-log?${p}`, filename: `attendance-log-${bl}-${d}.csv`,
    },
    {
      key: 'cert-evidence',
      icon: '🏆', title: 'Certification Evidence', btnColor: '#059669',
      desc: 'Mock calls, internal and external certification records with dates.',
      cols: 'Employee ID, Name, Batch, Branch, Process, Evidence Type, Score/Result, Conducted At, Assessor, Remarks, Created At',
      url: `/admin/reports/certification-evidence?${p}`, filename: `cert-evidence-${bl}-${d}.csv`,
    },
    {
      key: 'broadcast-assignments',
      icon: '📢', title: 'Broadcast Assignments', btnColor: '#7c3aed',
      desc: 'All module assignments via broadcast/refresher with scope and timestamps.',
      cols: 'Broadcast Title, Module Name, Scope Type, Scope Value, Assignment Type, Status (Active), Assigned By, Assigned At, Due Date, Message',
      url: `/admin/reports/broadcast-assignments`, filename: `broadcast-assignments-${d}.csv`,
    },
    {
      key: 'qa-activity',
      icon: '💬', title: 'Q&A Activity Log', btnColor: '#0284c7',
      desc: 'All queries raised by trainees with raised/answered/closed timestamps and TAT.',
      cols: 'Query ID, Employee ID, Batch, Module, Query Text, Status, Priority, Raised At, Answered At, Closed At, TAT (hours), Answer',
      url: `/admin/reports/qa-activity?${p}`, filename: `qa-activity-${bl}-${d}.csv`,
    },
  ];

  // Chart data
  const riskDonutData = riskStats ? {
    labels: ['CRITICAL/HIGH', 'WATCH', 'On Track'],
    datasets: [{
      data: [riskStats.atRisk, riskStats.watch, riskStats.ok],
      backgroundColor: [CHART_COLORS.red, CHART_COLORS.amber, CHART_COLORS.green],
      borderWidth: 0,
    }],
  } : null;

  const certFunnelData = summary ? {
    labels: ['Total', 'Certified', 'At Risk'],
    datasets: [{
      label: 'Trainees',
      data: [summary.total, summary.certified, summary.atRisk],
      backgroundColor: [CHART_COLORS.blue, CHART_COLORS.green, CHART_COLORS.red],
      borderRadius: 6,
    }],
  } : null;

  const batchBarData = batchStats.length > 0 ? {
    labels: batchStats.map(b => b.batchNo),
    datasets: [
      {
        label: 'Course %',
        data: batchStats.map(b => Math.round(b.avgCourseCompletion || 0)),
        backgroundColor: `${CHART_COLORS.blue}99`,
        borderRadius: 4,
      },
      {
        label: 'MCQ %',
        data: batchStats.map(b => Math.round(b.avgMcqPass || 0)),
        backgroundColor: `${CHART_COLORS.amber}99`,
        borderRadius: 4,
      },
      {
        label: 'Attendance %',
        data: batchStats.map(b => Math.round(b.avgAttendance || 0)),
        backgroundColor: `${CHART_COLORS.purple}99`,
        borderRadius: 4,
      },
    ],
  } : null;

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--ink)', font: { size: 11 } } } },
  };
  const barOpts = {
    ...chartOpts,
    scales: {
      x: { ticks: { color: 'var(--muted)', font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: 'var(--muted)', font: { size: 10 } }, max: 100, grid: { color: 'var(--line)' } },
    },
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Reports & Exports</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Compliance-grade exports with complete date/time audit trail. Use filters to scope by batch or classroom.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* Filters */}
      <div style={{
        background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
        padding: '18px 22px', marginBottom: 24, boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', marginBottom: 12 }}>Filter Data</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Batch</label>
            <select className="select" value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)}>
              <option value="">All Batches</option>
              {batches.map(b => <option key={b.batchNo} value={b.batchNo}>{b.batchNo}{b.batchName ? ` — ${b.batchName}` : ''}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Classroom</label>
            <select className="select" value={selectedClassroom} onChange={e => setSelectedClassroom(e.target.value)}>
              <option value="">All Classrooms</option>
              {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
            </select>
          </div>
          {(selectedBatch || selectedClassroom) && (
            <button className="btn" style={{ background: 'var(--line)', color: 'var(--ink)', fontSize: 12, padding: '8px 14px', height: 38 }}
              onClick={() => { setSelectedBatch(''); setSelectedClassroom(''); }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* KPI Summary */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
          <StatCard label="Total Trainees" value={summary.total} color={CHART_COLORS.blue} />
          <StatCard label="Certified" value={summary.certified} sub={`${summary.total ? Math.round(summary.certified / summary.total * 100) : 0}%`} color={CHART_COLORS.green} />
          <StatCard label="At Risk" value={summary.atRisk} sub="CRITICAL/HIGH" color={CHART_COLORS.red} />
          <StatCard label="Avg Course" value={`${summary.avgCourse}%`} color={CHART_COLORS.blue} />
          <StatCard label="Avg MCQ" value={`${summary.avgMcq}%`} color={CHART_COLORS.amber} />
          <StatCard label="Avg Attendance" value={`${summary.avgAtt}%`} color={CHART_COLORS.purple} />
        </div>
      )}

      {/* Charts Row */}
      {!loadingChart && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: 16, marginBottom: 28 }}>
          {/* Risk Donut */}
          <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>RISK DISTRIBUTION</div>
            <div style={{ height: 160 }}>
              {riskDonutData && <Doughnut data={riskDonutData} options={{ ...chartOpts, cutout: '65%' }} />}
            </div>
          </div>

          {/* Cert Funnel Bar */}
          <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>CERTIFICATION FUNNEL</div>
            <div style={{ height: 160 }}>
              {certFunnelData && <Bar data={certFunnelData} options={barOpts} />}
            </div>
          </div>

          {/* Batch Comparison Bar */}
          <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>BATCH KPI COMPARISON (latest 8)</div>
            <div style={{ height: 160 }}>
              {batchBarData ? <Bar data={batchBarData} options={barOpts} /> : (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12 }}>No batch data</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section header */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 14 }}>
        Export Reports — {exports.length} Available
      </div>

      {/* Export Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {exports.map(exp => (
          <ExportCard
            key={exp.key}
            icon={exp.icon}
            title={exp.title}
            desc={exp.desc}
            cols={exp.cols}
            btnColor={exp.btnColor}
            loading={!!exportLoading[exp.key]}
            onExport={() => doExport(exp.key, exp.url, exp.filename)}
          />
        ))}
      </div>

      <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
        <b style={{ color: 'var(--ink)' }}>Note:</b> Trainee Progress, At-Risk, Module Completion, Assessment Results, Attendance Log, and Q&A Activity exports respect the Batch/Classroom filters. Batch Summary and Broadcast Assignments export all records.
      </div>
    </div>
  );
}
