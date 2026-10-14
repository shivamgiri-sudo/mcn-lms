import { useState } from 'react';
import { api, downloadCsv } from '../../utils/api.js';
import { ProcessSelect } from '../../components/OrgSelect.jsx';

const card = {
  background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
  padding: '18px 22px', boxShadow: 'var(--shadow-sm)', marginBottom: 20,
};
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', borderBottom: '1.5px solid var(--line)', whiteSpace: 'nowrap' };
const td = { padding: '7px 10px', fontSize: 12, color: 'var(--ink)', borderBottom: '1px solid var(--line)' };

const ymd = (d) => d.toISOString().slice(0, 10);
function defaultRange(period) {
  const now = new Date();
  const to = ymd(now);
  if (period === 'weekly') return { from: ymd(new Date(now.getTime() - 6 * 86400000)), to };
  if (period === 'monthly') return { from: `${to.slice(0, 7)}-01`, to };
  return { from: to, to };
}

export function ReportPanel({ title, desc, path, filename, filters, extraFields, buildParams, previewQuery = '' }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState(null);

  async function load() {
    setLoading(true); setMsg(null);
    const res = await api.get(`${path}?${buildParams()}${previewQuery ? `&${previewQuery}` : ''}`, 'admin');
    if (res.ok) { setHeaders(res.data.headers); setRows(res.data.rows); setMeta(res.data); }
    else { setRows(null); setMsg(res.message || 'Could not load report.'); }
    setLoading(false);
  }

  async function exportExcel() {
    setExporting(true); setMsg(null);
    try { await downloadCsv(`${path}?${buildParams()}&format=xlsx`, filename(), 'admin'); }
    catch (err) { setMsg(err.message || 'Download failed.'); }
    setExporting(false);
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 14px' }}>{desc}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', marginBottom: 14 }}>
        {filters}
        {extraFields}
        <button className="btn" style={{ padding: '8px 18px', fontSize: 12, height: 38 }} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Show Report'}
        </button>
        <button className="btn" style={{ padding: '8px 18px', fontSize: 12, height: 38, background: '#16a34a' }} onClick={exportExcel} disabled={exporting}>
          {exporting ? 'Exporting…' : '⬇ Export Excel'}
        </button>
      </div>
      {msg && <div className="toast bad" style={{ marginBottom: 12 }}>{msg}</div>}
      {rows && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            {meta.total} record{meta.total === 1 ? '' : 's'}{meta.truncated ? ' — preview shows the first 5000; Excel export has them all' : ''}
          </div>
          <div style={{ overflow: 'auto', maxHeight: 420 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{headers.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td style={td} colSpan={headers.length}>No records for these filters.</td></tr>}
                {rows.map((r, i) => (
                  <tr key={i}>{r.map((v, j) => (
                    <td key={j} style={{ ...td, color: v === 'Pending' ? '#d97706' : v === 'Completed' ? '#16a34a' : td.color }}>{v}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function LmsActivityReports() {
  const [process, setProcess] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('daily');
  const [range, setRange] = useState(defaultRange('daily'));
  const [activeProcess, setActiveProcess] = useState('');
  const d = ymd(new Date());

  const processField = (value, set) => (
    <div className="field" style={{ margin: 0 }}>
      <label>Process</label>
      <ProcessSelect portal="admin" value={value} onChange={set} placeholder="All Processes" />
    </div>
  );

  function changePeriod(p) { setPeriod(p); setRange(defaultRange(p)); }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 14 }}>
        Training &amp; Activity Reports
      </div>

      <ReportPanel
        title="📋 Training Completion Report"
        desc="Every LMS user's assigned trainings (classroom courses and independent modules) with completion date and status."
        path="/admin/reports/training-completion"
        filename={() => `training-completion-${d}.xlsx`}
        filters={processField(process, setProcess)}
        extraFields={(
          <div className="field" style={{ margin: 0 }}>
            <label>Status</label>
            <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option><option value="Completed">Completed</option><option value="Pending">Pending</option>
            </select>
          </div>
        )}
        buildParams={() => new URLSearchParams({ process, status }).toString()}
      />

      <ReportPanel
        title="⏱ User On-Time Rate Report"
        desc="Daily login time and total active time on LMS (content engagement minutes). Weekly and monthly views roll the days up."
        path="/admin/reports/user-active-time"
        filename={() => `user-on-time-rate-${period}-${range.from}-to-${range.to}.xlsx`}
        filters={processField(activeProcess, setActiveProcess)}
        extraFields={(
          <>
            <div className="field" style={{ margin: 0 }}>
              <label>View</label>
              <select className="select" value={period} onChange={e => changePeriod(e.target.value)}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>From</label>
              <input className="input" type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>To</label>
              <input className="input" type="date" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            </div>
          </>
        )}
        buildParams={() => new URLSearchParams({ process: activeProcess, period, from: range.from, to: range.to }).toString()}
      />
    </div>
  );
}
