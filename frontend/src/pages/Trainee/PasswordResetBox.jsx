import { useState } from 'react';
import { api } from '../../utils/api.js';

export default function PasswordResetBox({ onDone }) {
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function change(e) {
    e.preventDefault();
    if (!oldPass || !newPass) return setMsg('Both fields required.');
    if (newPass.length < 4) return setMsg('New password must be at least 4 characters.');
    setLoading(true);
    const res = await api.post('/auth/trainee/change-password', { oldPassword: oldPass, newPassword: newPass }, 'trainee');
    setLoading(false);
    if (res.ok) onDone();
    else setMsg(res.message || 'Failed.');
  }

  return (
    <div style={{ border: '1px solid var(--warn)', background: 'var(--warn-soft)', borderRadius: 18, padding: 16, marginBottom: 14 }}>
      <b style={{ color: 'var(--ink)' }}>Password reset required</b>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 12px' }}>First login detected. Use your temporary password, then create a new password to continue.</p>
      <form onSubmit={change} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Current password</label>
          <input className="input" type="password" value={oldPass} onChange={e => setOldPass(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>New password</label>
          <input className="input" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={loading}>{loading ? '...' : 'Change'}</button>
      </form>
      {msg && <div className="toast bad" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
