import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from '../../utils/browserRouter.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import LearnerDevelopmentView from './LearnerDevelopmentView.jsx';
import CoordinatorDevelopmentView from './CoordinatorDevelopmentView.jsx';
import AdminDevelopmentView from './AdminDevelopmentView.jsx';
import './developmentHub.css';
import './developmentOperations.css';

const ROLE_CONFIG = {
  trainee: { label: 'My Development', token: 'lms_token_trainee', portal: '/lms' },
  coordinator: { label: 'Team Development', token: 'lms_token_coordinator', portal: '/coordinator' },
  admin: { label: 'Development Governance', token: 'lms_token_admin', portal: '/admin' },
};

export default function DevelopmentHubPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [params, setParams] = useSearchParams();
  const available = useMemo(() => Object.entries(ROLE_CONFIG).filter(([, config]) => localStorage.getItem(config.token)).map(([role]) => role), []);
  const requested = params.get('role');
  const initialRole = available.includes(requested) ? requested : available[0] || '';
  const [role, setRole] = useState(initialRole);

  if (!available.length) {
    return (
      <div className="dev-hub-login">
        <div><span>MCN LMS</span><h1>Development Hub</h1><p>Sign in through your LMS portal first. The hub uses your existing secure role session and never asks for separate credentials.</p><div><a href="/lms">Learner login</a><a href="/coordinator">Coordinator login</a><a href="/admin">Administrator login</a></div></div>
      </div>
    );
  }

  if (!ROLE_CONFIG[role]) return <Navigate to="/" replace />;

  function changeRole(nextRole) {
    setRole(nextRole);
    setParams({ role: nextRole }, { replace: true });
  }

  return (
    <main className="dev-hub-shell">
      <header className="dev-hub-header">
        <div><div className="dev-hub-logo">DEV</div><div><b>MCN Development Hub</b><span>Coaching · Skills · Credentials · Renewal</span></div></div>
        <div>
          {available.length > 1 && <select value={role} onChange={event => changeRole(event.target.value)}>{available.map(item => <option key={item} value={item}>{ROLE_CONFIG[item].label}</option>)}</select>}
          <a href={ROLE_CONFIG[role].portal}>Back to portal</a>
          <button onClick={toggleTheme} title="Toggle appearance">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </header>
      <div className="dev-hub-content">
        {role === 'trainee' && <LearnerDevelopmentView />}
        {role === 'coordinator' && <CoordinatorDevelopmentView />}
        {role === 'admin' && <AdminDevelopmentView />}
      </div>
    </main>
  );
}
