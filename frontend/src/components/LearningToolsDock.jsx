import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './learningToolsDock.css';

const ROLE_TOKENS = {
  trainee: 'lms_token_trainee',
  coordinator: 'lms_token_coordinator',
  admin: 'lms_token_admin',
};

const ROLE_LABELS = {
  trainee: 'Learner',
  coordinator: 'Coordinator',
  admin: 'Administrator',
};

const TOOLS = [
  {
    key: 'calendar',
    title: 'Live Training',
    description: 'Sessions, capacity, waitlists and attendance',
    icon: '◫',
    href: role => `/training-calendar?role=${role}`,
  },
  {
    key: 'development',
    title: 'Development Hub',
    description: 'Coaching, goals and certification renewal',
    icon: '↗',
    href: role => `/development-hub?role=${role}`,
  },
  {
    key: 'practical',
    title: 'Practical Assessments',
    description: 'Evidence, rubrics, evaluation and moderation',
    icon: '✓',
    href: role => `/practical-assessments?role=${role}`,
  },
];

function roleFromPath(pathname, available) {
  if (pathname.startsWith('/lms')) return available.includes('trainee') ? 'trainee' : available[0];
  if (pathname.startsWith('/coordinator')) return available.includes('coordinator') ? 'coordinator' : available[0];
  if (pathname.startsWith('/admin')) return available.includes('admin') ? 'admin' : available[0];
  return available[0];
}

export default function LearningToolsDock() {
  const location = useLocation();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const available = useMemo(
    () => Object.entries(ROLE_TOKENS)
      .filter(([, token]) => Boolean(localStorage.getItem(token)))
      .map(([role]) => role),
    [location.pathname, sessionVersion],
  );
  const [role, setRole] = useState(() => roleFromPath(location.pathname, available));

  useEffect(() => {
    function refreshSessions() {
      setSessionVersion(value => value + 1);
    }
    window.addEventListener('lms:token-changed', refreshSessions);
    window.addEventListener('storage', refreshSessions);
    return () => {
      window.removeEventListener('lms:token-changed', refreshSessions);
      window.removeEventListener('storage', refreshSessions);
    };
  }, []);

  useEffect(() => {
    const next = roleFromPath(location.pathname, available);
    if (next && !available.includes(role)) setRole(next);
    if (!available.length || location.pathname === '/reset-password') setOpen(false);
  }, [location.pathname, sessionVersion, role, available]);

  useEffect(() => {
    function closeOnOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  if (!available.length || location.pathname === '/reset-password') return null;
  const activeRole = available.includes(role) ? role : available[0];

  return (
    <div className="learning-tools-dock" ref={rootRef}>
      {open && <section className="learning-tools-panel" aria-label="Learning tools">
        <header>
          <div><span>MCN LMS</span><b>Learning tools</b></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close learning tools">×</button>
        </header>
        {available.length > 1 && <label>
          Open as
          <select value={activeRole} onChange={event => setRole(event.target.value)}>
            {available.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
          </select>
        </label>}
        <nav>
          {TOOLS.map(tool => <a key={tool.key} href={tool.href(activeRole)} onClick={() => setOpen(false)}>
            <i>{tool.icon}</i>
            <span><b>{tool.title}</b><small>{tool.description}</small></span>
            <strong>›</strong>
          </a>)}
        </nav>
        <footer>{ROLE_LABELS[activeRole]} session · No separate sign-in</footer>
      </section>}
      <button
        type="button"
        className="learning-tools-fab"
        aria-label="Open learning tools"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span>⌘</span><b>Learning</b>
      </button>
    </div>
  );
}
