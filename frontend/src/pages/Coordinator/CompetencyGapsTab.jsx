import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './competencyGaps.css';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function GapPill({ value, critical }) {
  if (!value) return <span className="coord-gap-pill ready">Ready</span>;
  return <span className={`coord-gap-pill ${critical ? 'critical' : 'gap'}`}>{value} {critical ? 'critical' : 'gaps'}</span>;
}

function TraineeGapCard({ trainee, expanded, onToggle }) {
  const readiness = trainee.totalSkills ? Math.round((num(trainee.readyCount) / num(trainee.totalSkills)) * 100) : 0;
  const critical = (trainee.criticalGaps || []).length;
  return (
    <article className={`coord-gap-card${critical ? ' critical' : trainee.gapCount ? ' attention' : ' ready'}`}>
      <button type="button" className="coord-gap-card-summary" onClick={onToggle}>
        <div className="coord-gap-avatar">{String(trainee.traineeName || trainee.employeeId || '?').slice(0, 1).toUpperCase()}</div>
        <div className="coord-gap-person">
          <b>{trainee.traineeName || trainee.employeeId}</b>
          <span>{trainee.employeeId} · {trainee.process || 'Process'} / {trainee.lob || 'LOB'}</span>
        </div>
        <div className="coord-gap-readiness">
          <b>{readiness}%</b>
          <span>role ready</span>
        </div>
        <GapPill value={critical || num(trainee.gapCount)} critical={critical > 0} />
        <span className="coord-gap-expand">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded && (
        <div className="coord-gap-details">
          <div className="coord-gap-metrics">
            <div><span>Skills tracked</span><b>{num(trainee.totalSkills)}</b></div>
            <div><span>Ready</span><b>{num(trainee.readyCount)}</b></div>
            <div><span>Open gaps</span><b>{num(trainee.gapCount)}</b></div>
            <div><span>Risk status</span><b>{trainee.riskStatus || 'HEALTHY'}</b></div>
          </div>
          {(trainee.gaps || []).length ? (
            <div className="coord-gap-list">
              {(trainee.gaps || []).map(gap => {
                const isCritical = (trainee.criticalGaps || []).some(item => item.skillId === gap.skillId);
                return (
                  <div key={gap.skillId} className={isCritical ? 'critical' : ''}>
                    <div>
                      <b>{gap.skillName}</b>
                      <span>{gap.category || 'General competency'}</span>
                    </div>
                    <div className="coord-gap-levels">
                      <span>Current <b>{num(gap.currentLevel)}</b></span>
                      <span>Target <b>{num(gap.targetLevel)}</b></span>
                    </div>
                    <div className="coord-gap-bar"><span style={{ width: `${Math.min(100, gap.targetLevel ? (num(gap.currentLevel) / num(gap.targetLevel)) * 100 : 0)}%` }} /></div>
                    {isCritical && <span className="coord-gap-critical-label">Critical readiness blocker</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="coord-gap-complete">✓ All currently assigned competency requirements are met.</div>
          )}
        </div>
      )}
    </article>
  );
}

export default function CompetencyGapsTab() {
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState('');

  useEffect(() => {
    api.get('/coordinator/batches?status=Active', 'coordinator').then(result => {
      setLoading(false);
      if (!result.ok) return setError(result.message || 'Could not load your batches.');
      const rows = result.data || [];
      setBatches(rows);
      if (rows[0]?.batchNo) setSelectedBatch(rows[0].batchNo);
    });
  }, []);

  useEffect(() => {
    if (!selectedBatch) return;
    setLoadingGaps(true);
    setError('');
    setData(null);
    api.get(`/talent/coordinator/batches/${encodeURIComponent(selectedBatch)}/gaps`, 'coordinator').then(result => {
      setLoadingGaps(false);
      if (!result.ok) return setError(result.message || 'Could not load competency gaps.');
      setData(result.data);
    });
  }, [selectedBatch]);

  const trainees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.trainees || []).filter(trainee => {
      const matchesSearch = !term || [trainee.traineeName, trainee.employeeId, trainee.process, trainee.lob].some(value => String(value || '').toLowerCase().includes(term));
      if (!matchesSearch) return false;
      if (filter === 'critical') return (trainee.criticalGaps || []).length > 0;
      if (filter === 'gaps') return num(trainee.gapCount) > 0;
      if (filter === 'ready') return num(trainee.gapCount) === 0 && num(trainee.totalSkills) > 0;
      if (filter === 'unprofiled') return num(trainee.totalSkills) === 0;
      return true;
    });
  }, [data, search, filter]);

  const summary = useMemo(() => {
    const rows = data?.trainees || [];
    return {
      total: rows.length,
      ready: rows.filter(item => num(item.totalSkills) > 0 && num(item.gapCount) === 0).length,
      withGaps: rows.filter(item => num(item.gapCount) > 0).length,
      critical: rows.filter(item => (item.criticalGaps || []).length > 0).length,
      unprofiled: rows.filter(item => num(item.totalSkills) === 0).length,
    };
  }, [data]);

  if (loading) return <div className="coord-gap-loading"><div className="spinner" /><p>Loading owned batches…</p></div>;

  return (
    <section className="coord-gap-shell">
      <div className="coord-gap-hero">
        <div>
          <span>Evidence-based floor readiness</span>
          <h2>Batch Competency Gaps</h2>
          <p>Prioritize coaching using role requirements, completed learning, assessment evidence, and verified skill levels.</p>
        </div>
        <select value={selectedBatch} onChange={event => setSelectedBatch(event.target.value)}>
          {batches.map(batch => <option key={batch.batchNo} value={batch.batchNo}>{batch.batchNo} · {batch.batchName || batch.process}</option>)}
        </select>
      </div>

      {error && <div className="toast bad">{error}</div>}
      {!batches.length && <div className="coord-gap-empty"><b>No active owned batches</b><p>Competency views appear after trainees are assigned to an active coordinator batch.</p></div>}

      {selectedBatch && (
        <>
          <div className="coord-gap-kpis">
            <div><span>Trainees</span><b>{summary.total}</b></div>
            <div className="ready"><span>Role ready</span><b>{summary.ready}</b></div>
            <div className="attention"><span>With gaps</span><b>{summary.withGaps}</b></div>
            <div className="critical"><span>Critical blockers</span><b>{summary.critical}</b></div>
            <div><span>Not profiled</span><b>{summary.unprofiled}</b></div>
          </div>

          <div className="coord-gap-toolbar">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search trainee, employee ID, process or LOB" />
            <div>
              {[['all', 'All'], ['critical', 'Critical'], ['gaps', 'Any gap'], ['ready', 'Ready'], ['unprofiled', 'Not profiled']].map(([id, label]) => (
                <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
          </div>

          {loadingGaps ? <div className="coord-gap-loading"><div className="spinner" /><p>Recalculating skill evidence and readiness…</p></div> : (
            <div className="coord-gap-cards">
              {trainees.map(trainee => <TraineeGapCard key={trainee.employeeId} trainee={trainee} expanded={expanded === trainee.employeeId} onToggle={() => setExpanded(value => value === trainee.employeeId ? '' : trainee.employeeId)} />)}
              {!trainees.length && <div className="coord-gap-empty"><b>No trainees match this view</b><p>Change the search or competency filter.</p></div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
