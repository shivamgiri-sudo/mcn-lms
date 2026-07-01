import { useState } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function CoordLogin({ onLogin }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState('');

  async function login(e) {
    e.preventDefault();
    if (!loginId || !pin) return setMsg('Login ID and PIN required.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/coordinator/login', { loginId, pin }, 'coordinator');
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'Login failed.');
  }

  async function handleForgot(e) {
    e.preventDefault();
    if (!forgotId) return;
    setForgotLoading(true);
    setForgotResult('');
    const res = await api.post('/auth/coordinator/forgot-password', { loginId: forgotId });
    setForgotLoading(false);
    setForgotResult(res.message || 'Request processed.');
  }

  const s = (light, darkVal) => dark ? darkVal : light;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: s('linear-gradient(135deg, #d1fae5 0%, #e0f2fe 60%, #f0fdf4 100%)', 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #0f172a 100%)'),
      position: 'relative', overflow: 'hidden', padding: 20,
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.1) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', left: '-10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 65%)' }} />
      </div>

      <button onClick={toggleTheme} title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>{dark ? '☀️' : '🌙'}</button>

      {showForgot ? (
        <div style={{
          width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
          background: s('rgba(255,255,255,.9)', 'rgba(255,255,255,.04)'),
          backdropFilter: 'blur(20px)',
          border: s('1px solid rgba(16,185,129,.15)', '1px solid rgba(255,255,255,.1)'),
          borderRadius: 24,
          padding: '40px 36px', boxShadow: s('0 24px 64px rgba(16,185,129,.1)', '0 24px 64px rgba(0,0,0,.4)'),
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
            <h2 style={{ color: s('#064e3b', '#fff'), fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Reset PIN</h2>
            <p style={{ color: s('#6b7280', 'rgba(255,255,255,.45)'), fontSize: 13, margin: 0 }}>Enter your Login ID to request a PIN reset</p>
          </div>

          <form onSubmit={handleForgot}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s('#6b7280', 'rgba(255,255,255,.5)'), textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Coordinator Login ID</label>
              <input
                style={{ width: '100%', background: s('#f3f4f6', 'rgba(255,255,255,.07)'), border: `1.5px solid ${s('#d1d5db', 'rgba(255,255,255,.12)')}`, borderRadius: 10, padding: '11px 14px', color: s('#111827', '#fff'), fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                placeholder="COORD-001"
                value={forgotId}
                onChange={e => setForgotId(e.target.value)}
                onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,.7)'}
                onBlur={e => e.target.style.borderColor = s('#d1d5db', 'rgba(255,255,255,.12)')}
              />
            </div>

            {forgotResult && (
              <div style={{ background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 10, padding: '10px 14px', color: s('#065f46', '#6ee7b7'), fontSize: 13, marginBottom: 16, wordBreak: 'break-word' }}>
                {forgotResult}
              </div>
            )}

            <button
              type="submit"
              disabled={forgotLoading}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: forgotLoading ? 'not-allowed' : 'pointer',
                background: forgotLoading ? 'rgba(16,185,129,.3)' : 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff', fontSize: 14, fontWeight: 800,
                boxShadow: forgotLoading ? 'none' : '0 8px 24px rgba(16,185,129,.35)',
                transition: 'all .2s', fontFamily: 'inherit',
              }}
            >
              {forgotLoading ? 'Processing...' : 'Request PIN Reset'}
            </button>
          </form>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button onClick={() => { setShowForgot(false); setForgotResult(''); setForgotId(''); }} style={{ background: 'none', border: 'none', color: s('#6b7280', 'rgba(255,255,255,.45)'), cursor: 'pointer', fontSize: 13, textDecoration: 'underline', fontFamily: 'inherit' }}>
              Back to Sign In
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
          background: s('rgba(255,255,255,.9)', 'rgba(255,255,255,.04)'),
          backdropFilter: 'blur(20px)',
          border: s('1px solid rgba(16,185,129,.15)', '1px solid rgba(255,255,255,.1)'),
          borderRadius: 24,
          padding: '40px 36px', boxShadow: s('0 24px 64px rgba(16,185,129,.1)', '0 24px 64px rgba(0,0,0,.4)'),
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
            <h2 style={{ color: s('#064e3b', '#fff'), fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Coordinator Portal</h2>
            <p style={{ color: s('#6b7280', 'rgba(255,255,255,.45)'), fontSize: 13, margin: 0 }}>Batch management & trainee tracking</p>
          </div>

          <form onSubmit={login}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s('#6b7280', 'rgba(255,255,255,.5)'), textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Coordinator Login ID</label>
              <input
                style={{ width: '100%', background: s('#f3f4f6', 'rgba(255,255,255,.07)'), border: `1.5px solid ${s('#d1d5db', 'rgba(255,255,255,.12)')}`, borderRadius: 10, padding: '11px 14px', color: s('#111827', '#fff'), fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                placeholder="COORD-001"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                autoComplete="username"
                onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,.7)'}
                onBlur={e => e.target.style.borderColor = s('#d1d5db', 'rgba(255,255,255,.12)')}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s('#6b7280', 'rgba(255,255,255,.5)'), textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>PIN</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ width: '100%', background: s('#f3f4f6', 'rgba(255,255,255,.07)'), border: `1.5px solid ${s('#d1d5db', 'rgba(255,255,255,.12)')}`, borderRadius: 10, padding: '11px 42px 11px 14px', color: s('#111827', '#fff'), fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  autoComplete="current-password"
                  onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,.7)'}
                  onBlur={e => e.target.style.borderColor = s('#d1d5db', 'rgba(255,255,255,.12)')}
                />
                <button type="button" onClick={() => setShowPin(!showPin)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: s('#9ca3af', 'rgba(255,255,255,.4)'), cursor: 'pointer', fontSize: 13 }}>
                  {showPin ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <button type="button" onClick={() => setShowForgot(true)} style={{ background: 'none', border: 'none', color: s('#10b981', 'rgba(52,211,153,.7)'), cursor: 'pointer', fontSize: 12, textDecoration: 'underline', fontFamily: 'inherit' }}>
                Forgot PIN?
              </button>
            </div>

            {msg && (
              <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: s('#b91c1c', '#fca5a5'), fontSize: 13, marginBottom: 16 }}>
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

          <div style={{ marginTop: 20, padding: '12px 16px', background: s('rgba(16,185,129,.06)', 'rgba(255,255,255,.04)'), borderRadius: 10, border: `1px solid ${s('rgba(16,185,129,.12)', 'rgba(255,255,255,.07)')}`, textAlign: 'center' }}>
            <span style={{ fontSize: 11.5, color: s('#9ca3af', 'rgba(255,255,255,.35)') }}>Demo: </span>
            <span style={{ fontSize: 11.5, color: s('#6b7280', 'rgba(255,255,255,.55)'), fontFamily: 'monospace' }}>COORD-TEST / 1234</span>
          </div>
        </div>
      )}
    </div>
  );
}
