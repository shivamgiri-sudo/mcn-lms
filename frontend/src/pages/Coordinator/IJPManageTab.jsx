import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { formatDate, formatDateTime } from '../../utils/format.js';

const POSTING_PILL = { OPEN: 'ok', CLOSED: 'info', FILLED: 'accent' };
const APPLICATION_PILL = { APPLIED: 'info', SHORTLISTED: 'warn', SELECTED: 'ok', REJECTED: 'bad', WITHDRAWN: 'info' };

function CreatePostingForm({ onCreated, portalType }) {
  const [form, setForm] = useState({
    title: '', description: '', targetBranch: '', targetProcess: '', targetLob: '',
    targetDesignation: '', minTenureMonths: '', closesAt: '',
  });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  function set(key) { return e => setForm(prev => ({ ...prev, [key]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return setMsg('Title is required.');
    setSaving(true);
    const res = await api.post('/ijp/admin', {
      ...form,
      minTenureMonths: form.minTenureMonths || undefined,
      closesAt: form.closesAt || undefined,
    }, portalType);
    setSaving(false);
    if (res.ok) {
      setMsg('✓ Posting created.');
      setForm({ title: '', description: '', targetBranch: '', targetProcess: '', targetLob: '', targetDesignation: '', minTenureMonths: '', closesAt: '' });
      onCreated && onCreated();
    } else setMsg(res.message || 'Could not create posting.');
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <b style={{ display: 'block', marginBottom: 10 }}>Post an Open Internal Role</b>
      <form onSubmit={submit}>
        <div className="col-3">
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Title</label>
            <input className="input" value={form.title} onChange={set('title')} placeholder="e.g. Team Lead — KYC Process" />
          </div>
          <div className="field">
            <label>Closes On (optional)</label>
            <input className="input" type="date" value={form.closesAt} onChange={set('closesAt')} />
          </div>
        </div>
        <div className="field">
          <label>Description (optional)</label>
          <textarea className="input" rows={2} value={form.description} onChange={set('description')} />
        </div>
        <div className="col-3">
          <div className="field">
            <label>Target Branch (blank = open to all)</label>
            <input className="input" value={form.targetBranch} onChange={set('targetBranch')} placeholder="e.g. Pune" />
          </div>
          <div className="field">
            <label>Target Process (blank = open to all)</label>
            <input className="input" value={form.targetProcess} onChange={set('targetProcess')} placeholder="e.g. KYC" />
          </div>
          <div className="field">
            <label>Target LOB (blank = open to all)</label>
            <input className="input" value={form.targetLob} onChange={set('targetLob')} />
          </div>
        </div>
        <div className="col-3">
          <div className="field">
            <label>Role / Level Being Hired For</label>
            <input className="input" value={form.targetDesignation} onChange={set('targetDesignation')} placeholder="e.g. Team Lead" />
          </div>
          <div className="field">
            <label>Min. Tenure (months, optional)</label>
            <input className="input" type="number" min="0" value={form.minTenureMonths} onChange={set('minTenureMonths')} />
          </div>
        </div>
        {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Posting…' : 'Post Role'}</button>
      </form>
    </div>
  );
}

function ApplicationsPanel({ posting, onChanged, portalType }) {
  const [applications, setApplications] = useState(null);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get(`/ijp/admin/${posting.id}/applications`, portalType).then(res => {
      if (res.ok) setApplications(res.data.applications || []);
    });
  }

  useEffect(() => { load(); }, [posting.id]);

  async function review(id, status) {
    setBusyId(id);
    const res = await api.patch(`/ijp/admin/applications/${id}`, { status, reviewNotes: notes[id] || '' }, portalType);
    setBusyId('');
    if (res.ok) { setMsg('✓ Application updated.'); load(); onChanged && onChanged(); }
    else setMsg(res.message || 'Could not update application.');
  }

  async function fill(applicantEmployeeId) {
    if (!window.confirm(`Mark this posting FILLED by ${applicantEmployeeId}? Other open applications will be auto-rejected.`)) return;
    const res = await api.patch(`/ijp/admin/${posting.id}/fill`, { filledBy: applicantEmployeeId }, portalType);
    if (res.ok) { setMsg('✓ Posting marked FILLED.'); load(); onChanged && onChanged(); }
    else setMsg(res.message || 'Could not fill posting.');
  }

  return (
    <div style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
      {applications === null ? <p style={{ color: 'var(--muted)', fontSize: 12 }}>Loading applications…</p> : applications.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>No applications yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {applications.map(a => (
            <div key={a.id} className="card" style={{ padding: 12 }}>
              <div className="row between">
                <div>
                  <b>{a.applicantName || a.applicantEmployeeId}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>
                    {a.applicantEmployeeId} · {a.currentDesignation || '—'} · {a.currentBranch || '—'} / {a.currentProcess || '—'}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`pill ${APPLICATION_PILL[a.status] || 'info'}`}>{a.status}</span>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Applied {formatDate(a.appliedAt)}</span>
                </div>
              </div>
              {a.reviewNotes && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Notes: {a.reviewNotes}</div>}
              {['APPLIED', 'SHORTLISTED'].includes(a.status) && posting.status === 'OPEN' && (
                <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
                  <input className="input" placeholder="Review note (optional)" value={notes[a.id] || ''} onChange={e => setNotes(prev => ({ ...prev, [a.id]: e.target.value }))} style={{ flex: 1, minWidth: 160 }} />
                  {a.status === 'APPLIED' && <button className="btn xs secondary" disabled={busyId === a.id} onClick={() => review(a.id, 'SHORTLISTED')}>Shortlist</button>}
                  <button className="btn xs" disabled={busyId === a.id} onClick={() => fill(a.applicantEmployeeId)}>Select &amp; Fill</button>
                  <button className="btn xs danger" disabled={busyId === a.id} onClick={() => review(a.id, 'REJECTED')}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// portalType: 'admin' or 'coordinator' — both can post, close/fill and review.
export default function IJPManageTab({ portalType = 'admin' }) {
  const [postings, setPostings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [expanded, setExpanded] = useState('');

  async function load() {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const res = await api.get(`/ijp/admin/list${qs}`, portalType);
    setLoading(false);
    if (!res.ok) return setError(res.message || 'Could not load postings.');
    setError('');
    setPostings(res.data || []);
  }

  useEffect(() => { load(); }, [statusFilter, portalType]);

  async function closePosting(id) {
    if (!window.confirm('Close this posting without filling it?')) return;
    const res = await api.patch(`/ijp/admin/${id}/close`, {}, portalType);
    if (res.ok) load(); else setError(res.message || 'Could not close posting.');
  }

  return (
    <section>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Internal Job Postings</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>Post open internal roles and review who's ready to move up.</p>
        </div>
        <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
          <option value="FILLED">Filled</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}

      <CreatePostingForm onCreated={load} portalType={portalType} />

      {loading ? <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {postings.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No postings in this view.</div>}
          {postings.map(p => (
            <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="row between" style={{ padding: 14, cursor: 'pointer' }} onClick={() => setExpanded(v => v === p.id ? '' : p.id)}>
                <div>
                  <b>{p.title}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>
                    {p.targetDesignation || 'Any level'} · {p.targetBranch || 'All branches'} / {p.targetProcess || 'All processes'}
                    {p.minTenureMonths != null ? ` · ${p.minTenureMonths}mo+ tenure` : ''}
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.applicationCount} applicant{p.applicationCount === 1 ? '' : 's'}</span>
                  <span className={`pill ${POSTING_PILL[p.status] || 'info'}`}>{p.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Posted {formatDate(p.postedAt)}</span>
                  {p.status === 'OPEN' && (
                    <button className="btn xs secondary" onClick={e => { e.stopPropagation(); closePosting(p.id); }}>Close</button>
                  )}
                  <span>{expanded === p.id ? '⌃' : '⌄'}</span>
                </div>
              </div>
              {expanded === p.id && (
                <>
                  {p.description && <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--muted)' }}>{p.description}</div>}
                  {p.status === 'FILLED' && <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--muted)' }}>Filled by {p.filledBy} on {formatDateTime(p.filledAt)}</div>}
                  <ApplicationsPanel posting={p} onChanged={load} portalType={portalType} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
