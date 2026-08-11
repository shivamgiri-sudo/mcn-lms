import { useState } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';

// Stroke icons sized from the caller. These replace the emoji the portal used
// to lean on, which rendered differently on every operator machine.
function Icon({ name, size = 18 }) {
  const paths = {
    path: 'M4 6h10M4 12h16M4 18h7',
    verified: 'M20 6L9 17l-5-5',
    award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 13.5L7 22l5-2.5L17 22l-1.5-8.5',
    sun: 'M12 4V2M12 22v-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M4 12H2M22 12h-2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z',
    eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 3.5-.6',
    arrow: 'M5 12h14M13 6l6 6-6 6',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
      {name === 'sun' && <circle cx="12" cy="12" r="4" />}
      {name === 'eye' && <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

const PILLARS = [
  { icon: 'path', title: 'A path built for your role', desc: 'Day-wise modules unlock in order, so you always know what comes next.' },
  { icon: 'verified', title: 'Progress that counts', desc: 'Completion and attendance are recorded from real, server-verified activity.' },
  { icon: 'award', title: 'Certification on evidence', desc: 'Readiness reflects your learning, assessments, attendance and submitted proof.' },
];

const LOGIN_CSS = [
  '.lms-login-root{font-family:"Source Sans 3",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}',
  '.lms-display{font-family:"Lexend","Source Sans 3",ui-sans-serif,system-ui,sans-serif;}',
  '.lms-field{transition:border-color .18s ease,box-shadow .18s ease;}',
  '.lms-field:focus{border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.18);}',
  '.lms-primary{transition:background-color .18s ease,transform .12s ease;}',
  '.lms-primary:hover:not(:disabled){background:#1a45bd;}',
  '.lms-primary:active:not(:disabled){transform:translateY(1px);}',
  '.lms-icon-btn{transition:color .18s ease,border-color .18s ease;}',
  '.lms-icon-btn:hover{color:#1d4ed8;}',
  '.lms-link:hover{text-decoration:underline;}',
  '.lms-login-root :focus-visible{outline:2px solid #1d4ed8;outline-offset:2px;border-radius:4px;}',
  '@media (max-width:900px){.lms-login-brand{display:none !important;}',
  '.lms-login-panel{width:100% !important;border-left:none !important;padding:28px 22px !important;}}',
  '@media (prefers-reduced-motion:reduce){.lms-login-root *{transition:none !important;}}',
].join('');

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
    if (!empId || !password) return setMsg('Enter your ID and password to continue.');
    setLoading(true);
    setMsg('');
    const res = await api.post('/auth/trainee/login', { employeeId: empId, password });
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'That ID and password did not match. Check both and try again.');
  }

  async function requestRecovery(e) {
    e.preventDefault();
    if (!forgotId.trim()) return;
    setForgotLoading(true);
    setForgotMsg('');
    const res = await api.post('/auth/trainee/forgot-password', { identifier: forgotId.trim() });
    setForgotLoading(false);
    setForgotMsg(res.message || 'If that account exists, recovery instructions are on their way.');
  }

  const ink = dark ? '#f2f5fb' : '#0f1729';
  const inkSoft = dark ? 'rgba(226,235,250,.62)' : '#4a5468';
  const panelBg = dark ? '#111726' : '#ffffff';
  const fieldBg = dark ? 'rgba(255,255,255,.05)' : '#f4f6fa';
  const fieldLine = dark ? 'rgba(255,255,255,.14)' : '#d3d9e4';

  const labelStyle = {
    display: 'block', fontSize: 12.5, fontWeight: 600,
    color: dark ? 'rgba(226,235,250,.74)' : '#3d4759', marginBottom: 7,
  };
  const inputStyle = {
    width: '100%', background: fieldBg, border: '1.5px solid ' + fieldLine,
    borderRadius: 10, padding: '13px 14px', color: ink,
    fontSize: 15, outline: 'none', fontFamily: 'inherit',
  };
  const primaryBtn = (busy) => ({
    width: '100%', minHeight: 48, padding: '14px 0', borderRadius: 10, border: 'none',
    cursor: busy ? 'progress' : 'pointer', background: busy ? '#7891d6' : '#1d4ed8',
    color: '#ffffff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  });
  const noticeStyle = (tone) => ({
    background: dark ? tone.darkBg : tone.lightBg,
    border: '1px solid ' + (dark ? tone.darkLine : tone.lightLine),
    color: dark ? tone.darkInk : tone.lightInk,
    borderRadius: 10, padding: '11px 14px', fontSize: 13.5,
    margin: '0 0 18px', lineHeight: 1.5,
  });
  const OK_TONE = { darkBg: 'rgba(45,212,191,.12)', lightBg: '#e6f7f3', darkLine: 'rgba(45,212,191,.30)', lightLine: '#b7e6da', darkInk: '#7ddcc7', lightInk: '#0f6b57' };
  const BAD_TONE = { darkBg: 'rgba(248,113,113,.12)', lightBg: '#fdeceb', darkLine: 'rgba(248,113,113,.32)', lightLine: '#f5c6c2', darkInk: '#ffa79f', lightInk: '#a52218' };

  return (
    <div className="lms-login-root" style={{ minHeight: '100vh', display: 'flex', background: panelBg }}>
      <section className="lms-login-brand" style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '52px 60px', color: '#eaf0fb', position: 'relative', overflow: 'hidden',
        background: dark
          ? 'linear-gradient(158deg, #080d18 0%, #101b36 54%, #16264a 100%)'
          : 'linear-gradient(158deg, #101830 0%, #16274f 54%, #1e3a73 100%)',
      }}>
        <div aria-hidden="true" style={{
          position: 'absolute', width: 560, height: 560, borderRadius: '50%', top: -180, right: -160,
          background: 'radial-gradient(circle, rgba(59,130,246,.30) 0%, transparent 68%)',
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%', bottom: -160, left: -120,
          background: 'radial-gradient(circle, rgba(45,212,191,.16) 0%, transparent 68%)',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 13, position: 'relative' }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 34, objectFit: 'contain' }} />
          <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,.20)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.15em', textTransform: 'uppercase', color: 'rgba(234,240,251,.72)' }}>
            Learning Hub
          </span>
        </div>

        <div style={{ position: 'relative', maxWidth: 520 }}>
          <h1 className="lms-display" style={{
            fontSize: 'clamp(32px, 3.6vw, 50px)', lineHeight: 1.08, letterSpacing: '-.03em',
            fontWeight: 600, margin: '0 0 18px', textWrap: 'balance',
          }}>
            Build the skill.<br />Prove the standard.
          </h1>
          <p style={{ fontSize: 16.5, lineHeight: 1.65, color: 'rgba(234,240,251,.70)', margin: '0 0 40px', maxWidth: 460 }}>
            Your assigned training, practice and assessments in one place, tracked all the way to certification.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
            {PILLARS.map((p) => (
              <div key={p.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: 'rgba(122,162,255,.14)', border: '1px solid rgba(122,162,255,.28)', color: '#9dbcff',
                }}>
                  <Icon name={p.icon} size={17} />
                </span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 14.5, marginBottom: 3 }}>{p.title}</span>
                  <span style={{ display: 'block', fontSize: 13.5, lineHeight: 1.55, color: 'rgba(234,240,251,.58)' }}>{p.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ position: 'relative', fontSize: 12.5, color: 'rgba(234,240,251,.42)', margin: 0 }}>
          MAS Callnet &middot; authorised learners only
        </p>
      </section>

      <section className="lms-login-panel" style={{
        width: 460, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, position: 'relative', background: panelBg,
        borderLeft: dark ? '1px solid rgba(255,255,255,.07)' : '1px solid #e6eaf2',
      }}>
        <button type="button" onClick={toggleTheme} className="lms-icon-btn"
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          style={{
            position: 'absolute', top: 18, right: 18, width: 40, height: 40, borderRadius: 10,
            display: 'grid', placeItems: 'center', cursor: 'pointer', color: inkSoft,
            background: 'transparent', border: '1px solid ' + fieldLine,
          }}>
          <Icon name={dark ? 'sun' : 'moon'} size={17} />
        </button>

        <div style={{ width: '100%', maxWidth: 348 }}>
          <h2 className="lms-display" style={{
            color: ink, fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', margin: '0 0 7px',
          }}>
            {showForgot ? 'Recover your account' : 'Sign in'}
          </h2>
          <p style={{ color: inkSoft, fontSize: 14.5, margin: '0 0 30px', lineHeight: 1.55 }}>
            {showForgot
              ? 'Tell us how to find you and we will send a secure reset link.'
              : 'Use the ID your coordinator issued you.'}
          </p>

          {showForgot ? (
            <form onSubmit={requestRecovery}>
              <div style={{ marginBottom: 18 }}>
                <label htmlFor="recover-id" style={labelStyle}>Employee ID, LMS ID, email or mobile</label>
                <input id="recover-id" className="lms-field" style={inputStyle} value={forgotId}
                  onChange={(e) => setForgotId(e.target.value)} placeholder="mas00000" autoComplete="username" />
              </div>
              {forgotMsg && <p role="status" style={noticeStyle(OK_TONE)}>{forgotMsg}</p>}
              <button type="submit" disabled={forgotLoading} className="lms-primary" style={primaryBtn(forgotLoading)}>
                {forgotLoading ? 'Sending...' : 'Send reset link'}
              </button>
              <button type="button" className="lms-link" onClick={() => { setShowForgot(false); setForgotMsg(''); }}
                style={{ width: '100%', marginTop: 16, minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', color: inkSoft, fontSize: 14, fontFamily: 'inherit' }}>
                Back to sign in
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={login}>
                <div style={{ marginBottom: 18 }}>
                  <label htmlFor="login-id" style={labelStyle}>Employee ID, LMS ID, email or mobile</label>
                  <input id="login-id" className="lms-field" style={inputStyle} placeholder="mas00000"
                    value={empId} onChange={(e) => setEmpId(e.target.value)} autoComplete="username" />
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label htmlFor="login-pass" style={labelStyle}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input id="login-pass" className="lms-field" style={{ ...inputStyle, paddingRight: 48 }}
                      type={showPass ? 'text' : 'password'} placeholder="Your password"
                      value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                    <button type="button" className="lms-icon-btn" onClick={() => setShowPass(!showPass)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                        width: 38, height: 38, borderRadius: 8, display: 'grid', placeItems: 'center',
                        background: 'none', border: 'none', color: inkSoft, cursor: 'pointer',
                      }}>
                      <Icon name={showPass ? 'eyeOff' : 'eye'} size={17} />
                    </button>
                  </div>
                </div>
                {msg && <p role="alert" style={noticeStyle(BAD_TONE)}>{msg}</p>}
                <button type="submit" disabled={loading} className="lms-primary" style={primaryBtn(loading)}>
                  {loading ? 'Opening your classroom...' : 'Open my classroom'}
                  {!loading && <Icon name="arrow" size={17} />}
                </button>
              </form>

              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <button type="button" className="lms-link"
                  onClick={() => { setShowForgot(true); setForgotId(empId); setForgotMsg(''); }}
                  style={{ minHeight: 44, padding: '0 8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: dark ? '#8fb0ff' : '#1d4ed8', fontFamily: 'inherit' }}>
                  Forgot your password
                </button>
              </div>

              <p style={{
                marginTop: 22, padding: '13px 15px', borderRadius: 10, textAlign: 'center', lineHeight: 1.55,
                background: dark ? 'rgba(255,255,255,.04)' : '#f4f6fa',
                border: '1px solid ' + (dark ? 'rgba(255,255,255,.07)' : '#e6eaf2'),
                fontSize: 12.5, color: inkSoft,
              }}>
                First time here? Sign in with the one-time credential sent to you, then set your own password.
              </p>
            </>
          )}
        </div>
      </section>

      <style>{LOGIN_CSS}</style>
    </div>
  );
}
