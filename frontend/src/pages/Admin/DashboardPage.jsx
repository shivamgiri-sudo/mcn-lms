import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function DashboardPage({ navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/dashboard', 'admin').then(r => {
      if (r.ok) setData(r.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading dashboard...</div>;
  if (!data) return <div style={{color:'var(--bad)',padding:'40px'}}>Failed to load dashboard.</div>;

  const riskConfig = {
    CRITICAL: { label: 'Critical', cls: 'crit', action: 'Immediate escalation required' },
    HIGH: { label: 'High Risk', cls: 'high', action: 'Follow-up required within 24h' },
    MEDIUM: { label: 'Medium Risk', cls: 'med', action: 'Monitor closely' },
    HEALTHY: { label: 'On Track', cls: 'low', action: 'Continue monitoring' },
  };

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)'}}>Dashboard</h2>
        <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'4px'}}>Live overview — {new Date().toLocaleDateString('en-IN', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      </div>

      <div className="kpi-strip">
        <div className="kpi r">
          <div className="kpi-num">{data.trainees}</div>
          <div className="kpi-label">Active Trainees</div>
          <div className="kpi-bar"><div className="kpi-bar-fill" style={{width:'72%'}}></div></div>
        </div>
        <div className="kpi b">
          <div className="kpi-num">{data.batches}</div>
          <div className="kpi-label">Active Batches</div>
          <div className="kpi-bar"><div className="kpi-bar-fill" style={{width:'55%'}}></div></div>
        </div>
        <div className="kpi g">
          <div className="kpi-num">{data.classrooms}</div>
          <div className="kpi-label">Classrooms</div>
          <div className="kpi-bar"><div className="kpi-bar-fill" style={{width:'87%'}}></div></div>
        </div>
        <div className="kpi a">
          <div className="kpi-num">{data.openQueries}</div>
          <div className="kpi-label">Open Queries</div>
          <div className="kpi-bar"><div className="kpi-bar-fill" style={{width:'40%'}}></div></div>
        </div>
        <div className="kpi p">
          <div className="kpi-num">{data.atRiskCount}</div>
          <div className="kpi-label">At Risk</div>
          <div className="kpi-bar"><div className="kpi-bar-fill" style={{width: data.trainees > 0 ? `${Math.round(data.atRiskCount/data.trainees*100)}%` : '0%'}}></div></div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="glass-panel">
          <div className="panel-title">Active Batches <span className="panel-sub">Top {data.activeBatches?.length || 0}</span></div>
          {(data.activeBatches || []).map(b => {
            const pct = b.totalTrainees > 0 ? Math.round(b.certified / b.totalTrainees * 100) : 0;
            const daysLeft = b.endDate ? Math.max(0, Math.ceil((new Date(b.endDate) - new Date()) / 86400000)) : null;
            return (
              <div key={b.batchNo} className="ccard" style={{marginBottom:'8px'}} onClick={() => navigate('batch-detail', { batchNo: b.batchNo })}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:'13px',fontWeight:'700',color:'var(--ink)'}}>{b.batchName || b.batchNo}</span>
                  <span className={`pill ${pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad'}`}>{pct >= 80 ? 'On Track' : pct >= 50 ? 'Needs Attention' : 'Critical'}</span>
                </div>
                <div style={{fontSize:'11px',color:'var(--muted)',marginTop:'4px'}}>{b.coordinatorName || 'No coordinator'}{daysLeft !== null ? ` · ${daysLeft}d left` : ''}</div>
                <div className="prog-bar" style={{marginTop:'8px'}}><div className="prog-fill" style={{width:`${pct}%`}}></div></div>
              </div>
            );
          })}
          <div style={{marginTop:'10px',textAlign:'right'}}><span style={{fontSize:'11px',color:'var(--brand)',cursor:'pointer'}} onClick={() => navigate('batches')}>View all →</span></div>
        </div>

        <div className="glass-panel">
          <div className="panel-title">Coordinator Activity</div>
          {(data.coordinators || []).slice(0,5).map(c => (
            <div key={c.coordinatorLoginId} className="ccard" style={{marginBottom:'8px'}} onClick={() => navigate('coord-detail', { loginId: c.coordinatorLoginId, coordinatorName: c.coordinatorName })}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:'13px',fontWeight:'700',color:'var(--ink)'}}>{c.coordinatorName || c.coordinatorLoginId}</span>
                <span className="pill info">Active</span>
              </div>
              <div style={{fontSize:'11px',color:'var(--muted)',marginTop:'4px'}}>{c.batchNo} · {c.batchName}</div>
            </div>
          ))}
          {(!data.coordinators || data.coordinators.length === 0) && <p style={{fontSize:'12px',color:'var(--muted)'}}>No active coordinators.</p>}
        </div>

        <div>
          <div className="glass-panel" style={{marginBottom:'14px'}}>
            <div className="panel-title">Risk Snapshot</div>
            <div className="risk-grid">
              {['CRITICAL','HIGH','MEDIUM','HEALTHY'].map(lvl => {
                const cfg = riskConfig[lvl];
                const count = data.riskSnapshot?.[lvl] || 0;
                return (
                  <div key={lvl} className={`rtile ${cfg.cls}`} onClick={() => navigate('risk-detail', { level: lvl })}>
                    <div className="rt-num">{count}</div>
                    <div className="rt-label">{cfg.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="glass-panel">
            <div className="panel-title">Live Feed</div>
            <div className="feed-item"><div className="fdot" style={{background:'#16a34a'}}></div><div><div className="feed-text">Dashboard loaded</div><div className="feed-time">Just now</div></div></div>
            {(data.atRiskTrainees || []).slice(0,4).map(t => (
              <div key={t.employeeId} className="feed-item">
                <div className="fdot" style={{background: t.riskStatus==='CRITICAL'?'#dc2626':t.riskStatus==='HIGH'?'#d97706':'#1d4ed8'}}></div>
                <div><div className="feed-text">{t.traineeName || t.employeeId} — {t.riskStatus}</div><div className="feed-time">{t.batchNo}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(data.atRiskTrainees || []).length > 0 && (
        <div className="glass-panel">
          <div className="panel-title">At-Risk Trainees <span className="panel-sub">{data.atRiskTrainees.length} trainees need attention</span></div>
          <table className="glass-table">
            <thead><tr><th>Emp ID</th><th>Name</th><th>Batch</th><th>Attendance</th><th>Course</th><th>MCQ</th><th>Risk</th><th>Action</th></tr></thead>
            <tbody>
              {data.atRiskTrainees.map(t => (
                <tr key={t.employeeId} className="clickable" onClick={() => navigate('trainee-detail', { empId: t.employeeId, from: 'Dashboard', fromId: 'dashboard' })}>
                  <td>{t.employeeId}</td>
                  <td>{t.traineeName}</td>
                  <td>{t.batchNo}</td>
                  <td>{Math.round(t.attendancePct)}%</td>
                  <td>{Math.round(t.courseCompletionPct)}%</td>
                  <td>{Math.round(t.assessmentPassPct)}%</td>
                  <td><span className={`pill ${t.riskStatus==='CRITICAL'?'crit':t.riskStatus==='HIGH'?'bad':'warn'}`}>{t.riskStatus}</span></td>
                  <td><button className={`btn-dark ${t.riskStatus==='CRITICAL'?'danger':''}`} onClick={e=>{e.stopPropagation();}}>{t.riskStatus==='CRITICAL'?'Notify':t.riskStatus==='HIGH'?'Follow Up':'Monitor'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
