import { useState, useEffect } from 'react';
import { api, setToken, clearToken } from '../../utils/api.js';
import AdminLogin from './AdminLogin.jsx';
import AdminConsole from './AdminConsole.jsx';

export default function AdminPage() {
  const [session, setSession] = useState(localStorage.getItem('lms_token_admin') || '');
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (session) checkSession();
    const handler = () => { clearToken('admin'); setSession(''); setUser(null); };
    window.addEventListener('lms:session-expired', handler);
    return () => window.removeEventListener('lms:session-expired', handler);
  }, []);

  async function checkSession() {
    const res = await api.get('/auth/me', 'admin');
    if (res.ok) setUser(res.user);
    else { clearToken('admin'); setSession(''); }
  }

  function handleLogin(data) {
    setToken('admin', data.token);
    setSession(data.token);
    setUser(data.user);
  }

  async function handleLogout() {
    await api.post('/auth/admin/logout', {}, 'admin').catch(() => {});
    clearToken('admin');
    setSession('');
    setUser(null);
  }

  if (!session) return <AdminLogin onLogin={handleLogin} />;
  return <AdminConsole user={user} onLogout={handleLogout} />;
}
