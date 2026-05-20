import { useState, useEffect } from 'react';
import { api, downloadCsv } from '../../utils/api.js';
import { formatDate, formatDateTime, pct, riskColor } from '../../utils/format.js';

const TRAINEE_CSV_TEMPLATE = 'EmployeeID,Name,Email,Mobile,DOJ\nEMP1001,John Doe,john@example.com,9876543210,2026-05-01\n';

function parseCsvTrainees(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const empIdx = header.findIndex(h => h.includes('emp') || h.includes('id'));
  const nameIdx = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email') || h.includes('mail'));
  const mobileIdx = header.findIndex(h => h.includes('mobile') || h.includes('phone'));
  const dojIdx = header.findIndex(h => h.includes('doj') || h.includes('date'));
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return {
      employeeId: (empIdx >= 0 ? cols[empIdx] : cols[0]) || '',
      traineeName: (nameIdx >= 0 ? cols[nameIdx] : cols[1]) || '',
      email: (emailIdx >= 0 ? cols[emailIdx] : cols[2]) || '',
      mobile: (mobileIdx >= 0 ? cols[mobileIdx] : cols[3]) || '',
      doj: (dojIdx >= 0 ? cols[dojIdx] : cols[4]) || '',
    };
  }).filter(t => t.employeeId);
}

