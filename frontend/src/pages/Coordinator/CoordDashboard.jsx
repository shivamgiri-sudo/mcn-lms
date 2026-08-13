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

const TAB_IDS = ['batches', 'live-training', 'competencies', 'pending', 'queries', 'reports'];

export default function CoordDashboard({ user, onLogout }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get('tab');
    return TAB_IDS.includes(t) ? t : 'batches';
  });
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    const res = await api.get('/coordinator/dashboard', 'coordinator');
    if (res.ok) setStats(res.data);
  }

  function handleRefresh() {
    loadStats();
    setRefreshKey(k => k + 1);
  }

  function switchTab(id) {
    setActiveTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', id);
    window.history.replaceState(null, '', url.toString());
  }

  const tabs = [
    { id: 'batches', label: 'Batches' },
    { id: 'live-training', label: 'Live Training' },
    { id: 'competencies', label: 'Competency Gaps' },
    { id: 'pending', label: 'Pending Activities' },
    { id: 'queries', label: 'Trainee Q&A' },
    { id: 'reports', label: 'Reports' },
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
          <button className="btn small secondary" onClick={handleRefresh}>↺ Refresh</button>
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ background: 'none', border: '1.5px solid var(--line)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1 }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="btn small secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {!stats ? (
        <div className="stat-row">
          {[1,2,3,4,5,6,7].map(i => (
            <div key={i} className="stat">
              <div className="skeleton" style={{height:26,width:'50%',borderRadius:5,marginBottom:5}} />
              <div className="skeleton" style={{height:11,width:'70%',borderRadius:3}} />
            </div>
          ))}
        </div>
      ) : (
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

      <div className="tabs" role="tablist" aria-label="Coordinator portal sections">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id && !selectedBatch}
            className={`tab-btn${activeTab === tab.id && !selectedBatch ? ' active' : ''}`}
            style={selectedBatch && tab.id !== 'batches' ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
            onClick={() => { if (selectedBatch) return; switchTab(tab.id); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {selectedBatch && (
        <div style={{display:'flex',gap:6,alignItems:'center',fontSize:13,marginBottom:10,padding:'6px 0'}}>
          <button className="btn small secondary" onClick={() => setSelectedBatch(null)}>← Back to Batches</button>
          <span style={{color:'var(--muted)'}}>›</span>
          <span style={{fontWeight:700,color:'var(--ink)'}}>{selectedBatch}</span>
        </div>
      )}

      {selectedBatch ? (
        <BatchDetail batchNo={selectedBatch} onBack={() => setSelectedBatch(null)} refreshKey={refreshKey} />
      ) : (
        <>
          <div role="tabpanel" aria-labelledby="tab-batches" style={{ display: activeTab === 'batches' ? 'block' : 'none' }}>
            <BatchList onSelectBatch={setSelectedBatch} user={user} refreshKey={refreshKey} />
          </div>
          <div role="tabpanel" aria-labelledby="tab-live-training" style={{ display: activeTab === 'live-training' ? 'block' : 'none' }}>
            <TrainingCalendarEntryCard role="coordinator" />
          </div>
          <div role="tabpanel" aria-labelledby="tab-competencies" style={{ display: activeTab === 'competencies' ? 'block' : 'none' }}>
            <CompetencyGapsTab refreshKey={refreshKey} />
          </div>
          <div role="tabpanel" aria-labelledby="tab-pending" style={{ display: activeTab === 'pending' ? 'block' : 'none' }}>
            <PendingActivities refreshKey={refreshKey} />
          </div>
          <div role="tabpanel" aria-labelledby="tab-queries" style={{ display: activeTab === 'queries' ? 'block' : 'none' }}>
            <QueryLog refreshKey={refreshKey} />
          </div>
          <div role="tabpanel" aria-labelledby="tab-reports" style={{ display: activeTab === 'reports' ? 'block' : 'none' }}>
            <CoordReportsTab refreshKey={refreshKey} />
          </div>
        </>
      )}
    </div>
  );
}
