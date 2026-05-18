import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import MgmtLogin from './MgmtLogin.jsx';
import MgmtDashboard from './MgmtDashboard.jsx';

export default function ManagementPage() {
  const [session, setSession] = useState(localStorage.getItem('lms_token_management') || '');

  useEffect(() => {
    if (session) checkSession();
    const handler = () => { clearToken('management'); setSession(''); };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function checkSession() {
    const res = await api.get('/auth/me', 'management');
    if (!res.ok) { clearToken('management'); setSession(''); }
  }

  function handleLogin(data) {
    setToken('management', data.token);
    setSession(data.token);
  }

  function handleLogout() {
    clearToken('management');
    setSession('');
  }

  if (!session) return <MgmtLogin onLogin={handleLogin} />;
  return <MgmtDashboard onLogout={handleLogout} />;
}
