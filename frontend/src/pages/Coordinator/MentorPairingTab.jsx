import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { formatDate, formatDateTime } from '../../utils/format.js';

const STATUS_PILL = { ACTIVE: 'ok', COMPLETED: 'info', CANCELLED: 'bad' };
const RATING_PILL = { GOOD: 'ok', NEEDS_ATTENTION: 'warn', CONCERN: 'bad' };

function CheckinPanel({ pairing, onLogged, portalType }) {
  const [rating, setRating] = useState('GOOD');
  const [remarks, setRemarks] = useState('');
  const [checkins, setCheckins] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get(`/mentor-pairing/admin/${pairing.id}/checkins`, portalType).then(res => {
      if (res.ok) setCheckins(res.data.checkins || []);
    });
  }, [pairing.id]);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    const res = await api.post(`/mentor-pairing/admin/${pairing.id}/checkins`, { rating, remarks }, portalType);
    setLoading(false);
    if (res.ok) {
      setRemarks('');
      setCheckins(prev => [res.data, ...(prev || [])]);
      setMsg('✓ Check-in logged.');
      onLogged && onLogged();
    } else setMsg(res.message || 'Could not log check-in.');
  }

  return (
    <div style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
      {pairing.status === 'ACTIVE' && (
        <form onSubmit={submit} className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
          <select className="select" value={rating} onChange={e => setRating(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="GOOD">Good</option>
            <option value="NEEDS_ATTENTION">Needs Attention</option>
            <option value="CONCERN">Concern</option>
          </select>
          <input className="input" placeholder="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn small" type="submit" disabled={loading}>{loading ? 'Logging…' : 'Log Check-in'}</button>
        </form>
      )}
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
      {checkins === null ? <p style={{ color: 'var(--muted)', fontSize: 12 }}>Loading check-ins…</p> : checkins.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>No check-ins logged yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {checkins.map(c => (
            <div key={c.id} className="row between" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
              <span className={`pill ${RATING_PILL[c.rating] || 'info'}`}>{c.rating}</span>
              <span style={{ flex: 1, marginLeft: 10, color: 'var(--muted)' }}>{c.remarks || '—'}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{formatDateTime(c.checkinDate)} · {c.loggedByType || ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePairingForm({ batches, onCreated, portalType }) {
  const [batchNo, setBatchNo] = useState('');
  const [menteeEmployeeId, setMenteeEmployeeId] = useState('');
  const [mentorType, setMentorType] = useState('TRAINEE');
  const [mentorId, setMentorId] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!batchNo) { setSuggestions(null); return; }
    api.get(`/mentor-pairing/admin/suggest-mentors?batchNo=${encodeURIComponent(batchNo)}`, portalType).then(res => {
      if (res.ok) setSuggestions(res.data);
    });
  }, [batchNo]);

  async function submit(e) {
    e.preventDefault();
    if (!menteeEmployeeId || !mentorId) return setMsg('Mentee and mentor are required.');
    setSaving(true);
    const res = await api.post('/mentor-pairing/admin', {
      menteeEmployeeId, mentorId, mentorType,
      targetEndDate: targetEndDate || undefined,
      notes: notes || undefined,
    }, portalType);
    setSaving(false);
    if (res.ok) {
      setMsg('✓ Mentor pairing created.');
      setMenteeEmployeeId(''); setMentorId(''); setNotes(''); setTargetEndDate('');
      onCreated && onCreated();
    } else setMsg(res.message || 'Could not create pairing.');
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <b style={{ display: 'block', marginBottom: 10 }}>Create a New Pairing</b>
      <form onSubmit={submit}>
        <div className="col-3">
          <div className="field">
            <label>Batch</label>
            <select className="select" value={batchNo} onChange={e => setBatchNo(e.target.value)}>
              <option value="">Select batch (for suggestions)</option>
              {batches.map(b => <option key={b.batchNo} value={b.batchNo}>{b.batchNo} · {b.batchName || b.process}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Mentee (Trainee Employee ID)</label>
            <input className="input" value={menteeEmployeeId} onChange={e => setMenteeEmployeeId(e.target.value)} placeholder="e.g. EMP1042" />
          </div>
          <div className="field">
            <label>Target End Date (optional)</label>
            <input className="input" type="date" value={targetEndDate} onChange={e => setTargetEndDate(e.target.value)} />
          </div>
        </div>
        <div className="col-3">
          <div className="field">
            <label>Mentor Type</label>
            <select className="select" value={mentorType} onChange={e => setMentorType(e.target.value)}>
              <option value="TRAINEE">Senior Trainee</option>
              <option value="COORDINATOR">Coordinator</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Mentor ID (Employee ID or Coordinator Login ID)</label>
            <input className="input" value={mentorId} onChange={e => setMentorId(e.target.value)} placeholder="e.g. EMP1005 or COORD-01" />
          </div>
        </div>
        <div className="field">
          <label>Notes (optional)</label>
          <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {suggestions && (suggestions.trainees.length > 0 || suggestions.coordinator) && (
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, display: 'block', marginBottom: 6 }}>Suggested mentors for this batch</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {suggestions.coordinator && (
                <button type="button" className="pill accent" style={{ cursor: 'pointer', border: 0 }} onClick={() => { setMentorType('COORDINATOR'); setMentorId(suggestions.coordinator.mentorId); }}>
                  🧑‍💼 {suggestions.coordinator.mentorName} (Coordinator)
                </button>
              )}
              {suggestions.trainees.map(s => (
                <button type="button" key={s.mentorId} className="pill info" style={{ cursor: 'pointer', border: 0 }} onClick={() => { setMentorType('TRAINEE'); setMentorId(s.mentorId); }}>
                  {s.mentorName} · {s.activeMenteeCount} mentee{s.activeMenteeCount === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          </div>
        )}

        {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Pairing'}</button>
      </form>
    </div>
  );
}

// portalType: 'coordinator' (default, scoped to owned batches) or 'admin'
// (scoped to branch for branch admins, unrestricted for super admins).
export default function MentorPairingTab({ portalType = 'coordinator' }) {
  const [batches, setBatches] = useState([]);
  const [pairings, setPairings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [expanded, setExpanded] = useState('');

  useEffect(() => {
    const url = portalType === 'admin' ? '/admin/batches?status=Active' : '/coordinator/batches?status=Active';
    api.get(url, portalType).then(res => { if (res.ok) setBatches(res.data || []); });
  }, [portalType]);

  async function load() {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const res = await api.get(`/mentor-pairing/admin/list${qs}`, portalType);
    setLoading(false);
    if (!res.ok) return setError(res.message || 'Could not load mentor pairings.');
    setError('');
    setPairings(res.data || []);
  }

  useEffect(() => { load(); }, [statusFilter, portalType]);

  async function endPairing(id, status) {
    const reason = window.prompt(status === 'CANCELLED' ? 'Reason for cancelling (optional):' : 'Closing notes (optional):') || '';
    const res = await api.patch(`/mentor-pairing/admin/${id}/end`, { status, reason }, portalType);
    if (res.ok) load(); else setError(res.message || 'Could not update pairing.');
  }

  return (
    <section>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Buddy / Mentor Pairing</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>Pair new hires with a senior trainee or coordinator, and track light onboarding check-ins.</p>
        </div>
        <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}

      <CreatePairingForm batches={batches} onCreated={load} portalType={portalType} />

      {loading ? <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {pairings.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No pairings in this view.</div>}
          {pairings.map(p => (
            <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="row between" style={{ padding: 14, cursor: 'pointer' }} onClick={() => setExpanded(v => v === p.id ? '' : p.id)}>
                <div>
                  <b>{p.menteeName || p.menteeEmployeeId}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{p.menteeEmployeeId} · {p.batchNo || '—'}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>Mentor ({p.mentorType === 'COORDINATOR' ? 'Coordinator' : 'Senior Trainee'})</span>
                  <b>{p.mentorName || p.mentorId}</b>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className={`pill ${STATUS_PILL[p.status] || 'info'}`}>{p.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Paired {formatDate(p.pairedAt)}</span>
                  {p.status === 'ACTIVE' && (
                    <>
                      <button className="btn xs secondary" onClick={e => { e.stopPropagation(); endPairing(p.id, 'COMPLETED'); }}>Complete</button>
                      <button className="btn xs danger" onClick={e => { e.stopPropagation(); endPairing(p.id, 'CANCELLED'); }}>Cancel</button>
                    </>
                  )}
                  <span>{expanded === p.id ? '⌃' : '⌄'}</span>
                </div>
              </div>
              {expanded === p.id && (
                <>
                  {p.notes && <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--muted)' }}>Notes: {p.notes}</div>}
                  {p.status !== 'ACTIVE' && p.endedReason && <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--muted)' }}>Ended: {p.endedReason}</div>}
                  <CheckinPanel pairing={p} onLogged={load} portalType={portalType} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
