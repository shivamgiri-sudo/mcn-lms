import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

const newCriterion = index => ({
  criterionCode: `C${index + 1}`,
  criterionTitle: '',
  description: '',
  observableBehavior: '',
  maxScore: 5,
  weightPct: 100,
  critical: false,
  criticalMinScore: 3,
  evidenceRequired: false,
  skillId: '',
  skillLevelAwarded: 1,
});

const newSection = index => ({
  sectionCode: `S${index + 1}`,
  sectionTitle: '',
  description: '',
  weightPct: 100,
  criteria: [newCriterion(0)],
});

const emptyTemplate = () => ({
  templateId: '',
  templateCode: '',
  templateName: '',
  description: '',
  learnerInstructions: '',
  evaluatorInstructions: '',
  audienceBranch: '',
  audienceProcess: '',
  audienceLob: '',
  passingPct: 70,
  maxAttempts: 2,
  evaluatorCount: 1,
  blindEvaluation: false,
  moderationThresholdPct: 15,
  sections: [newSection(0)],
});

export default function OperationsPracticalView({ role }) {
  const [tab, setTab] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [catalog, setCatalog] = useState({ templates: [], learners: [], skills: [] });
  const [templates, setTemplates] = useState([]);
  const [report, setReport] = useState({ statuses: [], templates: [], evaluators: [] });
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [myEvaluation, setMyEvaluation] = useState(null);
  const [scores, setScores] = useState({});
  const [evaluationForm, setEvaluationForm] = useState({ summary: '', strengths: '', developmentNotes: '' });
  const [assignmentForm, setAssignmentForm] = useState({ templateId: '', employeeId: '', dueAt: '' });
  const [templateForm, setTemplateForm] = useState(emptyTemplate());
  const [moderationForm, setModerationForm] = useState({ finalPercentage: '', finalResult: 'PASS', resolutionSummary: '' });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const base = `/practical/${role}`;

  async function loadAll(preferredId = '') {
    setLoading(true); setError('');
    const requests = [
      api.get(`${base}/queue`, role),
      api.get(`${base}/catalog`, role),
    ];
    if (role === 'admin') {
      requests.push(api.get('/practical/admin/templates', 'admin'));
      requests.push(api.get('/practical/admin/report/summary', 'admin'));
    }
    const results = await Promise.all(requests);
    setLoading(false);
    if (!results[0].ok) return setError(results[0].message || 'Could not load evaluation queue.');
    setQueue(results[0].data || []);
    if (results[1].ok) {
      const nextCatalog = results[1].data || { templates: [], learners: [], skills: [] };
      setCatalog(nextCatalog);
      setAssignmentForm(form => ({
        ...form,
        templateId: form.templateId || nextCatalog.templates?.[0]?.templateId || '',
        employeeId: form.employeeId || nextCatalog.learners?.[0]?.employeeId || '',
      }));
    }
    if (role === 'admin' && results[2]?.ok) setTemplates(results[2].data || []);
    if (role === 'admin' && results[3]?.ok) setReport(results[3].data || { statuses: [], templates: [], evaluators: [] });
    const nextId = preferredId || selectedId;
    if (nextId) await openAssignment(nextId);
  }

  useEffect(() => { loadAll(); }, [role]);

  async function openAssignment(assignmentId) {
    setBusy('detail'); setError('');
    const [detailResult, evaluationResult] = await Promise.all([
      api.get(`${base}/assignments/${encodeURIComponent(assignmentId)}`, role),
      api.get(`${base}/assignments/${encodeURIComponent(assignmentId)}/my-evaluation`, role),
    ]);
    setBusy('');
    if (!detailResult.ok) return setError(detailResult.message || 'Could not load assignment.');
    setSelectedId(assignmentId);
    setDetail(detailResult.data);
    const mine = evaluationResult.ok ? evaluationResult.data : null;
    setMyEvaluation(mine);
    const fullEvaluation = mine ? detailResult.data?.evaluations?.find(item => item.evaluationId === mine.evaluationId) : null;
    setEvaluationForm({
      summary: fullEvaluation?.summary || mine?.summary || '',
      strengths: fullEvaluation?.strengths || mine?.strengths || '',
      developmentNotes: fullEvaluation?.developmentNotes || mine?.developmentNotes || '',
    });
    const scoreState = {};
    for (const section of detailResult.data?.template?.sections || []) {
      for (const criterion of section.criteria || []) {
        const existing = fullEvaluation?.scores?.find(item => item.criterionId === criterion.criterionId);
        scoreState[criterion.criterionId] = {
          rawScore: existing?.rawScore ?? '',
          ratingLabel: existing?.ratingLabel || '',
          observationNotes: existing?.observationNotes || '',
          evidenceReference: existing?.evidenceReference || '',
        };
      }
    }
    setScores(scoreState);
    if (detailResult.data?.moderation) {
      const evaluations = detailResult.data.evaluations || [];
      const average = evaluations.length ? evaluations.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / evaluations.length : '';
      setModerationForm({
        finalPercentage: detailResult.data.moderation.finalPercentage ?? (average === '' ? '' : average.toFixed(2)),
        finalResult: detailResult.data.moderation.finalResult || 'PASS',
        resolutionSummary: detailResult.data.moderation.resolutionSummary || '',
      });
    }
  }

  async function claimEvaluation() {
    if (!detail) return;
    setBusy('claim'); setError(''); setMessage('');
    const result = await api.post(`${base}/assignments/${encodeURIComponent(detail.assignmentId)}/claim`, {}, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not claim evaluator slot.');
    setMessage('Evaluator slot claimed. Peer scores remain hidden until independent reviews are submitted.');
    await openAssignment(detail.assignmentId);
    await loadAll(detail.assignmentId);
  }

  function scorePayload() {
    return Object.entries(scores).map(([criterionId, value]) => ({ criterionId, ...value }));
  }

  async function saveEvaluation(submit = false) {
    if (!myEvaluation) return;
    if (submit && !window.confirm('Submit and permanently lock this independent evaluation?')) return;
    setBusy(submit ? 'submit-evaluation' : 'save-evaluation'); setError(''); setMessage('');
    const payload = { scores: scorePayload(), ...evaluationForm };
    const result = submit
      ? await api.post(`${base}/evaluations/${encodeURIComponent(myEvaluation.evaluationId)}/submit`, payload, role)
      : await api.put(`${base}/evaluations/${encodeURIComponent(myEvaluation.evaluationId)}`, payload, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save evaluation.');
    setMessage(result.message || 'Evaluation saved.');
    setDetail(result.data);
    await loadAll(result.data.assignmentId);
  }

  async function assignAssessment(event) {
    event.preventDefault();
    setBusy('assign'); setError(''); setMessage('');
    const result = await api.post(`${base}/assignments`, assignmentForm, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not assign practical assessment.');
    setMessage(result.message || 'Practical assessment assigned.');
    setTab('queue');
    await loadAll(result.data.assignmentId);
  }

  async function loadTemplate(templateId) {
    setBusy('template-detail'); setError('');
    const result = await api.get(`/practical/admin/templates/${encodeURIComponent(templateId)}`, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load rubric template.');
    setTemplateForm({
      ...emptyTemplate(),
      ...result.data,
      sections: (result.data.sections || []).map(section => ({
        ...section,
        criteria: (section.criteria || []).map(item => ({ ...item, skillId: item.skillId || '', skillLevelAwarded: item.skillLevelAwarded || 1 })),
      })),
    });
    setTab('templates');
  }

  function updateSection(sectionIndex, patch) {
    setTemplateForm(form => ({ ...form, sections: form.sections.map((section, index) => index === sectionIndex ? { ...section, ...patch } : section) }));
  }

  function updateCriterion(sectionIndex, criterionIndex, patch) {
    setTemplateForm(form => ({
      ...form,
      sections: form.sections.map((section, index) => index === sectionIndex
        ? { ...section, criteria: section.criteria.map((criterion, cIndex) => cIndex === criterionIndex ? { ...criterion, ...patch } : criterion) }
        : section),
    }));
  }

  async function saveTemplate(event) {
    event.preventDefault();
    setBusy('template'); setError(''); setMessage('');
    const result = templateForm.templateId
      ? await api.put(`/practical/admin/templates/${encodeURIComponent(templateForm.templateId)}`, templateForm, 'admin')
      : await api.post('/practical/admin/templates', templateForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save rubric template.');
    setTemplateForm({ ...templateForm, ...result.data });
    setMessage(result.message || 'Rubric template saved.');
    await loadAll(selectedId);
  }

  async function publishCurrent() {
    if (!templateForm.templateId || !window.confirm('Publish and lock this rubric version? Future changes require a new version.')) return;
    setBusy('publish'); setError('');
    const result = await api.post(`/practical/admin/templates/${encodeURIComponent(templateForm.templateId)}/publish`, {}, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not publish rubric.');
    setTemplateForm({ ...templateForm, ...result.data });
    setMessage('Rubric version published and locked.');
    await loadAll(selectedId);
  }

  async function versionCurrent() {
    if (!templateForm.templateId) return;
    setBusy('version'); setError('');
    const result = await api.post(`/practical/admin/templates/${encodeURIComponent(templateForm.templateId)}/version`, {}, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not create rubric version.');
    setTemplateForm({ ...emptyTemplate(), ...result.data, sections: result.data.sections || [] });
    setMessage('New draft rubric version created.');
    await loadAll(selectedId);
  }

  async function resolveCase(event) {
    event.preventDefault();
    if (!detail?.moderation) return;
    setBusy('moderation'); setError(''); setMessage('');
    const result = await api.post(`/practical/admin/moderation/${encodeURIComponent(detail.moderation.caseId)}/resolve`, moderationForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not resolve moderation.');
    setMessage(result.message || 'Moderation resolved.');
    setDetail(result.data);
    await loadAll(result.data.assignmentId);
  }

  const filteredQueue = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return queue;
    return queue.filter(item => [item.employeeId, item.traineeName, item.batchNo, item.templateName, item.status].some(value => String(value || '').toLowerCase().includes(term)));
  }, [queue, search]);

  const metrics = useMemo(() => ({
    waiting: queue.filter(item => item.status === 'SUBMITTED').length,
    evaluating: queue.filter(item => item.status === 'EVALUATING').length,
    moderation: queue.filter(item => item.status === 'MODERATION_REQUIRED').length,
    completed: queue.filter(item => ['PASSED', 'FAILED'].includes(item.status)).length,
  }), [queue]);

  if (loading) return <div className="practical-loading"><div className="spinner" /><p>Loading practical assessment operations…</p></div>;

  const canClaim = detail && ['SUBMITTED', 'EVALUATING'].includes(detail.status) && !myEvaluation;
  const canEvaluate = myEvaluation?.status === 'DRAFT';
  return (
    <div className="practical-view">
      <section className="practical-hero operations"><div><span>{role === 'admin' ? 'Branch and company governance' : 'Owned-batch evaluation'}</span><h1>{role === 'admin' ? 'Practical Assessment Governance' : 'Evaluation Workspace'}</h1><p>Independent rubric scoring, critical-fail controls, moderation and evidence-backed competency outcomes.</p></div><div className="practical-metrics"><article><span>Waiting</span><b>{metrics.waiting}</b></article><article><span>Evaluating</span><b>{metrics.evaluating}</b></article><article><span>Moderation</span><b>{metrics.moderation}</b></article><article><span>Completed</span><b>{metrics.completed}</b></article></div></section>
      {message && <div className="practical-toast ok">{message}</div>}
      {error && <div className="practical-toast bad">{error}</div>}
      <nav className="practical-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Evaluation queue</button><button className={tab === 'assign' ? 'active' : ''} onClick={() => setTab('assign')}>Assign assessment</button>{role === 'admin' && <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Rubric builder</button>}{role === 'admin' && <button className={tab === 'moderation' ? 'active' : ''} onClick={() => setTab('moderation')}>Moderation</button>}{role === 'admin' && <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>Analytics</button>}</nav>

      {tab === 'queue' && <div className="practical-layout operations-layout">
        <aside className="practical-list-panel"><div className="practical-section-head"><div><h2>Work queue</h2><p>Prioritized by moderation, submission and due date.</p></div><button onClick={() => loadAll(selectedId)}>↻</button></div><input className="practical-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee, batch, template or status" /><div className="practical-assignment-list">{filteredQueue.map(item => <button key={item.assignmentId} className={selectedId === item.assignmentId ? 'active' : ''} onClick={() => openAssignment(item.assignmentId)}><div><span className={`practical-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.traineeName || item.employeeId}</b></div><small>{item.employeeId} · {item.batchNo || 'No batch'}</small><small>{item.templateName} · V{item.versionNo}</small><small>{item.submittedEvaluations}/{item.evaluatorCount} evaluations submitted</small></button>)}{!filteredQueue.length && <div className="practical-empty"><b>No matching work</b><p>The scoped practical assessment queue is clear.</p></div>}</div></aside>
        <section className="practical-detail-panel">
          {busy === 'detail' && <div className="practical-loading compact"><div className="spinner" /></div>}
          {!detail && busy !== 'detail' && <div className="practical-empty large"><b>Select a learner submission</b><p>Open an assignment to inspect evidence, claim a slot and score the rubric.</p></div>}
          {detail && <><header className="practical-detail-head"><div><span className={`practical-status ${statusClass(detail.status)}`}>{detail.status}</span><h2>{detail.traineeName || detail.employeeId}</h2><p>{detail.employeeId} · {detail.batchNo || 'No batch'} · {detail.templateName} V{detail.versionNo}</p></div><div><b>{detail.finalPercentage == null ? `${detail.passingPct}%` : `${Number(detail.finalPercentage).toFixed(1)}%`}</b><span>{detail.finalPercentage == null ? 'Passing threshold' : detail.finalResult}</span></div></header>
            <div className="practical-info-grid"><article><span>Submitted</span><b>{formatDate(detail.submittedAt)}</b></article><article><span>Due</span><b>{formatDate(detail.dueAt)}</b></article><article><span>Review model</span><b>{detail.evaluatorCount} evaluator{Number(detail.evaluatorCount) > 1 ? 's' : ''}</b><small>{detail.blindEvaluation ? 'Blind independent scoring' : 'Standard scoring'}</small></article><article><span>Critical fail</span><b>{detail.criticalFail ? 'Yes' : 'No'}</b></article></div>
            {detail.submission && <div className="practical-callout"><b>Learner statement</b><p>{detail.submission.learnerStatement || 'No statement provided.'}</p>{detail.evidence?.map(item => <a key={item.evidenceId} href={item.referenceUrl || '#'} target={item.referenceUrl ? '_blank' : undefined} rel="noreferrer"><strong>{item.evidenceTitle}</strong><span>{item.evidenceType} · {item.referenceId || item.referenceUrl || item.notes}</span></a>)}</div>}
            {canClaim && <div className="practical-claim"><div><b>Independent evaluator slot available</b><p>Claiming locks one evaluator slot to your account. In blind mode, peer scores remain hidden until both reviews are submitted.</p></div><button className="btn" disabled={busy === 'claim'} onClick={claimEvaluation}>{busy === 'claim' ? 'Claiming…' : 'Claim evaluator slot'}</button></div>}
            {myEvaluation && <div className="practical-evaluator-banner"><span>Your evaluator slot</span><b>Evaluator {myEvaluation.evaluatorSlot} · {myEvaluation.status}</b>{detail.blindEvaluation && <small>Blind review safeguards are active.</small>}</div>}
            {canEvaluate && <section className="practical-evaluation-form"><div className="practical-section-head"><div><h3>Rubric evaluation</h3><p>Scores are calculated on the server. Required evidence and critical thresholds are enforced on submission.</p></div></div>{detail.template?.sections?.map(section => <article className="practical-rubric-section evaluator" key={section.sectionId}><header><div><b>{section.sectionTitle}</b><span>{section.sectionCode}</span></div><strong>{section.weightPct}%</strong></header>{section.criteria.map(criterion => { const value = scores[criterion.criterionId] || {}; return <div className="practical-score-row" key={criterion.criterionId}><div><b>{criterion.criterionTitle}{criterion.critical && <em>Critical ≥ {criterion.criticalMinScore}/{criterion.maxScore}</em>}</b><p>{criterion.observableBehavior || criterion.description}</p>{criterion.skillName && <small>Skill: {criterion.skillName}</small>}</div><aside><label>Score / {criterion.maxScore}<input type="number" min="0" max={criterion.maxScore} step="0.01" value={value.rawScore} onChange={event => setScores(items => ({ ...items, [criterion.criterionId]: { ...value, rawScore: event.target.value } }))} /></label><label>Rating<input value={value.ratingLabel} onChange={event => setScores(items => ({ ...items, [criterion.criterionId]: { ...value, ratingLabel: event.target.value } }))} placeholder="Meets / exceeds…" /></label></aside><label>Observation notes<textarea rows="3" value={value.observationNotes} onChange={event => setScores(items => ({ ...items, [criterion.criterionId]: { ...value, observationNotes: event.target.value } }))} /></label><label>Evidence reference {criterion.evidenceRequired && <strong>Required</strong>}<input value={value.evidenceReference} onChange={event => setScores(items => ({ ...items, [criterion.criterionId]: { ...value, evidenceReference: event.target.value } }))} /></label></div>; })}</article>)}<label>Evaluator summary<textarea rows="5" value={evaluationForm.summary} onChange={event => setEvaluationForm(form => ({ ...form, summary: event.target.value }))} placeholder="Summarize the observed performance and overall judgment." /></label><div className="practical-form-grid"><label>Strengths<textarea rows="4" value={evaluationForm.strengths} onChange={event => setEvaluationForm(form => ({ ...form, strengths: event.target.value }))} /></label><label>Development notes<textarea rows="4" value={evaluationForm.developmentNotes} onChange={event => setEvaluationForm(form => ({ ...form, developmentNotes: event.target.value }))} /></label></div><div className="practical-actions"><button className="btn secondary" disabled={Boolean(busy)} onClick={() => saveEvaluation(false)}>{busy === 'save-evaluation' ? 'Saving…' : 'Save draft'}</button><button className="btn" disabled={Boolean(busy)} onClick={() => saveEvaluation(true)}>{busy === 'submit-evaluation' ? 'Submitting…' : 'Submit & lock evaluation'}</button></div></section>}
            {detail.evaluations?.filter(item => item.status === 'SUBMITTED').length > 0 && <section className="practical-submitted"><h3>Submitted evaluations</h3><div>{detail.evaluations.filter(item => item.status === 'SUBMITTED').map(item => <article key={item.evaluationId}><b>Evaluator {item.evaluatorSlot}</b><span>{item.percentage == null ? 'Blind score hidden' : `${Number(item.percentage).toFixed(1)}% · ${item.result}`}</span><p>{item.summary || 'Independent feedback remains hidden until the review gate is complete.'}</p></article>)}</div></section>}
          </>}
        </section>
      </div>}

      {tab === 'assign' && <div className="practical-admin-grid"><section className="practical-admin-panel"><div className="practical-section-head"><div><h2>Assignment coverage</h2><p>Select a published rubric and an in-scope active learner.</p></div></div><div className="practical-catalog-list">{catalog.templates.map(item => <article key={item.templateId}><span>{item.templateCode} · V{item.versionNo}</span><b>{item.templateName}</b><p>{item.passingPct}% pass · {item.evaluatorCount} evaluator(s) · {item.maxAttempts} attempts</p></article>)}</div></section><form className="practical-form-card sticky" onSubmit={assignAssessment}><h2>Assign practical assessment</h2><label>Published rubric<select required value={assignmentForm.templateId} onChange={event => setAssignmentForm(form => ({ ...form, templateId: event.target.value }))}><option value="">Select rubric</option>{catalog.templates.map(item => <option key={item.templateId} value={item.templateId}>{item.templateName} · V{item.versionNo}</option>)}</select></label><label>Learner<select required value={assignmentForm.employeeId} onChange={event => setAssignmentForm(form => ({ ...form, employeeId: event.target.value }))}><option value="">Select learner</option>{catalog.learners.map(item => <option key={item.employeeId} value={item.employeeId}>{item.traineeName || item.employeeId} · {item.employeeId} · {item.batchNo || 'No batch'}</option>)}</select></label><label>Due date<input type="datetime-local" value={assignmentForm.dueAt} onChange={event => setAssignmentForm(form => ({ ...form, dueAt: event.target.value }))} /></label><button className="btn" disabled={busy === 'assign'}>{busy === 'assign' ? 'Assigning…' : 'Assign assessment'}</button></form></div>}

      {tab === 'templates' && role === 'admin' && <div className="practical-template-layout"><aside className="practical-list-panel"><div className="practical-section-head"><div><h2>Rubric versions</h2><p>Published versions are immutable.</p></div><button onClick={() => setTemplateForm(emptyTemplate())}>＋</button></div><div className="practical-assignment-list">{templates.map(item => <button key={item.templateId} onClick={() => loadTemplate(item.templateId)} className={templateForm.templateId === item.templateId ? 'active' : ''}><div><span className={`practical-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.templateName}</b></div><small>{item.templateCode} · V{item.versionNo}</small><small>{item.evaluatorCount} evaluator(s) · {item.passingPct}% pass</small></button>)}</div></aside><form className="practical-template-builder" onSubmit={saveTemplate}><header><div><span>{templateForm.templateId ? `Version ${templateForm.versionNo}` : 'New rubric'}</span><h2>{templateForm.templateName || 'Practical assessment rubric'}</h2></div><div>{templateForm.status === 'PUBLISHED' && <button type="button" className="btn secondary" onClick={versionCurrent} disabled={busy === 'version'}>Create new version</button>}{(!templateForm.status || templateForm.status === 'DRAFT') && <button type="submit" className="btn secondary" disabled={busy === 'template'}>{busy === 'template' ? 'Saving…' : 'Save draft'}</button>}{templateForm.templateId && templateForm.status === 'DRAFT' && <button type="button" className="btn" onClick={publishCurrent} disabled={busy === 'publish'}>{busy === 'publish' ? 'Publishing…' : 'Publish & lock'}</button>}</div></header><div className="practical-form-grid"><label>Template code<input required disabled={templateForm.status === 'PUBLISHED'} value={templateForm.templateCode} onChange={event => setTemplateForm(form => ({ ...form, templateCode: event.target.value }))} /></label><label>Template name<input required disabled={templateForm.status === 'PUBLISHED'} value={templateForm.templateName} onChange={event => setTemplateForm(form => ({ ...form, templateName: event.target.value }))} /></label></div><label>Description<textarea rows="3" disabled={templateForm.status === 'PUBLISHED'} value={templateForm.description || ''} onChange={event => setTemplateForm(form => ({ ...form, description: event.target.value }))} /></label><div className="practical-form-grid thirds"><label>Passing %<input type="number" min="0" max="100" disabled={templateForm.status === 'PUBLISHED'} value={templateForm.passingPct} onChange={event => setTemplateForm(form => ({ ...form, passingPct: event.target.value }))} /></label><label>Max attempts<input type="number" min="1" max="20" disabled={templateForm.status === 'PUBLISHED'} value={templateForm.maxAttempts} onChange={event => setTemplateForm(form => ({ ...form, maxAttempts: event.target.value }))} /></label><label>Evaluators<select disabled={templateForm.status === 'PUBLISHED'} value={templateForm.evaluatorCount} onChange={event => setTemplateForm(form => ({ ...form, evaluatorCount: Number(event.target.value) }))}><option value="1">1 evaluator</option><option value="2">2 independent evaluators</option></select></label></div><div className="practical-form-grid"><label>Moderation variance %<input type="number" min="0" max="100" disabled={templateForm.status === 'PUBLISHED'} value={templateForm.moderationThresholdPct} onChange={event => setTemplateForm(form => ({ ...form, moderationThresholdPct: event.target.value }))} /></label><label className="practical-check"><input type="checkbox" disabled={templateForm.status === 'PUBLISHED'} checked={Boolean(templateForm.blindEvaluation)} onChange={event => setTemplateForm(form => ({ ...form, blindEvaluation: event.target.checked }))} /> Blind independent evaluation</label></div><div className="practical-form-grid"><label>Process audience<input disabled={templateForm.status === 'PUBLISHED'} value={templateForm.audienceProcess || ''} onChange={event => setTemplateForm(form => ({ ...form, audienceProcess: event.target.value }))} placeholder="Blank = all" /></label><label>LOB audience<input disabled={templateForm.status === 'PUBLISHED'} value={templateForm.audienceLob || ''} onChange={event => setTemplateForm(form => ({ ...form, audienceLob: event.target.value }))} placeholder="Blank = all" /></label></div><label>Learner instructions<textarea rows="4" disabled={templateForm.status === 'PUBLISHED'} value={templateForm.learnerInstructions || ''} onChange={event => setTemplateForm(form => ({ ...form, learnerInstructions: event.target.value }))} /></label><label>Evaluator instructions<textarea rows="4" disabled={templateForm.status === 'PUBLISHED'} value={templateForm.evaluatorInstructions || ''} onChange={event => setTemplateForm(form => ({ ...form, evaluatorInstructions: event.target.value }))} /></label><section className="practical-builder-sections"><div className="practical-section-head"><div><h3>Rubric sections</h3><p>Section weights must total 100%; criteria within each section must also total 100%.</p></div>{templateForm.status !== 'PUBLISHED' && <button type="button" className="btn small secondary" onClick={() => setTemplateForm(form => ({ ...form, sections: [...form.sections, newSection(form.sections.length)] }))}>+ Section</button>}</div>{templateForm.sections.map((section, sectionIndex) => <article key={sectionIndex} className="practical-builder-section"><header><div className="practical-form-grid"><label>Section title<input disabled={templateForm.status === 'PUBLISHED'} value={section.sectionTitle} onChange={event => updateSection(sectionIndex, { sectionTitle: event.target.value })} /></label><label>Section weight %<input type="number" min="0.01" max="100" disabled={templateForm.status === 'PUBLISHED'} value={section.weightPct} onChange={event => updateSection(sectionIndex, { weightPct: event.target.value })} /></label></div>{templateForm.status !== 'PUBLISHED' && <button type="button" onClick={() => setTemplateForm(form => ({ ...form, sections: form.sections.filter((_, index) => index !== sectionIndex) }))} disabled={templateForm.sections.length === 1}>Remove section</button>}</header><label>Section description<textarea rows="2" disabled={templateForm.status === 'PUBLISHED'} value={section.description || ''} onChange={event => updateSection(sectionIndex, { description: event.target.value })} /></label>{section.criteria.map((criterion, criterionIndex) => <div className="practical-builder-criterion" key={criterionIndex}><div className="practical-form-grid"><label>Criterion title<input disabled={templateForm.status === 'PUBLISHED'} value={criterion.criterionTitle} onChange={event => updateCriterion(sectionIndex, criterionIndex, { criterionTitle: event.target.value })} /></label><label>Weight %<input type="number" min="0.01" max="100" disabled={templateForm.status === 'PUBLISHED'} value={criterion.weightPct} onChange={event => updateCriterion(sectionIndex, criterionIndex, { weightPct: event.target.value })} /></label><label>Max score<input type="number" min="0.01" disabled={templateForm.status === 'PUBLISHED'} value={criterion.maxScore} onChange={event => updateCriterion(sectionIndex, criterionIndex, { maxScore: event.target.value })} /></label></div><label>Observable behavior<textarea rows="2" disabled={templateForm.status === 'PUBLISHED'} value={criterion.observableBehavior || ''} onChange={event => updateCriterion(sectionIndex, criterionIndex, { observableBehavior: event.target.value })} /></label><div className="practical-form-grid thirds"><label className="practical-check"><input type="checkbox" disabled={templateForm.status === 'PUBLISHED'} checked={Boolean(criterion.critical)} onChange={event => updateCriterion(sectionIndex, criterionIndex, { critical: event.target.checked })} /> Critical criterion</label><label>Critical minimum<input type="number" min="0" max={criterion.maxScore} disabled={templateForm.status === 'PUBLISHED' || !criterion.critical} value={criterion.criticalMinScore} onChange={event => updateCriterion(sectionIndex, criterionIndex, { criticalMinScore: event.target.value })} /></label><label className="practical-check"><input type="checkbox" disabled={templateForm.status === 'PUBLISHED'} checked={Boolean(criterion.evidenceRequired)} onChange={event => updateCriterion(sectionIndex, criterionIndex, { evidenceRequired: event.target.checked })} /> Evidence required</label></div><div className="practical-form-grid"><label>Skill mapping<select disabled={templateForm.status === 'PUBLISHED'} value={criterion.skillId || ''} onChange={event => updateCriterion(sectionIndex, criterionIndex, { skillId: event.target.value })}><option value="">No skill mapping</option>{catalog.skills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.skillName} · {skill.category}</option>)}</select></label><label>Max skill level<input type="number" min="1" max="10" disabled={templateForm.status === 'PUBLISHED' || !criterion.skillId} value={criterion.skillLevelAwarded || 1} onChange={event => updateCriterion(sectionIndex, criterionIndex, { skillLevelAwarded: event.target.value })} /></label></div>{templateForm.status !== 'PUBLISHED' && <button type="button" className="btn small secondary" onClick={() => updateSection(sectionIndex, { criteria: section.criteria.filter((_, index) => index !== criterionIndex) })} disabled={section.criteria.length === 1}>Remove criterion</button>}</div>)}{templateForm.status !== 'PUBLISHED' && <button type="button" className="btn small secondary" onClick={() => updateSection(sectionIndex, { criteria: [...section.criteria, newCriterion(section.criteria.length)] })}>+ Criterion</button>}</article>)}</section></form></div>}

      {tab === 'moderation' && role === 'admin' && <div className="practical-layout operations-layout"><aside className="practical-list-panel"><div className="practical-section-head"><div><h2>Moderation queue</h2><p>Variance and critical-disagreement cases.</p></div></div><div className="practical-assignment-list">{queue.filter(item => item.status === 'MODERATION_REQUIRED').map(item => <button key={item.assignmentId} className={selectedId === item.assignmentId ? 'active' : ''} onClick={() => openAssignment(item.assignmentId)}><div><span className="practical-status moderation-required">MODERATION</span><b>{item.traineeName || item.employeeId}</b></div><small>{item.templateName} · {item.batchNo}</small></button>)}{!queue.some(item => item.status === 'MODERATION_REQUIRED') && <div className="practical-empty"><b>No open moderation cases</b><p>Independent evaluator outcomes are within configured tolerance.</p></div>}</div></aside><section className="practical-detail-panel">{detail?.moderation?.status === 'OPEN' ? <><header className="practical-detail-head"><div><span className="practical-status moderation-required">{detail.moderation.reasonCode}</span><h2>{detail.traineeName}</h2><p>{detail.templateName} · Score variance {Number(detail.moderation.scoreVariancePct || 0).toFixed(1)}%</p></div></header><div className="practical-comparison">{detail.evaluations.map(item => <article key={item.evaluationId}><span>Evaluator {item.evaluatorSlot}</span><b>{Number(item.percentage || 0).toFixed(1)}% · {item.result}</b><p>{item.summary}</p><small>{item.criticalFail ? 'Critical fail recorded' : 'No critical fail'}</small></article>)}</div><form className="practical-form-card" onSubmit={resolveCase}><div className="practical-form-grid"><label>Final percentage<input required type="number" min="0" max="100" step="0.01" value={moderationForm.finalPercentage} onChange={event => setModerationForm(form => ({ ...form, finalPercentage: event.target.value }))} /></label><label>Final result<select value={moderationForm.finalResult} onChange={event => setModerationForm(form => ({ ...form, finalResult: event.target.value }))}><option>PASS</option><option>FAIL</option></select></label></div><label>Moderation resolution<textarea required rows="6" value={moderationForm.resolutionSummary} onChange={event => setModerationForm(form => ({ ...form, resolutionSummary: event.target.value }))} placeholder="Document the evidence considered, variance resolution and final decision." /></label><button className="btn" disabled={busy === 'moderation'}>{busy === 'moderation' ? 'Resolving…' : 'Resolve and issue final result'}</button></form></> : <div className="practical-empty large"><b>Select an open moderation case</b><p>Compare independent evaluations and record an auditable final decision.</p></div>}</section></div>}

      {tab === 'report' && role === 'admin' && <div className="practical-report"><section><div className="practical-section-head"><div><h2>Lifecycle status</h2><p>Scoped assignment distribution and finalized scores.</p></div></div><div className="practical-report-grid">{report.statuses.map(item => <article key={item.status}><span>{item.status}</span><b>{item.count}</b><small>{item.averagePercentage == null ? 'No final scores' : `${Number(item.averagePercentage).toFixed(1)}% average`}</small></article>)}</div></section><section><div className="practical-section-head"><div><h2>Rubric performance</h2><p>Attempt volume, pass/fail outcomes and average scores.</p></div></div><div className="practical-table"><header><span>Rubric</span><span>Assigned</span><span>Passed</span><span>Failed</span><span>Average</span></header>{report.templates.map(item => <div key={item.templateId}><span>{item.templateName} · V{item.versionNo}</span><span>{item.assigned}</span><span>{item.passed}</span><span>{item.failed}</span><span>{item.averagePercentage == null ? '—' : `${Number(item.averagePercentage).toFixed(1)}%`}</span></div>)}</div></section><section><div className="practical-section-head"><div><h2>Evaluator activity</h2><p>Review throughput and submitted scoring patterns.</p></div></div><div className="practical-table four"><header><span>Evaluator</span><span>Evaluations</span><span>Submitted</span><span>Average</span></header>{report.evaluators.map(item => <div key={`${item.evaluatorType}-${item.evaluatorId}`}><span>{item.evaluatorId} · {item.evaluatorType}</span><span>{item.evaluations}</span><span>{item.submitted}</span><span>{item.averagePercentage == null ? '—' : `${Number(item.averagePercentage).toFixed(1)}%`}</span></div>)}</div></section></div>}
    </div>
  );
}
