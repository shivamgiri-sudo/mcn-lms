import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

export default function EvaluatorSelfView({ role = 'coordinator', embedded = false }) {
  const [dashboard, setDashboard] = useState({ assignments: [], authorizations: [], reliability: [], actions: [] });
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [responses, setResponses] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selfBase = role === 'admin' ? '/calibration/admin' : '/calibration/coordinator';
  const detailPath = assignmentId => role === 'admin'
    ? `/calibration/admin/assignments/${encodeURIComponent(assignmentId)}/self`
    : `/calibration/coordinator/assignments/${encodeURIComponent(assignmentId)}`;
  const submitPath = assignmentId => role === 'admin'
    ? `/calibration/admin/assignments/${encodeURIComponent(assignmentId)}/self/submit`
    : `/calibration/coordinator/assignments/${encodeURIComponent(assignmentId)}/submit`;

  async function load(preferredId = '') {
    setLoading(true); setError('');
    const result = await api.get(`${selfBase}/me`, role);
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load evaluator-quality profile.');
    const data = result.data || { assignments: [], authorizations: [], reliability: [], actions: [] };
    setDashboard(data);
    const next = preferredId || selectedId || data.assignments?.find(item => ['ASSIGNED', 'IN_PROGRESS'].includes(item.status))?.assignmentId || data.assignments?.[0]?.assignmentId || '';
    if (next) await openAssignment(next);
  }

  async function openAssignment(assignmentId) {
    setBusy('detail'); setError('');
    const result = await api.get(detailPath(assignmentId), role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load calibration assignment.');
    setSelectedId(assignmentId);
    setDetail(result.data);
    const state = {};
    for (const anchor of result.data?.program?.anchors || []) {
      for (const expected of anchor.expectedScores || []) {
        const existing = result.data?.responses?.find(item => item.anchorId === anchor.anchorId && item.criterionId === expected.criterionId);
        state[`${anchor.anchorId}:${expected.criterionId}`] = {
          anchorId: anchor.anchorId,
          criterionId: expected.criterionId,
          submittedScore: existing?.submittedScore ?? '',
          submittedCriticalFail: Boolean(existing?.submittedCriticalFail),
          evaluatorObservation: existing?.evaluatorObservation || '',
        };
      }
    }
    setResponses(state);
  }

  useEffect(() => { load(); }, [role]);

  async function save(submit = false) {
    if (!detail) return;
    if (submit && !window.confirm('Submit and lock this calibration attempt? Your scores will be compared with protected anchor standards.')) return;
    setBusy(submit ? 'submit' : 'save'); setMessage(''); setError('');
    const payload = { responses: Object.values(responses) };
    const result = submit
      ? await api.post(submitPath(detail.assignmentId), payload, role)
      : await api.put(detailPath(detail.assignmentId), payload, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save calibration.');
    setMessage(result.message || (submit ? 'Calibration submitted.' : 'Calibration draft saved.'));
    setDetail(result.data);
    await load(result.data.assignmentId);
  }

  const metrics = useMemo(() => ({
    open: dashboard.assignments?.filter(item => ['ASSIGNED', 'IN_PROGRESS'].includes(item.status)).length || 0,
    active: dashboard.authorizations?.filter(item => item.status === 'ACTIVE').length || 0,
    watch: dashboard.reliability?.filter(item => ['WATCH', 'RECALIBRATION_REQUIRED'].includes(item.reliabilityStatus)).length || 0,
    actions: dashboard.actions?.filter(item => ['OPEN', 'IN_PROGRESS'].includes(item.status)).length || 0,
  }), [dashboard]);

  if (loading) return <div className="quality-loading"><div className="spinner" /><p>Loading evaluator authorization and calibration…</p></div>;
  const editable = detail && ['ASSIGNED', 'IN_PROGRESS'].includes(detail.status);

  return (
    <div className={`quality-view ${embedded ? 'embedded' : ''}`}>
      {!embedded && <section className="quality-hero self"><div><span>Independent evaluation readiness</span><h1>My Evaluator Quality</h1><p>Complete anchor calibration, maintain template-specific authorization and monitor reliability against actual paired reviews.</p></div><div className="quality-metrics"><article><span>Open calibration</span><b>{metrics.open}</b></article><article><span>Active authority</span><b>{metrics.active}</b></article><article><span>Reliability watch</span><b>{metrics.watch}</b></article><article><span>Quality actions</span><b>{metrics.actions}</b></article></div></section>}
      {message && <div className="quality-toast ok">{message}</div>}
      {error && <div className="quality-toast bad">{error}</div>}
      <div className="quality-self-grid">
        <aside className="quality-panel quality-assignment-panel">
          <div className="quality-section-head"><div><h2>Calibration attempts</h2><p>Anchor-case scoring assigned to your evaluator identity.</p></div><button onClick={() => load(selectedId)}>↻</button></div>
          <div className="quality-list">{dashboard.assignments?.map(item => <button key={item.assignmentId} className={selectedId === item.assignmentId ? 'active' : ''} onClick={() => openAssignment(item.assignmentId)}><div><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.programName}</b></div><small>{item.templateName} · V{item.templateVersion} · Attempt {item.attemptNo}</small><small>Due {formatDate(item.dueAt)}</small>{item.scorePct != null && <strong>{Number(item.scorePct).toFixed(1)}% · {item.result}</strong>}</button>)}{!dashboard.assignments?.length && <div className="quality-empty"><b>No calibration assigned</b><p>Published anchor programs assigned to you will appear here.</p></div>}</div>
        </aside>
        <section className="quality-panel quality-detail">
          {busy === 'detail' && <div className="quality-loading compact"><div className="spinner" /></div>}
          {!detail && busy !== 'detail' && <div className="quality-empty large"><b>Select a calibration attempt</b><p>Open an assigned program to score protected anchor cases.</p></div>}
          {detail && <><header className="quality-detail-head"><div><span className={`quality-status ${statusClass(detail.status)}`}>{detail.status}</span><h2>{detail.programName}</h2><p>{detail.templateName} · Rubric V{detail.templateVersion} · Attempt {detail.attemptNo}</p></div><div><b>{detail.scorePct == null ? `${detail.passingPct}%` : `${Number(detail.scorePct).toFixed(1)}%`}</b><span>{detail.scorePct == null ? 'Passing threshold' : detail.result}</span></div></header>
            <div className="quality-info-grid"><article><span>Due</span><b>{formatDate(detail.dueAt)}</b></article><article><span>Agreement gate</span><b>{detail.minimumAgreementPct}%</b></article><article><span>Validity</span><b>{detail.authorizationValidDays} days</b></article><article><span>Authorization until</span><b>{formatDate(detail.validUntil)}</b></article></div>
            {detail.evaluatorInstructions && <div className="quality-callout"><b>Evaluator instructions</b><p>{detail.evaluatorInstructions}</p></div>}
            <section className="quality-anchor-list">{detail.program?.anchors?.filter(item => item.active).map((anchor, anchorIndex) => <article key={anchor.anchorId} className="quality-anchor"><header><div><span>Anchor {anchorIndex + 1}</span><h3>{anchor.anchorTitle}</h3></div><b>{anchor.anchorCode}</b></header><p>{anchor.scenarioDescription}</p>{anchor.evidenceUrl && <a href={anchor.evidenceUrl} target="_blank" rel="noreferrer">Open anchor evidence ↗</a>}{anchor.evidenceReference && <small>Reference: {anchor.evidenceReference}</small>}<div className="quality-anchor-scores">{anchor.expectedScores.map(expected => { const criterion = detail.program.criteria.find(item => item.criterionId === expected.criterionId); const key = `${anchor.anchorId}:${expected.criterionId}`; const value = responses[key] || {}; return <div className="quality-score-card" key={key}><div><b>{criterion?.criterionTitle}</b><span>{criterion?.sectionTitle} · Score 0–{criterion?.maxScore}</span>{criterion?.critical && <em>Critical ≥ {criterion.criticalMinScore}</em>}</div><label>Your score<input type="number" min="0" max={criterion?.maxScore} step="0.01" disabled={!editable} value={value.submittedScore} onChange={event => setResponses(items => ({ ...items, [key]: { ...value, anchorId: anchor.anchorId, criterionId: expected.criterionId, submittedScore: event.target.value } }))} /></label>{criterion?.critical && <label className="quality-check"><input type="checkbox" disabled={!editable} checked={Boolean(value.submittedCriticalFail)} onChange={event => setResponses(items => ({ ...items, [key]: { ...value, anchorId: anchor.anchorId, criterionId: expected.criterionId, submittedCriticalFail: event.target.checked } }))} /> Mark critical fail</label>}<label>Observation<textarea rows="2" disabled={!editable} value={value.evaluatorObservation || ''} onChange={event => setResponses(items => ({ ...items, [key]: { ...value, anchorId: anchor.anchorId, criterionId: expected.criterionId, evaluatorObservation: event.target.value } }))} /></label>{!editable && detail.status !== 'ASSIGNED' && <aside><span>Anchor standard</span><b>{expected.expectedScore} ± {expected.tolerance}</b><small>{value.submittedScore === '' ? 'No response' : `Your score ${value.submittedScore}`}</small></aside>}</div>; })}</div></article>)}</section>
            {editable && <div className="quality-actions"><button className="btn secondary" disabled={Boolean(busy)} onClick={() => save(false)}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button><button className="btn" disabled={Boolean(busy)} onClick={() => save(true)}>{busy === 'submit' ? 'Submitting…' : 'Submit calibration'}</button></div>}
            {!editable && detail.scorePct != null && <section className={`quality-result ${String(detail.result).toLowerCase()}`}><header><div><span>Calibration result</span><h3>{detail.result}</h3></div><b>{Number(detail.scorePct).toFixed(1)}%</b></header><div><article><span>Agreement</span><b>{Number(detail.agreementPct || 0).toFixed(1)}%</b></article><article><span>Critical agreement</span><b>{Number(detail.criticalAgreementPct || 0).toFixed(1)}%</b></article><article><span>Mean deviation</span><b>{Number(detail.meanAbsoluteDeviation || 0).toFixed(2)}</b></article></div></section>}
          </>}
        </section>
      </div>
      <div className="quality-bottom-grid">
        <section className="quality-panel"><div className="quality-section-head"><div><h2>Evaluator authorizations</h2><p>Template-version-specific authority granted through passed calibration.</p></div></div><div className="quality-card-grid">{dashboard.authorizations?.map(item => <article key={item.authorizationId}><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.templateName} · V{item.templateVersion}</b><p>{Number(item.calibrationScorePct || 0).toFixed(1)}% calibration</p><small>Valid until {formatDate(item.validUntil)}</small>{item.suspensionReason && <em>{item.suspensionReason}</em>}</article>)}{!dashboard.authorizations?.length && <div className="quality-empty"><b>No evaluator authorizations</b><p>Passing a published calibration program grants authorization.</p></div>}</div></section>
        <section className="quality-panel"><div className="quality-section-head"><div><h2>Reliability & actions</h2><p>Actual paired-evaluation consistency and required follow-up.</p></div></div><div className="quality-card-grid">{dashboard.reliability?.slice(0, 8).map(item => <article key={item.snapshotId}><span className={`quality-status ${statusClass(item.reliabilityStatus)}`}>{item.reliabilityStatus}</span><b>{item.templateName} · V{item.templateVersion}</b><p>{item.agreementWithinFivePct == null ? 'Insufficient pairs' : `${Number(item.agreementWithinFivePct).toFixed(1)}% within ±5`}</p><small>{item.pairedEvaluationCount} pairs · Severity {Number(item.severityIndex || 0).toFixed(1)}</small></article>)}{dashboard.actions?.filter(item => ['OPEN', 'IN_PROGRESS'].includes(item.status)).map(item => <article key={item.actionId} className="action"><span className={`quality-status ${statusClass(item.priority)}`}>{item.actionType}</span><b>{item.templateName || 'Evaluator quality'}</b><p>{item.reason}</p><small>Due {formatDate(item.dueAt)}</small></article>)}{!dashboard.reliability?.length && !dashboard.actions?.length && <div className="quality-empty"><b>No reliability history yet</b><p>Metrics appear after enough paired practical evaluations.</p></div>}</div></section>
      </div>
    </div>
  );
}
