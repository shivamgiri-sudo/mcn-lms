import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import CoordLogin from './CoordLogin.jsx';
import CoordDashboard from './CoordDashboard.jsx';

export default function CoordinatorPage() {
  const [session, setSession] = useState(localStorage.getItem('lms_token_coordinator') || '');
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (session) loadProfile();
    const handler = () => { clearToken('coordinator'); setSession(''); setUser(null); };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function loadProfile() {
    const res = await api.get('/auth/me', 'coordinator');
    if (!res.ok) { clearToken('coordinator'); setSession(''); }
  }

  function handleLogin(data) {
    setToken('coordinator', data.token);
    setSession(data.token);
    setUser(data.user);
  }

  function handleLogout() {
    api.post('/auth/coordinator/logout', {}, 'coordinator');
    clearToken('coordinator');
    setSession('');
    setUser(null);
  }

  if (!session) return <CoordLogin onLogin={handleLogin} />;
  return <CoordDashboard user={user} onLogout={handleLogout} />;
}
