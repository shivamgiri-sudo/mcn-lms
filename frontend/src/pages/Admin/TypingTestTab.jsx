import { useEffect, useState } from 'react';
import { api, downloadCsv } from '../../utils/api.js';

const EMPTY_PARAGRAPH = { text: '', category: '' };
const EMPTY_FILTERS = { date: '', dateFrom: '', dateTo: '', employeeId: '', employeeName: '', process: '', status: '', wpmMin: '', wpmMax: '', accuracyMin: '', accuracyMax: '' };

function toQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  return params.toString();
}

export default function TypingTestTab() {
  const [tab, setTab] = useState('dashboard'); // dashboard | report | paragraphs | settings
  const [msg, setMsg] = useState({ text: '', ok: true });

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 5000); }

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['dashboard', '📊 Dashboard'], ['report', '📋 Detailed Report'], ['paragraphs', '📝 Paragraph Bank'], ['settings', '⚙️ Settings']].map(([id, label]) => (
          <button key={id} className={`btn small ${tab === id ? 'accent' : 'secondary'}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {msg.text && <div className={msg.ok ? 'toast ok' : 'toast bad'}>{msg.text}</div>}
      {tab === 'dashboard' && <DashboardPanel />}
      {tab === 'report' && <ReportPanel toast={toast} />}
      {tab === 'paragraphs' && <ParagraphsPanel toast={toast} />}
      {tab === 'settings' && <SettingsPanel toast={toast} />}
    </div>
  );
}

function DashboardPanel() {
  const [data, setData] = useState(null);
  useEffect(() => { load(); }, []);
  async function load() {
    const res = await api.get('/typing-test/admin/dashboard', 'admin');
    if (res.ok) setData(res.data);
  }
  if (!data) return <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>;
  const cards = [
    ['Attempted Today', data.totalAttempted, '#2563eb'],
    ['Passed', data.totalPassed, '#16a34a'],
    ['Failed', data.totalFailed, '#dc2626'],
    ['Average WPM', data.avgWpm, '#7c3aed'],
    ['Average Accuracy', `${data.avgAccuracy}%`, '#0891b2'],
    ['Highest WPM', data.highestWpm, '#d97706'],
    ['Highest Accuracy', `${data.highestAccuracy}%`, '#059669'],
    ['Not Attempted', data.notAttemptedCount, '#6b7280'],
  ];
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {cards.map(([label, value, color]) => (
          <div key={label} className="card" style={{ padding: 16, textAlign: 'center', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: 26, fontWeight: 900, color }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ marginTop: 0 }}>Users Who Have Not Attempted Today ({data.notAttemptedCount})</h4>
        {data.notAttempted.length === 0 ? <div className="empty">Everyone has attempted today's test.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee ID</th><th>Name</th><th>Branch</th><th>Process</th></tr></thead>
              <tbody>
                {data.notAttempted.map(t => <tr key={t.employeeId}><td>{t.employeeId}</td><td>{t.traineeName || '—'}</td><td>{t.branch || '—'}</td><td>{t.process || '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportPanel({ toast }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState(null);

  async function search() {
    const res = await api.get(`/typing-test/admin/report?${toQuery(filters)}`, 'admin');
    if (res.ok) setRows(res.data); else toast(res.message || 'Failed.', false);
  }
  async function exportCsv() {
    try {
      await downloadCsv(`/typing-test/admin/report/export?${toQuery(filters)}`, `daily-typing-test-report-${new Date().toISOString().slice(0, 10)}.csv`, 'admin');
    } catch (e) { toast(e.message || 'Export failed.', false); }
  }
  function setF(key, value) { setFilters(prev => ({ ...prev, [key]: value })); }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div className="field"><label>Date</label><input className="input" type="date" value={filters.date} onChange={e => setF('date', e.target.value)} /></div>
          <div className="field"><label>From</label><input className="input" type="date" value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} /></div>
          <div className="field"><label>To</label><input className="input" type="date" value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} /></div>
          <div className="field"><label>Employee ID</label><input className="input" value={filters.employeeId} onChange={e => setF('employeeId', e.target.value)} /></div>
          <div className="field"><label>Employee Name</label><input className="input" value={filters.employeeName} onChange={e => setF('employeeName', e.target.value)} /></div>
          <div className="field"><label>Process</label><input className="input" value={filters.process} onChange={e => setF('process', e.target.value)} /></div>
          <div className="field">
            <label>Pass/Fail</label>
            <select className="select" value={filters.status} onChange={e => setF('status', e.target.value)}>
              <option value="">All</option><option value="Pass">Pass</option><option value="Fail">Fail</option>
            </select>
          </div>
          <div className="field"><label>WPM Min</label><input className="input" type="number" value={filters.wpmMin} onChange={e => setF('wpmMin', e.target.value)} /></div>
          <div className="field"><label>WPM Max</label><input className="input" type="number" value={filters.wpmMax} onChange={e => setF('wpmMax', e.target.value)} /></div>
          <div className="field"><label>Accuracy Min</label><input className="input" type="number" value={filters.accuracyMin} onChange={e => setF('accuracyMin', e.target.value)} /></div>
          <div className="field"><label>Accuracy Max</label><input className="input" type="number" value={filters.accuracyMax} onChange={e => setF('accuracyMax', e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn secondary" onClick={() => { setFilters(EMPTY_FILTERS); setRows(null); }}>Reset</button>
          <button className="btn secondary" onClick={exportCsv}>⬇ Export CSV</button>
          <button className="btn accent" onClick={search}>Search</button>
        </div>
      </div>

      {rows && (
        rows.length === 0 ? <div className="empty">No attempts match these filters.</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Employee ID</th><th>Name</th><th>Process</th><th>Gross WPM</th><th>Net WPM</th><th>Accuracy</th><th>Errors</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.attemptDate).toLocaleDateString()}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.employeeId}</td>
                    <td>{r.traineeName || '—'}</td>
                    <td>{r.process || '—'}</td>
                    <td>{r.grossWpm}</td>
                    <td>{r.netWpm}</td>
                    <td>{r.accuracyPct}%</td>
                    <td>{r.errorCount}</td>
                    <td><span className={`pill ${r.status === 'Pass' ? 'ok' : 'bad'}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function ParagraphsPanel({ toast }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY_PARAGRAPH);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const res = await api.get('/typing-test/admin/paragraphs', 'admin');
    if (res.ok) setRows(res.data);
  }

  const wordCount = form.text.trim() ? form.text.trim().split(/\s+/).length : 0;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const res = editing
      ? await api.patch(`/typing-test/admin/paragraphs/${editing.id}`, { text: form.text, category: form.category }, 'admin')
      : await api.post('/typing-test/admin/paragraphs', { text: form.text, category: form.category }, 'admin');
    setSaving(false);
    if (res.ok) {
      toast(editing ? 'Paragraph updated.' : 'Paragraph added.');
      setForm(EMPTY_PARAGRAPH); setEditing(null); load();
    } else toast(res.message || 'Failed.', false);
  }

  async function toggleActive(row) {
    const res = await api.patch(`/typing-test/admin/paragraphs/${row.id}`, { active: !row.active }, 'admin');
    if (res.ok) { toast(`Paragraph ${res.data.active ? 'activated' : 'deactivated'}.`); load(); }
    else toast(res.message || 'Failed.', false);
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ marginTop: 0 }}>{editing ? `Editing paragraph` : 'Add Paragraph'}</h4>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <div className="field">
            <label>Paragraph Text * ({wordCount} words)</label>
            <textarea className="input" style={{ minHeight: 120 }} value={form.text} onChange={e => setForm(p => ({ ...p, text: e.target.value }))} required />
          </div>
          <div className="field"><label>Category (optional)</label><input className="input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. Customer Service" /></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {editing && <button type="button" className="btn secondary" onClick={() => { setEditing(null); setForm(EMPTY_PARAGRAPH); }}>Cancel</button>}
            <button className="btn accent" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Paragraph'}</button>
          </div>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Text</th><th>Words</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id}>
                <td style={{ maxWidth: 420 }}>{p.text.slice(0, 120)}{p.text.length > 120 ? '…' : ''}</td>
                <td>{p.wordCount}</td>
                <td>{p.category || '—'}</td>
                <td><span className={`pill ${p.active ? 'ok' : 'bad'}`}>{p.active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small secondary" onClick={() => { setEditing(p); setForm({ text: p.text, category: p.category || '' }); }}>Edit</button>
                    <button className={`btn small ${p.active ? 'danger' : 'secondary'}`} onClick={() => toggleActive(p)}>{p.active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsPanel({ toast }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const res = await api.get('/typing-test/admin/settings', 'admin');
    if (res.ok) setForm(res.data);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const res = await api.put('/typing-test/admin/settings', form, 'admin');
    setSaving(false);
    if (res.ok) { toast('Settings saved.'); setForm(res.data); }
    else toast(res.message || 'Failed.', false);
  }

  if (!form) return <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>;
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="card" style={{ padding: 20, maxWidth: 560 }}>
      <h4 style={{ marginTop: 0 }}>Daily Typing Test Settings</h4>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <div className="field"><label>Test Duration (seconds)</label><input className="input" type="number" min="60" value={form.durationSeconds} onChange={e => set('durationSeconds', Number(e.target.value))} /></div>
        <div className="field"><label>Attempts Per Day</label><input className="input" type="number" min="1" value={form.attemptsPerDay} onChange={e => set('attemptsPerDay', Number(e.target.value))} /></div>
        <div className="field"><label>WPM Target (for Pass)</label><input className="input" type="number" min="0" value={form.wpmTarget} onChange={e => set('wpmTarget', Number(e.target.value))} /></div>
        <div className="field"><label>Accuracy Target % (for Pass)</label><input className="input" type="number" min="0" max="100" value={form.accuracyTarget} onChange={e => set('accuracyTarget', Number(e.target.value))} /></div>
        <div className="field"><label>Minimum Paragraph Words</label><input className="input" type="number" min="1" value={form.minWords} onChange={e => set('minWords', Number(e.target.value))} /></div>
        <div className="field"><label>Maximum Paragraph Words</label><input className="input" type="number" min="1" value={form.maxWords} onChange={e => set('maxWords', Number(e.target.value))} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={form.allowRetest} onChange={e => set('allowRetest', e.target.checked)} />
          Allow retest before the daily attempt cap is reached
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn accent" disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
        </div>
      </form>
    </div>
  );
}
