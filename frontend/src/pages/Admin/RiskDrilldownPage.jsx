import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import RiskActionModal, { riskActionLabel } from './RiskActionModal.jsx';

const riskConfig = {
  CRITICAL: { cls: 'crit', action: 'Immediate escalation required', color: '#dc2626' },
  HIGH: { cls: 'bad', action: 'Follow-up required within 24h', color: '#d97706' },
  MEDIUM: { cls: 'warn', action: 'Monitor closely', color: '#2563eb' },
  HEALTHY: { cls: 'ok', action: 'Continue monitoring', color: '#16a34a' },
};

export default function RiskDrilldownPage({ level, navigate, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState(null);

  useEffect(() => {
    api.get(`/admin/risk/${level}`, 'admin').then(r => { if (r.ok) setData(r.data); setLoading(false); });
  }, [level]);

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading...</div>;
  if (!data) return <div style={{color:'var(--bad)',padding:'40px'}}>Failed to load.</div>;

  const cfg = riskConfig[level] || riskConfig.MEDIUM;

  return (
    <div>
      <button className="back-btn" onClick={onBack}>← Dashboard</button>
      <div style={{marginBottom:'20px',display:'flex',alignItems:'center',gap:'12px'}}>
        <div>
          <h2 style={{fontSize:'20px',fontWeight:'900',color:cfg.color}}>{level} Risk Trainees</h2>
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'4px'}}>{cfg.action} · {data.count} trainee{data.count!==1?'s':''}</p>
        </div>
        <span className={`pill ${cfg.cls}`}>{data.count}</span>
      </div>

      <div className="glass-panel">
        <div className="panel-title">{level} Risk — Full List <span className="panel-sub">{data.count} trainees</span></div>
        {data.count === 0 ? (
          <p style={{color:'var(--muted)',fontSize:'12px',padding:'20px 0',textAlign:'center'}}>No trainees at this risk level. 🎉</p>
        ) : (
          <table className="glass-table">
            <thead><tr><th>Emp ID</th><th>Name</th><th>Batch</th><th>Course</th><th>Attendance</th><th>MCQ</th><th>Risk Reason</th><th>Action</th></tr></thead>
            <tbody>
              {data.trainees.map(t => (
                <tr key={t.employeeId} className="clickable" onClick={() => navigate('trainee-detail', { empId: t.employeeId, from: `${level} Risk`, fromId: 'risk-detail', level })}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.employeeId}</span>
                    {t.empIdType === 'TEMP' && (
                      <span style={{ marginLeft: 6, background: '#d97706', color: '#fff', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>TEMP</span>
                    )}
                  </td>
                  <td style={{fontWeight:'600'}}>{t.traineeName}</td>
                  <td>{t.batchNo}</td>
                  <td>{Math.round(t.courseCompletionPct)}%</td>
                  <td>{Math.round(t.attendancePct)}%</td>
                  <td>{Math.round(t.assessmentPassPct)}%</td>
                  <td style={{fontSize:'11px',color:'var(--muted)',maxWidth:'200px'}}>{t.riskReason || '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className={`btn-dark ${level==='CRITICAL'?'danger':''}`} onClick={() => {
                      if (level === 'HEALTHY') { navigate('trainee-detail', { empId: t.employeeId, from: `${level} Risk`, fromId: 'risk-detail', level }); }
                      else { setActionModal({ type: level === 'CRITICAL' ? 'notify' : level === 'HIGH' ? 'followup' : 'monitor', trainee: t }); }
                    }}>
                      {riskActionLabel(null, level)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <RiskActionModal modal={actionModal} onClose={() => setActionModal(null)} onNavigate={navigate} />
    </div>
  );
}
