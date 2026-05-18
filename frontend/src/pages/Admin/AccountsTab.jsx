import { useState } from 'react';
import { api } from '../../utils/api.js';
import { formatDate, pct, riskColor } from '../../utils/format.js';

export default function AccountsTab() {
  const [query, setQuery] = useState('');
  const [trainees, setTrainees] = useState([]);
  const [msg, setMsg] = useState('');
  const [searched, setSearched] = useState(false);

  async function search(e) {
    e.preventDefault();
    setSearched(true);
    const res = await api.get(`/admin/trainees/search?q=${encodeURIComponent(query)}`, 'admin');
    if (res.ok) setTrainees(res.data);
  }

  async function resetPassword(employeeId) {
    const res = await api.post(`/admin/trainees/${employeeId}/reset-password`, {}, 'admin');
    setMsg(res.ok ? `✓ ${res.message}` : res.message || 'Failed.');
  }

  async function unlockAccount(employeeId) {
    const res = await api.post(`/admin/trainees/${employeeId}/unlock`, {}, 'admin');
    setMsg(res.ok ? `✓ ${employeeId} unlocked.` : 'Failed.');
  }

  async function deleteAccount(employeeId) {
    if (!window.confirm(`Delete account for ${employeeId}? This will deactivate their LMS access.`)) return;
    const res = await api.delete(`/admin/trainees/${employeeId}`, 'admin');
    if (res.ok) { setMsg(`✓ ${employeeId} deleted.`); search(new Event('submit')); }
    else setMsg('Failed.');
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <form onSubmit={search} style={{ display: 'flex', gap: 10 }}>
          <input className="input" style={{ maxWidth: 360 }} placeholder="Search by Employee ID, Name, Batch, Email..." value={query} onChange={e => setQuery(e.target.value)} />
          <button className="btn" type="submit">Search</button>
        </form>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn small secondary" href="/api/admin/trainees/export" download="all-trainees.csv">⬇ Export All CSV</a>
          {trainees.length > 0 && (
            <button className="btn small secondary" onClick={() => {
              const rows = [['Employee ID','Name','Batch','Branch','Process','Course%','MCQ%','Attendance%','Risk','Certification']];
              trainees.forEach(t => rows.push([t.employeeId,t.traineeName||'',t.batchNo||'',t.branch||'',t.process||'',t.courseCompletionPct||0,t.assessmentPassPct||0,t.attendancePct||0,t.riskStatus||'',t.certificationStatus||'']));
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
                <th>Employee ID</th><th>Name</th><th>Batch</th><th>Branch / Process</th>
                <th>Course</th><th>MCQ</th><th>Risk</th><th>Joined</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trainees.map(t => (
                <tr key={t.id}>
                  <td><b>{t.employeeId}</b></td>
                  <td>{t.traineeName || '—'}</td>
                  <td>{t.batchNo || '—'}</td>
                  <td>{t.branch} / {t.process}</td>
                  <td>{pct(t.courseCompletionPct)}</td>
                  <td>{pct(t.assessmentPassPct)}</td>
                  <td><span className={`pill ${riskColor(t.riskStatus)}`}>{t.riskStatus}</span></td>
                  <td>{formatDate(t.createdAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn small secondary" onClick={() => resetPassword(t.employeeId)} style={{ fontSize: 11 }}>Reset PW</button>
                      <button className="btn small secondary" onClick={() => unlockAccount(t.employeeId)} style={{ fontSize: 11 }}>Unlock</button>
                      <button className="btn small danger" onClick={() => deleteAccount(t.employeeId)} style={{ fontSize: 11 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
