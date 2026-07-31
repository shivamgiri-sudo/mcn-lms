import { useState, useEffect } from 'react';
import { api, setToken, clearToken, hasSessionMarker } from '../../utils/api.js';
import LoginView from './LoginView.jsx';
import DashboardView from './DashboardView.jsx';

export default function TraineePage() {
  const [session, setSession] = useState('checking');
  const [dashboard, setDashboard] = useState(null);
  const [forceReset, setForceReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboard({ initial: true });
    const handler = event => {
      if (event.detail?.type && event.detail.type !== 'trainee') return;
      clearToken('trainee');
      setSession('none');
      setDashboard(null);
      setForceReset(false);
      setLoading(false);
    };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function loadDashboard({ initial = false } = {}) {
    setLoading(true);
    setError('');

    const [profileRes, dashboardRes] = await Promise.all([
      api.get('/auth/me', 'trainee'),
      api.get('/trainee/dashboard', 'trainee'),
    ]);

    setLoading(false);

    if (profileRes.ok && dashboardRes.ok) {
      setToken('trainee');
      setSession('active');
      setForceReset(Boolean(profileRes.user?.forcePasswordReset));
      setDashboard(dashboardRes.dashboard);
      return;
    }

    if (profileRes.networkError || dashboardRes.networkError) {
      const hadKnownSession = hasSessionMarker('trainee');
      if (hadKnownSession || !initial) {
        setSession('active');
        setError(profileRes.message || dashboardRes.message || 'Unable to connect to LMS server.');
        return;
      }
    }

    clearToken('trainee');
    setSession('none');
    setDashboard(null);
    setForceReset(false);
  }

  async function handleLogin(loginData) {
    setToken('trainee');
    setSession('active');
    setForceReset(Boolean(loginData.forcePasswordReset));
    await loadDashboard();
  }

  async function handleLogout() {
    await api.post('/auth/trainee/logout', {}, 'trainee').catch(() => {});
    clearToken('trainee');
    setSession('none');
    setDashboard(null);
    setForceReset(false);
  }

  if (session === 'checking' || loading) return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  if (session === 'none') return <LoginView onLogin={handleLogin} />;
  if (error) {
    return (
      <div className="wrap" style={{ paddingTop: 60, maxWidth: 560 }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginBottom: 8 }}>LMS connection issue</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>{error}</p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn accent" onClick={() => loadDashboard()}>Retry</button>
            <button className="btn secondary" onClick={handleLogout}>Back to Login</button>
          </div>
        </div>
      </div>
    );
  }
  if (dashboard) return <DashboardView dashboard={dashboard} forceReset={forceReset} onLogout={handleLogout} onRefresh={() => loadDashboard()} />;
  return null;
}
