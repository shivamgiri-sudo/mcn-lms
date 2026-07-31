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

const blankEvidence = () => ({ evidenceType: 'URL', evidenceTitle: '', referenceId: '', referenceUrl: '', notes: '' });

export default function LearnerPracticalView() {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [statement, setStatement] = useState('');
  const [evidence, setEvidence] = useState([blankEvidence()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadAssignments(preferredId = '') {
    setLoading(true); setError('');
    const result = await api.get('/practical/me', 'trainee');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load practical assessments.');
    const rows = result.data || [];
    setAssignments(rows);
    const next = preferredId || selectedId || rows[0]?.assignmentId || '';
    setSelectedId(next);
    if (next) await loadDetail(next);
    else setDetail(null);
  }

  async function loadDetail(assignmentId) {
    setBusy('detail'); setError('');
    const result = await api.get(`/practical/me/assignments/${encodeURIComponent(assignmentId)}`, 'trainee');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load assessment detail.');
    setDetail(result.data);
    setStatement(result.data?.submission?.learnerStatement || '');
    setEvidence(result.data?.evidence?.length ? result.data.evidence.map(item => ({
      evidenceType: item.evidenceType || 'URL',
      evidenceTitle: item.evidenceTitle || '',
      referenceId: item.referenceId || '',
      referenceUrl: item.referenceUrl || '',
      notes: item.notes || '',
    })) : [blankEvidence()]);
  }

  useEffect(() => { loadAssignments(); }, []);

  async function save(submit = false) {
    if (!detail) return;
    if (submit && !window.confirm('Submit this practical assessment for locked evaluator review?')) return;
    setBusy(submit ? 'submit' : 'save'); setMessage(''); setError('');
    const payload = { learnerStatement: statement, evidence: evidence.filter(item => item.evidenceTitle.trim()) };
    const result = submit
      ? await api.post(`/practical/me/assignments/${encodeURIComponent(detail.assignmentId)}/submit`, payload, 'trainee')
      : await api.put(`/practical/me/assignments/${encodeURIComponent(detail.assignmentId)}/submission`, payload, 'trainee');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save practical assessment.');
    setMessage(result.message || (submit ? 'Submitted for evaluation.' : 'Draft saved.'));
    setDetail(result.data);
    await loadAssignments(detail.assignmentId);
  }

  const metrics = useMemo(() => ({
    open: assignments.filter(item => ['ASSIGNED', 'IN_PROGRESS'].includes(item.status)).length,
    review: assignments.filter(item => ['SUBMITTED', 'EVALUATING', 'MODERATION_REQUIRED'].includes(item.status)).length,
    passed: assignments.filter(item => item.status === 'PASSED').length,
    failed: assignments.filter(item => item.status === 'FAILED').length,
  }), [assignments]);

  if (loading) return <div className="practical-loading"><div className="spinner" /><p>Loading practical assessment evidence…</p></div>;

  const editable = detail && ['ASSIGNED', 'IN_PROGRESS'].includes(detail.status);
  return (
    <div className="practical-view">
      <section className="practical-hero learner"><div><span>Observed capability</span><h1>My Practical Assessments</h1><p>Submit evidence, understand the rubric before review, and receive locked evaluator feedback after finalization.</p></div><div className="practical-metrics"><article><span>Open</span><b>{metrics.open}</b></article><article><span>In review</span><b>{metrics.review}</b></article><article><span>Passed</span><b>{metrics.passed}</b></article><article><span>Failed</span><b>{metrics.failed}</b></article></div></section>
      {message && <div className="practical-toast ok">{message}</div>}
      {error && <div className="practical-toast bad">{error}</div>}
      <div className="practical-layout">
        <aside className="practical-list-panel">
          <div className="practical-section-head"><div><h2>Assignments</h2><p>{assignments.length} practical assessment attempt(s)</p></div><button onClick={() => loadAssignments(selectedId)}>↻</button></div>
          <div className="practical-assignment-list">
            {assignments.map(item => <button key={item.assignmentId} className={selectedId === item.assignmentId ? 'active' : ''} onClick={() => { setSelectedId(item.assignmentId); loadDetail(item.assignmentId); }}><div><span className={`practical-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.templateName}</b></div><small>{item.templateCode} · V{item.versionNo} · Attempt {item.attemptNo}</small><small>Due {formatDate(item.dueAt)}</small>{item.finalPercentage != null && <strong>{Number(item.finalPercentage).toFixed(1)}% · {item.finalResult}</strong>}</button>)}
            {!assignments.length && <div className="practical-empty"><b>No practical assessments assigned</b><p>Your assigned observations and evidence tasks will appear here.</p></div>}
          </div>
        </aside>

        <section className="practical-detail-panel">
          {busy === 'detail' && <div className="practical-loading compact"><div className="spinner" /></div>}
          {!detail && busy !== 'detail' && <div className="practical-empty large"><b>Select an assignment</b><p>Open a practical assessment to review the scoring rubric and evidence requirements.</p></div>}
          {detail && <>
            <header className="practical-detail-head"><div><span className={`practical-status ${statusClass(detail.status)}`}>{detail.status}</span><h2>{detail.templateName}</h2><p>{detail.templateCode} · Version {detail.versionNo} · Attempt {detail.attemptNo}</p></div><div><b>{detail.passingPct}%</b><span>Passing threshold</span></div></header>
            <div className="practical-info-grid"><article><span>Assigned</span><b>{formatDate(detail.assignedAt)}</b></article><article><span>Due</span><b>{formatDate(detail.dueAt)}</b></article><article><span>Evaluators</span><b>{detail.evaluatorCount}</b><small>{detail.blindEvaluation ? 'Blind review enabled' : 'Standard review'}</small></article><article><span>Result</span><b>{detail.finalResult || 'Pending'}</b><small>{detail.finalPercentage == null ? 'Not finalized' : `${Number(detail.finalPercentage).toFixed(1)}%`}</small></article></div>

            {detail.learnerInstructions && <div className="practical-callout"><b>Learner instructions</b><p>{detail.learnerInstructions}</p></div>}

            <section className="practical-rubric"><div className="practical-section-head"><div><h3>Scoring rubric</h3><p>Critical criteria can force an overall fail even when the weighted score passes.</p></div></div>{detail.template?.sections?.map(section => <article className="practical-rubric-section" key={section.sectionId}><header><div><b>{section.sectionTitle}</b><span>{section.sectionCode}</span></div><strong>{Number(section.weightPct)}%</strong></header>{section.description && <p>{section.description}</p>}<div>{section.criteria.map(criterion => <div className="practical-criterion" key={criterion.criterionId}><div><b>{criterion.criterionTitle}{criterion.critical && <em>Critical</em>}</b><span>{criterion.observableBehavior || criterion.description || 'Observed performance against this criterion.'}</span>{criterion.skillName && <small>Skill evidence: {criterion.skillName} · Up to level {criterion.skillLevelAwarded}</small>}</div><aside><strong>{criterion.maxScore} pts</strong><span>{criterion.weightPct}% of section</span>{criterion.evidenceRequired && <small>Evidence required</small>}</aside></div>)}</div></article>)}</section>

            {editable && <section className="practical-submission-form"><div className="practical-section-head"><div><h3>Your evidence submission</h3><p>Save drafts until ready. Submitted evidence is locked for evaluator review.</p></div></div><label>Learner statement<textarea rows="6" value={statement} onChange={event => setStatement(event.target.value)} placeholder="Describe what you completed, the approach used, and the outcome achieved." /></label><div className="practical-evidence-list">{evidence.map((item, index) => <article key={index}><div className="practical-form-grid"><label>Evidence type<select value={item.evidenceType} onChange={event => setEvidence(values => values.map((value, i) => i === index ? { ...value, evidenceType: event.target.value } : value))}><option>URL</option><option>FILE_REFERENCE</option><option>RECORDING_REFERENCE</option><option>OBSERVATION</option><option>NOTE</option></select></label><label>Evidence title<input value={item.evidenceTitle} onChange={event => setEvidence(values => values.map((value, i) => i === index ? { ...value, evidenceTitle: event.target.value } : value))} placeholder="Call recording, work sample, observation…" /></label></div><div className="practical-form-grid"><label>Reference / file ID<input value={item.referenceId} onChange={event => setEvidence(values => values.map((value, i) => i === index ? { ...value, referenceId: event.target.value } : value))} /></label><label>URL<input value={item.referenceUrl} onChange={event => setEvidence(values => values.map((value, i) => i === index ? { ...value, referenceUrl: event.target.value } : value))} placeholder="https://…" /></label></div><label>Notes<textarea rows="2" value={item.notes} onChange={event => setEvidence(values => values.map((value, i) => i === index ? { ...value, notes: event.target.value } : value))} /></label><button className="btn small secondary" onClick={() => setEvidence(values => values.filter((_, i) => i !== index))} disabled={evidence.length === 1}>Remove</button></article>)}</div><button className="btn small secondary" onClick={() => setEvidence(values => [...values, blankEvidence()])}>+ Add evidence</button><div className="practical-actions"><button className="btn secondary" disabled={Boolean(busy)} onClick={() => save(false)}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button><button className="btn" disabled={Boolean(busy)} onClick={() => save(true)}>{busy === 'submit' ? 'Submitting…' : 'Submit for evaluation'}</button></div></section>}

            {!editable && detail.submission && <section className="practical-submitted"><h3>Submitted evidence</h3><p>{detail.submission.learnerStatement || 'No learner statement.'}</p><div>{detail.evidence.map(item => <article key={item.evidenceId}><b>{item.evidenceTitle}</b><span>{item.evidenceType}</span><p>{item.notes || item.referenceUrl || item.referenceId}</p></article>)}</div></section>}

            {['PASSED', 'FAILED'].includes(detail.status) && <section className={`practical-result ${detail.status.toLowerCase()}`}><header><div><span>Final result</span><h3>{detail.finalResult}</h3></div><b>{Number(detail.finalPercentage || 0).toFixed(1)}%</b></header>{detail.criticalFail && <p className="critical-note">A critical criterion was below its mandatory minimum.</p>}{detail.evaluations.map((evaluation, index) => <article key={index}><b>Evaluator {evaluation.evaluatorSlot}</b><p>{evaluation.summary}</p>{evaluation.strengths && <p><strong>Strengths:</strong> {evaluation.strengths}</p>}{evaluation.developmentNotes && <p><strong>Development:</strong> {evaluation.developmentNotes}</p>}</article>)}</section>}
          </>}
        </section>
      </div>
    </div>
  );
}
