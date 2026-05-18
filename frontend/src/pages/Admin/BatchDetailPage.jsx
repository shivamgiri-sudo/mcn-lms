import { useState, useEffect } from 'react';
import { api, downloadCsv } from '../../utils/api.js';

const TRAINEE_CSV_TEMPLATE = 'EmployeeID,Name,Email,Mobile\nEMP1001,John Doe,john@example.com,9876543210\n';

function parseCsvTrainees(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const empIdx = header.findIndex(h => h.includes('emp') || h.includes('id'));
  const nameIdx = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email') || h.includes('mail'));
  const mobileIdx = header.findIndex(h => h.includes('mobile') || h.includes('phone'));
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return {
      employeeId: (empIdx >= 0 ? cols[empIdx] : cols[0]) || '',
      traineeName: (nameIdx >= 0 ? cols[nameIdx] : cols[1]) || '',
      email: (emailIdx >= 0 ? cols[emailIdx] : cols[2]) || '',
      mobile: (mobileIdx >= 0 ? cols[mobileIdx] : cols[3]) || '',
    };
  }).filter(t => t.employeeId);
}

export default function BatchDetailPage({ batchNo, navigate, onBack }) {
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [addMsg, setAddMsg] = useState({ text: '', ok: true });
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [addLoading, setAddLoading] = useState(false);

  // Search & enroll existing trainee
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(null);

  function addToast(text, ok = true) { setAddMsg({ text, ok }); setTimeout(() => setAddMsg({ text: '', ok: true }), 5000); }

  async function searchTrainees(q) {
    setSearchQ(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const res = await api.get(`/admin/trainees/search?q=${encodeURIComponent(q)}&limit=10`, 'admin');
    setSearchLoading(false);
    if (res.ok) setSearchResults(res.data || []);
  }

  async function enrollExisting(trainee) {
    setEnrolling(trainee.employeeId);
    const res = await api.post(`/admin/batches/${batchNo}/trainees/bulk`, {
      trainees: [{ employeeId: trainee.employeeId, traineeName: trainee.traineeName, email: trainee.email || '', mobile: trainee.mobile || '' }],
    }, 'admin');
    setEnrolling(null);
    if (res.ok) {
      addToast(`${trainee.traineeName} enrolled.`);
      setSearchQ('');
      setSearchResults([]);
      reload();
    } else {
      addToast(res.message || 'Enroll failed.', false);
    }
  }

  async function reload() {
    const [d, a] = await Promise.all([
      api.get(`/admin/batches/${batchNo}`, 'admin'),
      api.get(`/admin/batches/${batchNo}/analytics`, 'admin'),
    ]);
    if (d.ok) setData(d.data);
    if (a.ok) setAnalytics(a.data);
    setLoading(false);
  }

  useEffect(() => { reload(); }, [batchNo]);

  async function bulkAddFromCsv() {
    if (!csvPreview || csvPreview.length === 0) return;
    setAddLoading(true);
    const res = await api.post(`/admin/batches/${batchNo}/trainees/bulk`, { trainees: csvPreview }, 'admin');
    setAddLoading(false);
    if (res.ok) {
      addToast(`Added ${res.data.success} trainee(s).${res.data.failed > 0 ? ` ${res.data.failed} failed.` : ''}`);
      setCsvPreview(null);
      reload();
    } else {
      addToast(res.message || 'Failed.', false);
    }
  }

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
        <div>
          {/* Search & enroll existing trainee */}
          <div className="glass-panel" style={{marginBottom:'14px'}}>
            <div className="panel-title">Search & Enroll Existing Trainee</div>
            {addMsg.text && (
              <div className={`${addMsg.ok ? 'toast ok' : 'toast bad'}`} style={{ marginBottom: 10, fontSize: 12 }}>{addMsg.text}</div>
            )}
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                placeholder="Search by name or Employee ID (min 2 chars)..."
                value={searchQ}
                onChange={e => searchTrainees(e.target.value)}
                style={{ width: '100%', paddingRight: 36 }}
              />
              {searchLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--muted)' }}>⟳</span>}
            </div>
            {searchResults.length > 0 && (
              <div style={{ marginTop: 8, background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', overflow: 'hidden' }}>
                {searchResults.map(t => {
                  const alreadyEnrolled = data?.trainees?.some(et => et.employeeId === t.employeeId);
                  return (
                    <div key={t.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t.traineeName}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.employeeId}{t.email ? ` · ${t.email}` : ''}{t.batchNo ? ` · Batch: ${t.batchNo}` : ''}</div>
                      </div>
                      {alreadyEnrolled
                        ? <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 700 }}>✓ Enrolled</span>
                        : <button className="btn small" onClick={() => enrollExisting(t)} disabled={enrolling === t.employeeId}>
                            {enrolling === t.employeeId ? '...' : '+ Enroll'}
                          </button>
                      }
                    </div>
                  );
                })}
              </div>
            )}
            {searchQ.length >= 2 && !searchLoading && searchResults.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center', padding: '12px 0' }}>No trainees found for "{searchQ}"</div>
            )}
          </div>

          {/* Add trainees via CSV */}
          <div className="glass-panel" style={{marginBottom:'14px'}}>
            <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>Bulk Upload via CSV</span>
              <button className="btn small secondary" onClick={() => {
                const blob = new Blob([TRAINEE_CSV_TEMPLATE], { type: 'text/csv' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Trainee_Upload_Template.csv'; a.click();
              }}>⬇ Download Template</button>
            </div>
            <div
              onDragOver={e => { e.preventDefault(); setCsvDragging(true); }}
              onDragLeave={() => setCsvDragging(false)}
              onDrop={e => {
                e.preventDefault(); setCsvDragging(false);
                const file = e.dataTransfer.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setCsvPreview(parseCsvTrainees(ev.target.result));
                reader.readAsText(file);
              }}
              onClick={() => document.getElementById(`bdp-csv-${batchNo}`).click()}
              style={{
                border: `2px dashed ${csvDragging ? '#2563eb' : 'rgba(255,255,255,.15)'}`,
                borderRadius: 12, padding: '22px 20px', textAlign: 'center',
                background: csvDragging ? 'rgba(37,99,235,.12)' : 'rgba(255,255,255,.03)',
                cursor: 'pointer', transition: 'all .15s', marginBottom: 10,
              }}
            >
              <input id={`bdp-csv-${batchNo}`} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setCsvPreview(parseCsvTrainees(ev.target.result));
                reader.readAsText(file); e.target.value = '';
              }} />
              <div style={{ fontSize: 22, marginBottom: 6 }}>📂</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drop trainee CSV here or click to browse</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Columns: EmployeeID, Name, Email, Mobile</div>
            </div>
            {csvPreview && csvPreview.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{csvPreview.length} trainees found</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn small" onClick={bulkAddFromCsv} disabled={addLoading}>
                      {addLoading ? '...' : `+ Add ${csvPreview.length} Trainees`}
                    </button>
                    <button className="btn small secondary" onClick={() => setCsvPreview(null)}>Discard</button>
                  </div>
                </div>
                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'grid', gap: 3 }}>
                  {csvPreview.slice(0, 8).map((t, i) => (
                    <div key={i} style={{ fontSize: 11, display: 'flex', gap: 10, padding: '3px 0' }}>
                      <b style={{ color: 'var(--brand)', minWidth: 80 }}>{t.employeeId}</b>
                      <span style={{ color: 'var(--ink)' }}>{t.traineeName}</span>
                      {t.email && <span style={{ color: 'var(--muted)' }}>{t.email}</span>}
                    </div>
                  ))}
                  {csvPreview.length > 8 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>...and {csvPreview.length - 8} more</div>}
                </div>
              </div>
            )}
          </div>

          {/* Trainees list */}
          <div className="glass-panel">
            <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Enrolled Trainees <span className="panel-sub">{trainees.length}</span></span>
              <button className="btn small secondary" onClick={() => downloadCsv(`/admin/trainees/export?batchNo=${encodeURIComponent(batchNo)}`, `trainees-${batchNo}.csv`)}>⬇ Export CSV</button>
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
