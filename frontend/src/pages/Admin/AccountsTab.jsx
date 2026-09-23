import { useState } from 'react';
import { api, downloadCsv } from '../../utils/api.js';
import { formatDate, pct, riskColor } from '../../utils/format.js';
import { BranchSelect, ProcessSelect, LobSelect } from '../../components/OrgSelect.jsx';

const blankUser = { traineeName: '', employeeId: '', lmsId: '', email: '', mobile: '', branch: '', process: '', lob: '', tempPassword: '' };

export default function AccountsTab({ isSuper }) {
  const [query, setQuery] = useState('');
  const [trainees, setTrainees] = useState([]);
  const [msg, setMsg] = useState('');
  const [searched, setSearched] = useState(false);
  const [newUser, setNewUser] = useState(blankUser);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [batchOptions, setBatchOptions] = useState([]);
  const [newBatchNo, setNewBatchNo] = useState('');
  const [changingBatch, setChangingBatch] = useState(false);

  async function search(e) {
    e?.preventDefault?.();
    setSearched(true);
    const res = await api.get(`/admin/trainees/search?q=${encodeURIComponent(query)}`, 'admin');
    if (res.ok) setTrainees(res.data);
  }

  async function createIndependentUser(e) {
    e.preventDefault();
    setCreating(true);
    setMsg('');
    const res = await api.post('/admin/lms-users', newUser, 'admin');
    setCreating(false);
    if (!res.ok) {
      setMsg(res.message || 'Unable to create LMS user.');
      return;
    }
    setMsg(`✓ ${res.message}. Temp password: ${res.data?.tempPassword || 'mobile last 4 / 1234'}`);
    setNewUser(blankUser);
    setQuery(res.data?.employeeId || '');
    setSearched(false);
  }

  function toast(text) {
    setMsg(text);
    setTimeout(() => setMsg(''), 6000);
  }

  async function resetPassword(employeeId) {
    const res = await api.post(`/admin/trainees/${employeeId}/reset-password`, {}, 'admin');
    toast(res.ok ? `✓ ${res.message}` : res.message || 'Failed.');
    if (res.ok) search();
  }

  async function unlockAccount(employeeId) {
    const res = await api.post(`/admin/trainees/${employeeId}/unlock`, {}, 'admin');
    toast(res.ok ? `✓ ${employeeId} unlocked.` : res.message || 'Failed.');
    if (res.ok) search();
  }

  async function deleteAccount(employeeId) {
    if (!window.confirm(`Delete account for ${employeeId}? This will deactivate their LMS access.`)) return;
    const res = await api.delete(`/admin/trainees/${employeeId}`, 'admin');
    if (res.ok) { toast(`✓ ${employeeId} deleted.`); search(); }
    else toast('Failed.');
  }

  function setUserField(key, value) {
    setNewUser(prev => ({ ...prev, [key]: value }));
  }

  function openEditBatch(t) {
    setEditTarget(t);
    setNewBatchNo(t.batchNo || '');
    if (batchOptions.length === 0) {
      api.get('/admin/batches', 'admin').then(res => res.ok && setBatchOptions(res.data));
    }
  }

  async function submitChangeBatch(e) {
    e.preventDefault();
    if (!editTarget || !newBatchNo) return;
    setChangingBatch(true);
    // Reuses the same transactional transfer as "Search & Enroll Existing Trainee" —
    // resets progress/risk/certification for the new batch and keeps batch trainee
    // counters and classroom membership consistent (see adminChangeTraineeBatch).
    const res = await api.post(`/admin/trainees/${editTarget.employeeId}/change-batch`, { batchNo: newBatchNo }, 'admin');
    setChangingBatch(false);
    if (res.ok) {
      toast(res.alreadyEnrolled ? `${editTarget.employeeId} is already in ${newBatchNo}.` : `✓ ${res.message}`);
      setEditTarget(null);
      search();
    } else {
      toast(res.message || 'Failed to change batch.');
    }
  }

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Independent LMS User</h3>
        <p style={{ color: 'var(--muted)', marginTop: -4 }}>
          Create LMS login without batch dependency. Batch/classroom can be mapped later from existing onboarding or assignment flows.
        </p>
        <form onSubmit={createIndependentUser} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <div className="field"><label>Name *</label><input className="input" value={newUser.traineeName} onChange={e => setUserField('traineeName', e.target.value)} required placeholder="Trainee / Employee name" /></div>
            <div className="field"><label>Employee ID optional</label><input className="input" value={newUser.employeeId} onChange={e => setUserField('employeeId', e.target.value)} placeholder="Leave blank for LMS ID" /></div>
            <div className="field"><label>LMS ID optional</label><input className="input" value={newUser.lmsId} onChange={e => setUserField('lmsId', e.target.value)} placeholder="Auto if blank" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <div className="field"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setUserField('email', e.target.value)} /></div>
            <div className="field"><label>Mobile</label><input className="input" value={newUser.mobile} onChange={e => setUserField('mobile', e.target.value)} placeholder="Used for temp password" /></div>
            <div className="field"><label>Branch</label><BranchSelect value={newUser.branch} onChange={next => setUserField('branch', next)} /></div>
            <div className="field"><label>Temp Password optional</label><input className="input" value={newUser.tempPassword} onChange={e => setUserField('tempPassword', e.target.value)} placeholder="Default mobile last 4" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Process</label><ProcessSelect value={newUser.process} onChange={next => setUserField('process', next)} /></div>
            <div className="field"><label>LOB</label><LobSelect process={newUser.process} value={newUser.lob} onChange={next => setUserField('lob', next)} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn accent" disabled={creating}>{creating ? 'Creating…' : 'Create LMS User'}</button></div>
        </form>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0, flexWrap: 'wrap', gap: 10 }}>
        <form onSubmit={search} style={{ display: 'flex', gap: 10 }}>
          <input className="input" style={{ maxWidth: 360 }} placeholder="Search by Employee ID, LMS ID, Name, Batch, Email..." value={query} onChange={e => setQuery(e.target.value)} />
          <button className="btn" type="submit">Search</button>
        </form>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small secondary" onClick={() => downloadCsv('/admin/trainees/export', 'all-trainees.csv')}>⬇ Export All CSV</button>
          {trainees.length > 0 && (
            <button className="btn small secondary" onClick={() => {
              const rows = [['Employee ID','LMS ID','Name','Email','Mobile','Batch','Branch','Process','Course%','MCQ%','Attendance%','Risk','Certification']];
              trainees.forEach(t => rows.push([t.employeeId,t.lmsId||'',t.traineeName||'',t.email||'',t.mobile||'',t.batchNo||'',t.branch||'',t.process||'',t.courseCompletionPct||0,t.assessmentPassPct||0,t.attendancePct||0,t.riskStatus||'',t.certificationStatus||'']));
              const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='search-results.csv'; a.click();
            }}>⬇ Export Search Results</button>
          )}
        </div>
      </div>
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}

      {searched && trainees.length === 0 && <div className="empty">No trainees found.</div>}
      {trainees.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee / LMS ID</th><th>Name</th><th>Email</th><th>Mobile</th><th>Batch</th><th>Branch / Process</th>
                <th>Course</th><th>MCQ</th><th>Risk</th><th>Joined</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trainees.map(t => (
                <tr key={t.id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}><b>{t.employeeId}</b></span>
                    {t.lmsId && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>LMS: {t.lmsId}</div>}
                    {t.empIdType === 'TEMP' && <span style={{ marginTop: 3, display: 'inline-block', background: '#d97706', color: '#fff', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>TEMP</span>}
                    {t.locked && <span style={{ marginTop: 3, display: 'inline-block', background: '#dc2626', color: '#fff', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>LOCKED</span>}
                    {!t.hasAccount && <span style={{ marginTop: 3, display: 'inline-block', background: '#6b7280', color: '#fff', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>NO LOGIN</span>}
                  </td>
                  <td>{t.traineeName || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{t.email || '—'}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{t.mobile || '—'}</td>
                  <td>{t.batchNo || '—'}</td>
                  <td>{t.branch || '—'} / {t.process || '—'}</td>
                  <td>{pct(t.courseCompletionPct)}</td>
                  <td>{pct(t.assessmentPassPct)}</td>
                  <td><span className={`pill ${riskColor(t.riskStatus)}`}>{t.riskStatus}</span></td>
                  <td>{formatDate(t.createdAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {isSuper && <button className="btn small secondary" onClick={() => openEditBatch(t)} style={{ fontSize: 11 }} title="Edit batch">Edit</button>}
                      <button className="btn small secondary" onClick={() => resetPassword(t.employeeId)} style={{ fontSize: 11 }}>Reset PW</button>
                      <button className={`btn small ${t.locked ? 'danger' : 'secondary'}`} onClick={() => unlockAccount(t.employeeId)} style={{ fontSize: 11 }} title={t.locked ? 'Account is locked — click to unlock' : 'Unlock account'}>{t.locked ? '🔓 Unlock' : 'Unlock'}</button>
                      <button className="btn small danger" onClick={() => deleteAccount(t.employeeId)} style={{ fontSize: 11 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <b>Edit Batch — {editTarget.traineeName || editTarget.employeeId}</b>
              <button className="btn small secondary" onClick={() => setEditTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={submitChangeBatch} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label>Current Batch</label>
                  <input className="input" value={editTarget.batchNo || '—'} disabled />
                </div>
                <div className="field">
                  <label>New Batch *</label>
                  <select className="select" value={newBatchNo} onChange={e => setNewBatchNo(e.target.value)} required>
                    <option value="">Select a batch…</option>
                    {batchOptions.map(b => <option key={b.batchNo} value={b.batchNo}>{b.batchNo} — {b.batchName}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Moving a trainee resets their course/assessment progress and risk status for the new batch, same as "Search &amp; Enroll Existing Trainee".
                </div>
                <button className="btn accent" disabled={changingBatch || !newBatchNo || newBatchNo === editTarget.batchNo}>{changingBatch ? 'Moving…' : 'Save'}</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
