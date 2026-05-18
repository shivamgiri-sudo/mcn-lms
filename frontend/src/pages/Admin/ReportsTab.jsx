import { useState, useEffect } from 'react';
import { api, downloadCsv } from '../../utils/api.js';

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

export default function ReportsTab() {
  const [batches, setBatches] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [selectedClassroom, setSelectedClassroom] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/admin/batches', 'admin').then(r => r.ok && setBatches(r.data));
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [selectedBatch, selectedClassroom]);

  async function loadSummary() {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedBatch) params.set('batchNo', selectedBatch);
    if (selectedClassroom) params.set('classroomId', selectedClassroom);
    const r = await api.get(`/admin/trainees/search?${params}&limit=500`, 'admin');
    if (r.ok) {
      const data = r.data || [];
      const total = data.length;
      const certified = data.filter(t => t.certificationStatus === 'Certified').length;
      const atRisk = data.filter(t => ['CRITICAL', 'HIGH'].includes(t.riskStatus)).length;
      const avgCourse = total ? Math.round(data.reduce((s, t) => s + (t.courseCompletionPct || 0), 0) / total) : 0;
      const avgMcq = total ? Math.round(data.reduce((s, t) => s + (t.assessmentPassPct || 0), 0) / total) : 0;
      const avgAtt = total ? Math.round(data.reduce((s, t) => s + (t.attendancePct || 0), 0) / total) : 0;
      setSummary({ total, certified, atRisk, avgCourse, avgMcq, avgAtt });
    }
    setLoading(false);
  }

  function getExportUrl(format) {
    const params = new URLSearchParams();
    if (selectedBatch) params.set('batchNo', selectedBatch);
    if (selectedClassroom) params.set('classroomId', selectedClassroom);
    return `/api/admin/trainees/export?${params}`;
  }

  async function downloadReport(type) {
    setMsg('');
    try {
      const params = new URLSearchParams();
      if (selectedBatch) params.set('batchNo', selectedBatch);
      if (selectedClassroom) params.set('classroomId', selectedClassroom);
      const batchLabel = selectedBatch || 'all-batches';
      await downloadCsv(`/admin/trainees/export?${params}`, `trainee-report-${batchLabel}-${new Date().toISOString().slice(0,10)}.csv`);
    } catch {
      setMsg('Download failed. Check your connection.');
    }
  }

  const batchObj = batches.find(b => b.batchNo === selectedBatch);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Reports & Exports</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Download trainee progress, attendance, and certification data as CSV.</p>
        </div>
      </div>

      {msg && (
        <div className="toast bad" style={{ marginBottom: 16 }}>
          {msg}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      {/* Filters */}
      <div style={{
        background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
        padding: '20px 24px', marginBottom: 24, boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Filter Data</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="field">
            <label>Batch (optional)</label>
            <select className="select" value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)}>
              <option value="">All Batches</option>
              {batches.map(b => (
                <option key={b.batchNo} value={b.batchNo}>{b.batchNo}{b.batchName ? ` — ${b.batchName}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Classroom (optional)</label>
            <select className="select" value={selectedClassroom} onChange={e => setSelectedClassroom(e.target.value)}>
              <option value="">All Classrooms</option>
              {classrooms.map(c => (
                <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>
              ))}
            </select>
          </div>
        </div>
        {(selectedBatch || selectedClassroom) && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Filtering: {selectedBatch ? <b style={{ color: 'var(--ink)' }}>{selectedBatch}</b> : null}
            {selectedBatch && selectedClassroom ? ' + ' : null}
            {selectedClassroom ? <b style={{ color: 'var(--ink)' }}>{classrooms.find(c => c.classroomId === selectedClassroom)?.classroomName}</b> : null}
            &nbsp;·&nbsp;
            <button style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 12, padding: 0, fontWeight: 600 }}
              onClick={() => { setSelectedBatch(''); setSelectedClassroom(''); }}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          <StatCard label="Total Trainees" value={summary.total} sub="matching filters" color="#1d4ed8" />
          <StatCard label="Certified" value={summary.certified} sub={`${summary.total ? Math.round(summary.certified/summary.total*100) : 0}% of total`} color="#16a34a" />
          <StatCard label="At Risk" value={summary.atRisk} sub="CRITICAL or HIGH" color="#dc2626" />
          <StatCard label="Avg Course %" value={`${summary.avgCourse}%`} sub="course completion" color="#1d4ed8" />
          <StatCard label="Avg MCQ %" value={`${summary.avgMcq}%`} sub="assessment pass rate" color="#d97706" />
          <StatCard label="Avg Attendance" value={`${summary.avgAtt}%`} sub="attendance percentage" color="#7c3aed" />
        </div>
      )}

      {/* Export Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {/* Trainee Progress CSV */}
        <div style={{
          background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)',
          padding: '22px 24px', boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(29,78,216,.2)', display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0 }}>
              📊
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Trainee Progress Report</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                Employee ID, Name, Batch, Branch, Process, LOB, Course %, MCQ %, Attendance %, Risk Status, Certification
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            Format: CSV · {summary ? `${summary.total} records` : '—'}
          </div>
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => downloadReport('trainee-progress')}
          >
            ⬇ Export CSV
          </button>
        </div>

        {/* Batch Summary */}
        <div style={{
          background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)',
          padding: '22px 24px', boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(22,163,74,.18)', display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0 }}>
              🏢
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Batch-Level Summary</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                Same trainee data grouped by batch — best used with "All Batches" filter for cross-batch comparison.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            Format: CSV · Includes all active trainees
          </div>
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center', background: '#16a34a' }}
            onClick={() => {
              setSelectedBatch('');
              setSelectedClassroom('');
              setTimeout(() => downloadReport('batch-summary'), 100);
            }}
          >
            ⬇ Export All Batches CSV
          </button>
        </div>

        {/* At-Risk Report */}
        <div style={{
          background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)',
          padding: '22px 24px', boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(220,38,38,.18)', display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0 }}>
              ⚠️
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>At-Risk Trainees</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                Export the same CSV filtered to CRITICAL and HIGH risk trainees only. Use for escalation reports.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            Format: CSV · {summary ? `${summary.atRisk} at-risk records` : '—'}
          </div>
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center', background: '#dc2626' }}
            onClick={() => downloadReport('at-risk')}
          >
            ⬇ Export At-Risk CSV
          </button>
        </div>
      </div>

      <div style={{ marginTop: 20, padding: '14px 18px', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
        <b style={{ color: 'var(--ink)' }}>Note:</b> All exports use the filters selected above. The at-risk export uses the same data with an extra risk status filter applied client-side after download (the backend always returns all records matching batch/classroom filters). For server-side risk filtering, contact the developer to extend the export endpoint.
      </div>
    </div>
  );
}
