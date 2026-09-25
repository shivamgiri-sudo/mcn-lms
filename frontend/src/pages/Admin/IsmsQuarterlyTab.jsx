import { useEffect, useState } from 'react';
import { api, downloadCsv } from '../../utils/api.js';

// Read-only status view for the ISMS Test - Quarterly automation -- there is
// deliberately no configuration here (assessment name, quarter cycle, and
// the CEO/Chairman/COO exclusion are fixed by the feature spec, not
// admin-editable). The scheduler runs entirely on its own; "Run Now" exists
// purely as a recovery/verification tool.
export default function IsmsQuarterlyTab({ isSuper }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState(null);

  function load() {
    setLoading(true);
    api.get('/isms-quarterly/status', 'admin').then(res => {
      if (res.ok) setStatus(res.data);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function runNow() {
    if (!window.confirm('Run the ISMS Test - Quarterly assignment for the current quarter now? This assigns it to every eligible active employee who does not already have it for this quarter.')) return;
    setRunning(true);
    setMsg(null);
    const res = await api.post('/isms-quarterly/run-now', {}, 'admin');
    setRunning(false);
    if (res.ok) { setMsg({ type: 'ok', text: res.message }); load(); }
    else setMsg({ type: 'bad', text: res.message || 'Run failed.' });
  }

  async function exportReport() {
    try { await downloadCsv('/isms-quarterly/report', `isms-quarterly-${new Date().toISOString().slice(0, 10)}.csv`, 'admin'); }
    catch { setMsg({ type: 'bad', text: 'Download failed.' }); }
  }

  if (loading || !status) return <div className="empty">Loading ISMS quarterly status…</div>;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>ISMS Test - Quarterly Automation</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          At the start of every financial-year quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar), the existing ISMS Test - Quarterly assessment is assigned automatically, Mandatory, to every active employee — except CEO, Chairman and COO. New joiners get the current quarter's test automatically as soon as they're added. This runs entirely on its own; nothing here needs to be configured.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Current Quarter</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{status.currentQuarter}</div>
        </div>
        <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Assigned This Quarter</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{status.assignedThisQuarter}</div>
        </div>
        <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Quarterly Run Status</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: status.runLog ? 'var(--ok)' : 'var(--warn)' }}>
            {status.runLog ? `Ran ${status.runLog.triggerType.toLowerCase()}` : 'Not yet run this quarter'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button className="btn accent" onClick={exportReport}>⬇ Export Quarterly Report</button>
        {isSuper && (
          <button className="btn" style={{ background: '#7c3aed' }} onClick={runNow} disabled={running}>
            {running ? 'Running…' : '▶ Run Now (recovery/verification)'}
          </button>
        )}
      </div>

      <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 22px' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Recent Runs</div>
        {status.recentRuns.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No runs recorded yet.</div>
        ) : (
          <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr><th>Quarter</th><th>Ran At</th><th>Trigger</th><th>Total Employees</th><th>Newly Assigned</th></tr>
            </thead>
            <tbody>
              {status.recentRuns.map(r => (
                <tr key={r.id}>
                  <td>{r.quarterKey}</td>
                  <td>{new Date(r.runAt).toLocaleString()}</td>
                  <td>{r.triggerType}</td>
                  <td>{r.totalEmployees}</td>
                  <td>{r.assignedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
