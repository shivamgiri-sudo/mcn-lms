import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function TraineeDetailPage({ empId, context, navigate }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

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
      <button className="back-btn" onClick={goBack}>← {context?.from || 'Dashboard'}</button>
      <div style={{marginBottom:'20px',display:'flex',alignItems:'center',gap:'12px'}}>
        <div>
          <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)'}}>{trainee.traineeName || empId}</h2>
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'4px'}}>{empId} · Batch: {trainee.batchNo || '—'}</p>
        </div>
        <span className={`pill ${trainee.riskStatus==='CRITICAL'?'crit':trainee.riskStatus==='HIGH'?'bad':trainee.riskStatus==='MEDIUM'?'warn':'ok'}`}>{trainee.riskStatus}</span>
      </div>

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
