import { useEffect, useMemo, useState } from 'react';
import { Link } from '../../utils/browserRouter.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

function captureRecoveryContext() {
  if (typeof window === 'undefined') return { token: '', userType: '' };
  const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(fragment);
  const token = params.get('token') || '';
  const userType = params.get('type') || '';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return { token, userType };
}

function passwordChecks(value) {
  return [
    { label: 'At least 10 characters', ok: value.length >= 10 },
    { label: 'Uppercase and lowercase letters', ok: /[A-Z]/.test(value) && /[a-z]/.test(value) },
    { label: 'At least one number', ok: /\d/.test(value) },
    { label: 'At least one special character', ok: /[^A-Za-z0-9]/.test(value) },
  ];
}

export default function PasswordResetPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const [{ token, userType }] = useState(captureRecoveryContext);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const checks = useMemo(() => passwordChecks(password), [password]);
  const validContext = Boolean(token && ['trainee', 'coordinator'].includes(userType));
  const validPassword = checks.every(check => check.ok) && password === confirm;
  const loginPath = userType === 'coordinator' ? '/coordinator' : '/lms';

  useEffect(() => {
    document.title = 'Secure Password Reset · MCN LMS';
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!validContext) return setMessage('This recovery link is invalid or incomplete.');
    if (!validPassword) return setMessage('Complete all password requirements and confirm the same password.');

    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE}/auth/recovery/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, userType, newPassword: password }),
      });
      const result = await response.json().catch(() => ({ ok: false, message: 'Invalid server response.' }));
      if (!response.ok || !result.ok) {
        setMessage(result.message || 'Password recovery could not be completed.');
      } else {
        setSuccess(true);
        setMessage(result.message || 'Password updated successfully.');
        setPassword('');
        setConfirm('');
      }
    } catch {
      setMessage('Unable to reach the LMS. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const surface = dark ? 'rgba(15,23,42,.92)' : 'rgba(255,255,255,.94)';
  const text = dark ? '#f8fafc' : '#172554';
  const muted = dark ? '#94a3b8' : '#64748b';
  const border = dark ? 'rgba(148,163,184,.2)' : 'rgba(79,70,229,.15)';

  return (
    <main style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
      background: dark
        ? 'radial-gradient(circle at top left, rgba(37,99,235,.25), transparent 34%), linear-gradient(145deg,#020617,#172554)'
        : 'radial-gradient(circle at top left, rgba(99,102,241,.18), transparent 34%), linear-gradient(145deg,#eff6ff,#f5f3ff)',
      color: text,
    }}>
      <button type="button" onClick={toggleTheme} aria-label="Toggle theme" style={{
        position: 'fixed', top: 18, right: 18, border: `1px solid ${border}`, borderRadius: 10,
        background: surface, color: text, padding: '8px 12px', cursor: 'pointer', fontSize: 16,
      }}>{dark ? '☀️' : '🌙'}</button>

      <section style={{
        width: '100%', maxWidth: 470, background: surface, border: `1px solid ${border}`,
        borderRadius: 24, padding: '34px clamp(22px, 6vw, 38px)', boxShadow: '0 28px 80px rgba(15,23,42,.18)',
        backdropFilter: 'blur(18px)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 36, objectFit: 'contain', marginBottom: 20 }} />
          <div style={{ width: 58, height: 58, margin: '0 auto 15px', borderRadius: 18, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#2563eb,#7c3aed)', color: '#fff', fontSize: 24, boxShadow: '0 14px 34px rgba(79,70,229,.3)' }}>🔐</div>
          <h1 style={{ margin: 0, fontSize: 25, letterSpacing: '-.03em' }}>Create a new password</h1>
          <p style={{ margin: '8px auto 0', color: muted, fontSize: 13.5, lineHeight: 1.6, maxWidth: 360 }}>
            This one-time link expires quickly. Your active LMS sessions will be revoked after the password is changed.
          </p>
        </div>

        {!validContext ? (
          <div style={{ textAlign: 'center' }}>
            <div role="alert" style={{ padding: '13px 15px', borderRadius: 12, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.25)', color: dark ? '#fecaca' : '#991b1b', fontSize: 13.5, lineHeight: 1.55 }}>
              This recovery link is invalid, incomplete, or was opened incorrectly. Request a new link from the LMS login page.
            </div>
            <Link to="/lms" style={{ display: 'inline-block', marginTop: 20, color: dark ? '#a5b4fc' : '#4f46e5', fontWeight: 700, fontSize: 13 }}>Return to LMS sign in</Link>
          </div>
        ) : success ? (
          <div style={{ textAlign: 'center' }}>
            <div role="status" style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.28)', color: dark ? '#a7f3d0' : '#065f46', fontSize: 13.5, lineHeight: 1.55 }}>{message}</div>
            <Link to={loginPath} style={{ display: 'inline-flex', marginTop: 20, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: '0 22px', borderRadius: 12, textDecoration: 'none', background: 'linear-gradient(135deg,#2563eb,#7c3aed)', color: '#fff', fontWeight: 800, fontSize: 13.5 }}>Sign in with new password</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>New password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="new-password"
                maxLength={128}
                required
                style={{ width: '100%', minHeight: 46, boxSizing: 'border-box', padding: '0 48px 0 14px', borderRadius: 11, border: `1.5px solid ${border}`, background: dark ? 'rgba(255,255,255,.055)' : '#f8fafc', color: text, outline: 'none', fontSize: 14 }}
              />
              <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 15 }}>{showPassword ? '🙈' : '👁'}</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '7px 12px', margin: '13px 0 18px' }}>
              {checks.map(check => <div key={check.label} style={{ color: check.ok ? (dark ? '#6ee7b7' : '#047857') : muted, fontSize: 11.5, lineHeight: 1.4 }}><span aria-hidden="true">{check.ok ? '✓' : '○'}</span> {check.label}</div>)}
            </div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={event => setConfirm(event.target.value)}
              autoComplete="new-password"
              maxLength={128}
              required
              style={{ width: '100%', minHeight: 46, boxSizing: 'border-box', padding: '0 14px', borderRadius: 11, border: `1.5px solid ${confirm && password !== confirm ? 'rgba(239,68,68,.7)' : border}`, background: dark ? 'rgba(255,255,255,.055)' : '#f8fafc', color: text, outline: 'none', fontSize: 14 }}
            />

            {message && <div role="alert" style={{ marginTop: 14, padding: '11px 13px', borderRadius: 10, background: 'rgba(239,68,68,.11)', border: '1px solid rgba(239,68,68,.23)', color: dark ? '#fecaca' : '#991b1b', fontSize: 12.5, lineHeight: 1.5 }}>{message}</div>}

            <button type="submit" disabled={loading || !validPassword} style={{ width: '100%', minHeight: 47, marginTop: 20, border: 0, borderRadius: 12, cursor: loading || !validPassword ? 'not-allowed' : 'pointer', background: loading || !validPassword ? 'rgba(99,102,241,.35)' : 'linear-gradient(135deg,#2563eb,#7c3aed)', color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: loading || !validPassword ? 'none' : '0 10px 28px rgba(79,70,229,.28)' }}>{loading ? 'Updating password...' : 'Update password securely'}</button>
          </form>
        )}
      </section>
    </main>
  );
}
