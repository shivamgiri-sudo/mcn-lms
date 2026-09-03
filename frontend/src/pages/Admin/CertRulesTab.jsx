import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

// The three thresholds below are computed from a trainee's own KPIs. Everything a
// coordinator records by hand is a criterion, so a process can define a mock call, a
// client certification round, a cumulative sales target or an email audit score
// without needing a new column.
const BLANK = { process: '', lob: '', courseCompletionMin: 80, mcqPassPctMin: 60, attendancePctMin: 70, criteria: [] };

const MEASURES = [
  { value: 'single', label: 'Single score', hint: 'One figure recorded once. A re-test replaces the earlier attempt.' },
  { value: 'daily_average', label: 'Daily average', hint: 'A figure per day, averaged over the days actually recorded.' },
  { value: 'cumulative', label: 'Cumulative total', hint: 'Entries add up and must reach the target.' },
  { value: 'completion', label: 'Completed / not completed', hint: 'A yes-no gate with no number.' },
];
const DIRECTIONS = [
  { value: 'at_least', label: 'At least (higher is better)' },
  { value: 'at_most', label: 'At most (lower is better, e.g. an error rate)' },
];
const UNITS = [
  { value: 'percent', label: '% percentage' },
  { value: 'number', label: '# number / count' },
  { value: 'currency', label: '₹ currency' },
];

const PRESETS = [
  { label: 'Mock Call', measure: 'single', direction: 'at_least', targetValue: 60, unit: 'percent' },
  { label: 'Client Certification Round', measure: 'single', direction: 'at_least', targetValue: 80, unit: 'percent' },
  { label: 'Email Audit Score', measure: 'single', direction: 'at_least', targetValue: 90, unit: 'percent' },
  { label: 'PQ Error Rate', measure: 'daily_average', direction: 'at_most', targetValue: 2.5, unit: 'percent', days: 5 },
  { label: 'Sales Target', measure: 'cumulative', direction: 'at_least', targetValue: 50, unit: 'number' },
  { label: 'Client Sign-off', measure: 'completion', direction: 'at_least', targetValue: 0, unit: 'percent' },
];

const blankCriterion = () => ({ criterionKey: '', label: '', measure: 'single', direction: 'at_least', targetValue: 80, unit: 'percent', days: 0, blocks: true });

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
      criteria: (r.criteria || []).map(c => ({
        criterionKey: c.criterionKey,
        label: c.label,
        measure: c.measure,
        direction: c.direction,
        targetValue: c.targetValue,
        unit: c.unit,
        days: c.days ?? 0,
        blocks: c.blocks !== false,
      })),
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

  function describeCriterion(c) {
    if (c.measure === 'completion') return `${c.label}: completed`;
    const value = c.unit === 'currency' ? `₹${c.targetValue}` : `${c.targetValue}${c.unit === 'percent' ? '%' : ''}`;
    const comparison = c.direction === 'at_most' ? '≤' : '≥';
    const scope = c.measure === 'daily_average' ? ` avg/${c.days}d` : (c.measure === 'cumulative' ? ' total' : '');
    return `${c.label} ${comparison}${value}${scope}${c.blocks === false ? ' (tracked)' : ''}`;
  }

  function stepsRequired(r) {
    const steps = (r.criteria || []).filter(c => c.active !== false).map(describeCriterion);
    return steps.length ? steps.join(', ') : '—';
  }

  function setCriterion(index, patch) {
    setForm(p => ({ ...p, criteria: p.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  }
  function addCriterion(preset) {
    setForm(p => ({ ...p, criteria: [...p.criteria, { ...blankCriterion(), ...(preset || {}) }] }));
  }
  function removeCriterion(index) {
    setForm(p => ({ ...p, criteria: p.criteria.filter((_, i) => i !== index) }));
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
                {/* Everything a coordinator records by hand is a criterion. Each carries
                    its own measure, direction, target and unit, so a mock call, a client
                    round, a daily error rate, a sales total and a sign-off all live side
                    by side without needing a column each. */}
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <b style={{ fontSize: 14 }}>Certification criteria</b>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Coordinators are offered exactly these, and only these.</span>
                  </div>

                  {form.criteria.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0' }}>
                      No manual criteria yet — this process certifies on course, MCQ and attendance alone.
                    </p>
                  )}

                  {form.criteria.map((c, index) => (
                    <div key={index} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 10, display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input className="input" style={{ flex: '1 1 200px' }} placeholder="Name, e.g. Client Certification Round"
                          value={c.label} onChange={e => setCriterion(index, { label: e.target.value })} />
                        <button type="button" className="btn small danger" onClick={() => removeCriterion(index)}>Remove</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                        <select className="select" value={c.measure}
                          onChange={e => setCriterion(index, { measure: e.target.value, days: e.target.value === 'daily_average' ? (c.days || 5) : 0 })}>
                          {MEASURES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        {c.measure !== 'completion' && (
                          <select className="select" value={c.direction} onChange={e => setCriterion(index, { direction: e.target.value })}>
                            {DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                          </select>
                        )}
                        {c.measure !== 'completion' && (
                          <select className="select" value={c.unit} onChange={e => setCriterion(index, { unit: e.target.value })}>
                            {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                          </select>
                        )}
                        {c.measure !== 'completion' && (
                          <input className="input" type="number" min="0" step="0.01"
                            max={c.unit === 'percent' ? 100 : undefined}
                            placeholder="Target" value={c.targetValue}
                            onChange={e => setCriterion(index, { targetValue: e.target.value === '' ? '' : Number(e.target.value) })} />
                        )}
                        {c.measure === 'daily_average' && (
                          <input className="input" type="number" min="1" max="20" placeholder="Days" value={c.days}
                            onChange={e => setCriterion(index, { days: Number(e.target.value) })} />
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                          <input type="checkbox" checked={c.blocks !== false} onChange={() => setCriterion(index, { blocks: c.blocks === false })} />
                          Blocks certification
                        </label>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {MEASURES.find(m => m.value === c.measure)?.hint}
                          {c.blocks === false && ' Recorded and shown, but does not stop certification.'}
                        </span>
                      </div>
                    </div>
                  ))}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                    <button type="button" className="btn small" onClick={() => addCriterion()}>+ Add criterion</button>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>or start from:</span>
                    {PRESETS.map(preset => (
                      <button key={preset.label} type="button" className="btn small secondary" style={{ fontSize: 11 }}
                        onClick={() => addCriterion(preset)}>{preset.label}</button>
                    ))}
                  </div>
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
