import { useState } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function LoginView({ onLogin }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  async function login(e) {
    e.preventDefault();
    if (!empId || !password) return setMsg('Employee ID and password required.');
    setLoading(true);
    setMsg('');
    const res = await api.post('/auth/trainee/login', { employeeId: empId, password });
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'Login failed.');
  }

  async function requestRecovery(e) {
    e.preventDefault();
    if (!forgotId.trim()) return;
    setForgotLoading(true);
    setForgotMsg('');
    const res = await api.post('/auth/trainee/forgot-password', { identifier: forgotId.trim() });
    setForgotLoading(false);
    setForgotMsg(res.message || 'If the account exists, the recovery request has been recorded.');
  }

  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: dark ? 'rgba(255,255,255,.5)' : '#6b7280', textTransform: 'uppercase',
    letterSpacing: '.06em', marginBottom: 8,
  };
  const inputStyle = {
    width: '100%', background: dark ? 'rgba(255,255,255,.07)' : '#f3f4f6',
    border: `1.5px solid ${dark ? 'rgba(255,255,255,.12)' : '#d1d5db'}`,
    borderRadius: 10, padding: '11px 14px', color: dark ? '#fff' : '#111827',
    fontSize: 14, outline: 'none', transition: 'border-color .15s', fontFamily: 'inherit',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      background: dark ? 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1e1b4b 100%)' : 'linear-gradient(135deg, #dbeafe 0%, #e8eaf6 50%, #ede9fe 100%)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.18) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '-5%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.12) 0%, transparent 70%)' }} />
      </div>

      <section className="lms-login-brand" style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '60px 70px', position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 48 }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 40, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 32, background: dark ? 'rgba(255,255,255,.15)' : 'rgba(30,58,138,.18)' }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: dark ? '#fff' : '#1e3a8a', letterSpacing: '-.02em' }}>MCN Learning Hub</div>
            <div style={{ fontSize: 12, color: dark ? 'rgba(255,255,255,.5)' : '#64748b', marginTop: 2 }}>Learn · Practice · Certify · Grow</div>
          </div>
        </div>

        <h1 style={{ fontSize: 42, fontWeight: 900, color: dark ? '#fff' : '#1e3a8a', letterSpacing: '-.03em', lineHeight: 1.1, marginBottom: 16, maxWidth: 500 }}>
          Build capability.<br />
          <span style={{ background: 'linear-gradient(90deg, #2563eb, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Prove readiness.
          </span>
        </h1>
        <p style={{ color: dark ? 'rgba(255,255,255,.55)' : '#475569', fontSize: 15, lineHeight: 1.7, maxWidth: 440, marginBottom: 42 }}>
          Follow your assigned learning path, complete verified practice and assessments, ask for support, and track your progress toward certification.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 440 }}>
          {[
            { icon: '▶', color: '#3b82f6', title: 'Structured learning', desc: 'Day-wise modules and prerequisites keep every learner on the right path.' },
            { icon: '✓', color: '#10b981', title: 'Verified progress', desc: 'Completion and attendance are recorded using server-validated learning activity.' },
            { icon: '🎓', color: '#8b5cf6', title: 'Evidence-based certification', desc: 'Readiness reflects learning, assessment, attendance and required evidence.' },
          ].map(({ icon, color, title, desc }) => (
            <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: `${color}22`, border: `1px solid ${color}44`, color, fontSize: 14, fontWeight: 700 }}>{icon}</div>
              <div>
                <div style={{ color: dark ? '#fff' : '#1e3a8a', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{title}</div>
                <div style={{ color: dark ? 'rgba(255,255,255,.45)' : '#475569', fontSize: 12, lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lms-login-panel" style={{
        width: 440, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, position: 'relative', zIndex: 1,
        background: dark ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.92)',
        backdropFilter: 'blur(20px)',
        borderLeft: dark ? '1px solid rgba(255,255,255,.08)' : '1px solid rgba(99,102,241,.12)',
      }}>
        <button onClick={toggleTheme} title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ position: 'absolute', top: 16, right: 16, background: dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.06)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 16 }}>{dark ? '☀️' : '🌙'}</button>

        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img src="/mcn-logo.png" alt="MCN" style={{ height: 32, objectFit: 'contain', opacity: .7, marginBottom: 20 }} />
            <div style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto 14px', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 900, color: '#fff', boxShadow: '0 12px 32px rgba(99,102,241,.4)' }}>LMS</div>
            <h2 style={{ color: dark ? '#fff' : '#1e3a8a', fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>{showForgot ? 'Account recovery' : 'Welcome back'}</h2>
            <p style={{ color: dark ? 'rgba(255,255,255,.45)' : '#6b7280', fontSize: 13, margin: 0 }}>
              {showForgot ? 'Submit your registered identity for secure verification' : 'Sign in to your learning classroom'}
            </p>
          </div>

          {showForgot ? (
            <form onSubmit={requestRecovery}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Employee ID / LMS ID / Email / Mobile</label>
                <input style={inputStyle} value={forgotId} onChange={e => setForgotId(e.target.value)} placeholder="Enter your registered identity" autoComplete="username" />
              </div>
              {forgotMsg && <div style={{ background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 10, padding: '10px 14px', color: dark ? '#6ee7b7' : '#065f46', fontSize: 13, marginBottom: 16 }}>{forgotMsg}</div>}
              <button type="submit" disabled={forgotLoading} style={{ width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: forgotLoading ? 'not-allowed' : 'pointer', background: forgotLoading ? 'rgba(99,102,241,.4)' : 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 800 }}>
                {forgotLoading ? 'Submitting...' : 'Submit Recovery Request'}
              </button>
              <button type="button" onClick={() => { setShowForgot(false); setForgotMsg(''); }} style={{ width: '100%', marginTop: 14, background: 'none', border: 'none', cursor: 'pointer', color: dark ? 'rgba(255,255,255,.5)' : '#6b7280', textDecoration: 'underline' }}>Back to Sign In</button>
            </form>
          ) : (
            <>
              <form onSubmit={login}>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Employee ID / LMS ID / Email / Mobile</label>
                  <input style={inputStyle} placeholder="Enter your registered identity" value={empId} onChange={e => setEmpId(e.target.value)} autoComplete="username" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input style={{ ...inputStyle, padding: '11px 42px 11px 14px' }} type={showPass ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: dark ? 'rgba(255,255,255,.4)' : '#9ca3af', cursor: 'pointer', fontSize: 13 }}>{showPass ? '🙈' : '👁'}</button>
                  </div>
                </div>
                {msg && <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 13, marginBottom: 16 }}>{msg}</div>}
                <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? 'rgba(99,102,241,.4)' : 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 800, boxShadow: loading ? 'none' : '0 8px 24px rgba(99,102,241,.35)' }}>
                  {loading ? 'Opening classroom...' : 'Open My Classroom →'}
                </button>
              </form>
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <button type="button" onClick={() => { setShowForgot(true); setForgotId(empId); setForgotMsg(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: dark ? 'rgba(129,140,248,.9)' : '#4f46e5', textDecoration: 'underline' }}>Forgot password?</button>
              </div>
              <div style={{ marginTop: 18, padding: '12px 16px', background: dark ? 'rgba(255,255,255,.05)' : 'rgba(99,102,241,.06)', borderRadius: 10, border: `1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(99,102,241,.12)'}`, textAlign: 'center' }}>
                <span style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,.45)' : '#6b7280' }}>Use the one-time credential sent to your registered channel, then create a private password.</span>
              </div>
            </>
          )}
        </div>
      </section>

      <style>{`
        @media (max-width: 860px) {
          .lms-login-brand { display: none !important; }
          .lms-login-panel { width: 100% !important; min-height: 100vh; border-left: none !important; padding: 24px !important; }
        }
      `}</style>
    </div>
  );
}
