import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import AdminLogin from './AdminLogin.jsx';
import AdminConsole from './AdminConsole.jsx';

export default function AdminPage() {
  const [session, setSession] = useState('checking');
  const [user, setUser] = useState(null);

  useEffect(() => {
    checkSession();
    const handler = event => {
      if (event.detail?.type && event.detail.type !== 'admin') return;
      clearToken('admin');
      setSession('none');
      setUser(null);
    };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function checkSession() {
    const res = await api.get('/auth/me', 'admin');
    if (res.ok) {
      setToken('admin');
      setSession('active');
      setUser(res.user);
      return;
    }
    clearToken('admin');
    setSession('none');
    setUser(null);
  }

  function handleLogin(data) {
    setToken('admin');
    setSession('active');
    setUser(data.user);
  }

  async function handleLogout() {
    await api.post('/auth/admin/logout', {}, 'admin').catch(() => {});
    clearToken('admin');
    setSession('none');
    setUser(null);
  }

  if (session === 'checking') return <div className="wrap" style={{ paddingTop: 60, textAlign: 'center' }}><div className="spinner" /></div>;
  if (session === 'none') return <AdminLogin onLogin={handleLogin} />;
  return <AdminConsole user={user} onLogout={handleLogout} />;
}
