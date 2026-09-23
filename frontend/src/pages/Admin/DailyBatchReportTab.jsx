import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

const ACTIVITY_FIELDS = [
  ['typingTest', 'Daily Typing Test'],
  ['classroomCurriculum', 'Classroom Curriculum'],
  ['videoCourse', 'Video Course'],
  ['assessment', 'Assessment'],
  ['learningNugget', 'Learning Nuggets'],
  ['pkt', 'PKT'],
  ['calibration', 'Calibration'],
  ['certification', 'Certification'],
  ['eLearning', 'E-learning'],
];

export default function DailyBatchReportTab({ isSuper }) {
  const [tab, setTab] = useState('dashboard'); // dashboard | activity-config | settings | history
  const [msg, setMsg] = useState({ text: '', ok: true });
  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 6000); }

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['dashboard', '📊 Dashboard'], ['history', '🗂️ Email History'], isSuper && ['activity-config', '⚙️ Activity Config'], isSuper && ['settings', '🛠️ Settings']]
          .filter(Boolean)
          .map(([id, label]) => (
            <button key={id} className={`btn small ${tab === id ? 'accent' : 'secondary'}`} onClick={() => setTab(id)}>{label}</button>
          ))}
      </div>
      {msg.text && <div className={msg.ok ? 'toast ok' : 'toast bad'}>{msg.text}</div>}
      {tab === 'dashboard' && <DashboardPanel toast={toast} />}
      {tab === 'history' && <HistoryPanel toast={toast} />}
      {tab === 'activity-config' && isSuper && <ActivityConfigPanel toast={toast} />}
      {tab === 'settings' && isSuper && <SettingsPanel toast={toast} />}
    </div>
  );
}

