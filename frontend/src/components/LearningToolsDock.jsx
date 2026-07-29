import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './learningToolsDock.css';

// These keys contain non-sensitive cookie-session presence markers only.
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
    roles: ['trainee', 'coordinator', 'admin'],
    href: role => `/training-calendar?role=${role}`,
  },
  {
    key: 'development',
    title: 'Development Hub',
    description: 'Coaching, goals and certification renewal',
    icon: '↗',
    roles: ['trainee', 'coordinator', 'admin'],
    href: role => `/development-hub?role=${role}`,
  },
  {
    key: 'practical',
    title: 'Practical Assessments',
    description: 'Evidence, rubrics, evaluation and moderation',
    icon: '✓',
    roles: ['trainee', 'coordinator', 'admin'],
    href: role => `/practical-assessments?role=${role}`,
  },
  {
    key: 'evaluator-quality',
    title: 'Evaluator Quality',
    description: 'Calibration, authorization and reliability',
    icon: '◎',
    roles: ['coordinator', 'admin'],
    href: role => `/evaluator-quality?role=${role}`,
  },
  {
    key: 'assessment-intelligence',
    title: 'Assessment Intelligence',
    description: 'Blueprints, item quality and remediation evidence',
    icon: '◇',
    roles: ['coordinator', 'admin'],
    href: role => `/assessment-intelligence?role=${role}`,
  },
  {
    key: 'session-security',
    title: 'Sessions & Security',
    description: 'Devices, sign-outs and account protection',
    icon: '⌾',
    roles: ['trainee', 'coordinator', 'admin'],
    href: role => `/session-security?role=${role}`,
  },
];

function portalRoleFromPath(pathname, available) {
  if (pathname.startsWith('/lms') && available.includes('trainee')) return 'trainee';
  if (pathname.startsWith('/coordinator') && available.includes('coordinator')) return 'coordinator';
  if (pathname.startsWith('/admin') && available.includes('admin')) return 'admin';
  return null;
}

export default function LearningToolsDock() {
  const location = useLocation();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const available = useMemo(
    () => Object.entries(ROLE_TOKENS)
      .filter(([, marker]) => Boolean(localStorage.getItem(marker)))
      .map(([role]) => role),
    [location.pathname, sessionVersion],
  );
  const [role, setRole] = useState(() => portalRoleFromPath(location.pathname, available) || available[0]);

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
    const portalRole = portalRoleFromPath(location.pathname, available);
    if (portalRole && portalRole !== role) setRole(portalRole);
    else if (!available.includes(role) && available[0]) setRole(available[0]);
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
  const visibleTools = TOOLS.filter(tool => tool.roles.includes(activeRole));

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
          {visibleTools.map(tool => <a key={tool.key} href={tool.href(activeRole)} onClick={() => setOpen(false)}>
            <i>{tool.icon}</i>
            <span><b>{tool.title}</b><small>{tool.description}</small></span>
            <strong>›</strong>
          </a>)}
        </nav>
        <footer>{ROLE_LABELS[activeRole]} session · HttpOnly cookie protected</footer>
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
