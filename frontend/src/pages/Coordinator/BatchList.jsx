import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import { formatDate } from '../../utils/format.js';
import { BranchSelect } from '../../components/OrgSelect.jsx';

export default function BatchList({ onSelectBatch, user }) {
  const [batches, setBatches] = useState([]);
  const [statusFilter, setStatusFilter] = useState('Active');
  const [showCreate, setShowCreate] = useState(false);
  const [processList, setProcessList] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [form, setForm] = useState({ batchName: '', batchType: 'NHT', branch: '', process: '', lob: '', classroomId: '', startDate: '', endDate: '', expectedTrainees: '', remarks: '' });
  const [autoName, setAutoName] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
    api.get('/coordinator/process-lob', 'coordinator').then(r => r.ok && setProcessList(r.data));
    api.get('/coordinator/classrooms', 'coordinator').then(r => r.ok && setClassrooms(r.data));
  }, [statusFilter]);

  async function load() {
    const res = await api.get(`/coordinator/batches?status=${statusFilter}`, 'coordinator');
    if (res.ok) setBatches(res.data);
  }

  function getAutoName() {
    const { process, lob, startDate } = form;
    if (!process || !lob) return '';
    const d = startDate ? new Date(startDate) : new Date();
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yr = String(d.getFullYear()).slice(-2);
    const pro = process.replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
    const lobCode = lob.replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
    return `${pro}_${lobCode}_${mon}'${yr}_###`;
  }

  useEffect(() => { setAutoName(getAutoName()); }, [form.process, form.lob, form.startDate]);

  async function createBatch(e) {
    e.preventDefault();
    if (!form.process || !form.lob) return setMsg('Process and LOB required.');
    setLoading(true); setMsg('');
    const res = await api.post('/coordinator/batches', { ...form, branch: form.branch || user?.branch }, 'coordinator');
    setLoading(false);
    if (res.ok) {
      setShowCreate(false);
      setForm({ batchName: '', batchType: 'NHT', branch: '', process: '', lob: '', classroomId: '', startDate: '', endDate: '', expectedTrainees: '', remarks: '' });
      load();
    } else setMsg(res.message || 'Failed to create batch.');
  }

  const uniqueProcesses = [...new Set(processList.map(p => p.process))];
  const lobsForProcess = processList.filter(p => p.process === form.process).map(p => p.lob);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 16px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['Active', 'Closed', 'All'].map(s => (
            <button key={s} className={`tab-btn${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
        {user?.permissions?.canCreateBatch && (
          <button className="btn small" onClick={() => setShowCreate(true)}>+ New Batch</button>
        )}
      </div>

      {batches.length === 0 && (
        <div className="empty">No {statusFilter.toLowerCase()} batches found.</div>
      )}

      {/* Batch tiles grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {batches.map(b => <BatchTile key={b.id} batch={b} onClick={() => onSelectBatch(b.batchNo)} />)}
      </div>

      {/* Create Batch Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal-box">
            <div className="modal-head">
              <b>Create New Batch</b>
              <button className="btn small secondary" onClick={() => setShowCreate(false)}>Close</button>
            </div>
            <div className="modal-body">
              {autoName && <div className="pill info" style={{ marginBottom: 12 }}>Auto Batch No: {autoName}</div>}
              <form onSubmit={createBatch}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label>Process *</label>
                    <select className="select" value={form.process} onChange={e => setForm(p => ({ ...p, process: e.target.value, lob: '' }))}>
                      <option value="">Select process...</option>
                      {uniqueProcesses.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>LOB *</label>
                    <select className="select" value={form.lob} onChange={e => setForm(p => ({ ...p, lob: e.target.value }))} disabled={!form.process}>
                      <option value="">Select LOB...</option>
                      {lobsForProcess.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Batch Type</label>
                    <select className="select" value={form.batchType} onChange={e => setForm(p => ({ ...p, batchType: e.target.value }))}>
                      {['NHT', 'Refresher', 'Process Update', 'Other'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Branch</label>
                    <BranchSelect portal="coordinator" value={form.branch} onChange={next => setForm(p => ({ ...p, branch: next }))} placeholder={user?.branch || 'Select branch'} />
                  </div>
                  <div className="field">
                    <label>Start Date</label>
                    <input className="input" type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>End Date</label>
                    <input className="input" type="date" value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Assign Classroom</label>
                    <select className="select" value={form.classroomId} onChange={e => setForm(p => ({ ...p, classroomId: e.target.value }))}>
                      <option value="">No classroom yet...</option>
                      {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Expected Trainees</label>
                    <input className="input" type="number" min="1" value={form.expectedTrainees} onChange={e => setForm(p => ({ ...p, expectedTrainees: e.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>Batch Name (optional)</label>
                  <input className="input" placeholder="Leave blank to auto-generate" value={form.batchName} onChange={e => setForm(p => ({ ...p, batchName: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Remarks</label>
                  <input className="input" value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} />
                </div>
                {msg && <div className="toast bad">{msg}</div>}
                <button className="btn" type="submit" disabled={loading} style={{ marginTop: 10 }}>
                  {loading ? 'Creating...' : 'Create Batch'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchTile({ batch: b, onClick }) {
  const course = b.avgCompletionPct || 0;
  const mcq = b.avgMcqPct || 0;
  const att = b.avgAttendancePct || 0;
  const isActive = b.batchStatus === 'Active';
  const hasRisk = b.riskCount > 0;
  const health = b.batchHealth || (course >= 80 && att >= 80 ? 'Good' : course >= 50 || att >= 50 ? 'Average' : 'At Risk');
  const healthColor = health === 'Good' ? '#16a34a' : health === 'Average' ? '#d97706' : '#dc2626';
  const healthBg = health === 'Good' ? '#f0fdf4' : health === 'Average' ? '#fffbeb' : '#fef2f2';
  const accentColor = isActive ? (hasRisk ? '#dc2626' : '#1d4ed8') : '#9ca3af';

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card-solid)',
        border: `1.5px solid ${hasRisk ? '#fecaca' : '#e2e5ea'}`,
        borderRadius: 16,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(17,24,39,.06)',
        transition: 'all .15s',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(17,24,39,.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(17,24,39,.06)'; }}
    >
      {/* Accent bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)` }} />

      <div style={{ padding: '14px 16px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 900, fontSize: 13.5, color: 'var(--ink)' }}>{b.batchNo}</span>
              <span className={`pill ${isActive ? 'ok' : ''}`} style={{ fontSize: 10 }}>{b.batchStatus}</span>
              {b.batchType && b.batchType !== 'NHT' && <span className="pill info" style={{ fontSize: 10 }}>{b.batchType}</span>}
              {hasRisk && <span className="pill bad" style={{ fontSize: 10 }}>⚠ {b.riskCount} at risk</span>}
            </div>
            {b.batchName && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {b.batchName}
              </div>
            )}
          </div>
          {/* Health badge */}
          <div style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 99, background: healthBg, color: healthColor, fontSize: 11, fontWeight: 700, border: `1px solid ${healthColor}33` }}>
            {health === 'Good' ? '✓ ' : health === 'Average' ? '~ ' : '⚠ '}{health}
          </div>
        </div>

        {/* Process / Branch / Classroom / Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', marginBottom: 12 }}>
          <MetaRow icon="🏢" label={`${b.process} / ${b.lob}`} />
          <MetaRow icon="📍" label={b.branch || '—'} />
          <MetaRow icon="👥" label={`${b.totalTrainees || 0} trainees${b.expectedTrainees ? ` (${b.expectedTrainees} expected)` : ''}`} />
          {b.classroomName
            ? <MetaRow icon="🏫" label={b.classroomName} />
            : <MetaRow icon="🏫" label="No classroom" muted />
          }
          <MetaRow icon="📅" label={b.startDate ? `Start: ${formatDate(b.startDate)}` : 'No start date'} muted={!b.startDate} />
          <MetaRow icon="🏁" label={b.endDate ? `End: ${formatDate(b.endDate)}` : 'No end date'} muted={!b.endDate} />
        </div>

        {/* Metric bars */}
        <div style={{ display: 'grid', gap: 7 }}>
          <MetricBar label="Course Completion" value={course} color={course >= 80 ? '#16a34a' : course >= 40 ? '#1d4ed8' : '#d97706'} />
          <MetricBar label="MCQ Score Avg" value={mcq} color={mcq >= 70 ? '#16a34a' : mcq >= 40 ? '#7c3aed' : '#dc2626'} />
          <MetricBar label="Attendance" value={att} color={att >= 80 ? '#16a34a' : att >= 60 ? '#0891b2' : '#d97706'} />
        </div>

        {/* Certified count */}
        {b.certifiedCount > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eef0f4', display: 'flex', gap: 16 }}>
            <MiniStat num={b.certifiedCount} label="Certified" color="#16a34a" />
          </div>
        )}
      </div>
    </div>
  );
}

function MetricBar({ label, value, color }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color }}>{value}%</span>
      </div>
      <div style={{ height: 5, background: '#eef0f5', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width .5s ease' }} />
      </div>
    </div>
  );
}


function MetaRow({ icon, label, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: muted ? '#9ca3af' : '#374151', overflow: 'hidden' }}>
      <span style={{ flexShrink: 0, fontSize: 11 }}>{icon}</span>
      <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  );
}

function MiniStat({ num, label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 900, color }}>{num}</span>
      <span style={{ fontSize: 10, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
    </div>
  );
}
