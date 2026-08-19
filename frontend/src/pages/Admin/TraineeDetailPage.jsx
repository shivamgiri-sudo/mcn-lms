import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

function TraineeAttemptsTab({ empId, traineeName }) {
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState([]);
  const [grantForm, setGrantForm] = useState({ assessmentId: '', extraAttempts: 1, reason: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(null);

  function loadGrants() {
    setLoading(true);
    api.get(`/admin/trainees/${empId}/attempt-grants`, 'admin')
      .then(r => { if (r.ok) setGrants(r.data || []); setLoading(false); });
  }

  useEffect(() => {
    loadGrants();
    api.get('/admin/assessments', 'admin').then(r => r.ok && setAssessments(r.data || []));
  }, [empId]);

  async function grant(e) {
    e.preventDefault();
    if (!grantForm.assessmentId) return;
    setSaving(true); setMsg('');
    const res = await api.post(`/admin/assessments/${grantForm.assessmentId}/attempt-grants`, {
      employeeId: empId,
      extraAttempts: Number(grantForm.extraAttempts),
      reason: grantForm.reason.trim() || undefined,
    }, 'admin');
    setSaving(false);
    if (res.ok) {
      setMsg('Grant created.');
      setGrantForm({ assessmentId: '', extraAttempts: 1, reason: '' });
      loadGrants();
    } else {
      setMsg(res.message || 'Failed to create grant.');
    }
  }

  async function revoke(grantId) {
    setRevoking(grantId);
    const res = await api.post(`/admin/attempt-grants/${grantId}/revoke`, { reason: revokeReason.trim() || undefined }, 'admin');
    setRevoking(null);
    if (res.ok) { setRevokeTarget(null); setRevokeReason(''); loadGrants(); }
    else setMsg(res.message || 'Failed to revoke grant.');
  }

  const activeGrants = grants.filter(g => g.active);
  const totalExtra = activeGrants.reduce((s, g) => s + (g.extraAttempts || 0), 0);

  return (
    <div className="glass-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>Attempt Grants</div>
        {totalExtra > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ok)' }}>
            {activeGrants.length} active grant{activeGrants.length !== 1 ? 's' : ''} · +{totalExtra} extra attempts
          </span>
        )}
      </div>

      <form onSubmit={grant} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--muted)' }}>GRANT EXTRA ATTEMPTS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Assessment *</label>
            <select className="select" value={grantForm.assessmentId} onChange={e => setGrantForm(f => ({ ...f, assessmentId: e.target.value }))} required>
              <option value="">Select assessment...</option>
              {assessments.map(a => <option key={a.assessmentId} value={a.assessmentId}>{a.assessmentName}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Extra Attempts</label>
            <input className="input" type="number" min={1} max={10} value={grantForm.extraAttempts} onChange={e => setGrantForm(f => ({ ...f, extraAttempts: Number(e.target.value) }))} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Reason <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
            <input className="input" placeholder="e.g. Technical issue during exam" value={grantForm.reason} onChange={e => setGrantForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
          <button className="btn small" type="submit" disabled={!grantForm.assessmentId || saving}>
            {saving ? 'Granting...' : 'Grant'}
          </button>
        </div>
        {msg && <div className={`toast ${msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error') ? 'bad' : 'ok'}`} style={{ marginTop: 10, fontSize: 12 }}>{msg}</div>}
      </form>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading...</div>
      ) : grants.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>No attempt grants for {traineeName || empId}.</p>
      ) : (
        <table className="glass-table">
          <thead><tr>
            <th>Assessment</th>
            <th>+Attempts</th>
            <th>Reason</th>
            <th>Granted By</th>
            <th>Date</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.grantId} style={{ opacity: g.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: g.active ? 600 : 400 }}>{g.assessmentName || g.assessmentId}</td>
                <td style={{ color: g.active ? 'var(--ok)' : 'var(--muted)', fontWeight: 700 }}>+{g.extraAttempts}</td>
                <td style={{ color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.reason || '—'}</td>
                <td style={{ color: 'var(--muted)' }}>{g.grantedByName || g.grantedBy}</td>
                <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{new Date(g.createdAt).toLocaleDateString('en-IN')}</td>
                <td>
                  {g.active
                    ? <span className="pill ok">Active</span>
                    : <span className="pill" style={{ background: 'rgba(255,255,255,.06)', color: 'var(--muted)' }}>Revoked</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {g.active && (
                    revokeTarget === g.grantId
                      ? <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            className="input"
                            style={{ fontSize: 11, padding: '3px 6px', width: 130 }}
                            placeholder="Reason (optional)..."
                            value={revokeReason}
                            onChange={e => setRevokeReason(e.target.value)}
                          />
                          <button className="btn small danger" onClick={() => revoke(g.grantId)} disabled={revoking === g.grantId}>
                            {revoking === g.grantId ? '...' : 'Confirm'}
                          </button>
                          <button className="btn small secondary" onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}>✕</button>
                        </span>
                      : <button className="btn small secondary" style={{ fontSize: 11 }} onClick={() => setRevokeTarget(g.grantId)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AssignModuleModal({ empId, traineeName, onClose }) {
  const [classrooms, setClassrooms] = useState([]);
  const [modules, setModules] = useState([]);
  const [form, setForm] = useState({
    classroomId: '', moduleId: '', moduleName: '',
    assignmentType: 'Mandatory', message: '', dueDate: '',
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
  }, []);

  useEffect(() => {
    if (!form.classroomId) { setModules([]); return; }
    api.get(`/admin/classrooms/${form.classroomId}/modules`, 'admin').then(r => {
      if (r.ok) setModules(r.data);
    });
  }, [form.classroomId]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.moduleId) return setMsg('Select a module.');
    setLoading(true); setMsg('');
    const res = await api.post('/admin/assign-module', {
      moduleId: form.moduleId,
      moduleName: form.moduleName,
      assignedTo: empId,
      assignedToType: 'individual',
      assignmentType: form.assignmentType,
      message: form.message || null,
      dueDate: form.dueDate || null,
    }, 'admin');
    setLoading(false);
    if (res.ok) onClose(true);
    else setMsg(res.message || 'Failed to assign.');
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose(false)}>
      <div style={{ background: 'var(--card-solid)', borderRadius: 18, padding: '28px 28px 24px', width: 480, maxWidth: '94vw', border: '1.5px solid var(--line)', boxShadow: 'var(--shadow)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>Assign Module</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>to {traineeName || empId}</div>
          </div>
          <button onClick={() => onClose(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>✕</button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>Classroom</label>
            <select className="select" value={form.classroomId} onChange={e => { set('classroomId', e.target.value); set('moduleId', ''); set('moduleName', ''); }} required>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Type</label>
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
            <label>Message to trainee (optional)</label>
            <input className="input" type="text" placeholder="e.g. Please complete before Friday" value={form.message} onChange={e => set('message', e.target.value)} />
          </div>

          {msg && <div className="toast bad" style={{ marginBottom: 12 }}>{msg}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn secondary" onClick={() => onClose(false)}>Cancel</button>
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Assigning…' : 'Assign Module'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TraineeDetailPage({ empId, context, navigate }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [assignMsg, setAssignMsg] = useState('');
  const [permId, setPermId] = useState('');
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingMsg, setMappingMsg] = useState(null);

  function loadTrainee() {
    api.get(`/admin/trainees/${empId}/detail`, 'admin').then(r => { if (r.ok) setData(r.data); setLoading(false); });
  }

  useEffect(() => {
    loadTrainee();
  }, [empId]);

  function goBack() {
    if (context?.fromId) navigate(context.fromId, context);
    else navigate('dashboard');
  }

  async function handleMapPermId(e) {
    e.preventDefault();
    if (!permId.trim()) return;
    setMappingLoading(true);
    setMappingMsg(null);
    const res = await api.post(`/admin/trainees/${data.trainee.employeeId}/map-emp-id`, { permanentEmpId: permId.trim() }, 'admin');
    setMappingLoading(false);
    if (res.ok) {
      setMappingMsg({ type: 'ok', text: `Successfully mapped to permanent ID: ${permId.trim()}` });
      setPermId('');
      loadTrainee();
    } else {
      setMappingMsg({ type: 'bad', text: res.message || res.error || 'Mapping failed.' });
    }
  }

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading trainee...</div>;
  if (!data) return <div style={{color:'var(--bad)',padding:'40px'}}>Trainee not found.</div>;

  const { trainee, attendance, queries, riskLogs } = data;
  const tabs = ['overview','attendance','queries','risk','attempts'];

  return (
    <div>
      {showAssign && (
        <AssignModuleModal
          empId={empId}
          traineeName={trainee.traineeName}
          onClose={ok => {
            setShowAssign(false);
            if (ok) setAssignMsg('Module assigned successfully.');
          }}
        />
      )}

      <button className="back-btn" onClick={goBack}>← {context?.from || 'Dashboard'}</button>
      <div style={{marginBottom:'20px',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <div style={{flex:1}}>
          <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)'}}>{trainee.traineeName || empId}</h2>
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'4px'}}>{empId} · Batch: {trainee.batchNo || '—'}</p>
        </div>
        <span className={`pill ${trainee.riskStatus==='CRITICAL'?'crit':trainee.riskStatus==='HIGH'?'bad':trainee.riskStatus==='MEDIUM'?'warn':'ok'}`}>{trainee.riskStatus}</span>
        <button className="btn small" onClick={() => { setAssignMsg(''); setShowAssign(true); }}>+ Assign Module</button>
      </div>

      {assignMsg && (
        <div className="toast ok" style={{marginBottom:14}}>
          {assignMsg}
          <button style={{marginLeft:10,border:0,background:'transparent',cursor:'pointer',color:'inherit'}} onClick={() => setAssignMsg('')}>✕</button>
        </div>
      )}

      <div className="inner-tabs">
        {tabs.map(t => <button key={t} className={`itab${tab===t?' active':''}`} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="glass-panel" style={{marginBottom:'14px'}}>
            <div className="panel-title">Readiness</div>
            {[['Course Completion', trainee.courseCompletionPct],['Attendance', trainee.attendancePct],['MCQ Score', trainee.assessmentPassPct]].map(([label,val]) => (
              <div key={label} className="rrow">
                <span className="rlabel">{label}</span>
                <div className="rbar"><div className="rbar-fill" style={{width:`${val}%`,background:val>=80?'linear-gradient(90deg,#16a34a,#22c55e)':val>=60?'linear-gradient(90deg,#d97706,#f59e0b)':'linear-gradient(90deg,#dc2626,#f97316)'}}></div></div>
                <span className="rpct">{Math.round(val)}%</span>
              </div>
            ))}
          </div>
          <div className="glass-panel">
            <div className="panel-title">Trainee Info</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
              {[['Employee ID',trainee.employeeId],['Batch',trainee.batchNo||'—'],['Branch',trainee.branch||'—'],['Process',trainee.process||'—'],['LOB',trainee.lob||'—'],['Status',trainee.status],['Risk',trainee.riskStatus],['Certification',trainee.certificationStatus],['OJT Ready',trainee.ojtReady?'Yes':'No']].map(([k,v]) => (
                <div key={k} style={{background: 'var(--card)',borderRadius:'10px',padding:'10px 12px'}}>
                  <div style={{fontSize:'10px',color:'var(--muted-2)',textTransform:'uppercase',letterSpacing:'.05em',fontWeight:'700'}}>{k}</div>
                  <div style={{fontSize:'13px',fontWeight:'700',color:'var(--ink)',marginTop:'4px'}}>{String(v)}</div>
                </div>
              ))}
            </div>
            {trainee.riskReason && (
              <div style={{marginTop:'14px',background:'rgba(220,38,38,.06)',border:'1px solid rgba(220,38,38,.2)',borderRadius:'10px',padding:'12px'}}>
                <div style={{fontSize:'11px',color:'var(--bad)',fontWeight:'700',marginBottom:'4px'}}>RISK REASON</div>
                <div style={{fontSize:'12px',color:'var(--ink-2)'}}>{trainee.riskReason}</div>
              </div>
            )}
          </div>

          {trainee.empIdType === 'TEMP' && (
            <div style={{
              marginTop: 20, background: 'rgba(217,119,6,.08)', border: '1.5px solid rgba(217,119,6,.3)',
              borderRadius: 14, padding: '18px 20px',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ background: '#d97706', color: '#fff', borderRadius: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px' }}>TEMP ID</span>
                <b style={{ fontSize: 14, color: 'var(--ink)' }}>Assign Permanent Employee ID</b>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                Current temp code: <b style={{ fontFamily: 'monospace', color: 'var(--ink)' }}>{trainee.employeeId}</b>.
                Enter the permanent HRMS code to replace it across all records.
              </p>
              {mappingMsg && (
                <div className={`toast ${mappingMsg.type}`} style={{ marginBottom: 12 }}>
                  {mappingMsg.text}
                  <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMappingMsg(null)}>✕</button>
                </div>
              )}
              <form onSubmit={handleMapPermId} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div className="field" style={{ margin: 0, flex: 1 }}>
                  <label>Permanent Employee Code</label>
                  <input className="input" type="text" placeholder="e.g. EMP-10042"
                    value={permId} onChange={e => setPermId(e.target.value)} required />
                </div>
                <button className="btn" type="submit" style={{ marginBottom: 0, flexShrink: 0 }}
                  disabled={mappingLoading}>
                  {mappingLoading ? 'Mapping…' : 'Map ID'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {tab === 'attendance' && (
        <div className="glass-panel">
          <div className="panel-title">Attendance Record <span className="panel-sub">Last {attendance.length} entries</span></div>
          {attendance.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No attendance records.</p>}
          {attendance.length > 0 && (
            <table className="glass-table">
              <thead><tr><th>Date</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {attendance.map(a => (
                  <tr key={a.id}>
                    <td>{new Date(a.date).toLocaleDateString('en-IN')}</td>
                    <td><span className={`pill ${a.finalAttendance==='Present'?'ok':'bad'}`}>{a.finalAttendance}</span></td>
                    <td style={{color:'var(--muted)',fontSize:'11px'}}>{a.attendanceSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'queries' && (
        <div className="glass-panel">
          <div className="panel-title">Q&A History <span className="panel-sub">{queries.length} queries</span></div>
          {queries.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No queries raised.</p>}
          {queries.map(q => (
            <div key={q.queryId} style={{padding:'10px 0',borderBottom:'1px solid var(--line-2)'}}>
              <div style={{fontSize:'12px',color:'var(--ink)',marginBottom:'4px',fontWeight:'500'}}>{q.question}</div>
              <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                <span className={`pill ${q.status==='Open'?'warn':'ok'}`}>{q.status}</span>
                <span style={{fontSize:'10px',color:'var(--muted-2)'}}>{new Date(q.createdAt).toLocaleDateString('en-IN')}</span>
                {q.answeredBy && <span style={{fontSize:'10px',color:'var(--muted-2)'}}>Answered by {q.answeredBy}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'risk' && (
        <div className="glass-panel">
          <div className="panel-title">Risk Logs <span className="panel-sub">{riskLogs.length} open flags</span></div>
          {riskLogs.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No active risk flags.</p>}
          {riskLogs.map(r => (
            <div key={r.id} style={{padding:'12px 0',borderBottom:'1px solid var(--line-2)'}}>
              <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'4px'}}>
                <span className={`pill ${r.severity==='CRITICAL'?'crit':r.severity==='HIGH'?'bad':r.severity==='MEDIUM'?'warn':'ok'}`}>{r.severity}</span>
                <span style={{fontSize:'12px',fontWeight:'700',color:'var(--ink)'}}>{r.riskTitle}</span>
              </div>
              <div style={{fontSize:'11px',color:'var(--muted)'}}>{r.riskType} · {new Date(r.createdAt).toLocaleDateString('en-IN')}</div>
              {r.details && <div style={{fontSize:'11px',color:'var(--ink-2)',marginTop:'4px'}}>{r.details}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === 'attempts' && (
        <TraineeAttemptsTab empId={trainee.employeeId} traineeName={trainee.traineeName} />
      )}
    </div>
  );
}
