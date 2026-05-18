import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function BatchDetailPage({ batchNo, navigate, onBack }) {
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/admin/batches/${batchNo}`, 'admin'),
      api.get(`/admin/batches/${batchNo}/analytics`, 'admin'),
    ]).then(([d, a]) => {
      if (d.ok) setData(d.data);
      if (a.ok) setAnalytics(a.data);
      setLoading(false);
    });
  }, [batchNo]);

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading batch...</div>;
  if (!data) return <div style={{color:'var(--bad)',padding:'40px'}}>Batch not found.</div>;

  const { batch, trainees, summary } = data;
  const tabs = ['overview','trainees','analytics','coordinator','content'];

  return (
    <div>
      <button className="back-btn" onClick={onBack}>← Batches</button>
      <div style={{marginBottom:'20px',display:'flex',alignItems:'center',gap:'12px'}}>
        <div>
          <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)'}}>{batch.batchName || batchNo}</h2>
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'4px'}}>{batchNo} · {batch.process} / {batch.lob} · {batch.coordinatorName || 'No coordinator'}</p>
        </div>
        <span className={`pill ${batch.batchStatus==='Active'?'ok':batch.batchStatus==='Completed'?'info':'warn'}`}>{batch.batchStatus}</span>
      </div>

      <div className="inner-tabs">
        {tabs.map(t => <button key={t} className={`itab${tab===t?' active':''}`} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="kpi-strip" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
            <div className="kpi g"><div className="kpi-num">{summary.onTrack}</div><div className="kpi-label">On Track</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:`${summary.total>0?Math.round(summary.onTrack/summary.total*100):0}%`}}></div></div></div>
            <div className="kpi a"><div className="kpi-num">{summary.needsAttention}</div><div className="kpi-label">Needs Attention</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:`${summary.total>0?Math.round(summary.needsAttention/summary.total*100):0}%`}}></div></div></div>
            <div className="kpi r"><div className="kpi-num">{summary.atRisk}</div><div className="kpi-label">At Risk</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:`${summary.total>0?Math.round(summary.atRisk/summary.total*100):0}%`}}></div></div></div>
            <div className="kpi b"><div className="kpi-num">{summary.mcqPassed}</div><div className="kpi-label">MCQ Passed</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width:`${summary.total>0?Math.round(summary.mcqPassed/summary.total*100):0}%`}}></div></div></div>
          </div>
          <div className="glass-panel" style={{marginTop:'14px'}}>
            <div className="panel-title">Readiness Overview</div>
            {[['Course Completion', summary.avgCourse], ['Attendance', summary.avgAttendance], ['MCQ Score', summary.avgMcq], ['Certified', summary.total>0?Math.round(summary.certified/summary.total*100):0]].map(([label, val]) => (
              <div key={label} className="rrow">
                <span className="rlabel">{label}</span>
                <div className="rbar"><div className="rbar-fill" style={{width:`${val}%`,background:val>=80?'linear-gradient(90deg,#16a34a,#22c55e)':val>=60?'linear-gradient(90deg,#d97706,#f59e0b)':'linear-gradient(90deg,#dc2626,#f97316)'}}></div></div>
                <span className="rpct">{val}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'trainees' && (
        <div className="glass-panel">
          <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Trainees <span className="panel-sub">{trainees.length} enrolled</span></span>
            <a className="btn small secondary" href={`/api/admin/trainees/export?batchNo=${encodeURIComponent(batchNo)}`} download={`trainees-${batchNo}.csv`}>⬇ Export CSV</a>
          </div>
          <table className="glass-table">
            <thead><tr><th>Emp ID</th><th>Name</th><th>Course</th><th>Attendance</th><th>MCQ</th><th>Risk</th><th>Certified</th></tr></thead>
            <tbody>
              {trainees.map(t => (
                <tr key={t.employeeId} className="clickable" onClick={() => navigate('trainee-detail', { empId: t.employeeId, from: batch.batchName || batchNo, fromId: 'batch-detail', batchNo })}>
                  <td>{t.employeeId}</td>
                  <td style={{fontWeight:'600'}}>{t.traineeName}</td>
                  <td>{Math.round(t.courseCompletionPct)}%</td>
                  <td>{Math.round(t.attendancePct)}%</td>
                  <td>{Math.round(t.assessmentPassPct)}%</td>
                  <td><span className={`pill ${t.riskStatus==='CRITICAL'?'crit':t.riskStatus==='HIGH'?'bad':t.riskStatus==='MEDIUM'?'warn':'ok'}`}>{t.riskStatus}</span></td>
                  <td>{t.certificationStatus === 'Certified' ? <span className="pill ok">Certified</span> : <span style={{color:'var(--muted-2)',fontSize:'11px'}}>Pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'analytics' && analytics && (
        <div>
          <div className="glass-panel" style={{marginBottom:'14px'}}>
            <div className="panel-title">Attendance Trend</div>
            {analytics.attendanceTrend.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No attendance data.</p>}
            {analytics.attendanceTrend.slice(-14).map(d => (
              <div key={d.date} className="rrow">
                <span className="rlabel" style={{fontSize:'11px'}}>{new Date(d.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>
                <div className="rbar"><div className="rbar-fill" style={{width:`${d.pct}%`,background:d.pct>=80?'linear-gradient(90deg,#16a34a,#22c55e)':d.pct>=60?'linear-gradient(90deg,#d97706,#f59e0b)':'linear-gradient(90deg,#dc2626,#f97316)'}}></div></div>
                <span className="rpct">{d.pct}%</span>
              </div>
            ))}
          </div>
          <div className="glass-panel" style={{marginBottom:'14px'}}>
            <div className="panel-title">MCQ Score Distribution</div>
            {Object.entries(analytics.mcqDistribution).map(([band, count]) => (
              <div key={band} className="rrow">
                <span className="rlabel">{band}</span>
                <div className="rbar"><div className="rbar-fill" style={{width: summary.total>0 ? `${Math.round(count/summary.total*100)}%` : '0%',background:'linear-gradient(90deg,#2563eb,#6366f1)'}}></div></div>
                <span className="rpct">{count}</span>
              </div>
            ))}
          </div>
          <div className="glass-panel">
            <div className="panel-title">Certification Forecast</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px',marginTop:'8px'}}>
              {[{label:'Will Certify',val:analytics.certForecast.willCert,cls:'g'},{label:'Borderline',val:analytics.certForecast.borderline,cls:'a'},{label:'At Risk',val:analytics.certForecast.atRisk,cls:'r'}].map(({label,val,cls}) => (
                <div key={label} className={`kpi ${cls}`}><div className="kpi-num">{val}</div><div className="kpi-label">{label}</div><div className="kpi-bar"><div className="kpi-bar-fill" style={{width: summary.total>0?`${Math.round(val/summary.total*100)}%`:'0%'}}></div></div></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'coordinator' && (
        <div className="glass-panel">
          <div className="panel-title">Coordinator Details</div>
          <p style={{fontSize:'13px',color:'var(--ink)'}}>Coordinator: <strong>{batch.coordinatorName || 'Not assigned'}</strong> ({batch.coordinatorLoginId || '—'})</p>
          <div style={{marginTop:'14px'}}>
            <button className="btn-dark primary" onClick={() => batch.coordinatorLoginId && navigate('coord-detail', { loginId: batch.coordinatorLoginId, coordinatorName: batch.coordinatorName })}>
              View Coordinator Profile →
            </button>
          </div>
        </div>
      )}

      {tab === 'content' && (
        <div className="glass-panel">
          <div className="panel-title">Content Progress <span className="panel-sub">Classroom: {batch.classroomName || batch.classroomId || 'Not assigned'}</span></div>
          <p style={{color:'var(--muted)',fontSize:'12px',marginTop:'8px'}}>Content module breakdown available when classroom is linked.</p>
        </div>
      )}
    </div>
  );
}
