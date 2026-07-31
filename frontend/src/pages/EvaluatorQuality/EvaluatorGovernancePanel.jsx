import { useEffect, useMemo, useState } from 'react';
import { api, downloadCsv } from '../../utils/api.js';
import './evaluatorGovernance.css';

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

const blankAppeal = () => ({ assignmentId: '', category: 'SCORE_DISAGREEMENT', desiredOutcome: 'SCORE_REVIEW', statement: '' });
const blankResolution = () => ({ resolutionType: 'UPHELD', recommendedAction: 'NONE', resolutionSummary: '' });

export default function EvaluatorGovernancePanel({ role = 'coordinator' }) {
  const selfRoot = `/calibration/${role}/governance/self`;
  const [selfData, setSelfData] = useState({ assignments: [], eligibleAssignments: [], appeals: [], packs: [] });
  const [adminData, setAdminData] = useState({ appeals: [], packs: [], reviewers: [], metrics: {} });
  const [selected, setSelected] = useState(null);
  const [appealForm, setAppealForm] = useState(blankAppeal());
  const [resolution, setResolution] = useState(blankResolution());
  const [reviewerId, setReviewerId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(preferredAppealId = '') {
    setLoading(true); setError('');
    const requests = [api.get(selfRoot, role)];
    if (role === 'admin') requests.push(api.get('/calibration/admin/governance/dashboard', 'admin'));
    const [selfResult, adminResult] = await Promise.all(requests);
    setLoading(false);
    if (!selfResult.ok) return setError(selfResult.message || 'Could not load evaluator governance.');
    const nextSelf = selfResult.data || { assignments: [], eligibleAssignments: [], appeals: [], packs: [] };
    setSelfData(nextSelf);
    if (role === 'admin' && adminResult?.ok) setAdminData(adminResult.data || {});
    const own = nextSelf.appeals?.find(item => item.appealId === preferredAppealId)
      || nextSelf.appeals?.find(item => ['SUBMITTED', 'ACKNOWLEDGED', 'INFORMATION_REQUESTED', 'UNDER_REVIEW'].includes(item.status))
      || nextSelf.appeals?.[0];
    if (own && (!selected || preferredAppealId)) setSelected(own);
  }

  useEffect(() => { load(); }, [role]);

  async function submitAppeal(event) {
    event.preventDefault(); setBusy('submit'); setMessage(''); setError('');
    const result = await api.post(`${selfRoot}/appeals`, appealForm, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not submit calibration appeal.');
    setAppealForm(blankAppeal());
    setMessage(result.message || 'Calibration appeal submitted.');
    setSelected(result.data);
    await load(result.data.appealId);
  }

  async function openAdminAppeal(appealId) {
    setBusy('detail'); setError('');
    const result = await api.get(`/calibration/admin/governance/appeals/${encodeURIComponent(appealId)}`, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load appeal evidence.');
    setSelected(result.data);
    setReviewerId(result.data.assignedReviewerId || '');
  }

  async function provideInformation(item) {
    const response = window.prompt('Provide the requested information (minimum 20 characters):');
    if (!response) return;
    setBusy(`info-${item.appealId}`); setError('');
    const result = await api.post(`${selfRoot}/appeals/${encodeURIComponent(item.appealId)}/information`, { response }, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not submit additional information.');
    setMessage(result.message);
    setSelected(result.data);
    await load(result.data.appealId);
  }

  async function withdraw(item) {
    const reason = window.prompt('Provide a withdrawal reason (minimum 20 characters):');
    if (!reason) return;
    setBusy(`withdraw-${item.appealId}`); setError('');
    const result = await api.post(`${selfRoot}/appeals/${encodeURIComponent(item.appealId)}/withdraw`, { reason }, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not withdraw appeal.');
    setMessage(result.message);
    setSelected(result.data);
    await load(result.data.appealId);
  }

  async function adminAction(action, payload = {}) {
    if (!selected) return;
    setBusy(action); setError(''); setMessage('');
    const result = await api.post(`/calibration/admin/governance/appeals/${encodeURIComponent(selected.appealId)}/${action}`, payload, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || `Could not ${action} appeal.`);
    setMessage(result.message);
    setSelected(result.data);
    await load();
  }

  async function requestInformation() {
    const comment = window.prompt('What additional information is required? Minimum 20 characters.');
    if (comment) await adminAction('request-information', { comment });
  }

  async function assignReviewer() {
    if (!reviewerId) return setError('Select a reviewer first.');
    await adminAction('assign', { reviewerId });
  }

  async function resolveAppeal(event) {
    event.preventDefault();
    if (!window.confirm('Resolve this appeal? Original calibration scores will remain immutable.')) return;
    await adminAction('resolve', resolution);
    setResolution(blankResolution());
  }

  async function generatePack(item = selected) {
    if (!item?.assignmentId) return;
    setBusy('pack'); setError(''); setMessage('');
    const result = await api.post('/calibration/admin/governance/packs', {
      assignmentId: item.assignmentId,
      appealId: item.appealId || null,
      packType: item.appealId ? 'COMPLETE_GOVERNANCE' : 'ASSIGNMENT',
    }, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not generate evidence pack.');
    setMessage(result.message);
    await load();
  }

  async function downloadPack(pack, admin = false) {
    setBusy(`download-${pack.packId}`); setError('');
    try {
      const endpoint = admin
        ? `/calibration/admin/governance/packs/${encodeURIComponent(pack.packId)}`
        : `${selfRoot}/packs/${encodeURIComponent(pack.packId)}`;
      await downloadCsv(endpoint, `${pack.packCode}.json`, role);
    } catch (downloadError) {
      setError(downloadError.message || 'Evidence pack download failed.');
    } finally {
      setBusy('');
    }
  }

  async function revokePack(pack) {
    const reason = window.prompt('Provide a pack revocation reason of at least 20 characters:');
    if (!reason) return;
    setBusy(`revoke-${pack.packId}`); setError('');
    const result = await api.post(`/calibration/admin/governance/packs/${encodeURIComponent(pack.packId)}/revoke`, { reason }, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not revoke evidence pack.');
    setMessage(result.message);
    await load();
  }

  async function runGovernance() {
    setBusy('run'); setError(''); setMessage('');
    const result = await api.post('/calibration/admin/governance/run', {}, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not run appeal governance cycle.');
    setMessage(`Governance cycle complete: ${result.data?.slaBreaches || 0} SLA breach alert(s), ${result.data?.expiredPacks || 0} pack(s) expired.`);
    await load();
  }

  const ownOpen = selfData.appeals?.filter(item => ['SUBMITTED', 'ACKNOWLEDGED', 'INFORMATION_REQUESTED', 'UNDER_REVIEW'].includes(item.status)).length || 0;
  const filteredQueue = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return adminData.appeals || [];
    return (adminData.appeals || []).filter(item => [item.appealCode, item.evaluatorId, item.evaluatorName, item.programName, item.status, item.category].some(value => String(value || '').toLowerCase().includes(term)));
  }, [adminData.appeals, search]);

  if (loading) return <section className="quality-panel evaluator-governance-loading"><div className="spinner" /><p>Loading appeals and governance evidence…</p></section>;

  return (
    <section className="evaluator-governance">
      <header className="evaluator-governance-hero">
        <div><span>Phase 9 governance</span><h2>Appeals, Review SLA & Evidence Packs</h2><p>Challenge a finalized calibration through a governed process that preserves the original scoring record and produces tamper-evident evidence.</p></div>
        <div className="evaluator-governance-metrics">
          <article><span>My open appeals</span><b>{ownOpen}</b></article>
          <article><span>Eligible results</span><b>{selfData.eligibleAssignments?.length || 0}</b></article>
          <article><span>Evidence packs</span><b>{selfData.packs?.length || 0}</b></article>
          <article><span>Appeal window</span><b>{selfData.appealWindowDays || 14}d</b></article>
        </div>
      </header>

      {message && <div className="quality-toast ok">{message}</div>}
      {error && <div className="quality-toast bad">{error}</div>}

      <div className="evaluator-governance-grid">
        <form className="quality-panel appeal-form" onSubmit={submitAppeal}>
          <div className="quality-section-head"><div><h2>Raise a calibration appeal</h2><p>One appeal is allowed per finalized calibration attempt.</p></div></div>
          <label>Finalized attempt<select required value={appealForm.assignmentId} onChange={event => setAppealForm(item => ({ ...item, assignmentId: event.target.value }))}><option value="">Select eligible result</option>{selfData.eligibleAssignments?.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.programName} · {item.templateName} · Attempt {item.attemptNo} · {item.result}</option>)}</select></label>
          <div className="appeal-form-row"><label>Category<select value={appealForm.category} onChange={event => setAppealForm(item => ({ ...item, category: event.target.value }))}><option value="SCORE_DISAGREEMENT">Score disagreement</option><option value="CRITICAL_FAIL_DISAGREEMENT">Critical-fail disagreement</option><option value="EVIDENCE_ACCESS">Evidence access</option><option value="PROCESS_VIOLATION">Process violation</option><option value="OTHER">Other</option></select></label><label>Desired outcome<select value={appealForm.desiredOutcome} onChange={event => setAppealForm(item => ({ ...item, desiredOutcome: event.target.value }))}><option value="SCORE_REVIEW">Score review</option><option value="CRITICAL_FAIL_REVIEW">Critical-fail review</option><option value="REASSESSMENT">New reassessment</option><option value="PROCESS_REVIEW">Process review</option><option value="OTHER">Other</option></select></label></div>
          <label>Appeal statement<textarea required minLength="40" rows="6" placeholder="Explain the specific scoring, evidence or process concern. Include criterion names and facts where possible." value={appealForm.statement} onChange={event => setAppealForm(item => ({ ...item, statement: event.target.value }))} /></label>
          <button className="btn" disabled={busy === 'submit' || !selfData.eligibleAssignments?.length}>{busy === 'submit' ? 'Submitting…' : 'Submit governed appeal'}</button>
        </form>

        <section className="quality-panel appeal-register">
          <div className="quality-section-head"><div><h2>My appeal register</h2><p>Status, SLA, reviewer action and hash-chain integrity.</p></div><button onClick={() => load(selected?.appealId)}>↻</button></div>
          <div className="appeal-card-list">{selfData.appeals?.map(item => <button key={item.appealId} className={selected?.appealId === item.appealId ? 'active' : ''} onClick={() => setSelected(item)}><header><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.appealCode}</b></header><strong>{item.programName}</strong><small>{item.category.replaceAll('_', ' ')} · SLA {formatDate(item.slaDueAt)}</small><em className={item.integrityVerified ? 'verified' : 'failed'}>{item.integrityVerified ? '✓ Timeline verified' : '⚠ Integrity failure'}</em></button>)}{!selfData.appeals?.length && <div className="quality-empty"><b>No appeals submitted</b><p>Eligible finalized results appear in the appeal form.</p></div>}</div>
        </section>
      </div>

      {selected && <section className="quality-panel appeal-detail">
        <header><div><span className={`quality-status ${statusClass(selected.status)}`}>{selected.status}</span><h2>{selected.appealCode} · {selected.programName}</h2><p>{selected.templateName} · Attempt {selected.attemptNo} · Original result {selected.originalResult} ({Number(selected.originalScorePct || 0).toFixed(1)}%)</p></div><div><b>{selected.slaBreached ? 'SLA BREACHED' : 'SLA ACTIVE'}</b><span>{formatDate(selected.slaDueAt)}</span></div></header>
        <div className="appeal-summary"><article><span>Category</span><b>{selected.category?.replaceAll('_', ' ')}</b></article><article><span>Desired outcome</span><b>{selected.desiredOutcome?.replaceAll('_', ' ')}</b></article><article><span>Reviewer</span><b>{selected.reviewerName || selected.assignedReviewerId || 'Unassigned'}</b></article><article><span>Integrity</span><b>{selected.integrityVerified ? 'Verified' : 'Failed'}</b></article></div>
        <div className="appeal-statement"><b>Original appeal statement</b><p>{selected.appealStatement}</p></div>
        {selected.resolutionSummary && <div className="appeal-resolution"><b>{selected.resolutionType} · {selected.recommendedAction}</b><p>{selected.resolutionSummary}</p>{selected.reassessmentAssignmentId && <small>Reassessment created: {selected.reassessmentAssignmentId}</small>}</div>}
        <div className="appeal-timeline">{selected.events?.map(item => <article key={item.eventId}><i /><div><header><b>{item.eventType.replaceAll('_', ' ')}</b><span>{formatDate(item.createdAt)}</span></header>{item.eventComment && <p>{item.eventComment}</p>}<small>{item.actorType} · {item.actorId} · Sequence {item.sequenceNo}</small></div></article>)}</div>
        <div className="appeal-actions">{selected.status === 'INFORMATION_REQUESTED' && selected.evaluatorId === String(localStorage.getItem(`lms_${role}_id`) || selected.evaluatorId) && <button className="btn" onClick={() => provideInformation(selected)}>Provide information</button>}{['SUBMITTED', 'ACKNOWLEDGED', 'INFORMATION_REQUESTED', 'UNDER_REVIEW'].includes(selected.status) && selfData.appeals?.some(item => item.appealId === selected.appealId) && <button className="btn secondary" onClick={() => withdraw(selected)}>Withdraw appeal</button>}{selected.packs?.map(pack => <button className="btn secondary" key={pack.packId} disabled={busy === `download-${pack.packId}`} onClick={() => downloadPack(pack, false)}>Download {pack.packCode}</button>)}</div>
      </section>}

      <section className="quality-panel governance-pack-register">
        <div className="quality-section-head"><div><h2>My governance evidence packs</h2><p>JSON manifests are SHA-256 verified before every authenticated download.</p></div></div>
        <div className="governance-pack-grid">{selfData.packs?.map(pack => <article key={pack.packId}><span className={`quality-status ${statusClass(pack.status)}`}>{pack.status}</span><b>{pack.packCode}</b><p>{pack.packType.replaceAll('_', ' ')} · Version {pack.versionNo}</p><small>{formatDate(pack.generatedAt)} · {pack.downloadCount} download(s)</small>{pack.status === 'ACTIVE' && <button className="btn small secondary" onClick={() => downloadPack(pack, false)}>Download verified JSON</button>}</article>)}{!selfData.packs?.length && <div className="quality-empty"><b>No evidence packs yet</b><p>A resolved appeal automatically creates a complete governance pack.</p></div>}</div>
      </section>

      {role === 'admin' && <>
        <section className="quality-panel governance-control">
          <div className="quality-section-head"><div><h2>Appeal governance control centre</h2><p>Branch/company queue, SLA breaches and reviewer ownership.</p></div><button className="btn" disabled={busy === 'run'} onClick={runGovernance}>{busy === 'run' ? 'Running…' : 'Run governance now'}</button></div>
          <div className="governance-admin-metrics"><article><span>Open</span><b>{adminData.metrics?.open || 0}</b></article><article><span>SLA breached</span><b>{adminData.metrics?.slaBreached || 0}</b></article><article><span>Information pending</span><b>{adminData.metrics?.informationRequested || 0}</b></article><article><span>Resolved</span><b>{adminData.metrics?.resolved || 0}</b></article></div>
          <input className="quality-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search appeal, evaluator, programme, status or category" />
          <div className="appeal-admin-table"><header><span>Appeal</span><span>Evaluator</span><span>Programme</span><span>SLA</span><span>Reviewer</span><span>Status</span></header>{filteredQueue.map(item => <button key={item.appealId} onClick={() => openAdminAppeal(item.appealId)}><span><b>{item.appealCode}</b><small>{item.category.replaceAll('_', ' ')}</small></span><span><b>{item.evaluatorName || item.evaluatorId}</b><small>{item.branch} · {item.processName || '—'}</small></span><span>{item.programName}<small>{item.templateName} · V{item.templateVersion}</small></span><span className={item.slaBreached ? 'breached' : ''}>{formatDate(item.slaDueAt)}</span><span>{item.reviewerName || item.assignedReviewerId || 'Unassigned'}</span><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span></button>)}</div>
        </section>

        {selected && adminData.appeals?.some(item => item.appealId === selected.appealId) && <section className="quality-panel governance-review-actions">
          <div className="quality-section-head"><div><h2>Governance decision workspace</h2><p>Actions append to the immutable timeline. Resolution cannot alter the original calibration record.</p></div><button className="btn secondary" disabled={busy === 'pack'} onClick={() => generatePack(selected)}>{busy === 'pack' ? 'Generating…' : 'Generate evidence pack'}</button></div>
          <div className="governance-review-grid"><div className="governance-action-card"><h3>Reviewer actions</h3><button className="btn secondary" disabled={Boolean(busy)} onClick={() => adminAction('acknowledge', {})}>Acknowledge</button><button className="btn secondary" disabled={Boolean(busy)} onClick={requestInformation}>Request information</button><label>Assign reviewer<select value={reviewerId} onChange={event => setReviewerId(event.target.value)}><option value="">Select reviewer</option>{adminData.reviewers?.map(item => <option key={item.reviewerId} value={item.reviewerId}>{item.name || item.reviewerId} · {item.branch || 'Company'}</option>)}</select></label><button className="btn secondary" disabled={!reviewerId || Boolean(busy)} onClick={assignReviewer}>Assign review</button></div><form className="governance-resolution-form" onSubmit={resolveAppeal}><h3>Final resolution</h3><div><label>Resolution<select value={resolution.resolutionType} onChange={event => setResolution(item => ({ ...item, resolutionType: event.target.value }))}><option value="UPHELD">Appeal upheld</option><option value="PARTIALLY_UPHELD">Partially upheld</option><option value="OVERTURNED">Original decision overturned</option><option value="PROCEDURAL_REMEDY">Procedural remedy</option><option value="NO_ACTION">No action</option></select></label><label>Recommended action<select value={resolution.recommendedAction} onChange={event => setResolution(item => ({ ...item, recommendedAction: event.target.value }))}><option value="NONE">No further action</option><option value="REASSESSMENT">Create reassessment</option><option value="COACHING">Coaching</option><option value="RESTORE_AUTHORIZATION">Restore authorization</option><option value="SUSPEND_AUTHORIZATION">Suspend authorization</option><option value="POLICY_REVIEW">Policy review</option></select></label></div><label>Resolution summary<textarea required minLength="40" rows="5" value={resolution.resolutionSummary} onChange={event => setResolution(item => ({ ...item, resolutionSummary: event.target.value }))} placeholder="Record the evidence reviewed, decision rationale and required follow-up." /></label><button className="btn" disabled={Boolean(busy)}>Resolve and seal evidence</button></form></div>
        </section>}

        <section className="quality-panel governance-admin-packs">
          <div className="quality-section-head"><div><h2>Governance evidence-pack register</h2><p>Download counts, hashes, lifecycle and audited revocation.</p></div></div>
          <div className="governance-pack-grid">{adminData.packs?.map(pack => <article key={pack.packId}><span className={`quality-status ${statusClass(pack.status)}`}>{pack.status}</span><b>{pack.packCode}</b><p>{pack.evaluatorName || pack.evaluatorId} · {pack.templateName} · V{pack.templateVersion}</p><small>Hash {pack.manifestHash?.slice(0, 16)}… · {pack.downloadCount} download(s)</small><div>{pack.status === 'ACTIVE' && <button className="btn small secondary" onClick={() => downloadPack(pack, true)}>Download</button>}{pack.status === 'ACTIVE' && <button className="btn small secondary" onClick={() => revokePack(pack)}>Revoke</button>}</div></article>)}</div>
        </section>
      </>}
    </section>
  );
}
