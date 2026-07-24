import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import CoordLogin from './CoordLogin.jsx';
import CoordDashboard from './CoordDashboard.jsx';

export default function CoordinatorPage() {
  const [session, setSession] = useState(localStorage.getItem('lms_token_coordinator') || '');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem('lms_token_coordinator'));

  useEffect(() => {
    if (session) loadProfile();
    const handler = () => {
      clearToken('coordinator');
      setSession('');
      setUser(null);
      setLoading(false);
    };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function loadProfile() {
    setLoading(true);
    const res = await api.get('/auth/me', 'coordinator');
    setLoading(false);
    if (res.ok && res.user) {
      setUser(res.user);
      return;
    }
    clearToken('coordinator');
    setSession('');
    setUser(null);
  }

  function handleLogin(data) {
    setToken('coordinator', data.token);
    setSession(data.token);
    setUser(data.user);
  }

  function handleLogout() {
    api.post('/auth/coordinator/logout', {}, 'coordinator').catch(() => {});
    clearToken('coordinator');
    setSession('');
    setUser(null);
  }

  if (!session) return <CoordLogin onLogin={handleLogin} />;
  if (loading) return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  return <CoordDashboard user={user} onLogout={handleLogout} />;
}
