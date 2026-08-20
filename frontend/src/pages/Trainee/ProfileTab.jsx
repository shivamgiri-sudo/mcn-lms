import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { formatDate, formatDateTime } from '../../utils/format.js';

const RATING_PILL = { GOOD: 'ok', NEEDS_ATTENTION: 'warn', CONCERN: 'bad' };

// Read-only "My Mentor" card — shows an active pairing as mentee (who my
// mentor is) and, if this trainee is a senior buddy, as mentor (my mentees).
// A trainee can also log a light check-in on their own active pairing(s).
function MyMentorCard() {
  const [data, setData] = useState(null);
  const [rating, setRating] = useState({});
  const [remarks, setRemarks] = useState({});
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get('/mentor-pairing/me', 'trainee').then(res => { if (res.ok) setData(res.data); });
  }

  useEffect(() => { load(); }, []);

  async function logCheckin(pairingId) {
    setBusyId(pairingId);
    const res = await api.post('/mentor-pairing/me/checkins', {
      pairingId,
      rating: rating[pairingId] || 'GOOD',
      remarks: remarks[pairingId] || '',
    }, 'trainee');
    setBusyId('');
    if (res.ok) {
      setRemarks(prev => ({ ...prev, [pairingId]: '' }));
      setMsg('✓ Check-in logged.');
      load();
    } else setMsg(res.message || 'Could not log check-in.');
  }

  function PairingCard({ pairing, roleLabel, counterpartLabel }) {
    return (
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row between">
          <div>
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{roleLabel}</span>
            <b style={{ fontSize: 14 }}>{counterpartLabel}</b>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`pill ${pairing.status === 'ACTIVE' ? 'ok' : pairing.status === 'CANCELLED' ? 'bad' : 'info'}`}>{pairing.status}</span>
            <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Since {formatDate(pairing.pairedAt)}</span>
          </div>
        </div>

        {pairing.checkins?.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {pairing.checkins.slice(0, 5).map(chk => (
              <div key={chk.id} className="row between" style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }}>
                <span className={`pill ${RATING_PILL[chk.rating] || 'info'}`}>{chk.rating}</span>
                <span style={{ flex: 1, marginLeft: 8, color: 'var(--muted)' }}>{chk.remarks || '—'}</span>
                <span style={{ color: 'var(--muted)' }}>{formatDate(chk.checkinDate)}</span>
              </div>
            ))}
          </div>
        )}

        {pairing.status === 'ACTIVE' && (
          <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
            <select className="select" value={rating[pairing.id] || 'GOOD'} onChange={e => setRating(prev => ({ ...prev, [pairing.id]: e.target.value }))} style={{ maxWidth: 170 }}>
              <option value="GOOD">Going well</option>
              <option value="NEEDS_ATTENTION">Needs attention</option>
              <option value="CONCERN">Concern</option>
            </select>
            <input className="input" placeholder="Optional note" value={remarks[pairing.id] || ''} onChange={e => setRemarks(prev => ({ ...prev, [pairing.id]: e.target.value }))} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn small secondary" disabled={busyId === pairing.id} onClick={() => logCheckin(pairing.id)}>{busyId === pairing.id ? 'Logging…' : 'Log Check-in'}</button>
          </div>
        )}
      </div>
    );
  }

  if (!data || (data.asMentee.length === 0 && data.asMentor.length === 0)) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <h3 className="section-title" style={{ margin: '0 0 10px' }}>My Mentor</h3>
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
      {data.asMentee.map(p => (
        <PairingCard key={p.id} pairing={p} roleLabel="Your mentor" counterpartLabel={p.mentorName || p.mentorId} />
      ))}
      {data.asMentor.length > 0 && (
        <>
          <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', margin: '10px 0 6px' }}>You're mentoring</span>
          {data.asMentor.map(p => (
            <PairingCard key={p.id} pairing={p} roleLabel="Your mentee" counterpartLabel={p.menteeName || p.menteeEmployeeId} />
          ))}
        </>
      )}
    </div>
  );
}

export default function ProfileTab({ trainee: t, classroom: c, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ traineeName: t.traineeName || t.name || '', email: t.email || '', mobile: t.mobile || '' });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const res = await api.patch('/trainee/profile', form, 'trainee');
    setSaving(false);
    if (res.ok) { setMsg('✓ Profile updated.'); setEditing(false); onRefresh && onRefresh(); }
    else setMsg(res.message || 'Update failed.');
  }

  const fields = [
    ['Employee ID', t.employeeId],
    ['Batch', t.batchNo],
    ['Branch', t.branch],
    ['Process', t.process],
    ['LOB', t.lob],
    ['Last Login', formatDateTime(t.lastLogin)],
  ];

  return (
    <div style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h3 className="section-title" style={{ margin: 0 }}>My Profile</h3>
        {!editing && <button className="btn small secondary" onClick={() => setEditing(true)}>Edit Profile</button>}
      </div>

      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 12 }}>{msg}</div>}

      <MyMentorCard />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        {fields.map(([label, val]) => (
          <div key={label} className="card">
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
            <b style={{ display: 'block', marginTop: 6, fontSize: 14 }}>{val || '—'}</b>
          </div>
        ))}
      </div>

      {editing && (
        <div className="card">
          <b style={{ display: 'block', marginBottom: 14 }}>Edit Contact Details</b>
          <form onSubmit={save}>
            <div className="col-3">
              <div className="field">
                <label>Full Name</label>
                <input className="input" value={form.traineeName} onChange={e => setForm(p => ({ ...p, traineeName: e.target.value }))} />
              </div>
              <div className="field">
                <label>Email</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="field">
                <label>Mobile</label>
                <input className="input" value={form.mobile} onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))} />
              </div>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 10 }}>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button className="btn secondary" type="button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
