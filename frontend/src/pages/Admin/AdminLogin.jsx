import { useState } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function AdminLogin({ onLogin }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState('');

  async function login(e) {
    e.preventDefault();
    if (!adminId || !password) return setMsg('Admin ID and password required.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/admin/login', { adminId, password });
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'Login failed.');
  }

  async function handleForgot(e) {
    e.preventDefault();
    if (!forgotId) return;
    setForgotLoading(true);
    setForgotResult('');
    const res = await api.post('/auth/admin/forgot-password', { adminId: forgotId });
    setForgotLoading(false);
    if (res.ok && res.tempPassword) {
      setForgotResult(`Temporary password: ${res.tempPassword}`);
    } else {
      setForgotResult(res.message || 'Request processed.');
    }
  }

  const s = (light, darkVal) => dark ? darkVal : light;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: s('linear-gradient(135deg, #ede9fe 0%, #dbeafe 60%, #f0fdf4 100%)', 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #0f172a 100%)'),
      position: 'relative', overflow: 'hidden', padding: 20,
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', left: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,.12) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', right: '-10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.1) 0%, transparent 65%)' }} />
      </div>

      <button onClick={toggleTheme} title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>{dark ? '☀️' : '🌙'}</button>

      {showForgot ? (
        <div style={{
          width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
          background: s('rgba(255,255,255,.9)', 'rgba(255,255,255,.04)'),
          backdropFilter: 'blur(20px)',
          border: s('1px solid rgba(139,92,246,.15)', '1px solid rgba(255,255,255,.1)'),
          borderRadius: 24,
          padding: '40px 36px', boxShadow: s('0 24px 64px rgba(139,92,246,.12)', '0 24px 64px rgba(0,0,0,.4)'),
        }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img src="/mcn-logo.png" alt="MCN" style={{ height: 34, objectFit: 'contain', opacity: .85 }} />
          </div>

          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
              display: 'grid', placeItems: 'center',
              fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '.05em',
              boxShadow: '0 12px 32px rgba(139,92,246,.4)',
            }}>ADM</div>
            <h2 style={{ color: s('#1e1b4b', '#fff'), fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Reset Password</h2>
            <p style={{ color: s('#6b7280', 'rgba(255,255,255,.45)'), fontSize: 13, margin: 0 }}>Enter your Admin ID to generate a temporary password</p>
          </div>

          <form onSubmit={handleForgot}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s('#6b7280', 'rgba(255,255,255,.5)'), textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Admin ID</label>
              <input
                style={{ width: '100%', background: s('#f3f4f6', 'rgba(255,255,255,.07)'), border: `1.5px solid ${s('#d1d5db', 'rgba(255,255,255,.12)')}`, borderRadius: 10, padding: '11px 14px', color: s('#111827', '#fff'), fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                placeholder="LMS-ADMIN"
                value={forgotId}
                onChange={e => setForgotId(e.target.value)}
                onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,.7)'}
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
                background: forgotLoading ? 'rgba(139,92,246,.3)' : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                color: '#fff', fontSize: 14, fontWeight: 800,
                boxShadow: forgotLoading ? 'none' : '0 8px 24px rgba(139,92,246,.35)',
                transition: 'all .2s', fontFamily: 'inherit',
              }}
            >
              {forgotLoading ? 'Processing...' : 'Generate Temporary Password'}
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
          border: s('1px solid rgba(139,92,246,.15)', '1px solid rgba(255,255,255,.1)'),
          borderRadius: 24,
          padding: '40px 36px', boxShadow: s('0 24px 64px rgba(139,92,246,.12)', '0 24px 64px rgba(0,0,0,.4)'),
        }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img src="/mcn-logo.png" alt="MCN" style={{ height: 34, objectFit: 'contain', opacity: .85 }} />
          </div>

          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
              display: 'grid', placeItems: 'center',
              fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '.05em',
              boxShadow: '0 12px 32px rgba(139,92,246,.4)',
            }}>ADM</div>
            <h2 style={{ color: s('#1e1b4b', '#fff'), fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Admin Console</h2>
            <p style={{ color: s('#6b7280', 'rgba(255,255,255,.45)'), fontSize: 13, margin: 0 }}>Curriculum, accounts & platform settings</p>
          </div>

          <form onSubmit={login}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s('#6b7280', 'rgba(255,255,255,.5)'), textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Admin ID</label>
              <input
                style={{ width: '100%', background: s('#f3f4f6', 'rgba(255,255,255,.07)'), border: `1.5px solid ${s('#d1d5db', 'rgba(255,255,255,.12)')}`, borderRadius: 10, padding: '11px 14px', color: s('#111827', '#fff'), fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                placeholder="LMS-ADMIN"
                value={adminId}
                onChange={e => setAdminId(e.target.value)}
                autoComplete="username"
                onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,.7)'}
                onBlur={e => e.target.style.borderColor = s('#d1d5db', 'rgba(255,255,255,.12)')}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s('#6b7280', 'rgba(255,255,255,.5)'), textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ width: '100%', background: s('#f3f4f6', 'rgba(255,255,255,.07)'), border: `1.5px solid ${s('#d1d5db', 'rgba(255,255,255,.12)')}`, borderRadius: 10, padding: '11px 42px 11px 14px', color: s('#111827', '#fff'), fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter admin password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,.7)'}
                  onBlur={e => e.target.style.borderColor = s('#d1d5db', 'rgba(255,255,255,.12)')}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: s('#9ca3af', 'rgba(255,255,255,.4)'), cursor: 'pointer', fontSize: 13 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <button type="button" onClick={() => setShowForgot(true)} style={{ background: 'none', border: 'none', color: s('#8b5cf6', 'rgba(167,139,250,.7)'), cursor: 'pointer', fontSize: 12, textDecoration: 'underline', fontFamily: 'inherit' }}>
                Forgot Password?
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
                background: loading ? 'rgba(139,92,246,.3)' : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                color: '#fff', fontSize: 14, fontWeight: 800,
                boxShadow: loading ? 'none' : '0 8px 24px rgba(139,92,246,.35)',
                transition: 'all .2s', fontFamily: 'inherit',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>

          <div style={{ marginTop: 20, padding: '12px 16px', background: s('rgba(139,92,246,.06)', 'rgba(255,255,255,.04)'), borderRadius: 10, border: `1px solid ${s('rgba(139,92,246,.12)', 'rgba(255,255,255,.07)')}`, textAlign: 'center' }}>
            <span style={{ fontSize: 11.5, color: s('#9ca3af', 'rgba(255,255,255,.35)') }}>Demo: </span>
            <span style={{ fontSize: 11.5, color: s('#6b7280', 'rgba(255,255,255,.55)'), fontFamily: 'monospace' }}>LMS-ADMIN / admin1234</span>
          </div>
        </div>
      )}
    </div>
  );
}
