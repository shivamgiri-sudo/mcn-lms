import { useState } from 'react';
import { api } from '../../utils/api.js';
import { formatDateTime } from '../../utils/format.js';

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
