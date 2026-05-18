import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function CoordDetailPage({ loginId, coordinatorName, navigate, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/admin/coordinators/${loginId}`, 'admin').then(r => { if (r.ok) setData(r.data); setLoading(false); });
  }, [loginId]);

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading...</div>;
  if (!data) return <div style={{color:'var(--bad)',padding:'40px'}}>Coordinator not found.</div>;

  const tabs = ['overview','pending','batches','activity'];
  const score = data.effectivenessScore || 75;

  return (
    <div>
      <button className="back-btn" onClick={onBack}>← Coordinators</button>
      <div style={{marginBottom:'20px',display:'flex',alignItems:'center',gap:'12px'}}>
        <div>
          <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)'}}>{coordinatorName || loginId}</h2>
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'4px'}}>{loginId} · {data.batches.length} active batch{data.batches.length!==1?'es':''}</p>
        </div>
        <span className={`pill ${score>=80?'ok':score>=60?'warn':'bad'}`}>Score: {score}%</span>
      </div>

      <div className="inner-tabs">
        {tabs.map(t => <button key={t} className={`itab${tab===t?' active':''}`} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="kpi-strip" style={{gridTemplateColumns:'repeat(4,1fr)',marginBottom:'14px'}}>
            <div className="kpi b"><div className="kpi-num">{data.batches.length}</div><div className="kpi-label">Batches</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:'60%'}}></div></div></div>
            <div className="kpi g"><div className="kpi-num">{data.answeredQueries}</div><div className="kpi-label">Q&A Answered</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:`${data.qaResponseRate}%`}}></div></div></div>
            <div className="kpi a"><div className="kpi-num">{data.openQueries}</div><div className="kpi-label">Open Queries</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:'40%'}}></div></div></div>
            <div className="kpi p"><div className="kpi-num">{score}%</div><div className="kpi-label">Effectiveness</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:`${score}%`}}></div></div></div>
          </div>
          <div className="glass-panel">
            <div className="panel-title">Effectiveness Breakdown</div>
            {[['Q&A Response Rate', data.qaResponseRate],['Attendance Marking', 80],['Drive Compliance', 75],['Escalation Handling', 70]].map(([label,val]) => (
              <div key={label} className="rrow">
                <span className="rlabel">{label}</span>
                <div className="rbar"><div className="rbar-fill" style={{width:`${val}%`,background:val>=80?'linear-gradient(90deg,#16a34a,#22c55e)':val>=60?'linear-gradient(90deg,#d97706,#f59e0b)':'linear-gradient(90deg,#dc2626,#f97316)'}}></div></div>
                <span className="rpct">{val}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'pending' && (
        <div className="glass-panel">
          <div className="panel-title">Pending Actions <span className="panel-sub">{data.pendingActions.length} open</span></div>
          {data.pendingActions.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No pending actions.</p>}
          {data.pendingActions.map(a => (
            <div key={a.queryId} className={`aitem ${a.priority==='High'?'urgent':'warn'}`}>
              <div className="adot"></div>
              <div>
                <div className="atext">{a.traineeName}: {a.question.slice(0,80)}{a.question.length>80?'...':''}</div>
                <div className="atime">{a.batchNo} · {new Date(a.createdAt).toLocaleDateString('en-IN')}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'batches' && (
        <div className="glass-panel">
          <div className="panel-title">Assigned Batches</div>
          <table className="glass-table">
            <thead><tr><th>Batch No</th><th>Name</th><th>Status</th><th>Trainees</th></tr></thead>
            <tbody>
              {data.batches.map(b => (
                <tr key={b.batchNo} className="clickable" onClick={() => navigate('batch-detail', { batchNo: b.batchNo })}>
                  <td>{b.batchNo}</td>
                  <td>{b.batchName}</td>
                  <td><span className={`pill ${b.batchStatus==='Active'?'ok':'info'}`}>{b.batchStatus}</span></td>
                  <td>{b.totalTrainees}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'activity' && (
        <div className="glass-panel">
          <div className="panel-title">Recent Activity</div>
          {data.pendingActions.length === 0
            ? <p style={{color:'var(--muted)',fontSize:'12px'}}>No recent activity.</p>
            : data.pendingActions.slice(0,10).map(a => (
              <div key={a.queryId} className="feed-item">
                <div className="fdot" style={{background:'#2563eb'}}></div>
                <div><div className="feed-text">Query from {a.traineeName}: {a.question.slice(0,60)}...</div><div className="feed-time">{new Date(a.createdAt).toLocaleDateString('en-IN')}</div></div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}
