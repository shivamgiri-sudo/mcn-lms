import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const SCOPE_OPTIONS = [
  { value: 'company',  label: 'Entire Company',      desc: 'All active trainees across all branches and processes' },
  { value: 'branch',   label: 'Branch',               desc: 'All trainees in a specific branch' },
  { value: 'process',  label: 'Process',              desc: 'All trainees in a specific process' },
  { value: 'batch',    label: 'Batch',                desc: 'All trainees in a specific batch' },
  { value: 'individual', label: 'Individual Trainee', desc: 'A single trainee by Employee ID' },
];

export default function BroadcastTab() {
  const [classrooms, setClassrooms] = useState([]);
  const [modules, setModules] = useState([]);
  const [batches, setBatches] = useState([]);
  const [processList, setProcessList] = useState([]);
  const [branchList, setBranchList] = useState([]);

  const [form, setForm] = useState({
    scope: 'company',
    scopeValue: '',
    classroomId: '',
    moduleId: '',
    moduleName: '',
    assignmentType: 'Mandatory',
    message: '',
    dueDate: '',
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'ok'|'bad', text }

  useEffect(() => {
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
    api.get('/admin/batches', 'admin').then(r => r.ok && setBatches(r.data));
    api.get('/admin/process-lob', 'admin').then(r => {
      if (r.ok) {
        const procs = [...new Set(r.data.map(p => p.process))].sort();
        setProcessList(procs);
      }
    });
    api.get('/admin/org/branches', 'admin').then(r => {
      if (r.ok) setBranchList(r.data.filter(b => b.active));
    });
  }, []);

  useEffect(() => {
    if (!form.classroomId) { setModules([]); setForm(f => ({ ...f, moduleId: '', moduleName: '' })); return; }
    api.get(`/admin/classrooms/${form.classroomId}/modules`, 'admin').then(r => {
      if (r.ok) setModules(r.data);
    });
  }, [form.classroomId]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.moduleId) return setMsg({ type: 'bad', text: 'Select a module.' });
    if (form.scope !== 'company' && !form.scopeValue) return setMsg({ type: 'bad', text: 'Select a target for the chosen scope.' });
    setLoading(true); setMsg(null);

    const res = await api.post('/admin/broadcast-module', {
      moduleId: form.moduleId,
      moduleName: form.moduleName,
      scope: form.scope,
      scopeValue: form.scope === 'company' ? 'ALL' : form.scopeValue,
      assignmentType: form.assignmentType,
      message: form.message || null,
      dueDate: form.dueDate || null,
    }, 'admin');

    setLoading(false);
    if (res.ok) {
      setMsg({ type: 'ok', text: `Module assigned successfully to ${SCOPE_OPTIONS.find(s => s.value === form.scope)?.label}.` });
      setForm(f => ({ ...f, scopeValue: '', message: '', dueDate: '' }));
    } else {
      setMsg({ type: 'bad', text: res.message || 'Failed to broadcast.' });
    }
  }

  const scopeInfo = SCOPE_OPTIONS.find(s => s.value === form.scope);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Broadcast / Refresher Assignment</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Assign a refresher or supplementary module to any group — entire company, a branch, process, batch, or individual trainee.
          The module will appear under the trainee's <b>Assigned</b> tab in the LMS portal.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
        {/* Main form */}
        <div style={{ background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)', padding: '24px 26px', boxShadow: 'var(--shadow-sm)' }}>
          <form onSubmit={submit}>

            {/* Scope selector */}
            <div className="field" style={{ marginBottom: 20 }}>
              <label style={{ fontWeight: 700, fontSize: 13 }}>Target Audience</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginTop: 6 }}>
                {SCOPE_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => { set('scope', opt.value); set('scopeValue', ''); }}
                    style={{
                      border: `2px solid ${form.scope === opt.value ? 'var(--brand)' : 'var(--line)'}`,
                      borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                      background: form.scope === opt.value ? 'rgba(29,78,216,.08)' : 'var(--card)',
                      transition: 'all .15s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: form.scope === opt.value ? 'var(--brand)' : 'var(--ink)' }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{opt.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Scope value picker */}
            {form.scope === 'branch' && (
              <div className="field">
                <label>Branch</label>
                <select className="select" value={form.scopeValue} onChange={e => set('scopeValue', e.target.value)} required>
                  <option value="">Select branch…</option>
                  {branchList.map(b => <option key={b.id} value={b.branchName}>{b.branchName}{b.city ? ` (${b.city})` : ''}</option>)}
                </select>
              </div>
            )}
            {form.scope === 'process' && (
              <div className="field">
                <label>Process</label>
                <select className="select" value={form.scopeValue} onChange={e => set('scopeValue', e.target.value)} required>
                  <option value="">Select process…</option>
                  {processList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
            {form.scope === 'batch' && (
              <div className="field">
                <label>Batch</label>
                <select className="select" value={form.scopeValue} onChange={e => set('scopeValue', e.target.value)} required>
                  <option value="">Select batch…</option>
                  {batches.map(b => <option key={b.batchNo} value={b.batchNo}>{b.batchNo}{b.batchName ? ` — ${b.batchName}` : ''}</option>)}
                </select>
              </div>
            )}
            {form.scope === 'individual' && (
              <div className="field">
                <label>Employee ID</label>
                <input className="input" type="text" placeholder="e.g. emp1001" value={form.scopeValue} onChange={e => set('scopeValue', e.target.value)} required />
              </div>
            )}

            {/* Module picker */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Classroom</label>
                <select className="select" value={form.classroomId} onChange={e => set('classroomId', e.target.value)} required>
                  <option value="">Select classroom…</option>
                  {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Module</label>
                <select className="select" value={form.moduleId} onChange={e => {
                  const m = modules.find(m => m.moduleId === e.target.value);
                  set('moduleId', e.target.value);
                  set('moduleName', m ? m.moduleTitle : '');
                }} required disabled={!form.classroomId}>
                  <option value="">Select module…</option>
                  {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} — {m.moduleTitle}</option>)}
                </select>
              </div>
            </div>

            {/* Assignment details */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>Assignment Type</label>
                <select className="select" value={form.assignmentType} onChange={e => set('assignmentType', e.target.value)}>
                  <option value="Mandatory">Mandatory</option>
                  <option value="Optional">Optional</option>
                </select>
              </div>
              <div className="field">
                <label>Due Date (optional)</label>
                <input className="input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>Message to trainees (optional)</label>
              <input className="input" type="text" placeholder="e.g. Refresher required before certification" value={form.message} onChange={e => set('message', e.target.value)} />
            </div>

            <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? 'Broadcasting…' : `📢 Broadcast to ${scopeInfo?.label}`}
            </button>
          </form>
        </div>

        {/* Info sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>How it works</div>
            {[
              ['📢', 'Entire Company', 'Every active trainee sees the module in their Assigned tab.'],
              ['🌿', 'Branch', 'All trainees whose Branch matches the selected value.'],
              ['⚙️', 'Process', 'All trainees enrolled in the selected process.'],
              ['🏢', 'Batch', 'All trainees in a specific batch, current or upcoming.'],
              ['👤', 'Individual', 'Single trainee identified by Employee ID.'],
            ].map(([icon, title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: 'rgba(29,78,216,.06)', borderRadius: 14, border: '1px solid rgba(29,78,216,.15)', padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>Note</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
              Assignments appear instantly in the trainee's <b style={{ color: 'var(--ink)' }}>Assigned</b> tab.
              Trainees do not get a push notification — you may need to inform them via other channels.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
