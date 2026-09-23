import { useState, useEffect, Component } from 'react';
import { api } from '../../utils/api.js';
import { formatSeconds, pct } from '../../utils/format.js';
import { useTheme } from '../../context/ThemeContext.jsx';

class TypingErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ borderLeft: '4px solid var(--bad)', padding: '18px 20px' }}>
          <b style={{ color: 'var(--bad)' }}>Typing Practice failed to load</b>
          <pre style={{ fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import LearningJourneyTab from './LearningJourneyTab.jsx';
import SkillsPathsTab from './SkillsPathsTab.jsx';
import LearningTab from './LearningTab.jsx';
import AssignedTab from './AssignedTab.jsx';
import QATab from './QATab.jsx';
import ProfileTab from './ProfileTab.jsx';
import LeaderboardTab from './LeaderboardTab.jsx';
import IJPTab from './IJPTab.jsx';
import VoiceAccentTab from './VoiceAccentTab.jsx';
import TypingPracticeTab from './TypingPracticeTab.jsx';
import DailyTypingTestTab from './DailyTypingTestTab.jsx';
import PasswordResetBox from './PasswordResetBox.jsx';
import TrainingCalendarEntryCard from '../TrainingCalendar/TrainingCalendarEntryCard.jsx';

export default function DashboardView({ dashboard, forceReset, onLogout, onRefresh }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('journey');
  const [showForceReset, setShowForceReset] = useState(forceReset);
  const [typingStats, setTypingStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/typing/me/stats', 'trainee').then(res => {
      if (!cancelled && res.ok) setTypingStats(res.data);
    });
    return () => { cancelled = true; };
  }, []);

  const d = dashboard || {};
  const t = d.trainee || {};
  const c = d.classroom || {};
  const s = d.summary || {};
  const overall = s.overallTrainingProgress || 0;
  const totalSecs = s.totalSecondsSpent || 0;

  // Assigned and broadcast content lives on the My Learning tab, but the portal
  // opens on My Journey — so without a count here, a learner has no way to know
  // something new was assigned to them.
  const assignedItems = (d.directAssignments || []).flatMap(a => (a.contents || []).map(c => ({ ...c, moduleName: a.moduleName })));
  const assignedPending = assignedItems.filter(c => (c.progress?.completionStatus || 'Not Started') !== 'Completed');

  const tabs = [
    { id: 'journey', label: '🧭 My Journey' },
    { id: 'talent', label: '🎯 Skills & Paths' },
    { id: 'live-training', label: '🗓️ Live Training' },
    { id: 'learning', label: '📚 Curriculum' },
    { id: 'assigned', label: '📢 Assigned', badge: assignedPending.length },
    { id: 'qa', label: '💬 Q&A' },
    { id: 'leaderboard', label: '🏆 Leaderboard' },
    { id: 'ijp', label: '🚀 Internal Jobs' },
    { id: 'voice-accent', label: '🎙️ Voice & Accent' },
    { id: 'typing', label: '⌨️ Typing Practice' },
    { id: 'typing-test', label: '📝 Daily Typing Test' },
    { id: 'profile', label: '👤 Profile' },
  ];

  const kpis = [
    { label: 'Overall Progress', value: `${overall}%`, cls: 'accent', w: overall },
    { label: 'Course Completion', value: pct(s.completionPercent), note: `${s.completedContents || 0}/${s.totalContents || 0} done`, cls: 'ok', w: s.completionPercent || 0 },
    { label: 'MCQ Completion', value: pct(s.mcqCompletionPercent), note: `${s.attemptedAssessments || 0}/${s.totalAssessments || 0} attempted`, cls: 'warn', w: s.mcqCompletionPercent || 0 },
    { label: 'Best MCQ Score', value: s.bestMcqScore != null ? `${Math.round(s.bestMcqScore)}%` : '—', note: s.bestMcqScore != null ? `${s.passedAssessments || 0} passed` : 'No attempt yet', cls: s.bestMcqScore == null ? '' : s.bestMcqScore >= 60 ? 'ok' : 'bad', w: s.bestMcqScore || 0 },
  ];

  const kpiColor = cls => cls === 'ok' ? 'var(--ok)' : cls === 'warn' ? 'var(--warn)' : cls === 'bad' ? 'var(--bad)' : 'var(--accent)';

  useEffect(() => {
    if (activeTab !== 'typing') return;
    const id = setTimeout(() => {
      document.getElementById('typing-textarea')?.focus();
    }, 120);
    return () => clearTimeout(id);
  }, [activeTab]);

  return (
    <div className="td-shell">

      {/* ── Left Sidebar ─────────────────────────────── */}
      <aside className="td-sidebar">

        {/* Brand */}
        <div className="td-brand">
          <div className="logo" style={{ width: 34, height: 34, fontSize: 11 }}>LMS</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: '-.02em', lineHeight: 1.1 }}>MCN Learning Hub</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Learn · Practice · Grow</div>
          </div>
        </div>

        {/* Profile strip */}
        <div className="td-profile">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>
              {(t.name || t.employeeId || '?')[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name || t.employeeId}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.process || c.classroomName || 'Trainee'}</div>
            </div>
            <span className="pill ok" style={{ fontSize: 10, padding: '2px 7px', marginLeft: 'auto', flexShrink: 0 }}>Active</span>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
            <span>Overall Progress</span><span style={{ color: 'var(--accent)' }}>{overall}%</span>
          </div>
          <div className="progress-shell" style={{ height: 6, marginTop: 0 }}><div className="progress-bar" style={{ width: `${overall}%` }} /></div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span>{formatSeconds(totalSecs)} verified</span>
            {t.batchNo && <span>· Batch {t.batchNo}</span>}
            {t.branch && <span>· {t.branch}</span>}
          </div>
        </div>

        {/* KPI cockpit */}
        <div className="td-section-label">Performance</div>
        {!dashboard ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {kpis.map(kpi => (
              <div key={kpi.label} className="td-kpi">
                <div className="td-kpi-val" style={{ color: kpiColor(kpi.cls) }}>{kpi.value}</div>
                <div className="td-kpi-lbl">{kpi.label}</div>
              </div>
            ))}
            {typingStats && (
              <div className="td-kpi" style={{ cursor: 'pointer', gridColumn: 'span 2' }} onClick={() => setActiveTab('typing')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div className="td-kpi-val" style={{ color: typingStats.todayBestWpm >= 60 ? 'var(--ok)' : typingStats.todayBestWpm >= 40 ? 'var(--warn)' : 'var(--ink)' }}>
                    {typingStats.todayBestWpm != null ? `${typingStats.todayBestWpm} WPM` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{typingStats.currentStreak}d streak</div>
                </div>
                <div className="td-kpi-lbl">⌨️ Typing (today)</div>
              </div>
            )}
          </div>
        )}

        {/* Bottom actions */}
        <div className="td-footer">
          <button className="btn small secondary" style={{ flex: 1 }} onClick={onRefresh}>↺ Refresh</button>
          <button onClick={toggleTheme} title="Toggle theme" style={{ background: 'none', border: '1.5px solid var(--line)', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', fontSize: 14, color: 'var(--muted)' }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="btn small secondary" onClick={onLogout}>Logout</button>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────── */}
      <main className="td-main">
        {showForceReset && <PasswordResetBox onDone={() => setShowForceReset(false)} />}

        {/* Horizontal tab bar */}
        <div className="td-tabbar" role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`td-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.badge > 0 && <span className="td-badge">{tab.badge}</span>}
            </button>
          ))}
        </div>

        <div className="td-content">
          {activeTab === 'journey' && assignedPending.length > 0 && (
            <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid #ef4444' }}>
              <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <b>📢 Assigned to you: {assignedPending.length} item{assignedPending.length === 1 ? '' : 's'} to complete</b>
                <button className="btn small" onClick={() => setActiveTab('learning')}>Open My Learning →</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {assignedPending.slice(0, 6).map((c, index) => (
                  <span key={c.repositoryContentId || c.contentId || index} className="pill info" style={{ fontSize: 11 }}>
                    {c.contentTitle || c.title}
                  </span>
                ))}
                {assignedPending.length > 6 && <span className="pill" style={{ fontSize: 11 }}>+{assignedPending.length - 6} more</span>}
              </div>
            </div>
          )}

          {activeTab === 'journey' && <LearningJourneyTab onNavigate={setActiveTab} />}
          {activeTab === 'talent' && <SkillsPathsTab />}
          {activeTab === 'live-training' && <TrainingCalendarEntryCard role="trainee" />}
          {activeTab === 'learning' && <LearningTab days={d.days || []} onRefresh={onRefresh} />}
          {activeTab === 'assigned' && <AssignedTab assignments={d.directAssignments || []} onRefresh={onRefresh} />}
          {activeTab === 'qa' && <QATab />}
          {activeTab === 'leaderboard' && <LeaderboardTab />}
          {activeTab === 'ijp' && <IJPTab />}
          {activeTab === 'voice-accent' && <VoiceAccentTab />}
          {activeTab === 'typing' && <TypingErrorBoundary><TypingPracticeTab /></TypingErrorBoundary>}
          {activeTab === 'typing-test' && <DailyTypingTestTab />}
          {activeTab === 'profile' && (
            <>
              <MyCertificates />
              <ProfileTab trainee={t} classroom={c} onRefresh={onRefresh} />
            </>
          )}
        </div>
      </main>

      <style>{`
        /* ── Trainee Dashboard Shell ── */
        .td-shell {
          display: grid;
          grid-template-columns: 240px 1fr;
          min-height: 100vh;
          background: var(--bg);
        }
        .td-sidebar {
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
          border-right: 1px solid var(--line);
          background: var(--bg);
          padding: 14px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          scrollbar-width: thin;
        }
        .td-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-bottom: 12px;
          margin-bottom: 10px;
          border-bottom: 1px solid var(--line);
        }
        .td-profile {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 10px 12px;
          margin-bottom: 10px;
        }
        .td-section-label {
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .07em;
          color: var(--muted);
          padding: 8px 4px 4px;
        }
        .td-batch {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 8px 12px;
          margin-bottom: 10px;
        }
        .td-batch-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 0;
          font-size: 12px;
          border-bottom: 1px solid var(--line);
        }
        .td-batch-row:last-child { border-bottom: none; }
        .td-batch-row span:first-child { color: var(--muted); }
        .td-batch-row span:last-child { font-weight: 700; }
        .td-kpi {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 8px 10px;
        }
        .td-kpi-val {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -.03em;
          line-height: 1.1;
          color: var(--ink);
        }
        .td-kpi-lbl {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .04em;
          color: var(--muted);
          margin-top: 2px;
        }
        .td-badge {
          background: #ef4444;
          color: #fff;
          border-radius: 99px;
          padding: 1px 6px;
          font-size: 10px;
          font-weight: 700;
          margin-left: 5px;
        }
        .td-footer {
          display: flex;
          gap: 6px;
          align-items: center;
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px solid var(--line);
        }
        .td-main {
          padding: 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .td-tabbar {
          display: flex;
          gap: 0;
          overflow-x: auto;
          border-bottom: 1px solid var(--line);
          background: var(--bg);
          position: sticky;
          top: 0;
          z-index: 10;
          scrollbar-width: none;
          flex-shrink: 0;
        }
        .td-tabbar::-webkit-scrollbar { display: none; }
        .td-tab {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          padding: 11px 16px;
          border: none;
          border-bottom: 3px solid transparent;
          background: transparent;
          color: var(--muted);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: color .12s, border-color .12s;
        }
        .td-tab:hover { color: var(--ink); }
        .td-tab.active {
          color: var(--brand);
          border-bottom-color: var(--brand);
        }
        .td-content {
          padding: 20px 28px;
          flex: 1;
        }
        @media (max-width: 820px) {
          .td-shell { grid-template-columns: 1fr; }
          .td-sidebar { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--line); }
          .td-content { padding: 14px 16px; }
          .td-tab { padding: 10px 12px; font-size: 12px; }
        }
      `}</style>
    </div>
  );
}

// A learner could not reach their own certificate at all. Entitlement is decided
// server-side from certification status and passed assessments, so this renders
// only what actually exists for them.
function MyCertificates() {
  const [certs, setCerts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/trainee/certificates', 'trainee').then(res => {
      if (!cancelled) setCerts(res.ok ? (res.data || []) : []);
    });
    return () => { cancelled = true; };
  }, []);

  async function fetchCertHtml(certificateNo) {
    const BASE = (import.meta.env.VITE_API_URL || '') + '/api';
    const res = await fetch(`${BASE}/trainee/certificates/${encodeURIComponent(certificateNo)}`, {
      credentials: 'include', headers: { 'X-LMS-Role': 'trainee' },
    });
    return res.ok ? res.text() : null;
  }

  async function openCertificate(certificateNo) {
    const html = await fetchCertHtml(certificateNo);
    if (!html) return;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  async function downloadCertificate(certificateNo) {
    const html = await fetchCertHtml(certificateNo);
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    // Give fonts time to load, then trigger print dialog for Save as PDF
    setTimeout(() => { w.focus(); w.print(); }, 1200);
  }

  if (!certs || !certs.length) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <b style={{ fontSize: 15 }}>🎓 My Certificates</b>
        <span style={{ fontSize: 11, background: "#eaf8ef", color: "#15803d", border: "1px solid #bbf7d0", borderRadius: 20, padding: "2px 10px", fontWeight: 700 }}>{certs.length} issued</span>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {certs.map(cert => (
          <div key={cert.certificateNo} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 8,
            background: 'linear-gradient(135deg,#edf4ff,#f0f4ff)',
            border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0d3c72' }}>{cert.title}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                {cert.type === 'ASSESSMENT' ? 'Assessment' : 'Training'} &nbsp;·&nbsp;
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#267abd' }}>{cert.certificateNo}</span>
                {cert.scorePct != null && <span style={{ marginLeft: 6, fontWeight: 700, color: '#16a34a' }}>{Math.round(cert.scorePct)}%</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn small secondary" style={{ fontSize: 12 }}
                onClick={() => openCertificate(cert.certificateNo)}>View</button>
              <button className="btn small" style={{ fontSize: 12, background: '#267abd', color: '#fff' }}
                onClick={() => downloadCertificate(cert.certificateNo)}>⬇ Download PDF</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
