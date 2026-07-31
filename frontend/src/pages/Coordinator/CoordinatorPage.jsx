import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import CoordLogin from './CoordLogin.jsx';
import CoordDashboard from './CoordDashboard.jsx';

export default function CoordinatorPage() {
  const [session, setSession] = useState('checking');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
    const handler = event => {
      if (event.detail?.type && event.detail.type !== 'coordinator') return;
      clearToken('coordinator');
      setSession('none');
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
      setToken('coordinator');
      setSession('active');
      setUser(res.user);
      return;
    }
    clearToken('coordinator');
    setSession('none');
    setUser(null);
  }

  function handleLogin(data) {
    setToken('coordinator');
    setSession('active');
    setUser(data.user);
  }

  async function handleLogout() {
    await api.post('/auth/coordinator/logout', {}, 'coordinator').catch(() => {});
    clearToken('coordinator');
    setSession('none');
    setUser(null);
  }

  if (session === 'checking' || loading) return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  if (session === 'none') return <CoordLogin onLogin={handleLogin} />;
  return <CoordDashboard user={user} onLogout={handleLogout} />;
}
