import { useEffect, useMemo, useState } from 'react';
import { api, clearToken, hasSessionMarker } from '../../utils/api.js';

const ROLE_LABELS = {
  trainee: 'Learner',
  coordinator: 'Coordinator',
  admin: 'Administrator',
};

function availableRoles() {
  return Object.keys(ROLE_LABELS).filter(role => hasSessionMarker(role));
}

function initialRole(roles) {
  const query = new URLSearchParams(window.location.search).get('role');
  return roles.includes(query) ? query : roles[0] || 'trainee';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusLabel(session) {
  if (session.revokedAt) return 'Revoked';
  if (!session.active) return 'Expired';
  return session.current ? 'Current' : 'Active';
}

export default function SessionSecurityPage() {
  const roles = useMemo(() => availableRoles(), []);
  const [role, setRole] = useState(() => initialRole(roles));
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [elevating, setElevating] = useState(false);

  const superAdmin = role === 'admin' && ['Super Admin', 'SuperAdmin'].includes(profile?.role);

  useEffect(() => {
    if (!roles.includes(role)) return;
    const params = new URLSearchParams(window.location.search);
    params.set('role', role);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    load();
  }, [role]);

  async function load() {
    setLoading(true);
    setError('');
    setMessage('');
    const [profileResult, sessionResult] = await Promise.all([
      api.get('/auth/me', role),
      api.get('/auth/sessions', role),
    ]);
    setLoading(false);
    if (!profileResult.ok || !sessionResult.ok) {
      setError(profileResult.message || sessionResult.message || 'Could not load session security information.');
      return;
    }
    setProfile(profileResult.user || null);
    setSessions(sessionResult.data || []);

    const isSuper = role === 'admin' && ['Super Admin', 'SuperAdmin'].includes(profileResult.user?.role);
    if (isSuper) {
      const eventResult = await api.get('/auth/security/events', 'admin');
      if (eventResult.ok) setEvents(eventResult.data || []);
    } else {
      setEvents([]);
    }
  }

  async function revoke(session) {
    const prompt = session.current
      ? 'Revoke this current session and sign out?'
      : `Revoke ${session.deviceLabel || 'this session'}?`;
    if (!window.confirm(prompt)) return;
    const result = await api.delete(`/auth/sessions/${encodeURIComponent(session.id)}`, role);
    if (!result.ok) return setError(result.message || 'Could not revoke the session.');
    if (result.currentSessionRevoked) {
      clearToken(role);
      window.location.replace(role === 'admin' ? '/admin' : role === 'coordinator' ? '/coordinator' : '/lms');
      return;
    }
    setMessage('Session revoked successfully.');
    await load();
  }

  async function revokeOthers() {
    if (!window.confirm('Revoke every other active session for this account?')) return;
    const result = await api.post('/auth/sessions/revoke-others', {}, role);
    if (!result.ok) return setError(result.message || 'Could not revoke other sessions.');
    setMessage(`${result.revokedCount || 0} other session(s) revoked.`);
    await load();
  }

  async function elevate(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!password || reason.trim().length < 20) {
      return setError('Enter your current password and a justification of at least 20 characters.');
    }
    setElevating(true);
    const result = await api.post('/auth/security/elevate', { password, reason: reason.trim() }, 'admin');
    setElevating(false);
    if (!result.ok) return setError(result.message || 'Could not elevate this session.');
    setPassword('');
    setReason('');
    setMessage(`Sensitive administration is enabled until ${formatDate(result.elevatedUntil)}.`);
    await load();
  }

  if (!roles.length) {
    return (
      <main className="security-shell">
        <section className="security-empty">
          <h1>Sessions & Security</h1>
          <p>Sign in to an LMS portal before opening this workspace.</p>
          <div className="security-actions">
            <a href="/lms">Learner sign in</a>
            <a href="/coordinator">Coordinator sign in</a>
            <a href="/admin">Administrator sign in</a>
          </div>
        </section>
        <SecurityStyles />
      </main>
    );
  }

  const activeCount = sessions.filter(item => item.active).length;
  const otherActiveCount = sessions.filter(item => item.active && !item.current).length;

  return (
    <main className="security-shell">
      <header className="security-header">
        <div>
          <span className="security-kicker">MCN Learning Hub</span>
          <h1>Sessions & Security</h1>
          <p>Review browser sessions, remove unknown devices and protect sensitive administration.</p>
        </div>
        <a className="security-back" href={role === 'admin' ? '/admin' : role === 'coordinator' ? '/coordinator' : '/lms'}>Back to portal</a>
      </header>

      {roles.length > 1 && (
        <label className="security-role-picker">
          Session context
          <select value={role} onChange={event => setRole(event.target.value)}>
            {roles.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
          </select>
        </label>
      )}

      {message && <div className="security-notice success">{message}</div>}
      {error && <div className="security-notice error">{error}</div>}

      <section className="security-summary">
        <article><small>Signed in as</small><strong>{profile?.name || profile?.adminName || profile?.traineeName || profile?.loginId || profile?.employeeId || profile?.adminId || ROLE_LABELS[role]}</strong><span>{profile?.role || ROLE_LABELS[role]}</span></article>
        <article><small>Active sessions</small><strong>{activeCount}</strong><span>Current and other devices</span></article>
        <article><small>Other active devices</small><strong>{otherActiveCount}</strong><span>Revoke anything unfamiliar</span></article>
      </section>

      <section className="security-panel">
        <div className="security-panel-head">
          <div><h2>Browser sessions</h2><p>Only hashed session fingerprints and privacy-preserving device evidence are retained.</p></div>
          <div className="security-actions">
            <button type="button" onClick={load}>Refresh</button>
            <button type="button" className="danger" disabled={!otherActiveCount} onClick={revokeOthers}>Revoke other sessions</button>
          </div>
        </div>

        {loading ? <div className="security-loading">Loading secure sessions…</div> : (
          <div className="security-session-grid">
            {sessions.map(session => (
              <article key={session.id} className={`security-session ${session.current ? 'current' : ''}`}>
                <div className="security-session-top">
                  <div className="device-icon">{session.current ? '●' : '○'}</div>
                  <div><strong>{session.deviceLabel || 'Unknown browser device'}</strong><span>{session.authMethod || 'Authenticated session'}</span></div>
                  <em className={`status ${statusLabel(session).toLowerCase()}`}>{statusLabel(session)}</em>
                </div>
                <dl>
                  <div><dt>Created</dt><dd>{formatDate(session.createdAt)}</dd></div>
                  <div><dt>Last activity</dt><dd>{formatDate(session.lastSeenAt)}</dd></div>
                  <div><dt>Idle expiry</dt><dd>{formatDate(session.expiresAt)}</dd></div>
                  <div><dt>Absolute expiry</dt><dd>{formatDate(session.absoluteExpiresAt)}</dd></div>
                  {session.elevationExpiresAt && <div><dt>Elevated until</dt><dd>{formatDate(session.elevationExpiresAt)}</dd></div>}
                  {session.revokedReason && <div><dt>Revocation</dt><dd>{session.revokedReason}</dd></div>}
                </dl>
                {session.active && <button type="button" className="session-revoke" onClick={() => revoke(session)}>{session.current ? 'Sign out this session' : 'Revoke session'}</button>}
              </article>
            ))}
          </div>
        )}
      </section>

      {superAdmin && (
        <section className="security-admin-grid">
          <form className="security-panel" onSubmit={elevate}>
            <div className="security-panel-head"><div><h2>Emergency elevation</h2><p>Re-enter your password and record why company-wide mutation access is required.</p></div></div>
            <label>Current password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
            <label>Security justification<textarea rows="4" value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe the exact action and business reason (minimum 20 characters)." /></label>
            <button type="submit" className="primary" disabled={elevating}>{elevating ? 'Verifying…' : 'Elevate for a limited time'}</button>
          </form>

          <section className="security-panel">
            <div className="security-panel-head"><div><h2>Recent security events</h2><p>Latest authentication, session, SSO and elevation evidence.</p></div></div>
            <div className="security-events">
              {events.slice(0, 50).map(item => (
                <article key={item.eventId}>
                  <span className={`severity ${String(item.severity || '').toLowerCase()}`}>{item.severity}</span>
                  <div><strong>{String(item.eventType || '').replaceAll('_', ' ')}</strong><small>{item.actorUserId || item.subjectUserId || 'System'} · {formatDate(item.createdAt)}</small></div>
                </article>
              ))}
              {!events.length && <p className="security-muted">No security events are available in this scope.</p>}
            </div>
          </section>
        </section>
      )}

      <SecurityStyles />
    </main>
  );
}

function SecurityStyles() {
  return <style>{`
    .security-shell{min-height:100vh;background:#f4f7fb;color:#172033;padding:34px;box-sizing:border-box}.security-header{max-width:1280px;margin:0 auto 22px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.security-kicker{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#4f46e5}.security-header h1{font-size:34px;margin:5px 0 7px;letter-spacing:-.03em}.security-header p,.security-panel-head p{margin:0;color:#667085;line-height:1.55}.security-back,.security-actions a{display:inline-flex;padding:10px 14px;border-radius:10px;background:#fff;border:1px solid #d9e0ea;color:#25324a;text-decoration:none;font-weight:700;font-size:13px}.security-role-picker{max-width:1280px;margin:0 auto 18px;display:flex;gap:10px;align-items:center;color:#667085;font-size:13px;font-weight:700}.security-role-picker select{padding:9px 12px;border:1px solid #d9e0ea;border-radius:9px;background:#fff}.security-notice{max-width:1280px;margin:0 auto 14px;padding:12px 15px;border-radius:10px;font-size:13px;font-weight:700}.security-notice.success{background:#ecfdf3;color:#067647;border:1px solid #abefc6}.security-notice.error{background:#fef3f2;color:#b42318;border:1px solid #fecdca}.security-summary{max-width:1280px;margin:0 auto 20px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.security-summary article,.security-panel,.security-empty{background:#fff;border:1px solid #dfe5ee;border-radius:16px;box-shadow:0 10px 30px rgba(30,50,80,.06)}.security-summary article{padding:18px}.security-summary small{display:block;color:#667085;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.security-summary strong{display:block;font-size:22px;margin:8px 0 3px;overflow-wrap:anywhere}.security-summary span{font-size:12px;color:#667085}.security-panel{max-width:1280px;margin:0 auto 20px;padding:20px;box-sizing:border-box}.security-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}.security-panel h2{font-size:19px;margin:0 0 5px}.security-actions{display:flex;gap:9px;flex-wrap:wrap}.security-actions button,.security-panel button{border:1px solid #d0d7e2;background:#fff;border-radius:9px;padding:9px 12px;font-weight:750;cursor:pointer;color:#26344d}.security-actions button.danger,.session-revoke{color:#b42318!important;border-color:#fecdca!important;background:#fff7f6!important}.security-panel button.primary{background:#4f46e5;color:#fff;border-color:#4f46e5}.security-panel button:disabled{opacity:.45;cursor:not-allowed}.security-loading{padding:35px;text-align:center;color:#667085}.security-session-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.security-session{border:1px solid #dfe5ee;border-radius:13px;padding:16px;background:#fbfcfe}.security-session.current{border-color:#a5b4fc;background:#f5f6ff}.security-session-top{display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center}.device-icon{width:34px;height:34px;border-radius:10px;background:#e8ecff;color:#4f46e5;display:grid;place-items:center}.security-session-top strong{display:block;font-size:14px}.security-session-top span{display:block;color:#667085;font-size:12px;margin-top:2px}.status,.severity{font-style:normal;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.05em;padding:5px 7px;border-radius:999px;background:#eef2f7;color:#475467}.status.current,.status.active{background:#ecfdf3;color:#067647}.status.revoked,.severity.critical{background:#fef3f2;color:#b42318}.status.expired{background:#fffaeb;color:#b54708}.security-session dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.security-session dl div{min-width:0}.security-session dt{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#98a2b3;font-weight:800}.security-session dd{font-size:12px;margin:3px 0 0;color:#344054;overflow-wrap:anywhere}.session-revoke{width:100%;padding:9px;border-radius:9px;cursor:pointer;font-weight:750}.security-admin-grid{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:18px}.security-admin-grid .security-panel{margin:0;max-width:none}.security-panel label{display:block;font-size:12px;font-weight:750;color:#475467;margin-bottom:14px}.security-panel input,.security-panel textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:11px;border:1px solid #d0d7e2;border-radius:9px;font:inherit;background:#fff}.security-events{display:flex;flex-direction:column;gap:8px;max-height:460px;overflow:auto}.security-events article{display:flex;gap:10px;align-items:center;border:1px solid #e4e7ec;border-radius:10px;padding:10px}.security-events strong{display:block;font-size:12px;text-transform:capitalize}.security-events small{display:block;color:#667085;font-size:11px;margin-top:3px}.severity.high{background:#fffaeb;color:#b54708}.severity.watch{background:#eff8ff;color:#175cd3}.security-muted{color:#667085;font-size:13px}.security-empty{max-width:620px;margin:80px auto;padding:34px;text-align:center}.security-empty p{color:#667085}.security-empty .security-actions{justify-content:center;margin-top:20px}@media(max-width:840px){.security-shell{padding:20px 14px}.security-header{flex-direction:column}.security-summary,.security-session-grid,.security-admin-grid{grid-template-columns:1fr}.security-panel-head{flex-direction:column}.security-session dl{grid-template-columns:1fr}.security-header h1{font-size:28px}}@media(prefers-color-scheme:dark){.security-shell{background:#0f172a;color:#e5e7eb}.security-summary article,.security-panel,.security-empty,.security-back,.security-actions a,.security-actions button{background:#172033;border-color:#334155;color:#e5e7eb}.security-session{background:#111827;border-color:#334155}.security-session.current{background:#1e1b4b;border-color:#6366f1}.security-header p,.security-panel-head p,.security-summary span,.security-session-top span,.security-session dd,.security-muted{color:#94a3b8}.security-panel input,.security-panel textarea,.security-role-picker select{background:#0f172a;border-color:#475569;color:#e5e7eb}}
  `}</style>;
}
