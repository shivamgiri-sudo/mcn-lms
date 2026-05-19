import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

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

  useEffect(() => {
    api.get(`/admin/trainees/${empId}/detail`, 'admin').then(r => { if (r.ok) setData(r.data); setLoading(false); });
  }, [empId]);

  function goBack() {
    if (context?.fromId) navigate(context.fromId, context);
    else navigate('dashboard');
  }

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading trainee...</div>;
  if (!data) return <div style={{color:'var(--bad)',padding:'40px'}}>Trainee not found.</div>;

  const { trainee, attendance, queries, riskLogs } = data;
  const tabs = ['overview','attendance','queries','risk'];

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
              {[['Employee ID',trainee.employeeId],['Batch',trainee.batchNo||'—'],['Status',trainee.status],['Risk',trainee.riskStatus],['Certification',trainee.certificationStatus],['OJT Ready',trainee.ojtReady?'Yes':'No']].map(([k,v]) => (
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
    </div>
  );
}
