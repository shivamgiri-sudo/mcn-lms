import { useState } from 'react';
import { api } from '../../utils/api.js';

export default function CoordLogin({ onLogin }) {
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  async function login(e) {
    e.preventDefault();
    if (!loginId || !pin) return setMsg('Login ID and PIN required.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/coordinator/login', { loginId, pin });
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'Login failed.');
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #0f172a 100%)',
      position: 'relative', overflow: 'hidden', padding: 20,
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.1) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', left: '-10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 65%)' }} />
      </div>

      <div style={{
        width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
        background: 'rgba(255,255,255,.04)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,.1)', borderRadius: 24,
        padding: '40px 36px', boxShadow: '0 24px 64px rgba(0,0,0,.4)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 34, objectFit: 'contain', opacity: .85 }} />
        </div>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            display: 'grid', placeItems: 'center',
            fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '.05em',
            boxShadow: '0 12px 32px rgba(16,185,129,.35)',
          }}>COORD</div>
          <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Coordinator Portal</h2>
          <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 13, margin: 0 }}>Batch management & trainee tracking</p>
        </div>

        <form onSubmit={login}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Coordinator Login ID</label>
            <input
              style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1.5px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              placeholder="COORD-001"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              autoComplete="username"
              onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,.7)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>PIN</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1.5px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '11px 42px 11px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                type={showPin ? 'text' : 'password'}
                placeholder="Enter your PIN"
                value={pin}
                onChange={e => setPin(e.target.value)}
                autoComplete="current-password"
                onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,.7)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
              />
              <button type="button" onClick={() => setShowPin(!showPin)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 13 }}>
                {showPin ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {msg && (
            <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
              {msg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'rgba(16,185,129,.3)' : 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff', fontSize: 14, fontWeight: 800,
              boxShadow: loading ? 'none' : '0 8px 24px rgba(16,185,129,.35)',
              transition: 'all .2s', fontFamily: 'inherit',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>

        <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', textAlign: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.35)' }}>Demo: </span>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)', fontFamily: 'monospace' }}>COORD-TEST / 1234</span>
        </div>
      </div>
    </div>
  );
}
