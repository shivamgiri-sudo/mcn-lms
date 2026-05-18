import { useState } from 'react';
import { api } from '../../utils/api.js';

export default function LoginView({ onLogin }) {
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  async function login(e) {
    e.preventDefault();
    if (!empId || !password) return setMsg('Employee ID and password required.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/trainee/login', { employeeId: empId, password });
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'Login failed.');
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1e1b4b 100%)',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Animated background blobs */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.18) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '-5%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.12) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', top: '40%', left: '30%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,.1) 0%, transparent 70%)' }} />
      </div>

      {/* Left panel — branding */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '60px 70px', position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 48 }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 40, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,.15)' }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-.02em' }}>Mini LMS Classroom</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>Digital Training Platform</div>
          </div>
        </div>

        <h1 style={{ fontSize: 42, fontWeight: 900, color: '#fff', letterSpacing: '-.03em', lineHeight: 1.1, marginBottom: 16, maxWidth: 440 }}>
          Your training<br />
          <span style={{ background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            starts here.
          </span>
        </h1>
        <p style={{ color: 'rgba(255,255,255,.55)', fontSize: 15, lineHeight: 1.7, maxWidth: 400, marginBottom: 48 }}>
          Access your day-wise curriculum, complete assessments, and track your learning progress — all in one place.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400 }}>
          {[
            { icon: '▶', color: '#3b82f6', title: 'Watch & Learn', desc: 'Video lessons, PDFs, and interactive content at your pace' },
            { icon: '💬', color: '#8b5cf6', title: 'Ask & Clarify', desc: 'Raise queries to your coordinator and get answers fast' },
            { icon: '✓', color: '#10b981', title: 'Track Progress', desc: 'Your activity auto-syncs as your live progress report' },
          ].map(({ icon, color, title, desc }) => (
            <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                background: `${color}22`, border: `1px solid ${color}44`, color, fontSize: 14, fontWeight: 700,
              }}>{icon}</div>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{title}</div>
                <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 12, lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{
        width: 440, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, position: 'relative', zIndex: 1,
        background: 'rgba(255,255,255,.04)',
        backdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(255,255,255,.08)',
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img src="/mcn-logo.png" alt="MCN" style={{ height: 32, objectFit: 'contain', opacity: .7, marginBottom: 20 }} />
            <div style={{
              width: 52, height: 52, borderRadius: 16, margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
              display: 'grid', placeItems: 'center',
              fontSize: 20, fontWeight: 900, color: '#fff',
              boxShadow: '0 12px 32px rgba(99,102,241,.4)',
            }}>LMS</div>
            <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Welcome back</h2>
            <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 13, margin: 0 }}>Sign in to your training classroom</p>
          </div>

          <form onSubmit={login}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Employee ID / LMS ID</label>
              <input
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1.5px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', transition: 'border-color .15s', fontFamily: 'inherit' }}
                placeholder="EMP1001"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                autoComplete="username"
                onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,.7)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1.5px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '11px 42px 11px 14px', color: '#fff', fontSize: 14, outline: 'none', transition: 'border-color .15s', fontFamily: 'inherit' }}
                  type={showPass ? 'text' : 'password'}
                  placeholder="First login: mobile last 4 digits"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,.7)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 13 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,.35)', marginBottom: 24, lineHeight: 1.5 }}>
              First-time login: use your mobile last 4 digits as password
            </p>

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
                background: loading ? 'rgba(99,102,241,.4)' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                color: '#fff', fontSize: 14, fontWeight: 800, letterSpacing: '.01em',
                boxShadow: loading ? 'none' : '0 8px 24px rgba(99,102,241,.35)',
                transition: 'all .2s', transform: loading ? 'none' : undefined,
                fontFamily: 'inherit',
              }}
              onMouseOver={e => { if (!loading) e.target.style.transform = 'translateY(-1px)'; }}
              onMouseOut={e => { e.target.style.transform = 'none'; }}
            >
              {loading ? 'Opening classroom...' : 'Open My Classroom →'}
            </button>
          </form>

          <div style={{ marginTop: 24, padding: '14px 16px', background: 'rgba(255,255,255,.05)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', textAlign: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.35)' }}>Demo: </span>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', fontFamily: 'monospace' }}>EMP1001 / 1234</span>
          </div>
        </div>
      </div>
    </div>
  );
}
