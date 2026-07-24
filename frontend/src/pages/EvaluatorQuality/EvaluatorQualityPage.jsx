import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext.jsx';
import EvaluatorSelfView from './EvaluatorSelfView.jsx';
import EvaluatorQualityAdminView from './EvaluatorQualityAdminView.jsx';
import './evaluatorQuality.css';

const ROLES = {
  coordinator: { token: 'lms_token_coordinator', label: 'Evaluator workspace', portal: '/coordinator' },
  admin: { token: 'lms_token_admin', label: 'Quality governance', portal: '/admin' },
};

export default function EvaluatorQualityPage() {
  const { theme, toggle } = useTheme();
  const [params, setParams] = useSearchParams();
  const available = useMemo(
    () => Object.entries(ROLES).filter(([, item]) => localStorage.getItem(item.token)).map(([role]) => role),
    [],
  );
  const requested = params.get('role');
  const [role, setRole] = useState(available.includes(requested) ? requested : available[0] || '');

  if (!available.length) {
    return <main className="quality-login"><section><span>MCN LMS</span><h1>Evaluator Quality</h1><p>Sign in through the coordinator or administrator portal to access calibration and reliability governance.</p><div><a href="/coordinator">Coordinator login</a><a href="/admin">Administrator login</a></div></section></main>;
  }

  function changeRole(nextRole) {
    setRole(nextRole);
    setParams({ role: nextRole }, { replace: true });
  }

  return (
    <main className="quality-shell">
      <header className="quality-header">
        <div className="quality-brand"><div>EQ</div><section><b>Evaluator Quality</b><span>Calibration · Authorization · Reliability</span></section></div>
        <nav>
          {available.length > 1 && <select value={role} onChange={event => changeRole(event.target.value)}>{available.map(item => <option key={item} value={item}>{ROLES[item].label}</option>)}</select>}
          <a href={ROLES[role]?.portal || '/'}>Back to portal</a>
          <button onClick={toggle}>{theme === 'dark' ? '☀️' : '🌙'}</button>
        </nav>
      </header>
      <div className="quality-content">
        {role === 'coordinator' && <EvaluatorSelfView role="coordinator" />}
        {role === 'admin' && <EvaluatorQualityAdminView />}
      </div>
    </main>
  );
}
