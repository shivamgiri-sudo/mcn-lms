import { useState } from 'react';
import { formatSeconds, pct } from '../../utils/format.js';
import LearningTab from './LearningTab.jsx';
import QATab from './QATab.jsx';
import AssignedTab from './AssignedTab.jsx';
import ProfileTab from './ProfileTab.jsx';
import PasswordResetBox from './PasswordResetBox.jsx';

export default function DashboardView({ dashboard, forceReset, onLogout, onRefresh }) {
  const [activeTab, setActiveTab] = useState('learning');
  const [showForceReset, setShowForceReset] = useState(forceReset);

  const d = dashboard || {};
  const t = d.trainee || {};
  const c = d.classroom || {};
  const s = d.summary || {};

  const overall = s.overallTrainingProgress || 0;
  const totalSecs = s.totalSecondsSpent || 0;

  const tabs = [
    { id: 'learning', label: '📚 My Learning' },
    { id: 'qa', label: '💬 Q&A' },
    { id: 'assigned', label: '📎 Assigned' },
    { id: 'profile', label: '👤 Profile' },
  ];

  const kpis = [
    { label: 'Overall Progress', value: `${overall}%`, cls: 'accent', w: overall },
    { label: 'Course Completion', value: pct(s.completionPercent), note: `${s.completedContents || 0}/${s.totalContents || 0} done`, cls: 'ok', w: s.completionPercent || 0 },
    { label: 'MCQ Completion', value: pct(s.mcqCompletionPercent), note: `${s.attemptedAssessments || 0}/${s.totalAssessments || 0} attempted`, cls: 'warn', w: s.mcqCompletionPercent || 0 },
    { label: 'Best MCQ Score', value: s.bestMcqScore != null ? `${Math.round(s.bestMcqScore)}%` : '—', note: s.bestMcqScore != null ? `${s.passedAssessments || 0} passed` : 'No attempt yet', cls: s.bestMcqScore >= 60 ? 'ok' : 'bad', w: s.bestMcqScore || 0 },
  ];

  return (
    <div className="wrap">
      {/* Hero */}
      <div className="hero">
        <div className="brand">
          <div className="logo">LMS</div>
          <div>
            <h1>Mini LMS Classroom</h1>
            <p>Learn day-wise · Track progress · Ask doubts instantly</p>
          </div>
        </div>
        <div className="row">
          <button className="btn small secondary" onClick={onRefresh}>↺ Refresh</button>
          <button className="btn small secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {showForceReset && (
        <PasswordResetBox onDone={() => setShowForceReset(false)} />
      )}

      {/* Top panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 12 }}>
        <div className="panel" style={{ padding: '18px 22px' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="pill ok">Active Trainee</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{formatSeconds(totalSecs)} spent</span>
          </div>
          <h2 style={{ fontSize: 21, fontWeight: 900, letterSpacing: '-.02em', margin: '0 0 3px' }}>
            Welcome back, {t.name || t.employeeId} 👋
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            {c.classroomName || 'No classroom assigned'}
            {c.process ? ` · ${c.process}` : ''}
            {c.lob ? ` / ${c.lob}` : ''}
          </p>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            <span>Overall Progress</span><span style={{ color: 'var(--accent)', fontWeight: 900 }}>{overall}%</span>
          </div>
          <div className="progress-shell" style={{ height: 10 }}>
            <div className="progress-bar" style={{ width: `${overall}%` }} />
          </div>
          <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small accent" onClick={() => setActiveTab('learning')}>Continue Learning →</button>
            <button className="btn small secondary" onClick={() => setActiveTab('qa')}>Ask a Question</button>
          </div>
        </div>

        <div className="card" style={{ minWidth: 200, padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 10 }}>Batch Details</div>
          <div style={{ display: 'grid', rowGap: 7 }}>
            {[
              ['Employee ID', t.employeeId],
              ['Batch', t.batchNo || '—'],
              ['Branch', t.branch || '—'],
              ['Days', s.totalDays || 0],
              ['Modules', s.totalModules || 0],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {!dashboard ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
          {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
          {kpis.map(k => (
            <div key={k.label} className="kpi-card">
              <div className="kpi-label">{k.label}</div>
              <div className={`kpi-value`} style={{ color: `var(--${k.cls === 'ok' ? 'ok' : k.cls === 'warn' ? 'warn' : k.cls === 'bad' ? 'bad' : 'accent'})` }}>{k.value}</div>
              {k.note && <div className="kpi-note">{k.note}</div>}
              <div className="progress-shell" style={{ height: 5, marginTop: 8 }}>
                <div className={`progress-bar ${k.cls === 'ok' ? 'ok' : k.cls === 'warn' ? 'warn' : k.cls === 'bad' ? 'bad' : ''}`} style={{ width: `${k.w}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Risk Banner */}
      {(s.riskStatus === 'CRITICAL' || s.riskStatus === 'HIGH') && (
        <div className={`card`} style={{
          marginBottom: 12,
          borderLeft: `4px solid var(--${s.riskStatus === 'CRITICAL' ? 'bad' : 'warn'})`,
          background: s.riskStatus === 'CRITICAL' ? 'var(--bad-soft)' : 'var(--warn-soft)'
        }}>
          <div className="row between">
            <div>
              <b style={{ color: s.riskStatus === 'CRITICAL' ? 'var(--bad)' : 'var(--warn)' }}>
                {s.riskStatus === 'CRITICAL' ? '🚨 Training Risk: Critical' : '⚠ Training Risk: High'}
              </b>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                {s.riskStatus === 'CRITICAL'
                  ? 'Your progress is significantly behind. Please complete pending content and assessments immediately.'
                  : 'Your progress needs attention. Focus on completing pending modules this week.'}
              </p>
            </div>
            <span className={`pill ${s.riskStatus === 'CRITICAL' ? 'bad' : 'warn'}`}>{s.riskStatus}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(tab => (
          <button key={tab.id} className={`tab-btn${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'learning' && <LearningTab days={d.days || []} onRefresh={onRefresh} />}
      {activeTab === 'qa' && <QATab />}
      {activeTab === 'assigned' && <AssignedTab assignments={d.directAssignments || []} />}
      {activeTab === 'profile' && <ProfileTab trainee={t} classroom={c} onRefresh={onRefresh} />}
    </div>
  );
}
