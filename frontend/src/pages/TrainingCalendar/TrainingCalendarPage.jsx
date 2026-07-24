import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext.jsx';
import LearnerCalendarView from './LearnerCalendarView.jsx';
import OperationsCalendarView from './OperationsCalendarView.jsx';
import './trainingCalendar.css';

const ROLE_CONFIG = {
  trainee: { label: 'My Live Learning', token: 'lms_token_trainee', portal: '/lms' },
  coordinator: { label: 'Batch Calendar', token: 'lms_token_coordinator', portal: '/coordinator' },
  admin: { label: 'Training Governance', token: 'lms_token_admin', portal: '/admin' },
};

export default function TrainingCalendarPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [params, setParams] = useSearchParams();
  const available = useMemo(
    () => Object.entries(ROLE_CONFIG).filter(([, config]) => localStorage.getItem(config.token)).map(([role]) => role),
    [],
  );
  const requested = params.get('role');
  const [role, setRole] = useState(available.includes(requested) ? requested : available[0] || '');

  if (!available.length) {
    return (
      <main className="ilt-login-shell">
        <section>
          <span>MCN LMS</span>
          <h1>Live Training Calendar</h1>
          <p>Sign in through your LMS portal first. This calendar reuses your existing secure role session.</p>
          <div><a href="/lms">Learner login</a><a href="/coordinator">Coordinator login</a><a href="/admin">Administrator login</a></div>
        </section>
      </main>
    );
  }

  if (!ROLE_CONFIG[role]) return <Navigate to="/" replace />;

  function changeRole(nextRole) {
    setRole(nextRole);
    setParams({ role: nextRole }, { replace: true });
  }

  return (
    <main className="ilt-shell">
      <header className="ilt-header">
        <div className="ilt-brand"><div>LIVE</div><section><b>MCN Training Calendar</b><span>Instructor-led learning · Capacity · Attendance · Evidence</span></section></div>
        <nav>
          {available.length > 1 && <select value={role} onChange={event => changeRole(event.target.value)}>{available.map(item => <option key={item} value={item}>{ROLE_CONFIG[item].label}</option>)}</select>}
          <a href={ROLE_CONFIG[role].portal}>Back to portal</a>
          <button onClick={toggleTheme} title="Toggle appearance">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </nav>
      </header>
      <div className="ilt-content">
        {role === 'trainee' && <LearnerCalendarView />}
        {role === 'coordinator' && <OperationsCalendarView role="coordinator" />}
        {role === 'admin' && <OperationsCalendarView role="admin" />}
      </div>
    </main>
  );
}
