import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './evaluatorOperations.css';

function formatDate(value, dateOnly = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', dateOnly
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

function percent(value) {
  return value == null ? '—' : `${Number(value).toFixed(1)}%`;
}

const blankEvidence = () => ({
  evidenceCode: '',
  evidenceTitle: '',
  evidenceType: 'LINK',
  sourceUrl: '',
  storageReference: '',
  textContent: '',
  contentHash: '',
  mimeType: '',
  fileSizeBytes: '',
  visibility: 'EVALUATOR',
  retentionUntil: '',
});

export default function EvaluatorOperationsPanel({ role = 'coordinator' }) {
  const [data, setData] = useState({ scope: {}, certificates: [], trends: [], benchmarks: [] });
  const [adminData, setAdminData] = useState({ certificates: [], benchmarks: [] });
  const [programs, setPrograms] = useState([]);
  const [program, setProgram] = useState(null);
  const [anchorId, setAnchorId] = useState('');
  const [evidence, setEvidence] = useState([]);
  const [evidenceForm, setEvidenceForm] = useState(blankEvidence());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selfEndpoint = role === 'admin'
    ? '/calibration/admin/operations/self'
    : '/calibration/coordinator/operations';

  async function load() {
    setLoading(true); setError('');
    const requests = [api.get(selfEndpoint, role)];
    if (role === 'admin') {
      requests.push(api.get('/calibration/admin/operations/dashboard', 'admin'));
      requests.push(api.get('/calibration/admin/programs', 'admin'));
    }
    const [selfResult, adminResult, programsResult] = await Promise.all(requests);
    setLoading(false);
    if (!selfResult.ok) return setError(selfResult.message || 'Could not load evaluator operations.');
    setData(selfResult.data || { scope: {}, certificates: [], trends: [], benchmarks: [] });
    if (role === 'admin' && adminResult?.ok) setAdminData(adminResult.data || { certificates: [], benchmarks: [] });
    if (role === 'admin' && programsResult?.ok) setPrograms(programsResult.data || []);
  }

  useEffect(() => { load(); }, [role]);

  async function openProgram(programId) {
    setBusy('program'); setError('');
    const result = await api.get(`/calibration/admin/programs/${encodeURIComponent(programId)}`, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load calibration programme.');
    setProgram(result.data);
    const firstAnchor = result.data?.anchors?.[0]?.anchorId || '';
    setAnchorId(firstAnchor);
    if (firstAnchor) await loadEvidence(firstAnchor);
    else setEvidence([]);
  }

  async function loadEvidence(nextAnchorId = anchorId) {
    if (!nextAnchorId) { setEvidence([]); return; }
    setBusy('evidence'); setError('');
    const result = await api.get(`/calibration/admin/anchors/${encodeURIComponent(nextAnchorId)}/evidence`, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load governed evidence.');
    setEvidence(result.data?.evidence || []);
  }

  async function runOperations() {
    setBusy('operations'); setMessage(''); setError('');
    const result = await api.post('/calibration/admin/operations/run', {}, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not run evaluator-quality operations.');
    const operations = result.data || {};
    setMessage(`Operations complete: ${operations.certificates?.created || 0} certificate(s) issued, ${operations.cohorts?.snapshots || 0} benchmark snapshot(s), ${operations.notifications?.generated || 0} notification event(s).`);
    await load();
  }

  async function createEvidence(event) {
    event.preventDefault();
    if (!anchorId) return;
    setBusy('evidence-create'); setMessage(''); setError('');
    const result = await api.post(`/calibration/admin/anchors/${encodeURIComponent(anchorId)}/evidence`, evidenceForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not create governed evidence.');
    setMessage(result.message || 'Governed evidence created.');
    setEvidenceForm(blankEvidence());
    await loadEvidence(anchorId);
  }

  async function evidenceAction(item, action) {
    let payload = {};
    if (action === 'retire') {
      const reason = window.prompt('Provide an audited retirement reason of at least 20 characters:');
      if (!reason) return;
      payload = { reason };
    }
    setBusy(`evidence-${item.evidenceId}`); setMessage(''); setError('');
    const result = await api.post(`/calibration/admin/evidence/${encodeURIComponent(item.evidenceId)}/${action}`, payload, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || `Could not ${action} evidence.`);
    setMessage(result.message);
    await loadEvidence(anchorId);
  }

  const latestTrend = data.trends?.[0] || null;
  const activeCertificates = data.certificates?.filter(item => item.status === 'ACTIVE') || [];
  const expiringSoon = activeCertificates.filter(item => {
    const days = (new Date(item.validUntil).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 30;
  }).length;
  const companyBenchmark = data.benchmarks?.find(item => item.cohortType === 'COMPANY') || null;
  const selectedAnchor = program?.anchors?.find(item => item.anchorId === anchorId) || null;
  const trendRows = useMemo(() => [...(data.trends || [])].reverse(), [data.trends]);

  if (loading) return <section className="quality-panel evaluator-ops-loading"><div className="spinner" /><p>Loading certificates, trends and benchmarks…</p></section>;

  return (
    <section className="evaluator-ops">
      <header className="evaluator-ops-hero">
        <div><span>Phase 8 operations</span><h2>Credentials, Trends & Benchmarks</h2><p>Verify evaluator authority, compare reliability over time and manage governed calibration evidence.</p></div>
        <div className="evaluator-ops-metrics">
          <article><span>Active certificates</span><b>{activeCertificates.length}</b></article>
          <article><span>Expiring ≤30 days</span><b>{expiringSoon}</b></article>
          <article><span>Latest agreement</span><b>{percent(latestTrend?.agreementWithinFivePct)}</b></article>
          <article><span>Company benchmark</span><b>{percent(companyBenchmark?.averageAgreementPct)}</b></article>
        </div>
      </header>

      {message && <div className="quality-toast ok">{message}</div>}
      {error && <div className="quality-toast bad">{error}</div>}

      <div className="evaluator-ops-grid">
        <section className="quality-panel evaluator-certificates">
          <div className="quality-section-head"><div><h2>Digital authorization certificates</h2><p>Cryptographically verifiable evidence of template-version authority.</p></div><button onClick={load}>↻</button></div>
          <div className="evaluator-certificate-grid">
            {data.certificates?.map(item => <article key={item.certificateId}>
              <header><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.certificateCode}</b></header>
              <h3>{item.snapshotJson?.templateName || 'Evaluator authorization'}</h3>
              <p>Rubric version {item.snapshotJson?.templateVersion || '—'} · Score {percent(item.snapshotJson?.calibrationScorePct)}</p>
              <small>Valid {formatDate(item.validFrom, true)} – {formatDate(item.validUntil, true)}</small>
              <div><a href={`/api/calibration/certificates/verify/${encodeURIComponent(item.certificateCode)}`} target="_blank" rel="noreferrer">Verify certificate ↗</a><button onClick={() => navigator.clipboard?.writeText(item.certificateCode)}>Copy code</button></div>
            </article>)}
            {!data.certificates?.length && <div className="quality-empty"><b>No certificate issued yet</b><p>A passed calibration creates a digital certificate during the operations cycle.</p></div>}
          </div>
        </section>

        <section className="quality-panel evaluator-trends">
          <div className="quality-section-head"><div><h2>Reliability trend</h2><p>Agreement, critical consistency and evaluator severity across periods.</p></div></div>
          <div className="evaluator-trend-chart">
            {trendRows.map(item => <article key={item.snapshotId} title={`${item.templateName}: ${percent(item.agreementWithinFivePct)}`}>
              <div className="trend-bar"><i style={{ height: `${Math.max(4, Math.min(100, Number(item.agreementWithinFivePct || 0)))}%` }} /></div>
              <b>{percent(item.agreementWithinFivePct)}</b>
              <span>{formatDate(item.periodEnd, true)}</span>
              <small>{item.templateName}</small>
            </article>)}
            {!trendRows.length && <div className="quality-empty"><b>No trend data yet</b><p>Trend points appear after paired evaluations are calculated.</p></div>}
          </div>
        </section>
      </div>

      <section className="quality-panel evaluator-benchmarks">
        <div className="quality-section-head"><div><h2>Reliability cohort benchmarks</h2><p>Compare company, branch, process and LOB consistency without exposing peer identities.</p></div></div>
        <div className="evaluator-benchmark-grid">
          {data.benchmarks?.slice(0, 24).map(item => <article key={item.cohortSnapshotId}>
            <header><span>{item.cohortType}</span><b>{item.cohortValue}</b></header>
            <h3>{item.templateName} · V{item.templateVersion}</h3>
            <div><span>Agreement <b>{percent(item.averageAgreementPct)}</b></span><span>Critical <b>{percent(item.averageCriticalAgreementPct)}</b></span><span>Severity <b>{Number(item.averageAbsoluteSeverityIndex || 0).toFixed(1)}</b></span></div>
            <small>{item.evaluatorCount} evaluators · {item.pairedEvaluationCount} paired reviews · {formatDate(item.periodEnd, true)}</small>
          </article>)}
          {!data.benchmarks?.length && <div className="quality-empty"><b>No cohort benchmark yet</b><p>Benchmarks are generated from the same reliability evidence used for authorization governance.</p></div>}
        </div>
      </section>

      {role === 'admin' && <>
        <section className="quality-panel evaluator-ops-admin">
          <div className="quality-section-head"><div><h2>Operations control centre</h2><p>Synchronise certificates, calculate cohorts and generate due, expiry and reliability notifications.</p></div><button className="btn" disabled={busy === 'operations'} onClick={runOperations}>{busy === 'operations' ? 'Running…' : 'Run operations now'}</button></div>
          <div className="evaluator-ops-register">
            <header><span>Evaluator</span><span>Certificate</span><span>Rubric</span><span>Valid until</span><span>Status</span></header>
            {adminData.certificates?.slice(0, 200).map(item => <div key={item.certificateId}><span><b>{item.evaluatorName || item.evaluatorId}</b><small>{item.evaluatorRole || item.evaluatorType} · {item.branch || 'Company'}</small></span><span>{item.certificateCode}</span><span>{item.templateName} · V{item.templateVersion}</span><span>{formatDate(item.validUntil, true)}</span><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span></div>)}
          </div>
        </section>

        <section className="quality-panel evaluator-evidence-manager">
          <div className="quality-section-head"><div><h2>Governed anchor evidence</h2><p>Version, approve, retain and retire supporting assets without exposing protected expected scores.</p></div></div>
          <div className="evidence-selectors">
            <label>Calibration programme<select value={program?.programId || ''} onChange={event => openProgram(event.target.value)}><option value="">Select programme</option>{programs.map(item => <option key={item.programId} value={item.programId}>{item.programName} · {item.templateName} · {item.status}</option>)}</select></label>
            <label>Anchor<select disabled={!program} value={anchorId} onChange={event => { setAnchorId(event.target.value); loadEvidence(event.target.value); }}><option value="">Select anchor</option>{program?.anchors?.map(item => <option key={item.anchorId} value={item.anchorId}>{item.anchorCode} · {item.anchorTitle}</option>)}</select></label>
          </div>
          {busy === 'program' && <div className="quality-loading compact"><div className="spinner" /></div>}
          {selectedAnchor && <div className="evidence-workspace">
            <div className="evidence-register">
              <header><div><span>{program.status}</span><h3>{selectedAnchor.anchorTitle}</h3></div><b>{selectedAnchor.anchorCode}</b></header>
              {evidence.map(item => <article key={item.evidenceId}><div><span className={`quality-status ${statusClass(item.status)}`}>{item.status}</span><b>{item.evidenceTitle}</b><small>{item.evidenceCode} · V{item.versionNo} · {item.evidenceType} · {item.visibility}</small></div><div>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open ↗</a>}{item.status === 'DRAFT' && <button disabled={busy === `evidence-${item.evidenceId}`} onClick={() => evidenceAction(item, 'approve')}>Approve</button>}{item.status !== 'RETIRED' && <button disabled={busy === `evidence-${item.evidenceId}`} onClick={() => evidenceAction(item, 'retire')}>Retire</button>}</div></article>)}
              {!evidence.length && <div className="quality-empty"><b>No governed assets</b><p>Create a versioned evidence record for this anchor.</p></div>}
            </div>
            <form className="evidence-form" onSubmit={createEvidence}>
              <h3>New evidence version</h3>
              {program.status !== 'DRAFT' && <div className="quality-toast bad">Published programmes are locked. Create a new draft programme version before adding evidence.</div>}
              <div><label>Evidence code<input required disabled={program.status !== 'DRAFT'} value={evidenceForm.evidenceCode} onChange={event => setEvidenceForm(item => ({ ...item, evidenceCode: event.target.value }))} /></label><label>Title<input required disabled={program.status !== 'DRAFT'} value={evidenceForm.evidenceTitle} onChange={event => setEvidenceForm(item => ({ ...item, evidenceTitle: event.target.value }))} /></label></div>
              <div><label>Type<select disabled={program.status !== 'DRAFT'} value={evidenceForm.evidenceType} onChange={event => setEvidenceForm(item => ({ ...item, evidenceType: event.target.value }))}>{['LINK','DOCUMENT','IMAGE','VIDEO','AUDIO','TEXT','DATASET'].map(item => <option key={item}>{item}</option>)}</select></label><label>Visibility<select disabled={program.status !== 'DRAFT'} value={evidenceForm.visibility} onChange={event => setEvidenceForm(item => ({ ...item, visibility: event.target.value }))}><option value="EVALUATOR">Evaluator</option><option value="AFTER_SUBMISSION">After submission</option><option value="ADMIN_ONLY">Admin only</option></select></label></div>
              <label>Secure URL<input disabled={program.status !== 'DRAFT'} placeholder="https://… or /secure-assets/…" value={evidenceForm.sourceUrl} onChange={event => setEvidenceForm(item => ({ ...item, sourceUrl: event.target.value }))} /></label>
              <label>Text evidence<textarea rows="3" disabled={program.status !== 'DRAFT'} value={evidenceForm.textContent} onChange={event => setEvidenceForm(item => ({ ...item, textContent: event.target.value }))} /></label>
              <div><label>SHA-256 hash<input disabled={program.status !== 'DRAFT'} value={evidenceForm.contentHash} onChange={event => setEvidenceForm(item => ({ ...item, contentHash: event.target.value }))} /></label><label>Retention until<input type="datetime-local" disabled={program.status !== 'DRAFT'} value={evidenceForm.retentionUntil} onChange={event => setEvidenceForm(item => ({ ...item, retentionUntil: event.target.value }))} /></label></div>
              <button className="btn" disabled={program.status !== 'DRAFT' || busy === 'evidence-create'}>{busy === 'evidence-create' ? 'Creating…' : 'Create draft evidence'}</button>
            </form>
          </div>}
        </section>
      </>}
    </section>
  );
}