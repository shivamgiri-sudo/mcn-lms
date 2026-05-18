import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import LoginView from './LoginView.jsx';
import DashboardView from './DashboardView.jsx';

export default function TraineePage() {
  const [session, setSession] = useState(localStorage.getItem('lms_token_trainee') || '');
  const [dashboard, setDashboard] = useState(null);
  const [forceReset, setForceReset] = useState(false);
  const [loading, setLoading] = useState(!!localStorage.getItem('lms_token_trainee'));

  useEffect(() => {
    if (session) loadDashboard();
    const handler = () => { clearToken('trainee'); setSession(''); setDashboard(null); };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function loadDashboard() {
    setLoading(true);
    const res = await api.get('/trainee/dashboard', 'trainee');
    setLoading(false);
    if (res.ok) setDashboard(res.dashboard);
    else { clearToken('trainee'); setSession(''); }
  }

  async function handleLogin(loginData) {
    setToken('trainee', loginData.token);
    setSession(loginData.token);
    setForceReset(loginData.forcePasswordReset);
    await loadDashboard();
  }

  function handleLogout() {
    clearToken('trainee');
    setSession('');
    setDashboard(null);
  }

  if (!session) return <LoginView onLogin={handleLogin} />;
  if (loading) return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  if (dashboard) return <DashboardView dashboard={dashboard} forceReset={forceReset} onLogout={handleLogout} onRefresh={loadDashboard} />;
  return null;
}
