import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { formatDate } from '../../utils/format.js';

const APPLICATION_PILL = { APPLIED: 'info', SHORTLISTED: 'warn', SELECTED: 'ok', REJECTED: 'bad', WITHDRAWN: 'info' };
const POSTING_PILL = { OPEN: 'ok', CLOSED: 'info', FILLED: 'accent' };

// Trainee-facing browse + apply + my-status view for Internal Job Postings.
// "Open Roles" defaults to eligibleOnly=true (server-side filter on
// branch/process/tenure — see backend/src/controllers/ijp.js for the
// documented eligibility design). A toggle lets a trainee see every open
// posting instead, each flagged eligible/not.
export default function IJPTab() {
  const [postings, setPostings] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [myApplications, setMyApplications] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/ijp/me/postings?eligibleOnly=${showAll ? 'false' : 'true'}`, 'trainee').then(res => { if (res.ok) setPostings(res.data); });
    api.get('/ijp/me/applications', 'trainee').then(res => { if (res.ok) setMyApplications(res.data); });
  }

  useEffect(() => { load(); }, [showAll]);

  async function apply(postingId) {
    setBusyId(postingId);
    const res = await api.post(`/ijp/me/postings/${postingId}/apply`, {}, 'trainee');
    setBusyId('');
    if (res.ok) { setMsg('✓ Application submitted.'); load(); }
    else setMsg(res.message || 'Could not submit application.');
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>Internal Job Postings</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>Open internal roles — apply once you're ready to move up.</p>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show all open roles (incl. ones I may not be eligible for)
        </label>
      </div>

      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 12 }}>{msg}</div>}

      {postings === null ? <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
          {postings.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No open roles right now.</div>}
          {postings.map(p => (
            <div key={p.id} className="card">
              <div className="row between">
                <div>
                  <b>{p.title}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {p.targetDesignation || 'Any level'} · {p.targetBranch || 'All branches'} / {p.targetProcess || 'All processes'}
                    {p.minTenureMonths != null ? ` · ${p.minTenureMonths}mo+ tenure` : ''}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {!p.eligible && <span className="pill bad" style={{ marginRight: 6 }}>Not eligible</span>}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Posted {formatDate(p.postedAt)}</span>
                </div>
              </div>
              {p.description && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0' }}>{p.description}</p>}
              <div className="row" style={{ marginTop: 8 }}>
                {p.alreadyApplied ? (
                  <span className={`pill ${APPLICATION_PILL[p.myApplicationStatus] || 'info'}`}>Applied · {p.myApplicationStatus}</span>
                ) : (
                  <button className="btn small" disabled={!p.eligible || busyId === p.id} onClick={() => apply(p.id)}>
                    {busyId === p.id ? 'Applying…' : 'Apply'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="section-title" style={{ margin: '0 0 10px' }}>My Applications</h3>
      {myApplications === null ? null : myApplications.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>You haven't applied to any roles yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {myApplications.map(a => (
            <div key={a.id} className="card">
              <div className="row between">
                <div>
                  <b>{a.posting?.title || a.postingId}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>Applied {formatDate(a.appliedAt)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`pill ${APPLICATION_PILL[a.status] || 'info'}`}>{a.status}</span>
                  {a.posting?.status && <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Posting: <span className={`pill ${POSTING_PILL[a.posting.status] || 'info'}`} style={{ fontSize: 9 }}>{a.posting.status}</span></span>}
                </div>
              </div>
              {a.reviewNotes && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Reviewer notes: {a.reviewNotes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
