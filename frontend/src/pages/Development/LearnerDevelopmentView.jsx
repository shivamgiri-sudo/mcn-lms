import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './developmentHub.css';

function formatDate(value) {
  if (!value) return 'No expiry';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

function Status({ value }) {
  const key = String(value || 'OPEN').toLowerCase();
  return <span className={`dev-status ${key}`}>{value || 'OPEN'}</span>;
}

export default function LearnerDevelopmentView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openPlan, setOpenPlan] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const result = await api.get('/development/me', 'trainee');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load your development records.');
    setData(result.data);
  }

  useEffect(() => { load(); }, []);

  const activeCredential = useMemo(() => (data?.certifications || []).find(item => ['ACTIVE', 'EXPIRING'].includes(item.status)), [data]);
  const activePlans = useMemo(() => (data?.plans || []).filter(item => ['ACTIVE', 'DRAFT'].includes(item.status)), [data]);
  const expiryDays = daysUntil(activeCredential?.expiresAt);

  if (loading) return <div className="dev-loading"><div className="spinner" /><p>Synchronizing coaching and credentials…</p></div>;

  return (
    <div className="dev-view">
      {error && <div className="toast bad">{error}</div>}
      <div className="dev-learner-hero">
        <div>
          <span>Personal development record</span>
          <h2>Coaching & Credentials</h2>
          <p>Track agreed coaching actions, evidence, commitments, certification validity and renewal blockers in one place.</p>
        </div>
        <button className="btn small secondary" onClick={load}>↻ Refresh</button>
      </div>

      <div className="dev-summary-grid">
        <div><span>Active plans</span><b>{activePlans.length}</b><small>{(data?.plans || []).filter(item => item.status === 'COMPLETED').length} completed</small></div>
        <div><span>Open goals</span><b>{activePlans.reduce((sum, plan) => sum + (plan.goals || []).filter(goal => goal.status !== 'COMPLETED').length, 0)}</b><small>Evidence-led development</small></div>
        <div className={activeCredential?.status === 'EXPIRING' ? 'warn' : 'ok'}><span>Credential</span><b>{activeCredential?.status || 'Not issued'}</b><small>{activeCredential ? `Version ${activeCredential.versionNo}` : 'Certification required'}</small></div>
        <div className={expiryDays != null && expiryDays <= 45 ? 'warn' : ''}><span>Valid until</span><b>{formatDate(activeCredential?.expiresAt)}</b><small>{expiryDays == null ? 'No configured expiry' : expiryDays >= 0 ? `${expiryDays} days remaining` : `${Math.abs(expiryDays)} days overdue`}</small></div>
      </div>

      {(data?.renewalCases || []).filter(item => !['COMPLETED', 'WAIVED', 'CANCELLED'].includes(item.status)).map(item => (
        <section className={`dev-renewal-banner ${String(item.status).toLowerCase()}`} key={item.caseId}>
          <div>
            <Status value={item.status} />
            <h3>Certification renewal</h3>
            <p>Complete the required evidence before {formatDate(item.dueAt)}.</p>
          </div>
          <div>
            {item.blockerReason ? item.blockerReason.split('. ').filter(Boolean).map(blocker => <span key={blocker}>• {blocker.replace(/\.$/, '')}</span>) : <span>✓ Renewal requirements are complete and awaiting issuance.</span>}
          </div>
        </section>
      ))}

      <section className="dev-section">
        <div className="dev-section-head"><div><h3>Coaching plans</h3><p>Goals, scheduled conversations and commitments agreed with your coach.</p></div><span>{data?.plans?.length || 0}</span></div>
        <div className="dev-plan-list">
          {(data?.plans || []).map(plan => {
            const completed = (plan.goals || []).filter(goal => goal.status === 'COMPLETED').length;
            const total = (plan.goals || []).length;
            const progress = total ? Math.round((completed / total) * 100) : 0;
            const expanded = openPlan === plan.planId;
            return (
              <article className={`dev-plan ${String(plan.priority).toLowerCase()}`} key={plan.planId}>
                <button className="dev-plan-summary" onClick={() => setOpenPlan(expanded ? '' : plan.planId)}>
                  <div><Status value={plan.status} /><b>{plan.title}</b><span>{plan.reasonCode} · Coach {plan.ownerId}</span></div>
                  <div><b>{progress}%</b><span>{completed}/{total} goals</span></div>
                  <div><b>{formatDate(plan.dueAt)}</b><span>Due date</span></div>
                  <span>{expanded ? '⌃' : '⌄'}</span>
                </button>
                {expanded && (
                  <div className="dev-plan-body">
                    {plan.successCriteria && <div className="dev-success-criteria"><b>Success criteria</b><p>{plan.successCriteria}</p></div>}
                    <div className="dev-goals">
                      {(plan.goals || []).map(goal => (
                        <div key={goal.goalId}>
                          <div><b>{goal.goalTitle}</b><span>{goal.skillName || goal.metricType}</span></div>
                          <div className="dev-progress"><span style={{ width: `${Number(goal.progressPct || 0)}%` }} /></div>
                          <div><Status value={goal.status} /><small>{Number(goal.progressPct || 0)}%</small></div>
                        </div>
                      ))}
                      {!plan.goals?.length && <p className="dev-muted">Goals have not been added yet.</p>}
                    </div>
                    <div className="dev-sessions">
                      <h4>Coaching conversations</h4>
                      {(plan.sessions || []).map(session => (
                        <div key={session.sessionId}><div><b>{session.sessionType}</b><span>{formatDate(session.scheduledAt)} · {session.coachId}</span></div><Status value={session.status} />{session.learnerCommitment && <p><b>Your commitment:</b> {session.learnerCommitment}</p>}</div>
                      ))}
                      {!plan.sessions?.length && <p className="dev-muted">No coaching session has been scheduled.</p>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {!data?.plans?.length && <div className="dev-empty"><b>No coaching plans</b><p>Your development plans will appear here when assigned.</p></div>}
        </div>
      </section>

      <section className="dev-section">
        <div className="dev-section-head"><div><h3>Credential history</h3><p>Every issue, renewal, supersession and revocation remains auditable.</p></div><span>{data?.certifications?.length || 0}</span></div>
        <div className="dev-credential-grid">
          {(data?.certifications || []).map(cert => (
            <article key={cert.certificationId}>
              <div><Status value={cert.status} /><b>{String(cert.certificationType || '').replaceAll('_', ' ')}</b><span>{cert.credentialNumber}</span></div>
              <dl><div><dt>Version</dt><dd>{cert.versionNo}</dd></div><div><dt>Issued</dt><dd>{formatDate(cert.issuedAt)}</dd></div><div><dt>Expires</dt><dd>{formatDate(cert.expiresAt)}</dd></div><div><dt>Score</dt><dd>{cert.scorePct == null ? '—' : `${Math.round(cert.scorePct)}%`}</dd></div></dl>
            </article>
          ))}
          {!data?.certifications?.length && <div className="dev-empty"><b>No durable credential issued</b><p>Your credential will appear after certification is completed.</p></div>}
        </div>
      </section>
    </div>
  );
}
