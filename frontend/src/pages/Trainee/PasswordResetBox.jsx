import { useState } from 'react';
import { api, setToken } from '../../utils/api.js';

function policyError(password) {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
  if (!/\d/.test(password)) return 'Include a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include a special character.';
  return '';
}

export default function PasswordResetBox({ onDone }) {
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function change(event) {
    event.preventDefault();
    if (!oldPass || !newPass || !confirmPass) return setMsg('Complete all password fields.');
    const error = policyError(newPass);
    if (error) return setMsg(error);
    if (newPass !== confirmPass) return setMsg('New passwords do not match.');
    setLoading(true);
    setMsg('');
    const res = await api.post('/auth/trainee/change-password', { oldPassword: oldPass, newPassword: newPass }, 'trainee');
    setLoading(false);
    if (res.ok) {
      if (res.token) setToken('trainee', res.token);
      onDone();
    } else setMsg(res.message || 'Password change failed.');
  }

  return (
    <div style={{ border: '1px solid var(--warn)', background: 'var(--warn-soft)', borderRadius: 18, padding: 16, marginBottom: 14 }}>
      <b style={{ color: 'var(--ink)' }}>Password reset required</b>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 12px' }}>Create a private password with at least 10 characters, uppercase, lowercase, a number, and a special character.</p>
      <form onSubmit={change} className="trainee-password-grid">
        <div className="field" style={{ margin: 0 }}><label>Current password</label><input className="input" type="password" autoComplete="current-password" value={oldPass} onChange={event => setOldPass(event.target.value)} required /></div>
        <div className="field" style={{ margin: 0 }}><label>New password</label><input className="input" type="password" autoComplete="new-password" value={newPass} onChange={event => setNewPass(event.target.value)} required /></div>
        <div className="field" style={{ margin: 0 }}><label>Confirm new password</label><input className="input" type="password" autoComplete="new-password" value={confirmPass} onChange={event => setConfirmPass(event.target.value)} required /></div>
        <button className="btn" type="submit" disabled={loading}>{loading ? 'Changing…' : 'Change password'}</button>
      </form>
      {msg && <div className="toast bad" style={{ marginTop: 8 }}>{msg}</div>}
      <style>{`.trainee-password-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:10px;align-items:end}@media(max-width:850px){.trainee-password-grid{grid-template-columns:1fr 1fr}.trainee-password-grid .btn{width:100%}}@media(max-width:520px){.trainee-password-grid{grid-template-columns:1fr}}`}</style>
    </div>
  );
}