function DashboardPanel({ toast }) {
  const [rows, setRows] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const res = await api.get('/daily-batch-report/dashboard', 'admin');
    if (res.ok) setRows(res.data); else toast(res.message || 'Failed to load.', false);
  }

  async function doPreview(batchNo) {
    setPreviewLoading(batchNo);
    const res = await api.get(`/daily-batch-report/batches/${batchNo}/preview`, 'admin');
    setPreviewLoading(null);
    if (res.ok) setPreview({ batchNo, ...res.data });
    else toast(res.message || 'Preview failed.', false);
  }

  async function doSend(batchNo) {
    const res = await api.post(`/daily-batch-report/batches/${batchNo}/send`, {}, 'admin');
    if (res.ok) { toast(`✓ ${res.message}`); load(); }
    else toast(res.message || 'Send failed.', false);
  }

  if (!rows) return <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Batch</th><th>Process</th><th>Branch</th><th>Coordinator</th>
              <th>Strength</th><th>Present</th><th>Today's Activities</th><th>Report Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.batchNo}>
                <td><b>{r.batchName}</b><div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{r.batchNo}</div></td>
                <td>{r.process || '—'}</td>
                <td>{r.branch || '—'}</td>
                <td>{r.coordinatorName || '—'}</td>
                <td>{r.strength}</td>
                <td>{r.present}</td>
                <td style={{ fontSize: 12 }}>{r.activitiesIncluded ? r.activitiesIncluded.join(', ') : '—'}</td>
                <td><span className={`pill ${r.reportStatus === 'Sent' ? 'ok' : r.reportStatus === 'Flagged' || r.reportStatus === 'Failed' ? 'bad' : ''}`}>{r.reportStatus}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small secondary" disabled={previewLoading === r.batchNo} onClick={() => doPreview(r.batchNo)}>{previewLoading === r.batchNo ? 'Loading…' : 'Preview'}</button>
                    <button className="btn small accent" onClick={() => doSend(r.batchNo)}>Send</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal-box" style={{ maxWidth: 800, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-head">
              <b>Preview — {preview.batchNo}</b>
              <button className="btn small secondary" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                <b>Subject:</b> {preview.subject}<br/>
                <b>To:</b> {preview.recipients.to || <span style={{ color: 'var(--bad)' }}>Missing</span>}<br/>
                <b>CC:</b> {preview.recipients.cc.length ? preview.recipients.cc.join(', ') : <span style={{ color: 'var(--bad)' }}>None resolved</span>}
                {preview.recipients.missing.length > 0 && (
                  <div className="toast bad" style={{ marginTop: 8 }}>{preview.recipients.missing.join(' ')}</div>
                )}
              </p>
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: '#fff' }} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ toast }) {
  const [rows, setRows] = useState(null);
  const [filters, setFilters] = useState({ batchNo: '', dateFrom: '', dateTo: '', status: '' });

  useEffect(() => { load(); }, []);
  async function load() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const res = await api.get(`/daily-batch-report/history?${params.toString()}`, 'admin');
    if (res.ok) setRows(res.data);
  }

  async function resend(id) {
    const res = await api.post(`/daily-batch-report/history/${id}/resend`, {}, 'admin');
    if (res.ok) { toast('✓ Report resent.'); load(); }
    else toast(res.message || 'Resend failed.', false);
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field"><label>Batch No</label><input className="input" value={filters.batchNo} onChange={e => setFilters(p => ({ ...p, batchNo: e.target.value }))} /></div>
        <div className="field"><label>From</label><input className="input" type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} /></div>
        <div className="field"><label>To</label><input className="input" type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} /></div>
        <div className="field">
          <label>Status</label>
          <select className="select" value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}>
            <option value="">All</option><option value="Sent">Sent</option><option value="Failed">Failed</option><option value="Flagged">Flagged</option>
          </select>
        </div>
        <button className="btn accent" onClick={load}>Search</button>
      </div>
      {rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Batch</th><th>Process</th><th>Recipient</th><th>Status</th><th>Trigger</th><th>Sent At</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.reportDate).toLocaleDateString()}</td>
                  <td>{r.batchNo}</td>
                  <td>{r.process || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.recipientTo || '—'}</td>
                  <td><span className={`pill ${r.status === 'Sent' ? 'ok' : 'bad'}`}>{r.status}</span></td>
                  <td>{r.triggerType}</td>
                  <td>{r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}</td>
                  <td><button className="btn small secondary" onClick={() => resend(r.id)}>Resend</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActivityConfigPanel({ toast }) {
  const [rows, setRows] = useState([]);
  const [processList, setProcessList] = useState([]);
  const [form, setForm] = useState({ process: '', lob: '' });

  useEffect(() => { load(); loadProcessLob(); }, []);
  async function load() {
    const res = await api.get('/daily-batch-report/activity-config', 'admin');
    if (res.ok) setRows(res.data);
  }
  async function loadProcessLob() {
    const res = await api.get('/admin/process-lob', 'admin');
    if (res.ok) setProcessList(res.data);
  }

  function toggle(row, key) {
    setRows(prev => prev.map(r => r === row ? { ...r, [key]: !r[key] } : r));
  }

  async function save(row) {
    const res = await api.post('/daily-batch-report/activity-config', row, 'admin');
    if (res.ok) toast(`✓ Saved for ${row.process} / ${row.lob}.`);
    else toast(res.message || 'Failed.', false);
  }

  function addRow(e) {
    e.preventDefault();
    if (!form.process || !form.lob) return;
    setRows(prev => [...prev, { process: form.process, lob: form.lob, typingTest: false, classroomCurriculum: false, videoCourse: false, assessment: false, learningNugget: false, pkt: false, calibration: false, certification: false, eLearning: false }]);
    setForm({ process: '', lob: '' });
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ marginTop: 0 }}>Add Process / LOB</h4>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6 }}>
          This defines what activities are POSSIBLE for a process. Whatever actually happened on a given day still decides what appears in that day's email — a process configured for Assessment does not get an "Assessment: Pending" line on a day nothing was assigned.
        </p>
        <form onSubmit={addRow} style={{ display: 'flex', gap: 10 }}>
          <select className="select" value={form.process} onChange={e => setForm(p => ({ ...p, process: e.target.value }))}>
            <option value="">Select process…</option>
            {[...new Set(processList.map(p => p.process))].map(p => <option key={p}>{p}</option>)}
          </select>
          <select className="select" value={form.lob} onChange={e => setForm(p => ({ ...p, lob: e.target.value }))} disabled={!form.process}>
            <option value="">Select LOB…</option>
            {processList.filter(p => p.process === form.process).map(p => <option key={p.lob}>{p.lob}</option>)}
          </select>
          <button className="btn accent" disabled={!form.process || !form.lob}>+ Add</button>
        </form>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b>{row.process} / {row.lob}</b>
            <button className="btn small accent" onClick={() => save(row)}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {ACTIVITY_FIELDS.map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={!!row[key]} onChange={() => toggle(row, key)} /> {label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsPanel({ toast }) {
  const [form, setForm] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const res = await api.get('/daily-batch-report/settings', 'admin');
    if (res.ok) setForm(res.data);
  }

  async function save(e) {
    e.preventDefault();
    const res = await api.put('/daily-batch-report/settings', form, 'admin');
    if (res.ok) { toast('✓ Settings saved.'); setForm(res.data); }
    else toast(res.message || 'Failed.', false);
  }

  if (!form) return <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>;
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="card" style={{ padding: 20, maxWidth: 560 }}>
      <h4 style={{ marginTop: 0 }}>Daily Batch Report Settings</h4>
      <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} /> Enable automatic daily sending
        </label>
        <div className="field"><label>Daily Send Time (IST)</label><input className="input" type="time" value={form.sendTime} onChange={e => set('sendTime', e.target.value)} /></div>
        <div className="field"><label>Typing Speed Target (WPM, strictly greater than)</label><input className="input" type="number" value={form.typingWpmTarget} onChange={e => set('typingWpmTarget', Number(e.target.value))} /></div>
        <div className="field"><label>Typing Accuracy Target (%, at least)</label><input className="input" type="number" value={form.typingAccuracyTarget} onChange={e => set('typingAccuracyTarget', Number(e.target.value))} /></div>
        <div className="field"><label>Minimum trainees sharing a gap to raise a Batch-Level TNI</label><input className="input" type="number" min="1" value={form.tniMinTraineeCount} onChange={e => set('tniMinTraineeCount', Number(e.target.value))} /></div>
        <div className="field"><label>Minimum % of present trainees sharing a gap to raise a TNI</label><input className="input" type="number" min="0" max="100" value={form.tniMinPct} onChange={e => set('tniMinPct', Number(e.target.value))} /></div>
        <div className="field"><label>Super Admin CC Emails (comma-separated)</label><input className="input" value={form.superAdminEmails || ''} onChange={e => set('superAdminEmails', e.target.value)} placeholder="superadmin@company.com" /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.requirePreviewApproval} onChange={e => set('requirePreviewApproval', e.target.checked)} /> Require preview approval before automatic sending
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn accent">Save Settings</button>
        </div>
      </form>
    </div>
  );
}
