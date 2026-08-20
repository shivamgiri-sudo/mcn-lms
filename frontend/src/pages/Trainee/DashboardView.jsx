import { useState } from 'react';
import { formatSeconds, pct } from '../../utils/format.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import LearningJourneyTab from './LearningJourneyTab.jsx';
import SkillsPathsTab from './SkillsPathsTab.jsx';
import LearningTab from './LearningTab.jsx';
import QATab from './QATab.jsx';
import AssignedTab from './AssignedTab.jsx';
import ProfileTab from './ProfileTab.jsx';
import LeaderboardTab from './LeaderboardTab.jsx';
import IJPTab from './IJPTab.jsx';
import VoiceAccentTab from './VoiceAccentTab.jsx';
import PasswordResetBox from './PasswordResetBox.jsx';
import TrainingCalendarEntryCard from '../TrainingCalendar/TrainingCalendarEntryCard.jsx';

export default function DashboardView({ dashboard, forceReset, onLogout, onRefresh }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('journey');
  const [showForceReset, setShowForceReset] = useState(forceReset);

  const d = dashboard || {};
  const t = d.trainee || {};
  const c = d.classroom || {};
  const s = d.summary || {};
  const overall = s.overallTrainingProgress || 0;
  const totalSecs = s.totalSecondsSpent || 0;

  const tabs = [
    { id: 'journey', label: '🧭 My Journey' },
    { id: 'talent', label: '🎯 Skills & Paths' },
    { id: 'live-training', label: '🗓️ Live Training' },
    { id: 'learning', label: '📚 My Learning' },
    { id: 'qa', label: '💬 Q&A' },
    { id: 'leaderboard', label: '🏆 Leaderboard' },
    { id: 'ijp', label: '🚀 Internal Jobs' },
    { id: 'voice-accent', label: '🎙️ Voice & Accent' },
    { id: 'assigned', label: '📎 Assigned' },
    { id: 'profile', label: '👤 Profile' },
  ];

  const kpis = [
    { label: 'Overall Progress', value: `${overall}%`, cls: 'accent', w: overall },
    { label: 'Course Completion', value: pct(s.completionPercent), note: `${s.completedContents || 0}/${s.totalContents || 0} done`, cls: 'ok', w: s.completionPercent || 0 },
    { label: 'MCQ Completion', value: pct(s.mcqCompletionPercent), note: `${s.attemptedAssessments || 0}/${s.totalAssessments || 0} attempted`, cls: 'warn', w: s.mcqCompletionPercent || 0 },
    { label: 'Best MCQ Score', value: s.bestMcqScore != null ? `${Math.round(s.bestMcqScore)}%` : '—', note: s.bestMcqScore != null ? `${s.passedAssessments || 0} passed` : 'No attempt yet', cls: s.bestMcqScore == null ? '' : s.bestMcqScore >= 60 ? 'ok' : 'bad', w: s.bestMcqScore || 0 },
  ];

  return (
    <div className="wrap">
      <div className="hero">
        <div className="brand">
          <div className="logo">LMS</div>
          <div>
            <h1>MCN Learning Hub</h1>
            <p>Learn · Practice · Prove readiness · Grow</p>
          </div>
        </div>
        <div className="row">
          <a className="btn small secondary" href="/training-calendar?role=trainee">🗓️ Live Training</a>
          <button className="btn small secondary" onClick={onRefresh}>↺ Refresh</button>
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ background: 'none', border: '1.5px solid var(--line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1 }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="btn small secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {showForceReset && <PasswordResetBox onDone={() => setShowForceReset(false)} />}

      <div className="trainee-overview-grid">
        <div className="panel" style={{ padding: '18px 22px' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="pill ok">Active Trainee</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{formatSeconds(totalSecs)} verified learning time</span>
          </div>
          <h2 style={{ fontSize: 21, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 3px' }}>Welcome back, {t.name || t.employeeId} 👋</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            {c.classroomName || 'No classroom assigned'}{c.process ? ` · ${c.process}` : ''}{c.lob ? ` / ${c.lob}` : ''}
          </p>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            <span>Overall Progress</span><span style={{ color: 'var(--accent)', fontWeight: 900 }}>{overall}%</span>
          </div>
          <div className="progress-shell" style={{ height: 10 }}><div className="progress-bar" style={{ width: `${overall}%` }} /></div>
          <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small accent" onClick={() => setActiveTab('learning')}>Continue Learning →</button>
            <button className="btn small secondary" onClick={() => setActiveTab('journey')}>View My Journey</button>
            <button className="btn small secondary" onClick={() => setActiveTab('talent')}>Review Skill Gaps</button>
            <button className="btn small secondary" onClick={() => setActiveTab('live-training')}>View Live Sessions</button>
            <button className="btn small secondary" onClick={() => setActiveTab('qa')}>Ask a Question</button>
          </div>
        </div>

        <div className="card" style={{ minWidth: 0, padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 10 }}>Batch Details</div>
          <div style={{ display: 'grid', rowGap: 7 }}>
            {[
              ['Employee ID', t.employeeId],
              ['Batch', t.batchNo || '—'],
              ['Branch', t.branch || '—'],
              ['Days', s.totalDays || 0],
              ['Modules', s.totalModules || 0],
            ].map(([key, value]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{key}</span>
                <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!dashboard ? (
        <div className="trainee-kpi-grid">{[1, 2, 3, 4].map(item => <div key={item} className="skeleton skeleton-card" />)}</div>
      ) : (
        <div className="trainee-kpi-grid">
          {kpis.map(kpi => (
            <div key={kpi.label} className="kpi-card">
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value" style={{ color: `var(--${kpi.cls === 'ok' ? 'ok' : kpi.cls === 'warn' ? 'warn' : kpi.cls === 'bad' ? 'bad' : 'accent'})` }}>{kpi.value}</div>
              {kpi.note && <div className="kpi-note">{kpi.note}</div>}
              <div className="progress-shell" style={{ height: 5, marginTop: 8 }}><div className={`progress-bar ${kpi.cls === 'ok' ? 'ok' : kpi.cls === 'warn' ? 'warn' : kpi.cls === 'bad' ? 'bad' : ''}`} style={{ width: `${kpi.w}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      {(s.riskStatus === 'CRITICAL' || s.riskStatus === 'HIGH') && (
        <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid var(--${s.riskStatus === 'CRITICAL' ? 'bad' : 'warn'})`, background: s.riskStatus === 'CRITICAL' ? 'var(--bad-soft)' : 'var(--warn-soft)' }}>
          <div className="row between">
            <div>
              <b style={{ color: s.riskStatus === 'CRITICAL' ? 'var(--bad)' : 'var(--warn)' }}>{s.riskStatus === 'CRITICAL' ? '🚨 Training Risk: Critical' : '⚠ Training Risk: High'}</b>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{s.riskStatus === 'CRITICAL' ? 'Your learning record has a critical blocker. Open My Journey to see the evidence and recommended action.' : 'Your progress needs attention. Open My Journey to review the next required action.'}</p>
            </div>
            <span className={`pill ${s.riskStatus === 'CRITICAL' ? 'bad' : 'warn'}`}>{s.riskStatus}</span>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Trainee portal sections">
        {tabs.map(tab => (
          <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={`tab-btn${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'journey' && <LearningJourneyTab onNavigate={setActiveTab} />}
      {activeTab === 'talent' && <SkillsPathsTab />}
      {activeTab === 'live-training' && <TrainingCalendarEntryCard role="trainee" />}
      {activeTab === 'learning' && <LearningTab days={d.days || []} onRefresh={onRefresh} />}
      {activeTab === 'qa' && <QATab />}
      {activeTab === 'leaderboard' && <LeaderboardTab />}
      {activeTab === 'ijp' && <IJPTab />}
      {activeTab === 'voice-accent' && <VoiceAccentTab />}
      {activeTab === 'assigned' && <AssignedTab assignments={d.directAssignments || []} onRefresh={onRefresh} />}
      {activeTab === 'profile' && <ProfileTab trainee={t} classroom={c} onRefresh={onRefresh} />}

      <style>{`
        .trainee-overview-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(190px,220px);gap:12px;margin-bottom:12px}
        .trainee-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
        @media(max-width:820px){.trainee-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){.trainee-overview-grid{grid-template-columns:1fr}.trainee-kpi-grid{grid-template-columns:1fr}.hero{align-items:flex-start;gap:12px}.hero>.row{width:100%;flex-wrap:wrap}.tabs{overflow-x:auto;justify-content:flex-start}.tab-btn{white-space:nowrap}}
      `}</style>
    </div>
  );
}
