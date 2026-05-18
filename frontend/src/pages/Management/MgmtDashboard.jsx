import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import { pct, riskColor } from '../../utils/format.js';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend, ArcElement
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, ArcElement);

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, WATCH: 2 };
const SEVERITY_CLS = { CRITICAL: 'bad', HIGH: 'warn', WATCH: 'info' };

function KpiCard({ label, value, cls = 'info', sub }) {
  return (
    <div className={`stat ${cls}`} style={{ minWidth: 100 }}>
      <div className="num">{value ?? '—'}</div>
      <div className="label">{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function PctBar({ value, cls = 'info' }) {
  const color = cls === 'ok' ? 'var(--ok)' : cls === 'bad' ? 'var(--bad)' : cls === 'warn' ? 'var(--warn)' : 'var(--accent)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="progress-shell" style={{ flex: 1, height: 8 }}>
        <div className="progress-bar" style={{ width: `${value}%`, background: color }} />
      </div>
      <span style={{ fontSize: 12, minWidth: 32, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

function StatusPill({ status }) {
  const cls = status === 'Active' ? 'ok' : status === 'Closed' ? 'info' : 'muted';
  return <span className={`pill ${cls}`}>{status}</span>;
}

export default function MgmtDashboard({ onLogout }) {
  const [kpis, setKpis] = useState(null);
  const [branches, setBranches] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [risks, setRisks] = useState([]);
  const [historical, setHistorical] = useState([]);
  const [batches, setBatches] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  // Risk filters
  const [riskSeverity, setRiskSeverity] = useState('ALL');
  const [riskBranch, setRiskBranch] = useState('');
  const [riskProcess, setRiskProcess] = useState('');
  const [riskLoading, setRiskLoading] = useState(false);

  // Batch filter
  const [batchFilter, setBatchFilter] = useState('ALL');

  // Batch drill-down modal
  const [drillBatch, setDrillBatch] = useState(null);
  const [drillTrainees, setDrillTrainees] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);

  async function openBatchDrill(batch) {
    setDrillBatch(batch);
    setDrillTrainees([]);
    setDrillLoading(true);
    const res = await api.get(`/management/batches/${encodeURIComponent(batch.batchNo)}/trainees`, 'management');
    setDrillLoading(false);
    if (res.ok) setDrillTrainees(res.data);
  }

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [kpiRes, branchRes, procRes, riskRes, histRes, batchRes, coordRes] = await Promise.all([
      api.get('/management/dashboard', 'management'),
      api.get('/management/branch-summaries', 'management'),
      api.get('/management/process-summaries', 'management'),
      api.get('/management/risk-list', 'management'),
      api.get('/management/historical-kpis', 'management'),
      api.get('/management/batch-summaries', 'management'),
      api.get('/management/coordinator-performance', 'management'),
    ]);
    setLoading(false);
    if (kpiRes.ok) setKpis(kpiRes.data);
    if (branchRes.ok) setBranches(branchRes.data);
    if (procRes.ok) setProcesses(procRes.data);
    if (riskRes.ok) setRisks(riskRes.data);
    if (histRes.ok) setHistorical(histRes.data);
    if (batchRes.ok) setBatches(batchRes.data);
    if (coordRes.ok) setCoordinators(coordRes.data);
  }

  async function loadRisks() {
    setRiskLoading(true);
    const params = new URLSearchParams();
    if (riskSeverity !== 'ALL') params.set('severity', riskSeverity);
    if (riskBranch) params.set('branch', riskBranch);
    if (riskProcess) params.set('process', riskProcess);
    const res = await api.get(`/management/risk-list?${params.toString()}`, 'management');
    setRiskLoading(false);
    if (res.ok) setRisks(res.data);
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'batches', label: 'Live Batches' },
    { id: 'closed', label: 'Past Batches' },
    { id: 'branch', label: 'Branch View' },
    { id: 'process', label: 'Process View' },
    { id: 'coordinators', label: 'Coordinators' },
    { id: 'risks', label: 'Risk Tracker' },
    { id: 'trends', label: 'Trends' },
    { id: 'reports', label: 'Reports' },
  ];

  const filteredBatches = batchFilter === 'ALL' ? batches : batches.filter(b => b.status === batchFilter);

  if (loading) return <div style={{ paddingTop: 80, textAlign: 'center' }}><div className="spinner" /></div>;

  const branchNames = [...new Set(branches.map(b => b.branch))];
  const processNames = [...new Set(processes.map(p => p.process).filter(Boolean))];

  return (
    <div className="wrap">
      {/* Header */}
      <div className="hero">
        <div className="brand">
          <div className="logo" style={{ background: 'linear-gradient(135deg,#1a3a8f,#2563eb)', color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MCN</div>
          <div>
            <h1>Management Dashboard</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Real-time training analytics &amp; performance</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small secondary" onClick={loadAll}>↻ Refresh</button>
          <button className="btn small secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* KPI Strip */}
      {kpis && (
        <div className="stat-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <KpiCard label="Active Batches" value={kpis.activeBatches} cls="info" />
          <KpiCard label="Closed Batches" value={kpis.closedBatches} cls="muted" />
          <KpiCard label="Active Trainees" value={kpis.totalActiveTrainees} cls="info" />
          <KpiCard label="Avg Course %" value={`${kpis.avgCourse}%`} cls={kpis.avgCourse >= 70 ? 'ok' : 'warn'} />
          <KpiCard label="Avg MCQ %" value={`${kpis.avgMcq}%`} cls={kpis.avgMcq >= 60 ? 'ok' : 'warn'} />
          <KpiCard label="Avg Attendance %" value={`${kpis.avgAttendance}%`} cls={kpis.avgAttendance >= 70 ? 'ok' : 'warn'} />
          <KpiCard label="Throughput %" value={`${kpis.throughputPct}%`} cls={kpis.throughputPct >= 70 ? 'ok' : 'warn'} sub="Handed to OPS" />
          <KpiCard label="Certification %" value={`${kpis.certPct}%`} cls={kpis.certPct >= 70 ? 'ok' : 'warn'} />
          <KpiCard label="Attrition %" value={`${kpis.attritionPct}%`} cls={kpis.attritionPct > 10 ? 'bad' : kpis.attritionPct > 5 ? 'warn' : 'ok'} />
          <KpiCard label="Critical Risks" value={kpis.criticalRisks} cls={kpis.criticalRisks > 0 ? 'bad' : 'ok'} />
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── OVERVIEW ─── */}
      {activeTab === 'overview' && kpis && (
        <div style={{ marginTop: 14 }}>
          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="card">
              <b style={{ fontSize: 14 }}>Training Health Overview</b>
              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
                {[
                  { label: 'Avg Course Completion', value: kpis.avgCourse, color: '#2563eb', bg: '#eff6ff', threshold: 70 },
                  { label: 'Avg MCQ Score', value: kpis.avgMcq, color: '#16a34a', bg: '#f0fdf4', threshold: 60 },
                  { label: 'Avg Attendance', value: kpis.avgAttendance, color: '#d97706', bg: '#fffbeb', threshold: 70 },
                  { label: 'Certification Rate', value: kpis.certPct, color: '#7c3aed', bg: '#faf5ff', threshold: 60 },
                ].map(m => (
                  <div key={m.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{m.label}</span>
                      <b style={{ color: m.value >= m.threshold ? m.color : '#dc2626', fontSize: 14 }}>{m.value}%</b>
                    </div>
                    <div style={{ height: 10, borderRadius: 99, background: m.bg, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${m.value}%`, background: m.color, borderRadius: 99, transition: 'width .6s ease' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                      Target: {m.threshold}% — {m.value >= m.threshold ? '✓ On track' : `⚠ ${m.threshold - m.value}% below target`}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <b style={{ fontSize: 14 }}>Outcome Funnel</b>
              <div style={{ marginTop: 16 }}>
                {[
                  { label: 'Total Trainees', value: kpis.totalEver, pctVal: 100, cls: 'info' },
                  { label: 'Certified', value: kpis.certified, pctVal: kpis.certPct, cls: 'ok' },
                  { label: 'Handed to OPS', value: kpis.handedOver, pctVal: kpis.throughputPct, cls: 'info' },
                  { label: 'Attrition', value: kpis.attritionCount, pctVal: kpis.attritionPct, cls: 'bad' },
                ].map(row => (
                  <div key={row.label} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>{row.label}</span>
                      <b>{row.value} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({row.pctVal}%)</span></b>
                    </div>
                    <PctBar value={row.pctVal} cls={row.cls} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Risk + Batch health */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
            <div className="card">
              <b style={{ fontSize: 14 }}>Risk Summary</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {[
                  { label: 'CRITICAL', cls: 'bad', val: kpis.criticalRisks },
                  { label: 'HIGH', cls: 'warn', val: Math.max(0, kpis.openRisks - kpis.criticalRisks) },
                  { label: 'ALL OPEN', cls: 'info', val: kpis.openRisks },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={`pill ${r.cls}`} style={{ fontSize: 11 }}>{r.label}</span>
                    <b style={{ fontSize: 20 }}>{r.val}</b>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <b style={{ fontSize: 14 }}>Batch Health Snapshot</b>
              {batches.length === 0 && <div className="empty" style={{ marginTop: 12 }}>No batch data.</div>}
              {batches.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {batches.filter(b => b.status === 'Active').slice(0, 8).map(b => {
                      const health = b.throughputPct >= 50 ? 'ok' : b.attritionPct > 15 ? 'bad' : 'warn';
                      return (
                        <div key={b.batchNo} className="card" onClick={() => openBatchDrill(b)}
                          style={{ padding: '10px 12px', cursor: 'pointer', transition: 'box-shadow .15s,transform .15s' }}
                          onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 18px rgba(15,23,42,.13)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{b.batchNo}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{b.coordinatorName}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                            <span>👥 {b.totalTrainees}</span>
                            <span className={`pill ${health}`} style={{ fontSize: 10, padding: '1px 6px' }}>{b.certPct}% cert</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {batches.filter(b => b.status === 'Active').length > 8 && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'right' }}>
                      +{batches.filter(b => b.status === 'Active').length - 8} more — see Batches tab
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── LIVE BATCHES ─── */}
      {activeTab === 'batches' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ marginRight: 8 }}>Active Batches</b>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)' }}>{batches.filter(b => b.status === 'Active').length} active batch{batches.filter(b => b.status === 'Active').length !== 1 ? 'es' : ''}</span>
          </div>

          {batches.filter(b => b.status === 'Active').length === 0 && <div className="empty">No active batches.</div>}
          {batches.filter(b => b.status === 'Active').length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Batch No</th>
                    <th>Process / LOB</th>
                    <th>Coordinator</th>
                    <th>Trainees</th>
                    <th>Certified</th>
                    <th>Cert %</th>
                    <th>Attrition</th>
                    <th>Attr %</th>
                    <th>Throughput %</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.filter(b => b.status === 'Active').map(b => (
                    <tr key={b.batchNo} onClick={() => openBatchDrill(b)} style={{ cursor: 'pointer' }}>
                      <td><b style={{ fontSize: 13, color: 'var(--brand)' }}>{b.batchNo}</b></td>
                      <td style={{ fontSize: 12 }}>{b.process || '—'}{b.lob ? ` / ${b.lob}` : ''}</td>
                      <td style={{ fontSize: 12 }}>{b.coordinatorName}</td>
                      <td>{b.totalTrainees}</td>
                      <td>{b.certified}</td>
                      <td>
                        <div style={{ minWidth: 80 }}>
                          <PctBar value={b.certPct} cls={b.certPct >= 70 ? 'ok' : b.certPct >= 40 ? 'warn' : 'bad'} />
                        </div>
                      </td>
                      <td>{b.attrition}</td>
                      <td>
                        <span className={`pill ${b.attritionPct > 15 ? 'bad' : b.attritionPct > 5 ? 'warn' : 'ok'}`}>
                          {b.attritionPct}%
                        </span>
                      </td>
                      <td>
                        <div style={{ minWidth: 80 }}>
                          <PctBar value={b.throughputPct} cls={b.throughputPct >= 60 ? 'ok' : 'warn'} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── PAST BATCHES (CLOSED) ─── */}
      {activeTab === 'closed' && (() => {
        const closed = batches.filter(b => b.status === 'Closed');
        const totalClosed = closed.length;
        const totalTrained = closed.reduce((s, b) => s + b.totalTrainees, 0);
        const totalCert = closed.reduce((s, b) => s + b.certified, 0);
        const totalAttr = closed.reduce((s, b) => s + b.attrition, 0);
        const totalHO = closed.reduce((s, b) => s + b.handedOver, 0);
        const avgCertPct = totalTrained > 0 ? Math.round((totalCert / totalTrained) * 100) : 0;
        const avgAttrPct = totalTrained > 0 ? Math.round((totalAttr / totalTrained) * 100) : 0;
        const avgThroughput = totalTrained > 0 ? Math.round((totalHO / totalTrained) * 100) : 0;

        // Group by process for bar chart
        const byProcess = {};
        for (const b of closed) {
          const key = b.process || 'Unknown';
          if (!byProcess[key]) byProcess[key] = { cert: 0, attr: 0, total: 0 };
          byProcess[key].cert += b.certified;
          byProcess[key].attr += b.attrition;
          byProcess[key].total += b.totalTrainees;
        }
        const procLabels = Object.keys(byProcess);
        const procCertPct = procLabels.map(k => byProcess[k].total > 0 ? Math.round(byProcess[k].cert / byProcess[k].total * 100) : 0);
        const procAttrPct = procLabels.map(k => byProcess[k].total > 0 ? Math.round(byProcess[k].attr / byProcess[k].total * 100) : 0);

        return (
          <div style={{ marginTop: 14 }}>
            {/* Summary KPI strip */}
            <div className="stat-row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
              <KpiCard label="Closed Batches" value={totalClosed} cls="info" />
              <KpiCard label="Total Trained" value={totalTrained} cls="info" />
              <KpiCard label="Certified" value={totalCert} cls="ok" />
              <KpiCard label="Cert %" value={`${avgCertPct}%`} cls={avgCertPct >= 70 ? 'ok' : avgCertPct >= 40 ? 'warn' : 'bad'} />
              <KpiCard label="Attrition" value={totalAttr} cls="bad" />
              <KpiCard label="Attr %" value={`${avgAttrPct}%`} cls={avgAttrPct > 15 ? 'bad' : avgAttrPct > 5 ? 'warn' : 'ok'} />
              <KpiCard label="Handed to OPS" value={totalHO} cls="ok" />
              <KpiCard label="Throughput %" value={`${avgThroughput}%`} cls={avgThroughput >= 60 ? 'ok' : 'warn'} />
            </div>

            {closed.length === 0 && <div className="empty">No closed batches yet.</div>}

            {closed.length > 0 && (
              <>
                {/* Charts */}
                {procLabels.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div className="card">
                      <b style={{ fontSize: 14 }}>Outcome Breakdown (All Closed Batches)</b>
                      <div style={{ maxHeight: 240, display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                        <Doughnut
                          data={{
                            labels: ['Certified', 'Attrition', 'Not Certified / Other'],
                            datasets: [{
                              data: [totalCert, totalAttr, Math.max(0, totalTrained - totalCert - totalAttr)],
                              backgroundColor: ['rgba(34,197,94,.75)', 'rgba(230,57,70,.75)', 'rgba(245,158,11,.75)'],
                              borderWidth: 0,
                            }],
                          }}
                          options={{ plugins: { legend: { position: 'right', labels: { color: '#374151', font: { size: 12 } } } }, cutout: '60%' }}
                        />
                      </div>
                    </div>
                    <div className="card">
                      <b style={{ fontSize: 14 }}>Cert % vs Attrition % by Process</b>
                      <div style={{ marginTop: 12 }}>
                        <Bar
                          data={{
                            labels: procLabels,
                            datasets: [
                              { label: 'Cert %', data: procCertPct, backgroundColor: 'rgba(34,197,94,.7)' },
                              { label: 'Attrition %', data: procAttrPct, backgroundColor: 'rgba(230,57,70,.7)' },
                            ],
                          }}
                          options={{
                            responsive: true,
                            plugins: { legend: { position: 'top', labels: { color: '#374151' } } },
                            scales: {
                              y: { max: 100, grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                              x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                            },
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Closed batch table */}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Batch No</th>
                        <th>Process / LOB</th>
                        <th>Coordinator</th>
                        <th>Total</th>
                        <th>Certified</th>
                        <th>Cert %</th>
                        <th>Attrition</th>
                        <th>Attr %</th>
                        <th>Handed to OPS</th>
                        <th>Throughput %</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closed.map(b => {
                        const result = b.certPct >= 70 ? 'GOOD' : b.attritionPct > 15 ? 'POOR' : 'AVERAGE';
                        const resultCls = result === 'GOOD' ? 'ok' : result === 'POOR' ? 'bad' : 'warn';
                        return (
                          <tr key={b.batchNo} onClick={() => openBatchDrill(b)} style={{ cursor: 'pointer' }}>
                            <td><b style={{ fontSize: 13 }}>{b.batchNo}</b></td>
                            <td style={{ fontSize: 12 }}>{b.process || '—'}{b.lob ? ` / ${b.lob}` : ''}</td>
                            <td style={{ fontSize: 12 }}>{b.coordinatorName}</td>
                            <td>{b.totalTrainees}</td>
                            <td>{b.certified}</td>
                            <td>
                              <div style={{ minWidth: 80 }}>
                                <PctBar value={b.certPct} cls={b.certPct >= 70 ? 'ok' : b.certPct >= 40 ? 'warn' : 'bad'} />
                              </div>
                            </td>
                            <td>{b.attrition}</td>
                            <td>
                              <span className={`pill ${b.attritionPct > 15 ? 'bad' : b.attritionPct > 5 ? 'warn' : 'ok'}`}>
                                {b.attritionPct}%
                              </span>
                            </td>
                            <td>{b.handedOver}</td>
                            <td>
                              <div style={{ minWidth: 80 }}>
                                <PctBar value={b.throughputPct} cls={b.throughputPct >= 60 ? 'ok' : 'warn'} />
                              </div>
                            </td>
                            <td><span className={`pill ${resultCls}`}>{result}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ─── BRANCH VIEW ─── */}
      {activeTab === 'branch' && (
        <div style={{ marginTop: 14 }}>
          {branches.length === 0 && <div className="empty">No branch data available.</div>}
          {branches.length > 0 && (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <b style={{ fontSize: 14 }}>Branch Performance</b>
                <div style={{ marginTop: 12 }}>
                  <Bar
                    data={{
                      labels: branches.map(b => b.branch),
                      datasets: [
                        { label: 'Course %', data: branches.map(b => b.avgCourse), backgroundColor: 'rgba(37,99,235,.7)' },
                        { label: 'MCQ %', data: branches.map(b => b.avgMcq), backgroundColor: 'rgba(34,197,94,.7)' },
                        { label: 'Attendance %', data: branches.map(b => b.avgAttendance), backgroundColor: 'rgba(245,158,11,.7)' },
                        { label: 'Cert %', data: branches.map(b => b.certPct), backgroundColor: 'rgba(124,58,237,.7)' },
                      ],
                    }}
                    options={{
                      responsive: true,
                      plugins: { legend: { position: 'top', labels: { color: '#374151' } } },
                      scales: {
                        y: { max: 100, grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                        x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                      },
                    }}
                  />
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Branch</th><th>Total</th><th>Active</th>
                      <th>Avg Course</th><th>Avg MCQ</th><th>Avg Attend</th>
                      <th>Certified</th><th>Cert %</th>
                      <th>Attrition</th><th>Attr %</th>
                      <th>Throughput %</th><th>Critical</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map(b => (
                      <tr key={b.branch}>
                        <td><b>{b.branch}</b></td>
                        <td>{b.count}</td>
                        <td>{b.active}</td>
                        <td><span className={`pill ${b.avgCourse >= 70 ? 'ok' : 'warn'}`}>{b.avgCourse}%</span></td>
                        <td><span className={`pill ${b.avgMcq >= 60 ? 'ok' : 'warn'}`}>{b.avgMcq}%</span></td>
                        <td><span className={`pill ${b.avgAttendance >= 70 ? 'ok' : 'warn'}`}>{b.avgAttendance}%</span></td>
                        <td>{b.certified}</td>
                        <td><span className={`pill ${b.certPct >= 70 ? 'ok' : b.certPct >= 40 ? 'warn' : 'bad'}`}>{b.certPct}%</span></td>
                        <td>{b.attrition}</td>
                        <td><span className={`pill ${b.attritionPct > 15 ? 'bad' : b.attritionPct > 5 ? 'warn' : 'ok'}`}>{b.attritionPct}%</span></td>
                        <td>
                          <div style={{ minWidth: 80 }}><PctBar value={b.throughputPct} cls={b.throughputPct >= 60 ? 'ok' : 'warn'} /></div>
                        </td>
                        <td><span className={`pill ${b.critical > 0 ? 'bad' : 'ok'}`}>{b.critical}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── PROCESS VIEW ─── */}
      {activeTab === 'process' && (
        <div style={{ marginTop: 14 }}>
          {processes.length === 0 && <div className="empty">No process data.</div>}
          {processes.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Process</th><th>LOB</th><th>Total</th><th>Active</th>
                    <th>Avg Course</th><th>Avg MCQ</th><th>Avg Attend</th>
                    <th>Certified</th><th>Cert %</th>
                    <th>Attrition</th><th>Attr %</th>
                    <th>Throughput %</th><th>Critical</th><th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((p, i) => {
                    const health = p.certPct >= 70 && p.critical === 0 ? 'HEALTHY' : p.critical > 0 || p.attritionPct > 15 ? 'CRITICAL' : 'WATCH';
                    return (
                      <tr key={i}>
                        <td><b>{p.process || '—'}</b></td>
                        <td>{p.lob || '—'}</td>
                        <td>{p.count}</td>
                        <td>{p.active}</td>
                        <td><span className={`pill ${p.avgCourse >= 70 ? 'ok' : 'warn'}`}>{p.avgCourse}%</span></td>
                        <td><span className={`pill ${p.avgMcq >= 60 ? 'ok' : 'warn'}`}>{p.avgMcq}%</span></td>
                        <td><span className={`pill ${p.avgAttendance >= 70 ? 'ok' : 'warn'}`}>{p.avgAttendance}%</span></td>
                        <td>{p.certified}</td>
                        <td><span className={`pill ${p.certPct >= 70 ? 'ok' : p.certPct >= 40 ? 'warn' : 'bad'}`}>{p.certPct}%</span></td>
                        <td>{p.attrition}</td>
                        <td><span className={`pill ${p.attritionPct > 15 ? 'bad' : p.attritionPct > 5 ? 'warn' : 'ok'}`}>{p.attritionPct}%</span></td>
                        <td>
                          <div style={{ minWidth: 80 }}><PctBar value={p.throughputPct} cls={p.throughputPct >= 60 ? 'ok' : 'warn'} /></div>
                        </td>
                        <td><span className={`pill ${p.critical > 0 ? 'bad' : 'ok'}`}>{p.critical}</span></td>
                        <td><span className={`pill ${riskColor(health)}`}>{health}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── COORDINATORS ─── */}
      {activeTab === 'coordinators' && (
        <div style={{ marginTop: 14 }}>
          {coordinators.length === 0 && <div className="empty">No coordinator data.</div>}
          {coordinators.length > 0 && (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <b style={{ fontSize: 14 }}>Coordinator Throughput Comparison</b>
                <div style={{ marginTop: 12 }}>
                  <Bar
                    data={{
                      labels: coordinators.slice(0, 12).map(c => c.name),
                      datasets: [
                        { label: 'Throughput %', data: coordinators.slice(0, 12).map(c => c.throughputPct), backgroundColor: 'rgba(37,99,235,.7)' },
                        { label: 'Cert %', data: coordinators.slice(0, 12).map(c => c.certPct), backgroundColor: 'rgba(34,197,94,.7)' },
                        { label: 'Attrition %', data: coordinators.slice(0, 12).map(c => c.attritionPct), backgroundColor: 'rgba(230,57,70,.7)' },
                      ],
                    }}
                    options={{
                      responsive: true,
                      plugins: { legend: { position: 'top', labels: { color: '#374151' } } },
                      scales: {
                        y: { max: 100, grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                        x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280', font: { size: 11 } } },
                      },
                    }}
                  />
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Coordinator</th><th>Login ID</th>
                      <th>Total Batches</th><th>Active</th><th>Closed</th>
                      <th>Trainees</th><th>Certified</th><th>Cert %</th>
                      <th>Attrition</th><th>Attr %</th>
                      <th>Throughput %</th>
                      <th>Avg Course</th><th>Avg MCQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coordinators.map(c => (
                      <tr key={c.loginId}>
                        <td><b>{c.name}</b></td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{c.loginId}</td>
                        <td>{c.totalBatches}</td>
                        <td>{c.activeBatches}</td>
                        <td>{c.closedBatches}</td>
                        <td>{c.totalTrainees}</td>
                        <td>{c.certified}</td>
                        <td><span className={`pill ${c.certPct >= 70 ? 'ok' : c.certPct >= 40 ? 'warn' : 'bad'}`}>{c.certPct}%</span></td>
                        <td>{c.attrition}</td>
                        <td><span className={`pill ${c.attritionPct > 15 ? 'bad' : c.attritionPct > 5 ? 'warn' : 'ok'}`}>{c.attritionPct}%</span></td>
                        <td>
                          <div style={{ minWidth: 90 }}><PctBar value={c.throughputPct} cls={c.throughputPct >= 60 ? 'ok' : 'warn'} /></div>
                        </td>
                        <td><span className={`pill ${c.avgCourse >= 70 ? 'ok' : 'warn'}`}>{c.avgCourse}%</span></td>
                        <td><span className={`pill ${c.avgMcq >= 60 ? 'ok' : 'warn'}`}>{c.avgMcq}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── RISK TRACKER ─── */}
      {activeTab === 'risks' && (
        <div style={{ marginTop: 14 }}>
          {/* Filters */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Severity</label>
                <select className="select" style={{ minWidth: 120 }} value={riskSeverity} onChange={e => setRiskSeverity(e.target.value)}>
                  <option value="ALL">All</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="WATCH">Watch</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Branch</label>
                <select className="select" style={{ minWidth: 140 }} value={riskBranch} onChange={e => setRiskBranch(e.target.value)}>
                  <option value="">All Branches</option>
                  {branchNames.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Process</label>
                <select className="select" style={{ minWidth: 140 }} value={riskProcess} onChange={e => setRiskProcess(e.target.value)}>
                  <option value="">All Processes</option>
                  {processNames.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <button className="btn small" onClick={loadRisks} disabled={riskLoading}>
                {riskLoading ? '...' : 'Apply'}
              </button>
            </div>
          </div>

          {/* Risk count summary */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['CRITICAL', 'HIGH', 'WATCH'].map(sev => {
              const count = risks.filter(r => r.severity === sev).length;
              return (
                <div key={sev} className={`stat ${SEVERITY_CLS[sev]}`} style={{ flex: '0 0 auto', minWidth: 80 }}>
                  <div className="num">{count}</div>
                  <div className="label">{sev}</div>
                </div>
              );
            })}
            <div className="stat info" style={{ flex: '0 0 auto', minWidth: 80 }}>
              <div className="num">{risks.length}</div>
              <div className="label">TOTAL</div>
            </div>
          </div>

          {risks.length === 0 && <div className="empty">No risks match the selected filters.</div>}
          {risks.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)).map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${SEVERITY_CLS[r.severity] || 'muted'})` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className={`pill ${SEVERITY_CLS[r.severity]}`} style={{ fontSize: 10 }}>{r.severity}</span>
                    <b style={{ fontSize: 14 }}>{r.riskTitle}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
                    <span>👤 {r.traineeName || r.employeeId || '—'}</span>
                    <span>📦 {r.batchNo || '—'}</span>
                    {r.branch && <span>🏢 {r.branch}</span>}
                    {r.process && <span>⚙️ {r.process}{r.lob ? ` / ${r.lob}` : ''}</span>}
                  </div>
                  {(r.currentValue != null || r.expectedValue != null) && (
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Current: <b style={{ color: 'var(--bad)' }}>{r.currentValue ?? '—'}%</b>
                      &nbsp;|&nbsp; Expected: <b style={{ color: 'var(--ok)' }}>{r.expectedValue ?? '—'}%</b>
                      {r.currentValue != null && r.expectedValue != null && (
                        <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                          Gap: {r.expectedValue - r.currentValue}%
                        </span>
                      )}
                    </div>
                  )}
                  {r.riskDescription && (
                    <div style={{ fontSize: 12, marginTop: 4, color: 'var(--muted)', fontStyle: 'italic' }}>{r.riskDescription}</div>
                  )}
                </div>
                {r.createdAt && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── TRENDS ─── */}
      {activeTab === 'trends' && (
        <div style={{ marginTop: 14 }}>
          {historical.length === 0 && <div className="empty">No historical data yet. Data syncs monthly.</div>}
          {historical.length > 0 && (() => {
            const rev = historical.slice(0, 12).reverse();
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="card">
                  <b style={{ fontSize: 14 }}>Active Trainees by Month</b>
                  <Line
                    style={{ marginTop: 12 }}
                    data={{
                      labels: rev.map(h => h.period),
                      datasets: [{ label: 'Trainees', data: rev.map(h => h.totalTrainees), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.15)', fill: true, tension: 0.3 }],
                    }}
                    options={{
                      responsive: true,
                      plugins: { legend: { labels: { color: '#374151' } } },
                      scales: {
                        y: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                        x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                      },
                    }}
                  />
                </div>
                <div className="card">
                  <b style={{ fontSize: 14 }}>Avg Completion Trend</b>
                  <Line
                    style={{ marginTop: 12 }}
                    data={{
                      labels: rev.map(h => h.period),
                      datasets: [
                        { label: 'Course %', data: rev.map(h => h.avgCoursePct), borderColor: '#2563eb', tension: 0.3 },
                        { label: 'MCQ %', data: rev.map(h => h.avgMcqPct), borderColor: '#22c55e', tension: 0.3 },
                        { label: 'Attendance %', data: rev.map(h => h.avgAttendancePct), borderColor: '#f59e0b', tension: 0.3 },
                      ],
                    }}
                    options={{
                      responsive: true,
                      plugins: { legend: { labels: { color: '#374151' } } },
                      scales: {
                        y: { max: 100, grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                        x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                      },
                    }}
                  />
                </div>
                {historical[0]?.certifiedCount !== undefined && (
                  <>
                    <div className="card">
                      <b style={{ fontSize: 14 }}>Certification & Attrition Trend</b>
                      <Line
                        style={{ marginTop: 12 }}
                        data={{
                          labels: rev.map(h => h.period),
                          datasets: [
                            { label: 'Certified', data: rev.map(h => h.certifiedCount || 0), borderColor: '#22c55e', tension: 0.3 },
                            { label: 'Attrition', data: rev.map(h => h.attritionCount || 0), borderColor: '#e63946', tension: 0.3 },
                          ],
                        }}
                        options={{
                          responsive: true,
                          plugins: { legend: { labels: { color: '#374151' } } },
                          scales: {
                            y: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                            x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                          },
                        }}
                      />
                    </div>
                    <div className="card">
                      <b style={{ fontSize: 14 }}>Throughput % Trend</b>
                      <Line
                        style={{ marginTop: 12 }}
                        data={{
                          labels: rev.map(h => h.period),
                          datasets: [
                            { label: 'Throughput %', data: rev.map(h => h.throughputPct || 0), borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,.15)', fill: true, tension: 0.3 },
                          ],
                        }}
                        options={{
                          responsive: true,
                          plugins: { legend: { labels: { color: '#374151' } } },
                          scales: {
                            y: { max: 100, grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                            x: { grid: { color: '#f3f4f6' }, ticks: { color: '#6b7280' } },
                          },
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── BATCH DRILL-DOWN MODAL ─── */}
      {drillBatch && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDrillBatch(null)}>
          <div className="modal-box" style={{ maxWidth: 860, width: '95vw' }}>
            <div className="modal-head">
              <div>
                <b style={{ fontSize: 16 }}>Batch {drillBatch.batchNo}</b>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>
                  {drillBatch.process || ''}{drillBatch.lob ? ` / ${drillBatch.lob}` : ''} · {drillBatch.coordinatorName}
                </span>
              </div>
              <button className="btn small secondary" onClick={() => setDrillBatch(null)}>✕ Close</button>
            </div>
            <div className="modal-body">
              {/* Batch KPI strip */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {[
                  { label: 'Trainees', val: drillBatch.totalTrainees, cls: 'info' },
                  { label: 'Certified', val: drillBatch.certified, cls: 'ok' },
                  { label: 'Cert %', val: `${drillBatch.certPct}%`, cls: drillBatch.certPct >= 70 ? 'ok' : drillBatch.certPct >= 40 ? 'warn' : 'bad' },
                  { label: 'Attrition', val: drillBatch.attrition, cls: drillBatch.attritionPct > 15 ? 'bad' : 'warn' },
                  { label: 'Attr %', val: `${drillBatch.attritionPct}%`, cls: drillBatch.attritionPct > 15 ? 'bad' : drillBatch.attritionPct > 5 ? 'warn' : 'ok' },
                  { label: 'Throughput', val: `${drillBatch.throughputPct}%`, cls: drillBatch.throughputPct >= 60 ? 'ok' : 'warn' },
                ].map(k => (
                  <div key={k.label} className={`stat ${k.cls}`} style={{ minWidth: 80, flex: '0 0 auto' }}>
                    <div className="num" style={{ fontSize: 18 }}>{k.val}</div>
                    <div className="label">{k.label}</div>
                  </div>
                ))}
              </div>

              {drillLoading && <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>}

              {!drillLoading && drillTrainees.length === 0 && (
                <div className="empty">No trainees found in this batch.</div>
              )}

              {!drillLoading && drillTrainees.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Employee ID</th>
                        <th>Name</th>
                        <th>Branch</th>
                        <th>Course %</th>
                        <th>MCQ %</th>
                        <th>Attend %</th>
                        <th>Risk</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillTrainees.map(t => {
                        const riskCls = t.riskStatus === 'CRITICAL' ? 'bad' : t.riskStatus === 'HIGH' ? 'warn' : t.riskStatus === 'WATCH' ? 'info' : 'ok';
                        const certCls = t.certificationStatus === 'Certified' ? 'ok' : t.certificationStatus === 'Attrition' ? 'bad' : 'muted';
                        return (
                          <tr key={t.employeeId}>
                            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.employeeId}</td>
                            <td><b style={{ fontSize: 13 }}>{t.traineeName || '—'}</b></td>
                            <td style={{ fontSize: 12 }}>{t.branch || '—'}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
                                <div style={{ flex: 1, height: 6, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${t.courseCompletionPct || 0}%`, background: (t.courseCompletionPct || 0) >= 70 ? '#16a34a' : '#f59e0b', borderRadius: 99 }} />
                                </div>
                                <span style={{ fontSize: 11, minWidth: 28, textAlign: 'right' }}>{t.courseCompletionPct || 0}%</span>
                              </div>
                            </td>
                            <td>
                              <span className={`pill ${(t.assessmentPassPct || 0) >= 60 ? 'ok' : 'warn'}`} style={{ fontSize: 11 }}>{t.assessmentPassPct || 0}%</span>
                            </td>
                            <td>
                              <span className={`pill ${(t.attendancePct || 0) >= 70 ? 'ok' : 'warn'}`} style={{ fontSize: 11 }}>{t.attendancePct || 0}%</span>
                            </td>
                            <td><span className={`pill ${riskCls}`} style={{ fontSize: 10 }}>{t.riskStatus || 'NONE'}</span></td>
                            <td><span className={`pill ${certCls}`} style={{ fontSize: 11 }}>{t.certificationStatus || t.status}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {[
              { title: 'All Trainees Export', desc: 'Full trainee list across all batches — Employee ID, LMS ID, Name, Batch, Branch, Process, Course %, MCQ %, Attendance %, Risk, Certification.', href: '/api/reports/trainees/export', filename: 'all-trainees.csv', icon: '👥' },
              { title: 'Batch Summaries', desc: 'Per-batch summary: Batch No, Process, LOB, Coordinator, Total, Certified %, Attrition %, Throughput %, Status.', href: null, icon: '🏢', key: 'batches' },
              { title: 'Branch Performance', desc: 'Branch-wise breakdown: Total, Certified %, Attrition %, Throughput %, Avg Course/MCQ/Attendance.', href: null, icon: '🌿', key: 'branches' },
              { title: 'Process Performance', desc: 'Process/LOB breakdown with certification, attrition, and health metrics.', href: null, icon: '⚙️', key: 'processes' },
              { title: 'Coordinator Performance', desc: 'Per-coordinator: Batches handled, trainees, Cert %, Attrition %, Throughput %.', href: null, icon: '🧑‍💼', key: 'coordinators' },
              { title: 'At-Risk Trainees', desc: 'All trainees with CRITICAL/HIGH/MEDIUM risk — includes risk reason, batch, branch.', href: null, icon: '⚠️', key: 'risks' },
              { title: 'Historical KPI Trends', desc: 'Month-wise: active trainees, avg completion, cert %, attrition %, throughput %.', href: null, icon: '📈', key: 'historical' },
            ].map(report => {
              const handleClick = async () => {
                const endpoints = { batches: '/management/batch-summaries', branches: '/management/branch-summaries', processes: '/management/process-summaries', coordinators: '/management/coordinator-performance', risks: '/management/risk-list', historical: '/management/historical-kpis' };
                const headers = {
                  batches: ['Batch No','Process','LOB','Coordinator','Total','CertPct%','AttritionPct%','ThroughputPct%','Status'],
                  branches: ['Branch','Total','Certified','Attrition','HandedOver','CertPct%','AttritionPct%','ThroughputPct%','AvgCourse%','AvgMCQ%','AvgAttendance%'],
                  processes: ['Process','LOB','Total','CertPct%','AttritionPct%','ThroughputPct%','AvgCourse%','AvgMCQ%','AvgAttendance%'],
                  coordinators: ['Coordinator','Login ID','Batches','Total','Certified','Attrition','HandedOver','CertPct%','AttritionPct%','ThroughputPct%'],
                  risks: ['Employee ID','Name','Batch','Branch','Process','Severity','Risk Reason','Course%','MCQ%','Attendance%'],
                  historical: ['Period','Branch','Process','Total Trainees','AvgCourse%','AvgMCQ%','AvgAttendance%','CertPct%','AttritionPct%','ThroughputPct%'],
                };
                const rowMap = {
                  batches: d => [d.batchNo,d.process,d.lob,d.coordinatorName,d.totalTrainees,d.certPct,d.attritionPct,d.throughputPct,d.batchStatus],
                  branches: d => [d.branch,d.total,d.certified,d.attrition,d.handedOver,d.certPct,d.attritionPct,d.throughputPct,d.avgCourse,d.avgMcq,d.avgAttendance],
                  processes: d => [d.process,d.lob,d.total,d.certPct,d.attritionPct,d.throughputPct,d.avgCourse,d.avgMcq,d.avgAttendance],
                  coordinators: d => [d.coordinatorName,d.loginId,d.batches,d.totalTrainees,d.certified,d.attrition,d.handedOver,d.certPct,d.attritionPct,d.throughputPct],
                  risks: d => [d.employeeId,d.traineeName,d.batchNo,d.branch,d.process,d.severity,d.riskReason,d.courseCompletionPct,d.assessmentPassPct,d.attendancePct],
                  historical: d => [d.period,d.branch||'All',d.process||'All',d.totalTrainees,d.avgCoursePct,d.avgMcqPct,d.avgAttendancePct,d.certPct,d.attritionPct,d.throughputPct],
                };
                const res = await api.get(endpoints[report.key], 'management');
                if (!res.ok) return alert('Failed to fetch data');
                const rows = [headers[report.key], ...(res.data || []).map(rowMap[report.key])];
                const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
                const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${report.key}-report.csv`; a.click();
              };
              return (
                <div key={report.title} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 24 }}>{report.icon}</span>
                    <div>
                      <b style={{ fontSize: 14, color: 'var(--ink)' }}>{report.title}</b>
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>{report.desc}</p>
                    </div>
                  </div>
                  {report.href
                    ? <a className="btn small" href={report.href} download={report.filename} style={{ alignSelf: 'flex-start' }}>⬇ Download CSV</a>
                    : <button className="btn small" onClick={handleClick} style={{ alignSelf: 'flex-start' }}>⬇ Download CSV</button>
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
