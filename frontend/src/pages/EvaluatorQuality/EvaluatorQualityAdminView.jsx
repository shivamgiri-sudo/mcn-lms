import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import EvaluatorSelfView from './EvaluatorSelfView.jsx';

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

const emptyProgram = () => ({
  programId: '',
  programCode: '',
  programName: '',
  templateId: '',
  description: '',
  evaluatorInstructions: '',
  audienceBranch: '',
  audienceProcess: '',
  audienceLob: '',
  passingPct: 85,
  minAnchorCases: 2,
  maxAttempts: 3,
  authorizationValidDays: 180,
  defaultScoreTolerance: 1,
  minimumAgreementPct: 80,
  maximumSeverityIndex: 8,
  status: 'DRAFT',
  anchors: [],
});

function newAnchor(index, criteria, tolerance = 1) {
  return {
    anchorCode: `ANCHOR-${index + 1}`,
    anchorTitle: '',
    scenarioDescription: '',
    evidenceReference: '',
    evidenceUrl: '',
    evaluatorNotes: '',
    sortOrder: index + 1,
    active: true,
    expectedScores: criteria.map(item => ({
      criterionId: item.criterionId,
      expectedScore: item.criticalMinScore ?? Math.min(Number(item.maxScore || 5), 3),
      tolerance,
      expectedCriticalFail: false,
      rationale: '',
    })),
  };
}

