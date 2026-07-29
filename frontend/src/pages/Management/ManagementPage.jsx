import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import MgmtLogin from './MgmtLogin.jsx';
import MgmtDashboard from './MgmtDashboard.jsx';

export default function ManagementPage() {
  const [session, setSession] = useState('checking');

  useEffect(() => {
    checkSession();
    const handler = event => {
      if (event.detail?.type && !['management', 'coordinator'].includes(event.detail.type)) return;
      clearToken('management');
      setSession('none');
    };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function checkSession() {
    const res = await api.get('/auth/me', 'management');
    if (res.ok) {
      const allowed = res.user?.canViewManagementDashboard
        || res.user?.role === 'CEO'
        || res.user?.role === 'Super Admin';
      if (allowed) {
        setToken('management');
        setSession('active');
        return;
      }
    }
    clearToken('management');
    setSession('none');
  }

  function handleLogin() {
    setToken('management');
    setSession('active');
  }

  async function handleLogout() {
    await api.post('/auth/coordinator/logout', {}, 'management').catch(() => {});
    clearToken('management');
    setSession('none');
  }

  if (session === 'checking') return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  if (session === 'none') return <MgmtLogin onLogin={handleLogin} />;
  return <MgmtDashboard onLogout={handleLogout} />;
}
