import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

export default function IndependentModulesTab() {
  const [modules, setModules] = useState([]);
  const [rules, setRules] = useState([]);
  const [msg, setMsg] = useState('');

  async function load() {
    const [moduleRes, ruleRes] = await Promise.all([
      api.get('/admin/independent-modules', 'admin'),
      api.get('/admin/independent-modules/auto-assign-rules', 'admin'),
    ]);
    if (moduleRes.ok) setModules(moduleRes.data || []);
    if (ruleRes.ok) setRules(ruleRes.data || []);
    if (!moduleRes.ok || !ruleRes.ok) setMsg('Unable to load independent module data.');
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Independent Modules</h2>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Modules here are not linked with any classroom. They can be assigned directly or by auto assignment rules when new LMS IDs are created.
        </p>
      </div>
      {msg && <div className="toast bad">{msg}</div>}
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Independent Module Library</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Module ID</th><th>Module</th><th>Process / LOB</th><th>Contents</th></tr></thead>
            <tbody>
              {modules.map(m => (
                <tr key={m.module_id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.module_id}</td>
                  <td><b>{m.module_name}</b><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{m.description || m.category || '—'}</span></td>
                  <td>{m.process || '—'} / {m.lob || '—'}</td>
                  <td>{(m.contents || []).length}</td>
                </tr>
              ))}
              {!modules.length && <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No independent modules created yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Auto Assignment Rules</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rule</th><th>Module</th><th>Scope</th><th>Type</th><th>Due</th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.rule_id}>
                  <td><b>{r.rule_name}</b><br /><span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>{r.rule_id}</span></td>
                  <td>{r.module_name || r.module_id}</td>
                  <td>{r.scope_type}{r.scope_value ? `: ${r.scope_value}` : ''}</td>
                  <td><span className={`pill ${r.assignment_type === 'Mandatory' ? 'warn' : 'info'}`}>{r.assignment_type}</span></td>
                  <td>{r.due_days || 0} day(s)</td>
                </tr>
              ))}
              {!rules.length && <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No auto assignment rules configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <button className="btn secondary" onClick={load}>Refresh</button>
    </div>
  );
}
