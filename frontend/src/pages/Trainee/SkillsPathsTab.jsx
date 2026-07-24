import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './talent.css';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value) {
  if (!value) return 'No deadline';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No deadline' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusClass(status) {
  const value = String(status || '').toUpperCase();
  if (['READY', 'COMPLETED'].includes(value)) return 'talent-ok';
  if (['GAP', 'OVERDUE'].includes(value)) return 'talent-bad';
  if (['DEVELOPING', 'IN_PROGRESS', 'AVAILABLE'].includes(value)) return 'talent-warn';
  return 'talent-muted';
}

function ProgressRing({ value }) {
  const progress = Math.max(0, Math.min(100, number(value)));
  return (
    <div className="talent-ring" style={{ '--talent-progress': `${progress * 3.6}deg` }}>
      <div>{Math.round(progress)}%</div>
    </div>
  );
}

function SkillCard({ skill }) {
  const current = number(skill.currentLevel);
  const target = number(skill.targetLevel);
  const max = Math.max(target, current, 1);
  const pct = Math.min(100, Math.round((current / max) * 100));
  return (
    <article className={`talent-skill-card ${statusClass(skill.status)}`}>
      <div className="talent-card-head">
        <div>
          <span className="talent-category">{skill.category || 'General'}</span>
          <h4>{skill.skillName}</h4>
          <p>{skill.description || skill.skillCode}</p>
        </div>
        <span className={`talent-status ${statusClass(skill.status)}`}>{skill.status || 'UNASSESSED'}</span>
      </div>
      <div className="talent-level-row">
        <b>Level {current}</b>
        <span>Target {target || '—'}</span>
      </div>
      <div className="talent-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="talent-meta-row">
        <span>Confidence {Math.round(number(skill.confidenceScore))}%</span>
        <span>{skill.verifiedBy ? 'Verified' : 'Evidence-derived'}</span>
      </div>
    </article>
  );
}

