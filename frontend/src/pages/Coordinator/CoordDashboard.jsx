import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import BatchList from './BatchList.jsx';
import BatchDetail from './BatchDetail.jsx';
import PendingActivities from './PendingActivities.jsx';
import QueryLog from './QueryLog.jsx';
import CoordReportsTab from './CoordReportsTab.jsx';
import CompetencyGapsTab from './CompetencyGapsTab.jsx';
import TrainingCalendarEntryCard from '../TrainingCalendar/TrainingCalendarEntryCard.jsx';

export default function CoordDashboard({ user, onLogout }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('batches');
  const [selectedBatch, setSelectedBatch] = useState(null);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    const res = await api.get('/coordinator/dashboard', 'coordinator');
    if (res.ok) setStats(res.data);
  }

  const tabs = [
    { id: 'batches', label: '📋 Batches' },
    { id: 'live-training', label: '🗓️ Live Training' },
    { id: 'competencies', label: '🎯 Competency Gaps' },
    { id: 'pending', label: '⏳ Pending Activities' },
    { id: 'queries', label: '💬 Trainee Q&A' },
    { id: 'reports', label: '📥 Reports' },
  ];

  return (
    <div className="wrap">
      <div className="hero">
        <div className="brand">
          <div className="logo">CO</div>
          <div>
            <h1>Coordinator Portal</h1>
            <p>{user?.name || user?.loginId}{user?.branch ? ` — ${user.branch}` : ''}</p>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn small secondary" href="/training-calendar?role=coordinator">🗓️ Training Calendar</a>
          <button className="btn small secondary" onClick={loadStats}>↺ Refresh</button>
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ background: 'none', border: '1.5px solid var(--line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1 }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="btn small secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {stats && (
        <div className="stat-row">
          <div className="stat info"><div className="num">{stats.activeBatches}</div><div className="label">Active Batches</div></div>
          <div className="stat info"><div className="num">{stats.totalTrainees}</div><div className="label">Total Trainees</div></div>
          <div className="stat warn"><div className="num">{stats.pendingCount}</div><div className="label">Pending Activities</div></div>
          <div className="stat bad"><div className="num">{stats.criticalRisks}</div><div className="label">Critical Risks</div></div>
          <div className="stat ok"><div className="num">{stats.throughputPct != null ? `${stats.throughputPct}%` : '—'}</div><div className="label">Throughput %</div></div>
          <div className="stat info"><div className="num">{stats.certificationPct != null ? `${stats.certificationPct}%` : '—'}</div><div className="label">Certification %</div></div>
          <div className="stat bad"><div className="num">{stats.attritionPct != null ? `${stats.attritionPct}%` : '—'}</div><div className="label">Attrition %</div></div>
        </div>
      )}

      {selectedBatch ? (
        <BatchDetail batchNo={selectedBatch} onBack={() => setSelectedBatch(null)} />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Coordinator portal sections">
            {tabs.map(tab => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={`tab-btn${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          {activeTab === 'batches' && <BatchList onSelectBatch={setSelectedBatch} user={user} />}
          {activeTab === 'live-training' && <TrainingCalendarEntryCard role="coordinator" />}
          {activeTab === 'competencies' && <CompetencyGapsTab />}
          {activeTab === 'pending' && <PendingActivities />}
          {activeTab === 'queries' && <QueryLog />}
          {activeTab === 'reports' && <CoordReportsTab />}
        </>
      )}
    </div>
  );
}
