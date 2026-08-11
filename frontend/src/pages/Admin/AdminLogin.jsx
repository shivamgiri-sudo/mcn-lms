import { useState } from 'react';
import { api } from '../../utils/api.js';
import { PortalAuthShell, AuthIcon, authTokens } from '../../components/PortalAuth.jsx';

const PILLARS = [
  { icon: 'gauge',     title: 'The whole training picture', desc: 'Batches, classrooms, learners and risk across every branch and process.' },
  { icon: 'path',      title: 'Build the curriculum',       desc: 'Classrooms, modules, content and assessments, assigned where they are needed.' },
  { icon: 'shield',    title: 'Governed access',            desc: 'Sensitive changes are re-authenticated and written to the audit trail.' },
];

export default function AdminLogin({ onLogin }) {
  const [adminId, setAdminId]         = useState('');
  const [password, setPassword]       = useState('');
  const [msg, setMsg]                 = useState('');
  const [loading, setLoading]         = useState(false);
  const [showPass, setShowPass]       = useState(false);
  const [showForgot, setShowForgot]   = useState(false);
  const [forgotId, setForgotId]       = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult]   = useState('');

  async function login(e) {
    e.preventDefault();
    if (!adminId || !password) return setMsg('Enter your admin ID and password to continue.');
    setLoading(true); setMsg('');
    const res = await api.post('/auth/admin/login', { adminId, password });
    setLoading(false);
    if (res.ok) onLogin(res);
    else setMsg(res.message || 'That admin ID and password did not match.');
  }

  async function handleForgot(e) {
    e.preventDefault();
    if (!forgotId) return;
    setForgotLoading(true); setForgotResult('');
    const res = await api.post('/auth/admin/forgot-password', { adminId: forgotId });
    setForgotLoading(false);
    if (res.ok && res.tempPassword) {
      setForgotResult(`Temporary password: ${res.tempPassword}`);
    } else {
      setForgotResult(res.message || 'Your request has been recorded for verification.');
    }
  }

  return (
    <PortalAuthShell
      eyebrow="Administration"
      headline={<>Set the standard.<br />See it hold.</>}
      blurb="Curriculum, batches, people and evidence for the whole training operation."
      pillars={PILLARS}
      footnote="MAS Callnet · authorised administrators only"
      title={showForgot ? 'Account recovery' : 'Sign in'}
      subtitle={
        showForgot
          ? 'Admin recovery is verified by a person, so this raises a request rather than emailing a link.'
          : 'Use your administrator credentials.'
      }
    >
      {(t) => showForgot ? (
        <form onSubmit={handleForgot}>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="admin-recover" style={t.labelStyle}>Admin ID</label>
            <input
              id="admin-recover"
              className="lms-field"
              style={t.inputStyle}
              value={forgotId}
              onChange={e => setForgotId(e.target.value)}
              placeholder="your.admin.id"
              autoComplete="username"
            />
          </div>
          {forgotResult && <p role="status" style={t.notice(true)}>{forgotResult}</p>}
          <button type="submit" disabled={forgotLoading} className="lms-primary" style={t.primaryBtn(forgotLoading)}>
            {forgotLoading ? 'Submitting…' : 'Raise recovery request'}
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
              <label htmlFor="admin-id" style={t.labelStyle}>Admin ID</label>
              <input
                id="admin-id"
                className="lms-field"
                style={t.inputStyle}
                value={adminId}
                onChange={e => setAdminId(e.target.value)}
                placeholder="your.admin.id"
                autoComplete="username"
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="admin-pass" style={t.labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="admin-pass"
                  className="lms-field"
                  style={{ ...t.inputStyle, paddingRight: 48 }}
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lms-icon-btn"
                  onClick={() => setShowPass(!showPass)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    width: 38, height: 38, borderRadius: 8, display: 'grid', placeItems: 'center',
                    background: 'none', border: 'none', color: t.inkSoft, cursor: 'pointer',
                  }}
                >
                  <AuthIcon name={showPass ? 'eyeOff' : 'eye'} size={17} />
                </button>
              </div>
            </div>
            {msg && <p role="alert" style={t.notice(false)}>{msg}</p>}
            <button type="submit" disabled={loading} className="lms-primary" style={t.primaryBtn(loading)}>
              {loading ? 'Opening the console…' : 'Open the console'}
              {!loading && <AuthIcon name="arrow" size={17} />}
            </button>
          </form>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              type="button"
              className="lms-link"
              onClick={() => { setShowForgot(true); setForgotId(adminId); setForgotResult(''); }}
              style={{
                minHeight: 44, padding: '0 8px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, color: '#1d4ed8', fontFamily: 'inherit',
              }}
            >
              Forgot your password
            </button>
          </div>
        </>
      )}
    </PortalAuthShell>
  );
}