export default function BatchDetail({ batchNo, onBack }) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('trainees');
  const [showOnboard, setShowOnboard] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [closureRemarks, setClosureRemarks] = useState('');
  const [closureChecks, setClosureChecks] = useState({ allAttended: false, assessmentsDone: false, certComplete: false, handoverDone: false });
  const allChecked = Object.values(closureChecks).every(Boolean);
  const [form, setForm] = useState({ employeeId: '', traineeName: '', email: '', mobile: '', doj: '' });
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Permanent ID mapping
  const [mappingTrainee, setMappingTrainee] = useState(null);
  const [permId, setPermId] = useState('');
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingMsg, setMappingMsg] = useState(null);

  // Search & enroll existing trainee
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(null);

  useEffect(() => { load(); }, [batchNo]);

  async function load() {
    const res = await api.get(`/coordinator/batches/${batchNo}`, 'coordinator');
    if (res.ok) setData(res.data);
  }

  async function searchTrainees(q) {
    setSearchQ(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const res = await api.get(`/coordinator/trainees/search?q=${encodeURIComponent(q)}&limit=10`, 'coordinator');
    setSearchLoading(false);
    if (res.ok) setSearchResults(res.data || []);
  }

  async function enrollExisting(trainee) {
    setEnrolling(trainee.employeeId);
    const res = await api.post(`/coordinator/batches/${batchNo}/trainees/bulk`, {
      trainees: [{ employeeId: trainee.employeeId, traineeName: trainee.traineeName, email: trainee.email || '', mobile: trainee.mobile || '' }],
    }, 'coordinator');
    setEnrolling(null);
    if (res.ok) {
      setMsg(`✓ ${trainee.traineeName || trainee.employeeId} enrolled.`);
      setSearchQ(''); setSearchResults([]);
      load();
    } else {
      setMsg(res.message || 'Enroll failed.');
    }
  }

  async function bulkAddFromCsv() {
    if (!csvPreview || csvPreview.length === 0) return;
    setLoading(true);
    const res = await api.post(`/coordinator/batches/${batchNo}/trainees/bulk`, { trainees: csvPreview }, 'coordinator');
    setLoading(false);
    if (res.ok) {
      setMsg(`✓ ${res.data.success} onboarded, ${res.data.failed} failed.`);
      setCsvPreview(null);
      load();
    } else {
      setMsg(res.message || 'Failed.');
    }
  }

  async function onboardTrainee(e) {
    e.preventDefault();
    setLoading(true); setMsg('');
    const res = await api.post(`/coordinator/batches/${batchNo}/trainees`, form, 'coordinator');
    setLoading(false);
    if (res.ok) { setMsg(`✓ ${res.message}`); setForm({ employeeId: '', traineeName: '', email: '', mobile: '', doj: '' }); load(); }
    else setMsg(res.message || 'Failed.');
  }

  async function handleMapPermId(e) {
    e.preventDefault();
    if (!permId.trim()) return;
    setMappingLoading(true);
    setMappingMsg(null);
    const res = await api.post(`/coordinator/trainees/${mappingTrainee.employeeId}/map-emp-id`, { permanentEmpId: permId.trim() }, 'coordinator');
    setMappingLoading(false);
    if (res.ok) {
      setMappingMsg({ type: 'ok', text: `Mapped to ${permId.trim()} successfully.` });
      setPermId('');
      setMappingTrainee(null);
      load();
    } else {
      setMappingMsg({ type: 'bad', text: res.message || res.error || 'Mapping failed.' });
    }
  }

  if (!data) return <div style={{ paddingTop: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  const { batch, trainees, pending, queries, risks } = data;
  const tabs = [
    { id: 'trainees', label: `Trainees (${trainees.length})` },
    { id: 'pending', label: `Pending (${pending.length})` },
    { id: 'queries', label: `Q&A (${queries.length})` },
    { id: 'risks', label: `Risks (${risks.length})` },
    { id: 'certification', label: 'Certification' },
  ];

  return (
    <div>
      {msg && !showClose && !showOnboard && (
        <div className="toast warn" style={{ marginBottom: 12 }}>{msg}<button style={{ marginLeft: 10, cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit', fontWeight: 700 }} onClick={() => setMsg('')}>✕</button></div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <button className="btn small secondary" onClick={onBack}>← Back</button>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{batch.batchNo}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>{batch.batchName} &nbsp;|&nbsp; {batch.process} / {batch.lob} &nbsp;|&nbsp; {batch.branch}</p>
        </div>
        <span className={`pill ${batch.batchStatus === 'Active' ? 'ok' : ''}`} style={{ marginLeft: 'auto' }}>{batch.batchStatus}</span>
        {batch.batchStatus === 'Active' && (
          <button
            className="btn small danger"
            onClick={() => {
              const pendingCert = trainees.filter(t => t.certificationStatus !== 'Certified' && t.certificationStatus !== 'Failed').length;
              const pendingHO = trainees.filter(t => t.certificationStatus === 'Certified' && !t.handoverToOps).length;
              if (pendingCert > 0 || pendingHO > 0) {
                setActiveTab('certification');
                setMsg(`Complete certification & handover before closing. ${pendingCert > 0 ? `${pendingCert} trainee(s) not yet certified. ` : ''}${pendingHO > 0 ? `${pendingHO} certified trainee(s) not yet handed over.` : ''}`);
              } else {
                setShowClose(true);
              }
            }}
          >🔒 Close Batch</button>
        )}
      </div>

      {/* KPI Row */}
      <div className="stat-row">
        <div className="stat info"><div className="num">{trainees.length}</div><div className="label">Trainees</div></div>
        <div className="stat ok"><div className="num">{trainees.filter(t => t.certificationStatus === 'Certified').length}</div><div className="label">Certified</div></div>
        <div className="stat warn"><div className="num">{pending.length}</div><div className="label">Pending Activities</div></div>
        <div className="stat bad"><div className="num">{risks.filter(r => r.severity === 'CRITICAL').length}</div><div className="label">Critical Risks</div></div>
        <div className="stat info"><div className="num">{queries.filter(q => q.status === 'Open').length}</div><div className="label">Open Questions</div></div>
      </div>

      <div className="tabs">
        {tabs.map(t => <button key={t.id} className={`tab-btn${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
      </div>

      {/* TRAINEES TAB */}
      {activeTab === 'trainees' && (
        <div>
          <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
            <button className="btn small" onClick={() => setShowOnboard(true)}>+ Add Trainee</button>
            <button className="btn small secondary" onClick={() => setShowBulk(true)}>⬆ Bulk Upload (CSV)</button>
            <button className="btn small secondary" onClick={() => downloadCsv(`/reports/trainees/export?batchNo=${encodeURIComponent(batchNo)}`, `trainees-${batchNo}.csv`, 'coordinator')}>⬇ Export CSV</button>
          </div>
          {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 8 }}>{msg}<button style={{ marginLeft: 8, cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit', fontWeight: 700 }} onClick={() => setMsg('')}>✕</button></div>}

          {/* Search & Enroll Existing Trainee */}
          <div className="card" style={{ marginBottom: 12, padding: '14px 16px' }}>
            <b style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Search & Enroll Existing LMS User</b>
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
              <div style={{ marginTop: 8, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--line)', overflow: 'hidden' }}>
                {searchResults.map(t => {
                  const alreadyEnrolled = trainees.some(et => et.employeeId === t.employeeId);
                  return (
                    <div key={t.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--line)' }}>
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
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center', padding: '10px 0' }}>No trainees found for "{searchQ}"</div>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee ID</th><th>Name</th><th>Mobile</th><th>Course %</th><th>MCQ %</th><th>Attendance %</th><th>Risk</th><th>Status</th><th>Perm. ID</th></tr></thead>
              <tbody>
                {trainees.map(t => (
                  <tr key={t.id}>
                    <td>
                      <b>{t.employeeId}</b>
                      {t.empIdType === 'TEMP' && <span className="pill warn" style={{ marginLeft: 6, fontSize: 10 }}>TEMP</span>}
                    </td>
                    <td>{t.traineeName || '—'}</td>
                    <td>{t.mobile || '—'}</td>
                    <td>{pct(t.courseCompletionPct)}</td>
                    <td>{pct(t.assessmentPassPct)}</td>
                    <td>{pct(t.attendancePct)}</td>
                    <td><span className={`pill ${riskColor(t.riskStatus)}`}>{t.riskStatus}</span></td>
                    <td>{t.certificationStatus}</td>
                    <td>
                      {t.empIdType === 'TEMP'
                        ? <button className="btn small secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setMappingTrainee(t); setPermId(''); setMappingMsg(null); }}>Assign Perm. ID</button>
                        : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PENDING TAB */}
      {activeTab === 'pending' && (
        <div style={{ marginTop: 12 }}>
          {pending.length === 0 && <div className="empty">No pending activities. Great work!</div>}
          {pending.map(a => <PendingCard key={a.id} activity={a} onAction={load} />)}
        </div>
      )}

      {/* Q&A TAB */}
      {activeTab === 'queries' && (
        <div style={{ marginTop: 12 }}>
          {queries.length === 0 && <div className="empty">No questions raised yet.</div>}
          {queries.map(q => <QueryCard key={q.id} query={q} batchNo={batchNo} onAction={load} />)}
        </div>
      )}

      {/* RISKS TAB */}
      {activeTab === 'risks' && (
        <div style={{ marginTop: 12 }}>
          {risks.length === 0 && <div className="empty">No open risks. Excellent!</div>}
          {risks.map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${riskColor(r.severity)})` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <b>{r.riskTitle}</b>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>Trainee: {r.traineeName || r.employeeId} &nbsp;|&nbsp; {formatDateTime(r.createdAt)}</p>
                  {r.currentValue != null && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Current: {r.currentValue}% &nbsp;|&nbsp; Expected: {r.expectedValue}%</p>}
                </div>
                <span className={`pill ${riskColor(r.severity)}`}>{r.severity}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CERTIFICATION TAB */}
      {activeTab === 'certification' && <CertificationTab batchNo={batchNo} trainees={trainees} />}

      {/* Onboard single trainee */}
      {showOnboard && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowOnboard(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div className="modal-head"><b>Add Trainee to {batchNo}</b><button className="btn small secondary" onClick={() => setShowOnboard(false)}>Close</button></div>
            <div className="modal-body">
              <form onSubmit={onboardTrainee}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field"><label>Employee ID *</label><input className="input" value={form.employeeId} onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))} /></div>
                  <div className="field"><label>Name</label><input className="input" value={form.traineeName} onChange={e => setForm(p => ({ ...p, traineeName: e.target.value }))} /></div>
                  <div className="field"><label>Mobile</label><input className="input" value={form.mobile} onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))} /></div>
                  <div className="field"><label>Email</label><input className="input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
                  <div className="field"><label>DOJ</label><input className="input" type="date" value={form.doj} onChange={e => setForm(p => ({ ...p, doj: e.target.value }))} /></div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Temp password: mobile last 4 digits (or 1234). Trainee must reset on first login.</p>
                <button className="btn" type="submit" disabled={loading} style={{ marginTop: 10 }}>{loading ? 'Onboarding...' : 'Add Trainee'}</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Bulk upload */}
      {showBulk && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowBulk(false)}>
          <div className="modal-box" style={{ maxWidth: 580 }}>
            <div className="modal-head">
              <b>Bulk Onboard to {batchNo}</b>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small secondary" onClick={() => {
                  const blob = new Blob([TRAINEE_CSV_TEMPLATE], { type: 'text/csv' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Trainee_Upload_Template.csv'; a.click();
                }}>⬇ Template</button>
                <button className="btn small secondary" onClick={() => { setShowBulk(false); setCsvPreview(null); }}>Close</button>
              </div>
            </div>
            <div className="modal-body">
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
                onClick={() => document.getElementById(`coord-csv-${batchNo}`).click()}
                style={{
                  border: `2px dashed ${csvDragging ? '#2563eb' : 'var(--line)'}`,
                  borderRadius: 12, padding: '22px 20px', textAlign: 'center',
                  background: csvDragging ? 'rgba(37,99,235,.12)' : 'var(--surface, rgba(255,255,255,.03))',
                  cursor: 'pointer', transition: 'all .15s', marginBottom: 10,
                }}
              >
                <input id={`coord-csv-${batchNo}`} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => {
                  const file = e.target.files[0]; if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setCsvPreview(parseCsvTrainees(ev.target.result));
                  reader.readAsText(file); e.target.value = '';
                }} />
                <div style={{ fontSize: 22, marginBottom: 6 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drop trainee CSV here or click to browse</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Columns: EmployeeID, Name, Email, Mobile, DOJ</div>
              </div>
              {csvPreview && csvPreview.length > 0 && (
                <div style={{ background: 'var(--surface, rgba(255,255,255,.04))', borderRadius: 10, border: '1px solid var(--line)', padding: '12px 16px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{csvPreview.length} trainees found</span>
                    <button className="btn small secondary" onClick={() => setCsvPreview(null)}>Discard</button>
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
              {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn" onClick={bulkAddFromCsv} disabled={loading || !csvPreview || csvPreview.length === 0}>
                  {loading ? 'Uploading...' : csvPreview ? `+ Onboard ${csvPreview.length} Trainees` : 'Select a CSV file first'}
                </button>
                <button className="btn secondary" onClick={() => { setShowBulk(false); setCsvPreview(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Permanent ID Modal */}
      {mappingTrainee && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMappingTrainee(null)}>
          <div className="modal-box" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <b>Assign Permanent Employee ID</b>
              <button className="btn small secondary" onClick={() => setMappingTrainee(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                Trainee: <b style={{ color: 'var(--ink)' }}>{mappingTrainee.traineeName || mappingTrainee.employeeId}</b><br />
                Current Temp ID: <b style={{ color: 'var(--ink)' }}>{mappingTrainee.employeeId}</b>
              </p>
              <form onSubmit={handleMapPermId}>
                <div className="field">
                  <label>Permanent Employee ID *</label>
                  <input
                    className="input"
                    placeholder="e.g. EMP20001"
                    value={permId}
                    onChange={e => setPermId(e.target.value)}
                    autoFocus
                  />
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  This will replace the temporary ID across all trainee records. This action cannot be undone.
                </p>
                {mappingMsg && (
                  <div className={`toast ${mappingMsg.type}`} style={{ margin: '10px 0 0' }}>{mappingMsg.text}</div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button className="btn" type="submit" disabled={mappingLoading || !permId.trim()}>
                    {mappingLoading ? 'Mapping...' : 'Confirm Map'}
                  </button>
                  <button className="btn secondary" type="button" onClick={() => setMappingTrainee(null)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Close Batch Modal */}
      {showClose && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowClose(false)}>
          <div className="modal-box" style={{ maxWidth: 500 }}>
            <div className="modal-head"><b>🔒 Close Batch — {batchNo}</b><button className="btn small secondary" onClick={() => setShowClose(false)}>✕</button></div>
            <div className="modal-body">
              <div className="warn-box" style={{ marginBottom: 16 }}>
                <b>⚠ This action is permanent.</b> Once closed, the batch cannot be re-opened. All trainee progress tracking will freeze.
              </div>

              <b style={{ fontSize: 13, color: 'var(--ink)', display: 'block', marginBottom: 10 }}>Pre-closure checklist — check all boxes to proceed:</b>
              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                {[
                  ['allAttended', 'All training sessions have been conducted and attendance marked'],
                  ['assessmentsDone', 'All MCQ assessments have been completed by trainees'],
                  ['certComplete', 'Final status (Certified / Attrition) set for all active trainees'],
                  ['handoverDone', 'Certified trainees have been handed over to operations team'],
                ].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '8px 12px', borderRadius: 8, background: closureChecks[key] ? 'rgba(34,197,94,.1)' : 'rgba(255,255,255,.04)', border: '1px solid', borderColor: closureChecks[key] ? 'rgba(34,197,94,.3)' : 'var(--line)' }}>
                    <input
                      type="checkbox"
                      checked={closureChecks[key]}
                      onChange={e => setClosureChecks(p => ({ ...p, [key]: e.target.checked }))}
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 13, color: closureChecks[key] ? '#4ade80' : 'var(--ink)' }}>{label}</span>
                  </label>
                ))}
              </div>

              <div className="field">
                <label>Closure Remarks * <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(required)</span></label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Describe completion status, any unresolved issues, notes for records..."
                  value={closureRemarks}
                  onChange={e => setClosureRemarks(e.target.value)}
                />
              </div>

              {!allChecked && (
                <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 10 }}>
                  Complete all checklist items before closing.
                </div>
              )}
              {!closureRemarks.trim() && allChecked && (
                <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 10 }}>
                  Closure remarks are required.
                </div>
              )}

              {msg && <div className={`toast ${msg.startsWith('✓') ? 'ok' : 'bad'}`} style={{ marginBottom: 12 }}>{msg}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button
                  className="btn danger"
                  disabled={loading || !allChecked || !closureRemarks.trim()}
                  onClick={async () => {
                    setLoading(true); setMsg('');
                    const res = await api.post(`/coordinator/batches/${batchNo}/close`, { remarks: closureRemarks }, 'coordinator');
                    setLoading(false);
                    if (res.ok) { setMsg('✓ Batch closed successfully.'); setTimeout(() => { setShowClose(false); load(); }, 1500); }
                    else setMsg(res.message || 'Failed to close batch.');
                  }}
                >
                  {loading ? 'Closing...' : '🔒 Confirm Close Batch'}
                </button>
                <button className="btn secondary" onClick={() => setShowClose(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PendingCard({ activity: a, onAction }) {
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  async function markDone() {
    setSaving(true);
    await api.patch(`/coordinator/pending-activities/${a.id}`, { actionTaken: answer, status: 'Actioned' }, 'coordinator');
    setSaving(false);
    onAction();
  }

  return (
    <div className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${a.severity === 'CRITICAL' ? 'bad' : a.severity === 'HIGH' ? 'warn' : 'info'})` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <b>{a.activityTitle}</b>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{a.traineeName || a.employeeId} &nbsp;|&nbsp; {a.activityType}</p>
          {a.details && <p style={{ fontSize: 12, color: 'var(--muted)' }}>{a.details}</p>}
        </div>
        <span className={`pill ${a.severity === 'CRITICAL' ? 'bad' : a.severity === 'HIGH' ? 'warn' : 'info'}`}>{a.severity}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="input" style={{ fontSize: 12 }} placeholder="Action taken..." value={answer} onChange={e => setAnswer(e.target.value)} />
        <button className="btn small ok" onClick={markDone} disabled={saving}>Done</button>
      </div>
    </div>
  );
}

function QueryCard({ query: q, onAction }) {
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  async function submitAnswer() {
    if (!answer.trim()) return;
    setSaving(true);
    await api.patch(`/coordinator/queries/${q.id}`, { coordinatorAnswer: answer }, 'coordinator');
    setSaving(false);
    setAnswer('');
    onAction();
  }

  const statusColor = { Open: 'warn', Answered: 'ok', Closed: '' };

  return (
    <div className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${statusColor[q.status] || 'line'})` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <b style={{ fontSize: 13 }}>{q.question}</b>
        <span className={`pill ${statusColor[q.status]}`}>{q.status}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{q.traineeName || q.employeeId} &nbsp;|&nbsp; {q.category} &nbsp;|&nbsp; Priority: {q.priority}</p>
      {q.coordinatorAnswer && (
        <div style={{ marginTop: 8, borderLeft: '4px solid var(--ok)', background: '#ecfdf5', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
          <b>Your answer:</b> {q.coordinatorAnswer}
        </div>
      )}
      {q.status === 'Open' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <textarea className="input" style={{ minHeight: 60, fontSize: 12 }} placeholder="Type your answer..." value={answer} onChange={e => setAnswer(e.target.value)} />
          <button className="btn small ok" onClick={submitAnswer} disabled={saving}>Answer</button>
        </div>
      )}
    </div>
  );
}

function CertificationTab({ batchNo, trainees }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => { load(); }, [batchNo]);

  async function load() {
    const res = await api.get(`/coordinator/batches/${batchNo}/certification`, 'coordinator');
    if (res.ok) setData(res.data);
  }

  async function certify(employeeId) {
    const res = await api.post(`/coordinator/batches/${batchNo}/certification/certify`, { employeeId }, 'coordinator');
    if (res.ok) { setMsg(`✓ ${employeeId} certified.`); load(); }
    else setMsg(res.message || 'Failed.');
  }

  async function handover(employeeId) {
    const res = await api.post(`/coordinator/batches/${batchNo}/certification/handover`, { employeeId }, 'coordinator');
    if (res.ok) { setMsg(`✓ ${employeeId} handed over.`); load(); }
    else setMsg(res.message || 'Failed.');
  }

  async function setFinalStatus(employeeId, finalStatus) {
    const res = await api.patch(`/coordinator/batches/${batchNo}/trainees/${employeeId}/final-status`, { finalStatus }, 'coordinator');
    if (res.ok) { setMsg(`✓ ${employeeId} marked as ${finalStatus}.`); load(); }
    else setMsg(res.message || 'Failed.');
  }

  async function bulkCertifyAll() {
    if (!data?.trainees) return;
    const eligible = data.trainees.filter(t => t.eligible && t.certificationStatus !== 'Certified' && t.certificationStatus !== 'Attrition');
    if (!eligible.length) return setMsg('No eligible trainees to certify.');
    setBulkLoading(true);
    for (const t of eligible) {
      await api.post(`/coordinator/batches/${batchNo}/certification/certify`, { employeeId: t.employeeId }, 'coordinator');
    }
    setBulkLoading(false);
    setMsg(`✓ ${eligible.length} trainees certified.`);
    load();
  }

  async function bulkHandoverAll() {
    if (!data?.trainees) return;
    const certified = data.trainees.filter(t => t.certificationStatus === 'Certified' && !t.handoverToOps);
    if (!certified.length) return setMsg('No certified trainees pending handover.');
    setBulkLoading(true);
    for (const t of certified) {
      await api.post(`/coordinator/batches/${batchNo}/certification/handover`, { employeeId: t.employeeId }, 'coordinator');
    }
    setBulkLoading(false);
    setMsg(`✓ ${certified.length} trainees handed over to OPS.`);
    load();
  }

  async function bulkMarkNotCertified() {
    if (!data?.trainees) return;
    const remaining = data.trainees.filter(t => !t.certificationStatus || (t.certificationStatus === 'Not Certified' && t.status === 'Active'));
    // "remaining" = trainees with no final status yet (null or default Not Certified with Active status)
    const unresolved = data.trainees.filter(t => t.status === 'Active' && !t.handoverToOps && t.certificationStatus !== 'Certified' && t.certificationStatus !== 'Attrition');
    if (!unresolved.length) return setMsg('No remaining trainees to mark.');
    if (!window.confirm(`Mark ${unresolved.length} trainee(s) as Not Certified?`)) return;
    setBulkLoading(true);
    for (const t of unresolved) {
      await api.patch(`/coordinator/batches/${batchNo}/trainees/${t.employeeId}/final-status`, { finalStatus: 'Not Certified' }, 'coordinator');
    }
    setBulkLoading(false);
    setMsg(`✓ ${unresolved.length} trainees marked as Not Certified.`);
    load();
  }

  if (!data) return <div className="spinner" />;

  const traineeList = data.trainees || [];
  const eligibleCount = traineeList.filter(t => t.eligible).length;
  const certifiedCount = traineeList.filter(t => t.certificationStatus === 'Certified').length;
  const attritionCount = traineeList.filter(t => t.certificationStatus === 'Attrition').length;
  const handedOverCount = traineeList.filter(t => t.handoverToOps).length;
  const pendingCertify = traineeList.filter(t => t.eligible && t.certificationStatus !== 'Certified' && t.certificationStatus !== 'Attrition').length;
  const pendingHandover = traineeList.filter(t => t.certificationStatus === 'Certified' && !t.handoverToOps).length;
  const unresolvedCount = traineeList.filter(t => t.status === 'Active' && !t.handoverToOps && t.certificationStatus !== 'Certified' && t.certificationStatus !== 'Attrition').length;

  function statusPill(t) {
    if (t.handoverToOps) return <span className="pill info" style={{ background: '#3b82f6', color: '#fff' }}>Handed Over</span>;
    if (t.certificationStatus === 'Certified') return <span className="pill ok" style={{ background: '#22c55e', color: '#fff' }}>Certified</span>;
    if (t.certificationStatus === 'Attrition') return <span className="pill bad" style={{ background: '#ef4444', color: '#fff' }}>Attrition</span>;
    if (t.certificationStatus === 'Not Certified') return <span className="pill warn" style={{ background: '#f59e0b', color: '#fff' }}>Not Certified</span>;
    return <span className="pill" style={{ opacity: 0.7 }}>Pending</span>;
  }

  function actionButtons(t) {
    if (t.handoverToOps) return <span style={{ color: '#4ade80', fontSize: 13 }}>✓ Done</span>;
    if (t.certificationStatus === 'Certified') {
      return <button className="btn small secondary" style={{ fontSize: 12 }} onClick={() => handover(t.employeeId)}>→ Handover</button>;
    }
    if (t.certificationStatus === 'Attrition' || t.certificationStatus === 'Not Certified') {
      return null;
    }
    // Not yet marked — show all 3 action buttons
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {t.eligible && (
          <button className="btn small ok" style={{ fontSize: 11, background: '#22c55e', padding: '3px 8px' }} onClick={() => certify(t.employeeId)}>✓ Certify</button>
        )}
        <button className="btn small" style={{ fontSize: 11, background: '#f59e0b', color: '#fff', padding: '3px 8px' }} onClick={() => setFinalStatus(t.employeeId, 'Not Certified')}>✕ Not Certified</button>
        <button className="btn small danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { if (window.confirm(`Mark ${t.employeeId} as Attrition? This will set their status to Inactive.`)) setFinalStatus(t.employeeId, 'Attrition'); }}>⚠ Attrition</button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* Progress summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          [traineeList.length, 'Total', ''],
          [eligibleCount, 'Eligible', 'ok'],
          [certifiedCount, 'Certified', 'ok'],
          [attritionCount, 'Attrition', 'bad'],
          [handedOverCount, 'Handed Over', 'info'],
        ].map(([n, l, cls]) => (
          <div key={l} className={`stat ${cls}`} style={{ textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 28 }}>{n}</div>
            <div className="label">{l}</div>
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {pendingCertify > 0 && (
          <button className="btn small" style={{ background: '#22c55e' }} onClick={bulkCertifyAll} disabled={bulkLoading}>
            ✓ Certify All Eligible ({pendingCertify})
          </button>
        )}
        {pendingHandover > 0 && (
          <button className="btn small secondary" onClick={bulkHandoverAll} disabled={bulkLoading}>
            → Handover All Certified ({pendingHandover})
          </button>
        )}
        {unresolvedCount > 0 && (
          <button className="btn small" style={{ background: '#f59e0b', color: '#fff' }} onClick={bulkMarkNotCertified} disabled={bulkLoading}>
            ✕ Mark All Remaining as Not Certified ({unresolvedCount})
          </button>
        )}
        {unresolvedCount === 0 && pendingHandover === 0 && certifiedCount > 0 && (
          <div className="toast ok" style={{ margin: 0 }}>✓ All trainees have been given a final status. Batch is ready to close.</div>
        )}
      </div>

      {data.rule && (
        <div className="card" style={{ marginBottom: 14 }}>
          <b>Certification Rule: {data.rule.process} / {data.rule.lob}</b>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
            Course: {data.rule.courseCompletionMin}% &nbsp;|&nbsp; MCQ: {data.rule.mcqPassPctMin}% &nbsp;|&nbsp; Attendance: {data.rule.attendancePctMin}%
            {data.rule.mockCallRequired && ' | Mock Call Required'}
            {data.rule.internalCertRequired && ' | Internal Cert Required'}
            {data.rule.externalCertRequired && ' | External Cert Required'}
          </p>
        </div>
      )}
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee ID</th><th>Name</th><th>Course</th><th>MCQ</th><th>Attendance</th><th>Eligible</th><th>Final Status</th><th>Actions</th></tr></thead>
          <tbody>
            {traineeList.map(t => (
              <tr key={t.employeeId}>
                <td><b>{t.employeeId}</b></td>
                <td>{t.traineeName || '—'}</td>
                <td>{pct(t.courseCompletionPct)}</td>
                <td>{pct(t.assessmentPassPct)}</td>
                <td>{pct(t.attendancePct)}</td>
                <td>{t.eligible ? <span className="pill ok">Eligible</span> : <span className="pill bad">Not Yet</span>}</td>
                <td>{statusPill(t)}</td>
                <td>{actionButtons(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
