import { useEffect, useRef, useState } from 'react';
import { setElevationHandler } from '../utils/api.js';

// The server rejects sensitive admin actions with ELEVATION_REQUIRED until the
// session has been re-authenticated. api.js hands the request over here so the
// user can confirm in place instead of losing the action.
const MIN_REASON = 20;

export default function ElevationGate() {
  const [pending, setPending] = useState(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const resolverRef = useRef(null);

  useEffect(() => {
    setElevationHandler(context => new Promise(resolve => {
      resolverRef.current = resolve;
      setPassword('');
      setReason('');
      setError('');
      setPending(context || {});
    }));
    return () => setElevationHandler(null);
  }, []);

  function finish(value) {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    setPassword('');
    setReason('');
    if (resolve) resolve(value);
  }

  function submit(e) {
    e.preventDefault();
    if (!password) {
      setError('Enter your current password.');
      return;
    }
    if (reason.trim().length < MIN_REASON) {
      setError('Justification must be at least ' + MIN_REASON + ' characters.');
      return;
    }
    finish({ password, reason: reason.trim() });
  }

  if (!pending) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <b>🔐 Confirm this sensitive action</b>
          <button className="btn small secondary" onClick={() => finish(null)}>✕</button>
        </div>
        <form className="modal-body" style={{ padding: '20px 24px' }} onSubmit={submit}>
          <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 16, lineHeight: 1.6 }}>
            This action changes protected data, so it needs your password and a short
            justification. Both are recorded in the security audit log.
          </div>
          <div className="field">
            <label>Current password</label>
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Reason (minimum {MIN_REASON} characters)</label>
            <textarea
              className="input"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why this change is needed"
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              {reason.trim().length} / {MIN_REASON}
            </div>
          </div>
          {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => finish(null)}>Cancel</button>
            <button type="submit" className="btn" style={{ flex: 1 }}>Confirm and continue</button>
          </div>
        </form>
      </div>
    </div>
  );
}
