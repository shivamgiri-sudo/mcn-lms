import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './developmentHub.css';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Status({ value }) {
  return <span className={`dev-status ${String(value || '').toLowerCase()}`}>{value || 'OPEN'}</span>;
}

const emptyPlan = { employeeId: '', title: '', reasonCode: 'DEVELOPMENT', priority: 'MEDIUM', dueAt: '', successCriteria: '', activate: true };
const emptyGoal = { planId: '', goalTitle: '', skillId: '', metricType: 'PERCENT', baselineValue: '', targetValue: '', dueAt: '', evidenceRequired: true };
const emptySession = { planId: '', sessionType: 'COACHING', scheduledAt: '', agenda: '', nextFollowUpAt: '' };

export default function CoordinatorDevelopmentView() {
  const [batches, setBatches] = useState([]);
  const [batchNo, setBatchNo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState('plans');
  const [planForm, setPlanForm] = useState(emptyPlan);
  const [goalForm, setGoalForm] = useState(emptyGoal);
  const [sessionForm, setSessionForm] = useState(emptySession);
  const [action, setAction] = useState(null);

  async function loadBatches() {
    setLoading(true);
    const result = await api.get('/coordinator/batches?status=Active', 'coordinator');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load owned batches.');
    const rows = result.data || [];
    setBatches(rows);
    if (!batchNo && rows[0]?.batchNo) setBatchNo(rows[0].batchNo);
  }

  async function loadBatch(selected = batchNo) {
    if (!selected) return;
    setLoading(true);
    setError('');
    const result = await api.get(`/development/coordinator/batches/${encodeURIComponent(selected)}`, 'coordinator');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load coaching and renewal records.');
    setData(result.data);
    const firstPlan = result.data?.plans?.find(item => ['ACTIVE', 'DRAFT'].includes(item.status));
    setGoalForm(form => ({ ...form, planId: form.planId || firstPlan?.planId || '' }));
    setSessionForm(form => ({ ...form, planId: form.planId || firstPlan?.planId || '' }));
  }

  useEffect(() => { loadBatches(); }, []);
  useEffect(() => { if (batchNo) loadBatch(batchNo); }, [batchNo]);

  async function createPlan(event) {
    event.preventDefault();
    setSaving('plan'); setError(''); setMessage('');
    const result = await api.post(`/development/coordinator/batches/${encodeURIComponent(batchNo)}/plans`, planForm, 'coordinator');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not create coaching plan.');
    setMessage('Coaching plan created. Add measurable goals and schedule the first session.');
    setPlanForm(emptyPlan);
    await loadBatch();
  }

  async function addGoal(event) {
    event.preventDefault();
    setSaving('goal'); setError(''); setMessage('');
    const result = await api.post(`/development/coordinator/plans/${encodeURIComponent(goalForm.planId)}/goals`, goalForm, 'coordinator');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not add goal.');
    setMessage('Goal added to the coaching plan.');
    setGoalForm(form => ({ ...emptyGoal, planId: form.planId }));
    await loadBatch();
  }

  async function addSession(event) {
    event.preventDefault();
    setSaving('session'); setError(''); setMessage('');
    const result = await api.post(`/development/coordinator/plans/${encodeURIComponent(sessionForm.planId)}/sessions`, sessionForm, 'coordinator');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not schedule session.');
    setMessage('Coaching session scheduled.');
    setSessionForm(form => ({ ...emptySession, planId: form.planId }));
    await loadBatch();
  }

  async function saveAction(event) {
    event.preventDefault();
    setSaving('action'); setError(''); setMessage('');
    let result;
    if (action.type === 'goal') {
      result = await api.patch(`/development/coordinator/goals/${encodeURIComponent(action.id)}`, action.form, 'coordinator');
    } else {
      result = await api.patch(`/development/coordinator/sessions/${encodeURIComponent(action.id)}`, action.form, 'coordinator');
    }
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not save coaching evidence.');
    setMessage(result.message || 'Coaching evidence saved.');
    setAction(null);
    await loadBatch();
  }

  async function renewalAction(item, type) {
    setSaving(`${type}:${item.caseId}`); setError(''); setMessage('');
    const result = await api.post(`/development/coordinator/renewals/${encodeURIComponent(item.caseId)}/${type}`, {}, 'coordinator');
    setSaving('');
    if (!result.ok) return setError(result.message || `Could not ${type} renewal.`);
    setMessage(result.message || 'Renewal updated.');
    await loadBatch();
  }

  const activePlans = useMemo(() => (data?.plans || []).filter(item => ['ACTIVE', 'DRAFT'].includes(item.status)), [data]);
  const readyRenewals = useMemo(() => (data?.renewalCases || []).filter(item => item.status === 'READY'), [data]);

  return (
    <div className="dev-view">
      <div className="dev-learner-hero">
        <div><span>Owned-batch development governance</span><h2>Coaching & Certification</h2><p>Create evidence-led plans, document conversations, close measurable goals and prevent certification lapses.</p></div>
        <select className="dev-select" value={batchNo} onChange={event => setBatchNo(event.target.value)}>{batches.map(batch => <option key={batch.batchNo} value={batch.batchNo}>{batch.batchNo} · {batch.batchName || batch.process}</option>)}</select>
      </div>
      {message && <div className="toast ok">{message}</div>}
      {error && <div className="toast bad">{error}</div>}
      <div className="dev-summary-grid">
        <div><span>Employees</span><b>{data?.employees?.length || 0}</b><small>Active in selected batch</small></div>
        <div className="warn"><span>Active coaching</span><b>{activePlans.length}</b><small>{(data?.plans || []).filter(item => item.priority === 'CRITICAL').length} critical priority</small></div>
        <div className="warn"><span>Open renewals</span><b>{(data?.renewalCases || []).filter(item => !['COMPLETED', 'WAIVED', 'CANCELLED'].includes(item.status)).length}</b><small>{(data?.renewalCases || []).filter(item => item.status === 'OVERDUE').length} overdue</small></div>
        <div className="ok"><span>Ready to issue</span><b>{readyRenewals.length}</b><small>Requirements complete</small></div>
      </div>

      <div className="dev-switcher"><button className={view === 'plans' ? 'active' : ''} onClick={() => setView('plans')}>Plans & evidence</button><button className={view === 'renewals' ? 'active' : ''} onClick={() => setView('renewals')}>Certification renewals</button><button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}>Create & schedule</button></div>

      {loading ? <div className="dev-loading"><div className="spinner" /><p>Synchronizing batch development records…</p></div> : view === 'plans' ? (
        <section className="dev-section">
          <div className="dev-section-head"><div><h3>Coaching plans</h3><p>Use goals and sessions as permanent, reviewable evidence.</p></div><span>{data?.plans?.length || 0}</span></div>
          <div className="dev-table-wrap"><table className="dev-table"><thead><tr><th>Employee</th><th>Plan</th><th>Progress</th><th>Due</th><th>Priority</th></tr></thead><tbody>{(data?.plans || []).map(plan => <tr key={plan.planId}><td><b>{plan.traineeName}</b><small>{plan.employeeId}</small></td><td><b>{plan.title}</b><small><Status value={plan.status} /></small></td><td>{Number(plan.completedGoals || 0)}/{Number(plan.goalCount || 0)} goals<small>{Number(plan.sessionCount || 0)} sessions</small></td><td>{formatDate(plan.dueAt)}</td><td><Status value={plan.priority} /></td></tr>)}</tbody></table></div>
          {!data?.plans?.length && <div className="dev-empty"><b>No coaching plans</b><p>Create a plan for an employee who needs structured development or performance support.</p></div>}
        </section>
      ) : view === 'renewals' ? (
        <section className="dev-section">
          <div className="dev-section-head"><div><h3>Renewal cases</h3><p>Sign off only after review; issue only when all configured evidence is ready.</p></div><span>{data?.renewalCases?.length || 0}</span></div>
          <div className="dev-renewal-list">{(data?.renewalCases || []).map(item => <article key={item.caseId}><div><Status value={item.status} /><b>{item.traineeName}</b><span>{item.employeeId} · {item.credentialNumber}</span></div><div><b>{formatDate(item.dueAt)}</b><span>Renewal due</span></div><p>{item.blockerReason || 'All requirements complete.'}</p><div>{!item.managerSignoffAt && <button className="btn small secondary" disabled={saving === `signoff:${item.caseId}`} onClick={() => renewalAction(item, 'signoff')}>Manager sign-off</button>}<button className="btn small" disabled={item.status !== 'READY' || saving === `renew:${item.caseId}`} onClick={() => renewalAction(item, 'renew')}>Issue renewal</button></div></article>)}</div>
          {!data?.renewalCases?.length && <div className="dev-empty"><b>No renewal cases</b><p>Cases open automatically when a credential enters its configured renewal window.</p></div>}
        </section>
      ) : (
        <div className="dev-create-grid">
          <form className="dev-form-card" onSubmit={createPlan}><h3>Create coaching plan</h3><label>Employee<select required value={planForm.employeeId} onChange={event => setPlanForm(form => ({ ...form, employeeId: event.target.value }))}><option value="">Select employee</option>{(data?.employees || []).map(employee => <option key={employee.employeeId} value={employee.employeeId}>{employee.traineeName || employee.employeeId} · {employee.employeeId}</option>)}</select></label><label>Plan title<input required value={planForm.title} onChange={event => setPlanForm(form => ({ ...form, title: event.target.value }))} placeholder="Example: Extraction quality improvement" /></label><div className="dev-form-grid"><label>Priority<select value={planForm.priority} onChange={event => setPlanForm(form => ({ ...form, priority: event.target.value }))}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label><label>Due date<input type="date" value={planForm.dueAt} onChange={event => setPlanForm(form => ({ ...form, dueAt: event.target.value }))} /></label></div><label>Success criteria<textarea rows="3" required value={planForm.successCriteria} onChange={event => setPlanForm(form => ({ ...form, successCriteria: event.target.value }))} /></label><button className="btn" disabled={saving === 'plan'}>{saving === 'plan' ? 'Creating…' : 'Create active plan'}</button></form>
          <form className="dev-form-card" onSubmit={addGoal}><h3>Add measurable goal</h3><label>Plan<select required value={goalForm.planId} onChange={event => setGoalForm(form => ({ ...form, planId: event.target.value }))}><option value="">Select active plan</option>{activePlans.map(plan => <option key={plan.planId} value={plan.planId}>{plan.traineeName} · {plan.title}</option>)}</select></label><label>Goal<input required value={goalForm.goalTitle} onChange={event => setGoalForm(form => ({ ...form, goalTitle: event.target.value }))} /></label><div className="dev-form-grid"><label>Baseline<input type="number" value={goalForm.baselineValue} onChange={event => setGoalForm(form => ({ ...form, baselineValue: event.target.value }))} /></label><label>Target<input type="number" value={goalForm.targetValue} onChange={event => setGoalForm(form => ({ ...form, targetValue: event.target.value }))} /></label></div><label>Due date<input type="date" value={goalForm.dueAt} onChange={event => setGoalForm(form => ({ ...form, dueAt: event.target.value }))} /></label><button className="btn" disabled={saving === 'goal'}>{saving === 'goal' ? 'Adding…' : 'Add goal'}</button></form>
          <form className="dev-form-card" onSubmit={addSession}><h3>Schedule coaching session</h3><label>Plan<select required value={sessionForm.planId} onChange={event => setSessionForm(form => ({ ...form, planId: event.target.value }))}><option value="">Select active plan</option>{activePlans.map(plan => <option key={plan.planId} value={plan.planId}>{plan.traineeName} · {plan.title}</option>)}</select></label><label>Date and time<input required type="datetime-local" value={sessionForm.scheduledAt} onChange={event => setSessionForm(form => ({ ...form, scheduledAt: event.target.value }))} /></label><label>Agenda<textarea rows="3" value={sessionForm.agenda} onChange={event => setSessionForm(form => ({ ...form, agenda: event.target.value }))} /></label><button className="btn" disabled={saving === 'session'}>{saving === 'session' ? 'Scheduling…' : 'Schedule session'}</button></form>
        </div>
      )}

      {action && <div className="modal-overlay" onClick={() => setAction(null)}><form className="modal-box dev-action-modal" onClick={event => event.stopPropagation()} onSubmit={saveAction}><div className="modal-head"><b>{action.type === 'goal' ? 'Update goal evidence' : 'Complete coaching session'}</b><button type="button" className="btn small secondary" onClick={() => setAction(null)}>✕</button></div>{action.type === 'goal' ? <><label>Status<select value={action.form.status} onChange={event => setAction(item => ({ ...item, form: { ...item.form, status: event.target.value } }))}><option>IN_PROGRESS</option><option>COMPLETED</option><option>BLOCKED</option></select></label><label>Progress %<input type="number" min="0" max="100" value={action.form.progressPct} onChange={event => setAction(item => ({ ...item, form: { ...item.form, progressPct: event.target.value } }))} /></label><label>Evidence reference<input value={action.form.evidenceReference} onChange={event => setAction(item => ({ ...item, form: { ...item.form, evidenceReference: event.target.value } }))} /></label><label>Completion notes<textarea rows="4" value={action.form.completionNotes} onChange={event => setAction(item => ({ ...item, form: { ...item.form, completionNotes: event.target.value } }))} /></label></> : <><label>Observation notes<textarea required rows="4" value={action.form.observationNotes} onChange={event => setAction(item => ({ ...item, form: { ...item.form, observationNotes: event.target.value } }))} /></label><label>Learner commitment<textarea required rows="4" value={action.form.learnerCommitment} onChange={event => setAction(item => ({ ...item, form: { ...item.form, learnerCommitment: event.target.value } }))} /></label><label>Effectiveness rating<input type="number" min="1" max="5" value={action.form.effectivenessRating} onChange={event => setAction(item => ({ ...item, form: { ...item.form, effectivenessRating: event.target.value } }))} /></label></>}<button className="btn" disabled={saving === 'action'}>{saving === 'action' ? 'Saving…' : 'Save evidence'}</button></form></div>}
    </div>
  );
}
