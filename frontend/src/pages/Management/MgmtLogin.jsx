import { useState } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function MgmtLogin({ onLogin }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  async function login(e) {
    e.preventDefault();
    if (!loginId || !pin) return setMsg('Login ID and PIN required.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/coordinator/login', { loginId, pin }, 'management');
    setLoading(false);
    if (res.ok) {
      if (!res.user?.permissions?.canViewManagementDashboard && res.user?.role !== 'CEO' && res.user?.role !== 'Super Admin') {
        return setMsg('Access denied. Management dashboard permission required.');
      }
      onLogin(res);
    } else setMsg(res.message || 'Login failed.');
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: dark ? 'linear-gradient(135deg, #0f172a 0%, #1c1917 60%, #0f172a 100%)' : 'linear-gradient(135deg, #fef3c7 0%, #fce7f3 60%, #fff7ed 100%)',
      position: 'relative', overflow: 'hidden', padding: 20,
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,158,11,.1) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', left: '-10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(239,68,68,.08) 0%, transparent 65%)' }} />
      </div>

      <button onClick={toggleTheme} title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, background: dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.07)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>{dark ? '☀️' : '🌙'}</button>

      <div style={{
        width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
        background: dark ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.9)', backdropFilter: 'blur(20px)',
        border: dark ? '1px solid rgba(255,255,255,.1)' : '1px solid rgba(245,158,11,.2)', borderRadius: 24,
        padding: '40px 36px', boxShadow: dark ? '0 24px 64px rgba(0,0,0,.4)' : '0 24px 64px rgba(245,158,11,.12)',
      }}>
        {/* MCN Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 36, objectFit: 'contain', opacity: .85 }} />
        </div>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            display: 'grid', placeItems: 'center',
            fontSize: 11, fontWeight: 900, color: '#fff', letterSpacing: '.05em',
            boxShadow: '0 12px 32px rgba(245,158,11,.35)',
          }}>MGMT</div>
          <h2 style={{ color: dark ? '#fff' : '#78350f', fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Management Dashboard</h2>
          <p style={{ color: dark ? 'rgba(255,255,255,.45)' : '#6b7280', fontSize: 13, margin: 0 }}>Executive analytics & training KPIs</p>
        </div>

        <form onSubmit={login}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: dark ? 'rgba(255,255,255,.5)' : '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Login ID</label>
            <input
              style={{ width: '100%', background: dark ? 'rgba(255,255,255,.07)' : '#f3f4f6', border: `1.5px solid ${dark ? 'rgba(255,255,255,.12)' : '#d1d5db'}`, borderRadius: 10, padding: '11px 14px', color: dark ? '#fff' : '#111827', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              placeholder="CEO-001"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              autoComplete="username"
              onFocus={e => e.target.style.borderColor = 'rgba(245,158,11,.7)'}
              onBlur={e => e.target.style.borderColor = dark ? 'rgba(255,255,255,.12)' : '#d1d5db'}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: dark ? 'rgba(255,255,255,.5)' : '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>PIN</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ width: '100%', background: dark ? 'rgba(255,255,255,.07)' : '#f3f4f6', border: `1.5px solid ${dark ? 'rgba(255,255,255,.12)' : '#d1d5db'}`, borderRadius: 10, padding: '11px 42px 11px 14px', color: dark ? '#fff' : '#111827', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                type={showPin ? 'text' : 'password'}
                placeholder="Enter your PIN"
                value={pin}
                onChange={e => setPin(e.target.value)}
                autoComplete="current-password"
                onFocus={e => e.target.style.borderColor = 'rgba(245,158,11,.7)'}
                onBlur={e => e.target.style.borderColor = dark ? 'rgba(255,255,255,.12)' : '#d1d5db'}
              />
              <button type="button" onClick={() => setShowPin(!showPin)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: dark ? 'rgba(255,255,255,.4)' : '#9ca3af', cursor: 'pointer', fontSize: 13 }}>
                {showPin ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {msg && (
            <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 13, marginBottom: 16 }}>
              {msg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'rgba(245,158,11,.3)' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
              color: '#fff', fontSize: 14, fontWeight: 800,
              boxShadow: loading ? 'none' : '0 8px 24px rgba(245,158,11,.35)',
              transition: 'all .2s', fontFamily: 'inherit',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>

        <div style={{ marginTop: 20, padding: '12px 16px', background: dark ? 'rgba(255,255,255,.04)' : 'rgba(245,158,11,.06)', borderRadius: 10, border: `1px solid ${dark ? 'rgba(255,255,255,.07)' : 'rgba(245,158,11,.12)'}`, textAlign: 'center' }}>
          <span style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,.35)' : '#9ca3af' }}>Demo: </span>
          <span style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,.55)' : '#6b7280', fontFamily: 'monospace' }}>CEO-001 / ceo123</span>
        </div>
      </div>
    </div>
  );
}