function PathCard({ path }) {
  const [open, setOpen] = useState(false);
  const completed = (path.steps || []).filter(step => step.status === 'COMPLETED').length;
  return (
    <article className={`talent-path-card ${statusClass(path.status)}`}>
      <button className="talent-path-summary" onClick={() => setOpen(value => !value)} type="button">
        <ProgressRing value={path.progressPct} />
        <div className="talent-path-copy">
          <div className="talent-card-head compact">
            <div>
              <span className="talent-category">{path.pathCode} · v{path.versionNo}</span>
              <h4>{path.pathName}</h4>
            </div>
            <span className={`talent-status ${statusClass(path.status)}`}>{path.status}</span>
          </div>
          <p>{path.description || 'Structured development path'}</p>
          <div className="talent-meta-row">
            <span>{completed}/{(path.steps || []).length} steps complete</span>
            <span>Due {formatDate(path.dueAt)}</span>
            {path.mandatory ? <span className="talent-mandatory">Mandatory</span> : null}
          </div>
        </div>
        <span className="talent-chevron">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="talent-step-list">
          {(path.steps || []).map((step, index) => (
            <div key={step.stepId} className={`talent-step ${statusClass(step.status)}`}>
              <div className="talent-step-index">{step.status === 'COMPLETED' ? '✓' : index + 1}</div>
              <div>
                <div className="talent-step-title">
                  <b>{step.stepTitle}</b>
                  <span className={`talent-status small ${statusClass(step.status)}`}>{step.status}</span>
                </div>
                <p>{step.stepType} · {step.referenceId}</p>
                {!step.prerequisiteComplete && <small>Complete the prerequisite step first.</small>}
                {step.minScore != null && <small>Minimum score: {number(step.minScore)}%</small>}
                {step.minLevel != null && <small>Required skill level: {number(step.minLevel)}</small>}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default function SkillsPathsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('skills');

  async function load(refresh = false) {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const response = refresh
      ? await api.post('/talent/me/refresh', {}, 'trainee')
      : await api.get('/talent/me', 'trainee');
    refresh ? setRefreshing(false) : setLoading(false);
    if (!response.ok) return setError(response.message || 'Could not load your development profile.');
    setData(response.data);
  }

  useEffect(() => { load(false); }, []);

  const groupedEvidence = useMemo(() => {
    const result = {};
    for (const item of data?.evidence || []) {
      const key = item.skillName || item.skillId;
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
    return result;
  }, [data]);

  if (loading) return <div className="talent-loading"><div className="spinner" /><p>Building your competency profile…</p></div>;
  if (error) return <div className="card talent-error"><b>Skills & learning paths unavailable</b><p>{error}</p><button className="btn small accent" onClick={() => load(false)}>Retry</button></div>;

  const summary = data?.summary || {};
  return (
    <section className="talent-shell">
      <div className="talent-hero">
        <div>
          <span className="talent-eyebrow">Personal development intelligence</span>
          <h2>Skills & Learning Paths</h2>
          <p>See what your LMS evidence proves, where your gaps are, and which structured path will move you forward.</p>
        </div>
        <button className="btn small accent" onClick={() => load(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh evidence'}</button>
      </div>

      <div className="talent-kpis">
        <div><span>Skills tracked</span><b>{summary.totalSkills || 0}</b></div>
        <div className="talent-ok"><span>Ready</span><b>{summary.readyCount || 0}</b></div>
        <div className="talent-bad"><span>Skill gaps</span><b>{summary.gapCount || 0}</b></div>
        <div className="talent-bad"><span>Critical gaps</span><b>{summary.criticalGaps || 0}</b></div>
        <div className="talent-warn"><span>Assigned paths</span><b>{summary.assignedPaths || 0}</b></div>
        <div><span>Paths completed</span><b>{summary.completedPaths || 0}</b></div>
      </div>

      <div className="talent-view-tabs" role="tablist">
        {[
          ['skills', 'Competency profile'],
          ['paths', 'Learning paths'],
          ['evidence', 'Evidence ledger'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {view === 'skills' && (
        <div>
          {(data?.profiles || []).length ? (
            <div className="talent-skill-grid">{data.profiles.map(skill => <SkillCard key={skill.skillId} skill={skill} />)}</div>
          ) : (
            <div className="talent-empty"><b>No competency profile yet</b><p>Your administrator needs to map skills to learning content, assessments, or role requirements.</p></div>
          )}
        </div>
      )}

      {view === 'paths' && (
        <div className="talent-path-list">
          {(data?.learningPaths || []).length
            ? data.learningPaths.map(path => <PathCard key={path.enrollmentId} path={path} />)
            : <div className="talent-empty"><b>No learning paths assigned</b><p>Assigned development paths will appear here with prerequisites and deadlines.</p></div>}
        </div>
      )}

      {view === 'evidence' && (
        <div className="talent-evidence-groups">
          {Object.keys(groupedEvidence).length ? Object.entries(groupedEvidence).map(([skillName, rows]) => (
            <div className="talent-evidence-card" key={skillName}>
              <h4>{skillName}</h4>
              {rows.map(item => (
                <div className="talent-evidence-row" key={item.id}>
                  <span className="talent-evidence-icon">{item.evidenceType === 'ASSESSMENT' ? '✓' : item.evidenceType === 'CONTENT' ? '▶' : '★'}</span>
                  <div>
                    <b>{item.evidenceType.replaceAll('_', ' ')}</b>
                    <p>{item.referenceId}</p>
                  </div>
                  <div className="talent-evidence-score">
                    <b>Level {number(item.levelAwarded)}</b>
                    <span>{item.scorePct == null ? 'Verified' : `${Math.round(number(item.scorePct))}%`}</span>
                  </div>
                </div>
              ))}
            </div>
          )) : <div className="talent-empty"><b>No evidence recorded</b><p>Complete mapped learning content or assessments to build your evidence ledger.</p></div>}
        </div>
      )}
    </section>
  );
}
