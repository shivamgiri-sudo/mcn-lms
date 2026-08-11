import { useState } from 'react';
import { api } from '../../utils/api.js';
import { PortalAuthShell, AuthIcon, authTokens } from '../../components/PortalAuth.jsx';

const PILLARS = [
  { icon: 'users',     title: 'Your batches in one place',  desc: 'Every batch you run, with its learners, attendance and open actions.' },
  { icon: 'clipboard', title: 'Act on what needs you',      desc: 'Pending activities, learner questions and attendance exceptions surface first.' },
  { icon: 'award',     title: 'Certify with evidence',      desc: 'Complete the gates, then certify and hand over to operations.' },
];

export default function CoordLogin({ onLogin }) {
  const [loginId, setLoginId]         = useState('');
  const [pin, setPin]                 = useState('');
  const [msg, setMsg]                 = useState('');
  const [loading, setLoading]         = useState(false);
  const [showPin, setShowPin]         = useState(false);
  const [showForgot, setShowForgot]   = useState(false);
  const [forgotId, setForgotId]       = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult]   = useState('');

  async function login(e) {
    e.preventDefault();
    if (!loginId || !pin) return setMsg('Enter your login ID and PIN to continue.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/coordinator/login', { loginId, pin }, 'coordinator');
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'That login ID and PIN did not match.');
  }

  async function handleForgot(e) {
    e.preventDefault();
    if (!forgotId) return;
    setForgotLoading(true); setForgotResult('');
    const res = await api.post('/auth/coordinator/forgot-password', { loginId: forgotId });
    setForgotLoading(false);
    setForgotResult(res.message || 'If that account exists, recovery instructions are on their way.');
  }

  return (
    <PortalAuthShell
      eyebrow="Coordinator"
      headline={<>Run the batch.<br />Ready the team.</>}
      blurb="Everything you need to run training day to day: your batches, your learners, and the actions waiting on you."
      pillars={PILLARS}
      footnote="MAS Callnet · authorised coordinators only"
      title={showForgot ? 'Recover your account' : 'Sign in'}
      subtitle={
        showForgot
          ? 'Give us your login ID and we will send a secure reset link.'
          : 'Use the coordinator login ID issued to you.'
      }
    >
      {(t) => showForgot ? (
        <form onSubmit={handleForgot}>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="coord-recover" style={t.labelStyle}>Login ID</label>
            <input
              id="coord-recover"
              className="lms-field"
              style={t.inputStyle}
              value={forgotId}
              onChange={e => setForgotId(e.target.value)}
              placeholder="your.login"
              autoComplete="username"
            />
          </div>
          {forgotResult && <p role="status" style={t.notice(true)}>{forgotResult}</p>}
          <button type="submit" disabled={forgotLoading} className="lms-primary" style={t.primaryBtn(forgotLoading)}>
            {forgotLoading ? 'Sending…' : 'Send reset link'}
          </button>
          <button
            type="button"
            className="lms-link"
            onClick={() => { setShowForgot(false); setForgotResult(''); }}
            style={{
              width: '100%', marginTop: 16, minHeight: 44,
              background: 'none', border: 'none', cursor: 'pointer',
              color: t.inkSoft, fontSize: 14, fontFamily: 'inherit',
            }}
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <>
          <form onSubmit={login}>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="coord-id" style={t.labelStyle}>Login ID</label>
              <input
                id="coord-id"
                className="lms-field"
                style={t.inputStyle}
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                placeholder="your.login"
                autoComplete="username"
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="coord-pin" style={t.labelStyle}>PIN</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="coord-pin"
                  className="lms-field"
                  style={{ ...t.inputStyle, paddingRight: 48 }}
                  type={showPin ? 'text' : 'password'}
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  placeholder="Your PIN"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lms-icon-btn"
                  onClick={() => setShowPin(!showPin)}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    width: 38, height: 38, borderRadius: 8, display: 'grid', placeItems: 'center',
                    background: 'none', border: 'none', color: t.inkSoft, cursor: 'pointer',
                  }}
                >
                  <AuthIcon name={showPin ? 'eyeOff' : 'eye'} size={17} />
                </button>
              </div>
            </div>
            {msg && <p role="alert" style={t.notice(false)}>{msg}</p>}
            <button type="submit" disabled={loading} className="lms-primary" style={t.primaryBtn(loading)}>
              {loading ? 'Opening your workspace…' : 'Open my workspace'}
              {!loading && <AuthIcon name="arrow" size={17} />}
            </button>
          </form>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              type="button"
              className="lms-link"
              onClick={() => { setShowForgot(true); setForgotId(loginId); setForgotResult(''); }}
              style={{
                minHeight: 44, padding: '0 8px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, color: '#1d4ed8', fontFamily: 'inherit',
              }}
            >
              Forgot your PIN
            </button>
          </div>
        </>
      )}
    </PortalAuthShell>
  );
}
