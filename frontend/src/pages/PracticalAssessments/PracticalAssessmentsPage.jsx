import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from '../../utils/browserRouter.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import LearnerPracticalView from './LearnerPracticalView.jsx';
import OperationsPracticalView from './OperationsPracticalView.jsx';
import './practicalAssessments.css';

const ROLE_CONFIG = {
  trainee: { label: 'My Practical Assessments', token: 'lms_token_trainee', portal: '/lms' },
  coordinator: { label: 'Evaluation Workspace', token: 'lms_token_coordinator', portal: '/coordinator' },
  admin: { label: 'Assessment Governance', token: 'lms_token_admin', portal: '/admin' },
};

export default function PracticalAssessmentsPage() {
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
      <main className="practical-login-shell">
        <section>
          <span>MCN LMS</span>
          <h1>Practical Assessment Studio</h1>
          <p>Sign in through your LMS portal first. Rubric evaluation reuses your existing secure role session.</p>
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
    <main className="practical-shell">
      <header className="practical-header">
        <div className="practical-brand"><div>PA</div><section><b>MCN Practical Assessment Studio</b><span>Rubrics · Observation · Moderation · Skill evidence</span></section></div>
        <nav>
          {available.length > 1 && <select value={role} onChange={event => changeRole(event.target.value)}>{available.map(item => <option key={item} value={item}>{ROLE_CONFIG[item].label}</option>)}</select>}
          <a href={ROLE_CONFIG[role].portal}>Back to portal</a>
          <button onClick={toggleTheme} title="Toggle appearance">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </nav>
      </header>
      <div className="practical-content">
        {role === 'trainee' && <LearnerPracticalView />}
        {role === 'coordinator' && <OperationsPracticalView role="coordinator" />}
        {role === 'admin' && <OperationsPracticalView role="admin" />}
      </div>
    </main>
  );
}
