import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import LoginView from './LoginView.jsx';
import DashboardView from './DashboardView.jsx';

export default function TraineePage() {
  const [session, setSession] = useState(localStorage.getItem('lms_token_trainee') || '');
  const [dashboard, setDashboard] = useState(null);
  const [forceReset, setForceReset] = useState(false);
  const [loading, setLoading] = useState(!!localStorage.getItem('lms_token_trainee'));
  const [error, setError] = useState('');

  useEffect(() => {
    if (session) loadDashboard();
    const handler = () => { clearToken('trainee'); setSession(''); setDashboard(null); setForceReset(false); };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError('');

    const [profileRes, dashboardRes] = await Promise.all([
      api.get('/auth/me', 'trainee'),
      api.get('/trainee/dashboard', 'trainee'),
    ]);

    setLoading(false);

    if (profileRes.ok) {
      setForceReset(Boolean(profileRes.user?.forcePasswordReset));
    }

    if (dashboardRes.ok) {
      setDashboard(dashboardRes.dashboard);
      return;
    }

    if (dashboardRes.networkError) {
      setError(dashboardRes.message || 'Unable to connect to LMS server.');
      return;
    }

    clearToken('trainee');
    setSession('');
    setDashboard(null);
    setForceReset(false);
  }

  async function handleLogin(loginData) {
    setToken('trainee', loginData.token);
    setSession(loginData.token);
    setForceReset(Boolean(loginData.forcePasswordReset));
    await loadDashboard();
  }

  function handleLogout() {
    api.post('/auth/trainee/logout', {}, 'trainee').catch(() => {});
    clearToken('trainee');
    setSession('');
    setDashboard(null);
    setForceReset(false);
  }

  if (!session) return <LoginView onLogin={handleLogin} />;
  if (loading) return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  if (error) {
    return (
      <div className="wrap" style={{ paddingTop: 60, maxWidth: 560 }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginBottom: 8 }}>LMS connection issue</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>{error}</p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn accent" onClick={loadDashboard}>Retry</button>
            <button className="btn secondary" onClick={handleLogout}>Back to Login</button>
          </div>
        </div>
      </div>
    );
  }
  if (dashboard) return <DashboardView dashboard={dashboard} forceReset={forceReset} onLogout={handleLogout} onRefresh={loadDashboard} />;
  return null;
}
