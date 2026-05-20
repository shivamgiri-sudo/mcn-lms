import { useState, useEffect } from 'react';
import { api, downloadCsv } from '../../utils/api.js';
import {
  Chart as ChartJS,
  ArcElement, BarElement, CategoryScale, LinearScale,
  Tooltip, Legend,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const C = { blue: '#1d4ed8', green: '#16a34a', red: '#dc2626', amber: '#d97706', purple: '#7c3aed' };

function ExportCard({ icon, title, desc, cols, btnColor, onExport, loading }) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
      padding: '18px 20px', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `${btnColor || C.blue}22`,
          display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0,
        }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
      {cols && (
        <div style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--card)', borderRadius: 8, padding: '5px 10px', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--ink)' }}>Columns:</b> {cols}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn"
          style={{ background: btnColor || C.blue, padding: '7px 16px', fontSize: 12 }}
          onClick={onExport}
          disabled={loading}
        >
          {loading ? 'Exporting…' : '⬇ Export CSV'}
        </button>
      </div>
    </div>
  );
}

export default function CoordReportsTab() {
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [summary, setSummary] = useState(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [exportLoading, setExportLoading] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/coordinator/batches', 'coordinator').then(r => r.ok && setBatches(r.data));
  }, []);

  useEffect(() => { loadSummary(); }, [selectedBatch, batches]);

  async function loadSummary() {
    if (batches.length === 0) return;
    setLoadingChart(true);
    const batchNosToCheck = selectedBatch
      ? [selectedBatch]
      : batches.filter(b => b.batchStatus === 'Active').map(b => b.batchNo).slice(0, 10);

    const allData = [];
    for (const bn of batchNosToCheck.slice(0, 5)) {
      const r = await api.get(`/coordinator/batches/${bn}`, 'coordinator');
      if (r.ok && r.data.trainees) allData.push(...r.data.trainees);
    }

    const total = allData.length;
    const certified = allData.filter(t => t.certificationStatus === 'Certified').length;
    const atRisk = allData.filter(t => ['CRITICAL', 'HIGH'].includes(t.riskStatus)).length;
    const watch = allData.filter(t => t.riskStatus === 'WATCH').length;
    const avgCourse = total ? Math.round(allData.reduce((s, t) => s + (t.courseCompletionPct || 0), 0) / total) : 0;
    const avgMcq = total ? Math.round(allData.reduce((s, t) => s + (t.assessmentPassPct || 0), 0) / total) : 0;
    setSummary({ total, certified, atRisk, watch, avgCourse, avgMcq, ok: total - atRisk - watch });
    setLoadingChart(false);
  }

  async function doExport(key, url, filename) {
    setExportLoading(s => ({ ...s, [key]: true }));
    setMsg(null);
    try {
      await downloadCsv(url, filename, 'coordinator');
    } catch {
      setMsg({ type: 'bad', text: 'Download failed. Check your connection.' });
    }
    setExportLoading(s => ({ ...s, [key]: false }));
  }

  const d = new Date().toISOString().slice(0, 10);
  const p = new URLSearchParams();
  if (selectedBatch) p.set('batchNo', selectedBatch);
  const bl = selectedBatch || 'my-batches';

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--ink)', font: { size: 10 } } } },
  };

  const riskData = summary ? {
    labels: ['CRITICAL/HIGH', 'WATCH', 'On Track'],
    datasets: [{ data: [summary.atRisk, summary.watch, summary.ok], backgroundColor: [C.red, C.amber, C.green], borderWidth: 0 }],
  } : null;

  const completionData = summary ? {
    labels: ['Course Completion', 'MCQ Pass Rate'],
    datasets: [{
      label: 'Average %',
      data: [summary.avgCourse, summary.avgMcq],
      backgroundColor: [`${C.blue}99`, `${C.amber}99`],
      borderRadius: 6,
    }],
  } : null;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>Reports & Exports</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
          Export compliance-grade CSV reports scoped to your batches.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* Filter */}
      <div style={{ background: 'var(--card-solid)', borderRadius: 12, border: '1.5px solid var(--line)', padding: '14px 18px', marginBottom: 20 }}>
        <div className="field" style={{ margin: 0, maxWidth: 300 }}>
          <label>Filter by Batch (optional)</label>
          <select className="select" value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)}>
            <option value="">All My Batches</option>
            {batches.map(b => <option key={b.batchNo} value={b.batchNo}>{b.batchNo}{b.batchName ? ` — ${b.batchName}` : ''}</option>)}
          </select>
        </div>
      </div>

      {/* Quick charts */}
      {!loadingChart && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Trainees', value: summary.total, color: C.blue },
            { label: 'Certified', value: summary.certified, color: C.green },
            { label: 'At Risk', value: summary.atRisk, color: C.red },
            { label: 'Avg Course %', value: `${summary.avgCourse}%`, color: C.purple },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--card-solid)', borderRadius: 12, border: '1.5px solid var(--line)', padding: '12px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: s.color, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {!loadingChart && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14, marginBottom: 24 }}>
          <div style={{ background: 'var(--card-solid)', borderRadius: 12, border: '1.5px solid var(--line)', padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>RISK SPLIT</div>
            <div style={{ height: 140 }}>{riskData && <Doughnut data={riskData} options={{ ...chartOpts, cutout: '60%' }} />}</div>
          </div>
          <div style={{ background: 'var(--card-solid)', borderRadius: 12, border: '1.5px solid var(--line)', padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>AVG PERFORMANCE</div>
            <div style={{ height: 140 }}>{completionData && (
              <Bar data={completionData} options={{
                ...chartOpts,
                scales: {
                  x: { ticks: { color: 'var(--muted)', font: { size: 10 } }, grid: { display: false } },
                  y: { ticks: { color: 'var(--muted)', font: { size: 10 } }, max: 100, grid: { color: 'var(--line)' } },
                },
              }} />
            )}</div>
          </div>
        </div>
      )}

      {/* Export cards */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 12 }}>Export Reports</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        <ExportCard
          icon="👥" title="Trainee Progress" btnColor={C.blue}
          desc="All trainees in your batches with KPI metrics and certification status."
          cols="Employee ID, Name, Batch, Branch, Process, Batch Start/End, Onboarding Date, Last Updated, Course %, MCQ %, Attendance %, Risk, Cert Status"
          loading={!!exportLoading['trainee-progress']}
          onExport={() => doExport('trainee-progress', `/coordinator/reports/trainee-progress?${p}`, `trainee-progress-${bl}-${d}.csv`)}
        />
        <ExportCard
          icon="⚠️" title="At-Risk Trainees" btnColor={C.red}
          desc="CRITICAL, HIGH, and WATCH risk trainees with risk type and flag timestamps."
          cols="Employee ID, Name, Batch, Branch, Process, Batch Start/End, Risk Level, Risk Reason, Risk Type, Risk Flagged At, Course %, MCQ %, Attendance %"
          loading={!!exportLoading['at-risk']}
          onExport={() => doExport('at-risk', `/coordinator/reports/at-risk?${p}`, `at-risk-${bl}-${d}.csv`)}
        />
        <ExportCard
          icon="💬" title="Q&A Activity Log" btnColor={C.purple}
          desc="All queries raised in your batches with raised/answered/closed timestamps and TAT."
          cols="Query ID, Employee ID, Batch, Module, Query Text, Status, Priority, Raised At, Answered At, Closed At, TAT (hours), Answer"
          loading={!!exportLoading['qa-activity']}
          onExport={() => doExport('qa-activity', `/coordinator/reports/qa-activity?${p}`, `qa-activity-${bl}-${d}.csv`)}
        />
      </div>
    </div>
  );
}