export default function EvaluatorQualityAdminView() {
  const [tab, setTab] = useState('overview');
  const [catalog, setCatalog] = useState({ templates: [], evaluators: [] });
  const [programs, setPrograms] = useState([]);
  const [dashboard, setDashboard] = useState({ assignments: [], authorizations: [], reliability: [], pairs: [], actions: [], scope: 'branch' });
  const [criteria, setCriteria] = useState([]);
  const [programForm, setProgramForm] = useState(emptyProgram());
  const [assignmentForm, setAssignmentForm] = useState({ programId: '', evaluatorId: '', evaluatorType: 'coordinator', dueAt: '' });
  const [period, setPeriod] = useState({ periodStart: '', periodEnd: '' });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const [catalogResult, programsResult, dashboardResult] = await Promise.all([
      api.get('/calibration/admin/catalog', 'admin'),
      api.get('/calibration/admin/programs', 'admin'),
      api.get('/calibration/admin/dashboard', 'admin'),
    ]);
    setLoading(false);
    if (!catalogResult.ok) return setError(catalogResult.message || 'Could not load evaluator catalog.');
    setCatalog(catalogResult.data || { templates: [], evaluators: [] });
    if (programsResult.ok) {
      setPrograms(programsResult.data || []);
      setAssignmentForm(form => ({ ...form, programId: form.programId || programsResult.data?.find(item => item.status === 'PUBLISHED')?.programId || '' }));
    }
    if (dashboardResult.ok) setDashboard(dashboardResult.data || {});
  }

  useEffect(() => { load(); }, []);

  async function loadCriteria(templateId, preserveAnchors = false) {
    if (!templateId) { setCriteria([]); return []; }
    setBusy('criteria'); setError('');
    const result = await api.get(`/calibration/admin/templates/${encodeURIComponent(templateId)}/criteria`, 'admin');
    setBusy('');
    if (!result.ok) { setError(result.message || 'Could not load rubric criteria.'); return []; }
    const rows = result.data?.criteria || [];
    setCriteria(rows);
    if (!preserveAnchors) {
      setProgramForm(form => ({
        ...form,
        templateId,
        anchors: [newAnchor(0, rows, Number(form.defaultScoreTolerance || 1)), newAnchor(1, rows, Number(form.defaultScoreTolerance || 1))],
      }));
    }
    return rows;
  }

  async function openProgram(programId) {
    setBusy('program-detail'); setError('');
    const result = await api.get(`/calibration/admin/programs/${encodeURIComponent(programId)}`, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load calibration program.');
    await loadCriteria(result.data.templateId, true);
    setProgramForm({ ...emptyProgram(), ...result.data, anchors: result.data.anchors || [] });
    setTab('programs');
  }

  function updateAnchor(anchorIndex, patch) {
    setProgramForm(form => ({ ...form, anchors: form.anchors.map((item, index) => index === anchorIndex ? { ...item, ...patch } : item) }));
  }

  function updateExpected(anchorIndex, criterionId, patch) {
    setProgramForm(form => ({
      ...form,
      anchors: form.anchors.map((anchor, index) => index === anchorIndex
        ? { ...anchor, expectedScores: anchor.expectedScores.map(item => item.criterionId === criterionId ? { ...item, ...patch } : item) }
        : anchor),
    }));
  }

  async function saveProgram(event) {
    event.preventDefault(); setBusy('program-save'); setError(''); setMessage('');
    const result = programForm.programId
      ? await api.put(`/calibration/admin/programs/${encodeURIComponent(programForm.programId)}`, programForm, 'admin')
      : await api.post('/calibration/admin/programs', programForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save calibration program.');
    setProgramForm({ ...emptyProgram(), ...result.data, anchors: result.data.anchors || [] });
    setMessage(result.message || 'Calibration program saved.');
    await load();
  }

  async function publishProgram() {
    if (!programForm.programId || !window.confirm('Publish and lock this calibration program? Anchor standards will become protected.')) return;
    setBusy('publish'); setError(''); setMessage('');
    const result = await api.post(`/calibration/admin/programs/${encodeURIComponent(programForm.programId)}/publish`, {}, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not publish calibration program.');
    setProgramForm({ ...programForm, ...result.data });
    setMessage('Calibration program published and locked.');
    await load();
  }

  async function assignCalibration(event) {
    event.preventDefault(); setBusy('assign'); setError(''); setMessage('');
    const evaluator = catalog.evaluators.find(item => item.evaluatorId === assignmentForm.evaluatorId && item.evaluatorType === assignmentForm.evaluatorType);
    const payload = { ...assignmentForm, evaluatorId: evaluator?.evaluatorId, evaluatorType: evaluator?.evaluatorType };
    const result = await api.post('/calibration/admin/assignments', payload, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not assign calibration.');
    setMessage('Calibration assigned to evaluator.');
    await load();
  }

  async function runReliability(event) {
    event.preventDefault(); setBusy('reliability'); setError(''); setMessage('');
    const result = await api.post('/calibration/admin/reliability/run', period, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not calculate reliability.');
    setMessage(`Reliability recalculated: ${result.data.snapshots} snapshots, ${result.data.pairs} evaluator pairs.`);
    await load();
  }

  async function authorizationAction(item, action) {
    let payload = {};
    if (action === 'restore') {
      const validUntil = window.prompt('Enter future validity date (YYYY-MM-DD):');
      if (!validUntil) return;
      payload = { validUntil };
    } else {
      const reason = window.prompt(`Provide an audited reason to ${action} this authorization:`);
      if (!reason) return;
      payload = { reason };
    }
    setBusy(`auth-${item.authorizationId}`); setError(''); setMessage('');
    const result = await api.post(`/calibration/admin/authorizations/${encodeURIComponent(item.authorizationId)}/${action}`, payload, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not update evaluator authorization.');
    setMessage(result.message);
    await load();
  }

  async function completeAction(item) {
    const completionNotes = window.prompt('Describe the coaching, recalibration or monitoring outcome:');
    if (!completionNotes) return;
    setBusy(`action-${item.actionId}`); setError('');
    const result = await api.post(`/calibration/admin/actions/${encodeURIComponent(item.actionId)}/complete`, { completionNotes }, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not close quality action.');
    setMessage(result.message);
    await load();
  }

  const filteredReliability = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return dashboard.reliability || [];
    return (dashboard.reliability || []).filter(item => [item.evaluatorId, item.evaluatorName, item.templateName, item.reliabilityStatus].some(value => String(value || '').toLowerCase().includes(term)));
  }, [dashboard.reliability, search]);

  const metrics = useMemo(() => ({
    published: programs.filter(item => item.status === 'PUBLISHED').length,
    activeAuth: dashboard.authorizations?.filter(item => item.status === 'ACTIVE').length || 0,
    recalibration: dashboard.reliability?.filter(item => item.reliabilityStatus === 'RECALIBRATION_REQUIRED').length || 0,
    openActions: dashboard.actions?.filter(item => ['OPEN', 'IN_PROGRESS'].includes(item.status)).length || 0,
  }), [programs, dashboard]);

  if (loading) return <div className="quality-loading"><div className="spinner" /><p>Loading evaluator quality governance…</p></div>;

  return (
    <div className="quality-view">
      <section className="quality-hero admin"><div><span>{dashboard.scope === 'company' ? 'Company governance' : 'Branch governance'}</span><h1>Evaluator Quality Governance</h1><p>Calibrate evaluator judgment, authorize rubric versions, monitor inter-rater reliability and close corrective actions.</p></div><div className="quality-metrics"><article><span>Published programs</span><b>{metrics.published}</b></article><article><span>Active authority</span><b>{metrics.activeAuth}</b></article><article><span>Recalibration</span><b>{metrics.recalibration}</b></article><article><span>Open actions</span><b>{metrics.openActions}</b></article></div></section>
      {message && <div className="quality-toast ok">{message}</div>}
      {error && <div className="quality-toast bad">{error}</div>}
      <nav className="quality-tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Reliability</button><button className={tab === 'programs' ? 'active' : ''} onClick={() => setTab('programs')}>Calibration programs</button><button className={tab === 'assign' ? 'active' : ''} onClick={() => setTab('assign')}>Assign calibration</button><button className={tab === 'authorizations' ? 'active' : ''} onClick={() => setTab('authorizations')}>Authorizations</button><button className={tab === 'self' ? 'active' : ''} onClick={() => setTab('self')}>My calibration</button></nav>

      {tab === 'overview' && <div className="quality-overview"><section className="quality-panel"><div className="quality-section-head"><div><h2>Reliability snapshots</h2><p>Paired practical reviews, severity/leniency and critical agreement.</p></div><form onSubmit={runReliability}><input type="date" value={period.periodStart} onChange={event => setPeriod(item => ({ ...item, periodStart: event.target.value }))} /><input type="date" value={period.periodEnd} onChange={event => setPeriod(item => ({ ...item, periodEnd: event.target.value }))} /><button className="btn small" disabled={busy === 'reliability'}>{busy === 'reliability' ? 'Running…' : 'Recalculate'}</button></form></div><input className="quality-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search evaluator, template or status" /><div className="quality-table reliability"><header><span>Evaluator</span><span>Rubric</span><span>Pairs</span><span>±5 agreement</span><span>Critical</span><span>Severity</span><span>Status</span></header>{filteredReliability.map(item => <div key={item.snapshotId}><span><b>{item.evaluatorName || item.evaluatorId}</b><small>{item.evaluatorId} · {item.evaluatorType}</small></span><span>{item.templateName} · V{item.templateVersion}</span><span>{item.pairedEvaluationCount}</span><span>{item.agreementWithinFivePct == null ? '—' : `${Number(item.agreementWithinFivePct).toFixed(1)}%`}</span><span>{item.criticalAgreementPct == null ? '—' : `${Number(item.criticalAgreementPct).toFixed(1)}%`}</span><span>{Number(item.severityIndex || 0).toFixed(1)}</span><span className={`quality-status ${statusClass(item.reliabilityStatus)}`}>{item.reliabilityStatus}</span></div>)}</div></section><div className="quality-overview-grid"><section className="quality-panel"><div className="quality-section-head"><div><h2>Evaluator pairs</h2><p>Consistency between the same independent reviewer pair.</p></div></div><div className="quality-card-grid">{dashboard.pairs?.slice(0, 30).map(item => <article key={item.pairId}><span>{item.templateName} · V{item.templateVersion}</span><b>{item.evaluatorAId} ↔ {item.evaluatorBId}</b><p>{item.pairedCount} pairs · {Number(item.agreementWithinFivePct || 0).toFixed(1)}% within ±5</p><small>Critical {Number(item.criticalAgreementPct || 0).toFixed(1)}% · Moderated {Number(item.moderationRatePct || 0).toFixed(1)}%</small></article>)}</div></section><section className="quality-panel"><div className="quality-section-head"><div><h2>Corrective actions</h2><p>Coaching, monitoring and recalibration generated from governance evidence.</p></div></div><div className="quality-card-grid">{dashboard.actions?.map(item => <article key={item.actionId} className="action"><span className={`quality-status ${statusClass(item.priority)}`}>{item.actionType}</span><b>{item.evaluatorName || item.evaluatorId}</b><p>{item.reason}</p><small>{item.templateName || 'All rubrics'} · Due {formatDate(item.dueAt)}</small>{['OPEN', 'IN_PROGRESS'].includes(item.status) && <button className="btn small secondary" disabled={busy === `action-${item.actionId}`} onClick={() => completeAction(item)}>Complete action</button>}</article>)}</div></section></div></div>}

      {tab === 'programs' && <div className="quality-builder-layout"><aside className="quality-panel"><div className="quality-section-head"><div><h2>Programs</h2><p>One active calibration program per rubric version.</p></div><button onClick={() => { setProgramForm(emptyProgram()); setCriteria([]); }}>＋</button></div><div className="quality-list">{programs.map(item => <button key={item.programId} className={programForm.programId === item.programId ? 'active' : ''} onClick={() => openProgram(item.programId)}><div><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.programName}</b></div><small>{item.templateName} · V{item.templateVersion}</small><small>{item.anchorCount} anchors · {item.authorizationValidDays} day validity</small></button>)}</div></aside><form className="quality-program-builder" onSubmit={saveProgram}><header><div><span>{programForm.programId ? programForm.status : 'NEW PROGRAM'}</span><h2>{programForm.programName || 'Evaluator calibration program'}</h2></div><div>{programForm.status === 'DRAFT' && <button className="btn secondary" disabled={busy === 'program-save'}>{busy === 'program-save' ? 'Saving…' : 'Save draft'}</button>}{programForm.programId && programForm.status === 'DRAFT' && <button type="button" className="btn" disabled={busy === 'publish'} onClick={publishProgram}>{busy === 'publish' ? 'Publishing…' : 'Publish & lock'}</button>}</div></header><div className="quality-form-grid"><label>Program code<input required disabled={programForm.status !== 'DRAFT'} value={programForm.programCode} onChange={event => setProgramForm(item => ({ ...item, programCode: event.target.value }))} /></label><label>Program name<input required disabled={programForm.status !== 'DRAFT'} value={programForm.programName} onChange={event => setProgramForm(item => ({ ...item, programName: event.target.value }))} /></label></div><label>Published rubric<select required disabled={programForm.status !== 'DRAFT'} value={programForm.templateId} onChange={event => { setProgramForm(item => ({ ...item, templateId: event.target.value })); loadCriteria(event.target.value); }}><option value="">Select rubric version</option>{catalog.templates.map(item => <option key={item.templateId} value={item.templateId}>{item.templateName} · V{item.versionNo}</option>)}</select></label><label>Description<textarea rows="3" disabled={programForm.status !== 'DRAFT'} value={programForm.description || ''} onChange={event => setProgramForm(item => ({ ...item, description: event.target.value }))} /></label><div className="quality-form-grid thirds"><label>Pass score %<input type="number" min="0" max="100" disabled={programForm.status !== 'DRAFT'} value={programForm.passingPct} onChange={event => setProgramForm(item => ({ ...item, passingPct: event.target.value }))} /></label><label>Minimum agreement %<input type="number" min="0" max="100" disabled={programForm.status !== 'DRAFT'} value={programForm.minimumAgreementPct} onChange={event => setProgramForm(item => ({ ...item, minimumAgreementPct: event.target.value }))} /></label><label>Severity limit<input type="number" min="0" max="100" disabled={programForm.status !== 'DRAFT'} value={programForm.maximumSeverityIndex} onChange={event => setProgramForm(item => ({ ...item, maximumSeverityIndex: event.target.value }))} /></label></div><div className="quality-form-grid thirds"><label>Minimum anchors<input type="number" min="1" max="100" disabled={programForm.status !== 'DRAFT'} value={programForm.minAnchorCases} onChange={event => setProgramForm(item => ({ ...item, minAnchorCases: event.target.value }))} /></label><label>Max attempts<input type="number" min="1" max="20" disabled={programForm.status !== 'DRAFT'} value={programForm.maxAttempts} onChange={event => setProgramForm(item => ({ ...item, maxAttempts: event.target.value }))} /></label><label>Authorization days<input type="number" min="1" max="3650" disabled={programForm.status !== 'DRAFT'} value={programForm.authorizationValidDays} onChange={event => setProgramForm(item => ({ ...item, authorizationValidDays: event.target.value }))} /></label></div><label>Evaluator instructions<textarea rows="4" disabled={programForm.status !== 'DRAFT'} value={programForm.evaluatorInstructions || ''} onChange={event => setProgramForm(item => ({ ...item, evaluatorInstructions: event.target.value }))} /></label><section className="quality-anchors-builder"><div className="quality-section-head"><div><h3>Protected anchor cases</h3><p>Every active anchor must define an expected score for every rubric criterion.</p></div>{programForm.status === 'DRAFT' && criteria.length > 0 && <button type="button" className="btn small secondary" onClick={() => setProgramForm(item => ({ ...item, anchors: [...item.anchors, newAnchor(item.anchors.length, criteria, Number(item.defaultScoreTolerance || 1))] }))}>+ Anchor</button>}</div>{programForm.anchors.map((anchor, anchorIndex) => <article className="quality-anchor-builder" key={anchor.anchorId || anchorIndex}><header><div className="quality-form-grid"><label>Anchor title<input disabled={programForm.status !== 'DRAFT'} value={anchor.anchorTitle} onChange={event => updateAnchor(anchorIndex, { anchorTitle: event.target.value })} /></label><label>Anchor code<input disabled={programForm.status !== 'DRAFT'} value={anchor.anchorCode} onChange={event => updateAnchor(anchorIndex, { anchorCode: event.target.value })} /></label></div>{programForm.status === 'DRAFT' && <button type="button" onClick={() => setProgramForm(item => ({ ...item, anchors: item.anchors.filter((_, index) => index !== anchorIndex) }))}>Remove</button>}</header><label>Scenario<textarea rows="5" disabled={programForm.status !== 'DRAFT'} value={anchor.scenarioDescription} onChange={event => updateAnchor(anchorIndex, { scenarioDescription: event.target.value })} /></label><div className="quality-form-grid"><label>Evidence reference<input disabled={programForm.status !== 'DRAFT'} value={anchor.evidenceReference || ''} onChange={event => updateAnchor(anchorIndex, { evidenceReference: event.target.value })} /></label><label>Evidence URL<input disabled={programForm.status !== 'DRAFT'} value={anchor.evidenceUrl || ''} onChange={event => updateAnchor(anchorIndex, { evidenceUrl: event.target.value })} /></label></div><div className="quality-expected-grid">{anchor.expectedScores.map(expected => { const criterion = criteria.find(item => item.criterionId === expected.criterionId) || programForm.criteria?.find(item => item.criterionId === expected.criterionId); return <div key={expected.criterionId}><span>{criterion?.sectionTitle}</span><b>{criterion?.criterionTitle || expected.criterionId}</b><div><label>Expected score<input type="number" min="0" max={criterion?.maxScore} step="0.01" disabled={programForm.status !== 'DRAFT'} value={expected.expectedScore} onChange={event => updateExpected(anchorIndex, expected.criterionId, { expectedScore: event.target.value })} /></label><label>Tolerance<input type="number" min="0" step="0.01" disabled={programForm.status !== 'DRAFT'} value={expected.tolerance} onChange={event => updateExpected(anchorIndex, expected.criterionId, { tolerance: event.target.value })} /></label></div>{criterion?.critical && <label className="quality-check"><input type="checkbox" disabled={programForm.status !== 'DRAFT'} checked={Boolean(expected.expectedCriticalFail)} onChange={event => updateExpected(anchorIndex, expected.criterionId, { expectedCriticalFail: event.target.checked })} /> Expected critical fail</label>}</div>; })}</div></article>)}</section></form></div>}

      {tab === 'assign' && <div className="quality-two-column"><section className="quality-panel"><div className="quality-section-head"><div><h2>Published programs</h2><p>Assign calibration before authorization expires or when reliability requires recalibration.</p></div></div><div className="quality-card-grid">{programs.filter(item => item.status === 'PUBLISHED').map(item => <article key={item.programId}><span>{item.programCode}</span><b>{item.programName}</b><p>{item.templateName} · V{item.templateVersion}</p><small>{item.anchorCount} anchors · {item.passingPct}% pass · {item.authorizationValidDays} days</small></article>)}</div></section><form className="quality-form-card sticky" onSubmit={assignCalibration}><h2>Assign evaluator calibration</h2><label>Program<select required value={assignmentForm.programId} onChange={event => setAssignmentForm(item => ({ ...item, programId: event.target.value }))}><option value="">Select published program</option>{programs.filter(item => item.status === 'PUBLISHED').map(item => <option key={item.programId} value={item.programId}>{item.programName} · {item.templateName}</option>)}</select></label><label>Evaluator<select required value={`${assignmentForm.evaluatorType}:${assignmentForm.evaluatorId}`} onChange={event => { const [evaluatorType, ...parts] = event.target.value.split(':'); setAssignmentForm(item => ({ ...item, evaluatorType, evaluatorId: parts.join(':') })); }}><option value=":">Select evaluator</option>{catalog.evaluators.map(item => <option key={`${item.evaluatorType}:${item.evaluatorId}`} value={`${item.evaluatorType}:${item.evaluatorId}`}>{item.name || item.evaluatorId} · {item.evaluatorType} · {item.branch || 'Company'}</option>)}</select></label><label>Due date<input type="datetime-local" value={assignmentForm.dueAt} onChange={event => setAssignmentForm(item => ({ ...item, dueAt: event.target.value }))} /></label><button className="btn" disabled={busy === 'assign'}>{busy === 'assign' ? 'Assigning…' : 'Assign calibration'}</button></form></div>}

      {tab === 'authorizations' && <div className="quality-overview"><section className="quality-panel"><div className="quality-section-head"><div><h2>Authorization register</h2><p>Template-version authority, validity and audited intervention.</p></div></div><div className="quality-table authorization"><header><span>Evaluator</span><span>Rubric</span><span>Score</span><span>Valid until</span><span>Status</span><span>Actions</span></header>{dashboard.authorizations?.map(item => <div key={item.authorizationId}><span><b>{item.evaluatorName || item.evaluatorId}</b><small>{item.evaluatorId} · {item.evaluatorType}</small></span><span>{item.templateName} · V{item.templateVersion}</span><span>{Number(item.calibrationScorePct || 0).toFixed(1)}%</span><span>{formatDate(item.validUntil)}</span><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><span className="quality-row-actions">{item.status === 'ACTIVE' && <button onClick={() => authorizationAction(item, 'suspend')}>Suspend</button>}{item.status !== 'REVOKED' && <button onClick={() => authorizationAction(item, 'revoke')}>Revoke</button>}{item.status !== 'ACTIVE' && <button onClick={() => authorizationAction(item, 'restore')}>Restore</button>}</span></div>)}</div></section><section className="quality-panel"><div className="quality-section-head"><div><h2>Calibration assignment register</h2><p>Attempt outcomes and upcoming due dates.</p></div></div><div className="quality-card-grid">{dashboard.assignments?.slice(0, 100).map(item => <article key={item.assignmentId}><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.evaluatorName || item.evaluatorId}</b><p>{item.programName} · {item.templateName}</p><small>Attempt {item.attemptNo} · Due {formatDate(item.dueAt)}{item.scorePct == null ? '' : ` · ${Number(item.scorePct).toFixed(1)}%`}</small></article>)}</div></section></div>}

      {tab === 'self' && <EvaluatorSelfView role="admin" embedded />}
    </div>
  );
}
