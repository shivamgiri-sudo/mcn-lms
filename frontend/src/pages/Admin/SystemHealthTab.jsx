import { useState } from 'react';
import { api } from '../../utils/api.js';

function BoolPill({ value }) {
  return <span className={`pill ${value ? 'ok' : 'bad'}`}>{value ? 'OK' : 'Missing'}</span>;
}

function StatusPill({ ok }) {
  return <span className={`pill ${ok ? 'ok' : 'bad'}`}>{ok ? 'Healthy' : 'Issue'}</span>;
}

export default function SystemHealthTab() {
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagMsg, setDiagMsg] = useState('');
  const [diagLoading, setDiagLoading] = useState(false);
  const [batchNo, setBatchNo] = useState('');
  const [recon, setRecon] = useState(null);
  const [reconMsg, setReconMsg] = useState('');
  const [reconLoading, setReconLoading] = useState(false);

  async function loadDiagnostics() {
    setDiagLoading(true);
    setDiagMsg('');
    const res = await api.get('/admin/diagnostics', 'admin');
    setDiagLoading(false);
    if (!res.ok) {
      setDiagMsg(res.message || 'Unable to load diagnostics.');
      return;
    }
    setDiagnostics(res.data);
  }

  async function runReconciliation() {
    setReconLoading(true);
    setReconMsg('');
    const body = batchNo.trim() ? { batchNo: batchNo.trim() } : {};
    const res = await api.post('/admin/reconcile/batch-counters', body, 'admin');
    setReconLoading(false);
    if (!res.ok) {
      setReconMsg(res.message || 'Unable to reconcile batch counters.');
      return;
    }
    setRecon(res);
  }

  const env = diagnostics?.environment || {};
  const storage = diagnostics?.storage || {};
  const tables = diagnostics?.tables || {};
  const tableRows = Object.entries(tables);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>System Health & Reconciliation</h2>
          <p style={{ color: 'var(--muted)', marginTop: 4 }}>Check LMS deployment health and repair batch counters from actual trainee data.</p>
        </div>
        <button className="btn accent" onClick={loadDiagnostics} disabled={diagLoading}>{diagLoading ? 'Checking…' : 'Run Health Check'}</button>
      </div>

      {diagMsg && <div className="toast bad">{diagMsg}</div>}

      {diagnostics && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <div className="kpi-card"><div className="kpi-label">Overall</div><div className="kpi-value"><StatusPill ok={diagnostics.ok} /></div><div className="kpi-note">{diagnostics.durationMs || 0} ms</div></div>
            <div className="kpi-card"><div className="kpi-label">Database</div><div className="kpi-value"><StatusPill ok={diagnostics.database?.ok} /></div><div className="kpi-note">Connectivity check</div></div>
            <div className="kpi-card"><div className="kpi-label">Uploads</div><div className="kpi-value"><StatusPill ok={storage.uploadsWritable} /></div><div className="kpi-note">Writable storage</div></div>
            <div className="kpi-card"><div className="kpi-label">Frontend Build</div><div className="kpi-value"><BoolPill value={storage.frontendDistExists} /></div><div className="kpi-note">dist folder</div></div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Environment Flags</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {[
                ['Database URL', env.databaseUrlConfigured],
                ['Session Secret', env.sessionSecretConfigured],
                ['Frontend URL', env.frontendUrlConfigured],
                ['API URL', env.apiUrlConfigured],
                ['Drive Service Account', env.driveServiceAccountConfigured],
                ['Drive OAuth', env.driveOAuthConfigured],
                ['SMTP / Summary Email', env.smtpConfigured],
                ['Serve Frontend', env.serveFrontend],
              ].map(([label, value]) => (
                <div key={label} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{label}</span><BoolPill value={!!value} />
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Key Table Counts</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Table / Model</th><th>Status</th><th>Rows</th><th>Message</th></tr></thead>
                <tbody>
                  {tableRows.map(([model, info]) => (
                    <tr key={model}>
                      <td>{model}</td>
                      <td><StatusPill ok={info.ok} /></td>
                      <td>{info.count ?? '—'}</td>
                      <td>{info.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ padding: 16 }}>
        <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Batch Counter Reconciliation</h3>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>Repairs total trainees, OJT ready, certified, and OPS handover counts using trainee records.</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" placeholder="Optional Batch No" value={batchNo} onChange={e => setBatchNo(e.target.value)} style={{ width: 190 }} />
            <button className="btn accent" onClick={runReconciliation} disabled={reconLoading}>{reconLoading ? 'Running…' : 'Run Reconcile'}</button>
          </div>
        </div>
        {reconMsg && <div className="toast bad" style={{ marginTop: 10 }}>{reconMsg}</div>}
        {recon && (
          <div style={{ marginTop: 12 }}>
            <div className="toast ok">Checked {recon.summary?.totalBatches || 0} batch(es); corrected {recon.summary?.changedCount || 0}.</div>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="table">
                <thead><tr><th>Batch</th><th>Changed</th><th>Total</th><th>Certified</th><th>Handover</th><th>OJT Ready</th></tr></thead>
                <tbody>
                  {(recon.results || []).slice(0, 50).map(row => (
                    <tr key={row.batchNo}>
                      <td><b>{row.batchNo}</b><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{row.batchName}</span></td>
                      <td><span className={`pill ${row.changed ? 'warn' : 'ok'}`}>{row.changed ? 'Corrected' : 'No Change'}</span></td>
                      <td>{row.before.totalTrainees} → <b>{row.after.totalTrainees}</b></td>
                      <td>{row.before.certified} → <b>{row.after.certified}</b></td>
                      <td>{row.before.handoverToOps} → <b>{row.after.handoverToOps}</b></td>
                      <td>{row.before.ojtReady} → <b>{row.after.ojtReady}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
