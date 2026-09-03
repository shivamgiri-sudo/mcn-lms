import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const BLANK = { process: '', lob: '', courseCompletionMin: 80, mcqPassPctMin: 60, attendancePctMin: 70, mockCallRequired: false, mockCallPassPct: 60, internalCertRequired: false, internalCertPassPct: 60, externalCertRequired: false, externalCertPassPct: 60, pqRequired: false, pqTargetPct: 85, pqDays: 5 };

export default function CertRulesTab() {
  const [rules, setRules] = useState([]);
  const [processList, setProcessList] = useState([]);
  const [lobList, setLobList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [msg, setMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // rule id to delete

  useEffect(() => { load(); loadProcessLob(); }, []);

  async function load() {
    const res = await api.get('/admin/cert-rules', 'admin');
    if (res.ok) setRules(res.data);
  }

  async function loadProcessLob() {
    const res = await api.get('/admin/process-lob', 'admin');
    if (res.ok) {
      const uniqProcess = [...new Set(res.data.map(p => p.process))].sort();
      setProcessList(uniqProcess);
      setLobList(res.data);
    }
  }

  function lobsForProcess(proc) {
    return lobList.filter(p => p.process === proc).map(p => p.lob);
  }

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setShowForm(true);
  }

  function openEdit(r) {
    setEditId(r.id);
    setForm({
      process: r.process,
      lob: r.lob,
      courseCompletionMin: r.courseCompletionMin,
      mcqPassPctMin: r.mcqPassPctMin,
      attendancePctMin: r.attendancePctMin,
      mockCallRequired: r.mockCallRequired,
      mockCallPassPct: r.mockCallPassPct,
      internalCertRequired: r.internalCertRequired,
      internalCertPassPct: r.internalCertPassPct,
      externalCertRequired: r.externalCertRequired,
      externalCertPassPct: r.externalCertPassPct,
      pqRequired: Boolean(r.pqRequired),
      pqTargetPct: r.pqTargetPct ?? 85,
      pqDays: r.pqDays ?? 5,
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    let res;
    if (editId) {
      res = await api.put(`/admin/cert-rules/${editId}`, form, 'admin');
    } else {
      res = await api.post('/admin/cert-rules', form, 'admin');
    }
    if (res.ok) { setShowForm(false); setEditId(null); setMsg('✓ Rule saved.'); load(); }
    else setMsg(res.message || 'Failed.');
  }

  async function deleteRule(id) {
    const res = await api.delete(`/admin/cert-rules/${id}`, 'admin');
    if (res.ok) { setConfirmDelete(null); setMsg('✓ Rule deleted.'); load(); }
    else setMsg(res.message || 'Failed to delete.');
  }

  function stepsRequired(r) {
    const steps = [];
    if (r.mockCallRequired) steps.push('Mock Call');
    if (r.internalCertRequired) steps.push('Internal Cert');
    if (r.externalCertRequired) steps.push('External Cert');
    if (r.pqRequired) steps.push(`Process Quality ${r.pqTargetPct}% over ${r.pqDays}d`);
    return steps.length ? steps.join(', ') : '—';
  }

  const toggle = (k) => setForm(p => ({ ...p, [k]: !p[k] }));
  const num = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <b>Certification Rules per Process / LOB</b>
        <button className="btn small" onClick={openAdd}>+ Add Rule</button>
      </div>
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
      {rules.length === 0 && <div className="empty">No rules configured. Certification eligibility will use default 80/60/70%.</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Process</th><th>LOB</th><th>Course</th><th>MCQ</th><th>Attendance</th>
              <th>Steps Required</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td><b>{r.process}</b></td>
                <td>{r.lob}</td>
                <td>{r.courseCompletionMin}%</td>
                <td>{r.mcqPassPctMin}%</td>
                <td>{r.attendancePctMin}%</td>
                <td style={{ fontSize: 12 }}>{stepsRequired(r)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small secondary" style={{ fontSize: 12 }} onClick={() => openEdit(r)}>Edit</button>
                    <button className="btn small danger" style={{ fontSize: 12 }} onClick={() => setConfirmDelete(r.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal-box">
            <div className="modal-head">
              <b>{editId ? 'Edit Cert Rule' : 'Add Cert Rule'}</b>
              <button className="btn small secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Close</button>
            </div>
            <div className="modal-body">
              <form onSubmit={save}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label>Process *</label>
                    <select className="input" value={form.process} onChange={e => setForm(p => ({ ...p, process: e.target.value, lob: '' }))}>
                      <option value="">Select Process</option>
                      {processList.map(pr => <option key={pr} value={pr}>{pr}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>LOB *</label>
                    <select className="input" value={form.lob} onChange={e => setForm(p => ({ ...p, lob: e.target.value }))}>
                      <option value="">Select LOB</option>
                      {lobsForProcess(form.process).map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Min Course %</label><input className="input" type="number" max="100" value={form.courseCompletionMin} onChange={e => num('courseCompletionMin', e.target.value)} /></div>
                  <div className="field"><label>Min MCQ Pass %</label><input className="input" type="number" max="100" value={form.mcqPassPctMin} onChange={e => num('mcqPassPctMin', e.target.value)} /></div>
                  <div className="field"><label>Min Attendance %</label><input className="input" type="number" max="100" value={form.attendancePctMin} onChange={e => num('attendancePctMin', e.target.value)} /></div>
                </div>
                {[['mockCallRequired', 'mockCallPassPct', 'Mock Call'], ['internalCertRequired', 'internalCertPassPct', 'Internal Cert'], ['externalCertRequired', 'externalCertPassPct', 'External Cert']].map(([req, pctKey, label]) => (
                  <div key={req} style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '10px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                      <input type="checkbox" checked={form[req]} onChange={() => toggle(req)} />
                      {label} Required
                    </label>
                    {form[req] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Pass %:</span>
                        <input className="input" type="number" max="100" value={form[pctKey]} onChange={e => num(pctKey, e.target.value)} style={{ width: 80 }} />
                      </div>
                    )}
                  </div>
                ))}

                {/* Process Quality is scored once per training day and averaged across
                    the days actually recorded, so it needs a target and a day count
                    rather than a single pass mark. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '10px 0', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                    <input type="checkbox" checked={form.pqRequired} onChange={() => toggle('pqRequired')} />
                    Process Quality (PQ) Required
                  </label>
                  {form.pqRequired && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Target %:</span>
                      <input className="input" type="number" min="0" max="100" value={form.pqTargetPct} onChange={e => num('pqTargetPct', e.target.value)} style={{ width: 80 }} />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Days:</span>
                      <input className="input" type="number" min="1" max="20" value={form.pqDays} onChange={e => num('pqDays', e.target.value)} style={{ width: 70 }} />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Average of the days actually scored must reach the target.
                      </span>
                    </div>
                  )}
                </div>
                <button className="btn" type="submit" style={{ marginTop: 14 }}>{editId ? 'Update Rule' : 'Save Rule'}</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head"><b>Confirm Delete</b><button className="btn small secondary" onClick={() => setConfirmDelete(null)}>Cancel</button></div>
            <div className="modal-body">
              <p style={{ marginBottom: 16 }}>Are you sure you want to delete this certification rule? This cannot be undone.</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn danger" onClick={() => deleteRule(confirmDelete)}>Delete Rule</button>
                <button className="btn secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
