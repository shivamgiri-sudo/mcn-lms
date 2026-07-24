import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './developmentHub.css';
import './developmentOperations.css';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Status({ value }) {
  return <span className={`dev-status ${String(value || '').toLowerCase()}`}>{value || 'OPEN'}</span>;
}

const emptyRule = { processName: '', lobName: '', certificationType: 'PROCESS_CERTIFICATION', validityDays: 365, renewalWindowDays: 45, graceDays: 0, learningPathId: '', assessmentId: '', minScore: 70, requireNoCriticalRisk: true, requireManagerSignoff: true, active: true };
const emptyPlan = { employeeId: '', batchNo: '', title: '', reasonCode: 'DEVELOPMENT', priority: 'MEDIUM', dueAt: '', successCriteria: '', activate: true };

export default function AdminDevelopmentView() {
  const [data, setData] = useState({ coaching: [], certifications: [], renewalCases: [] });
  const [rules, setRules] = useState([]);
  const [paths, setPaths] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [view, setView] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [planForm, setPlanForm] = useState(emptyPlan);
  const [employees, setEmployees] = useState([]);
  const [confirmAction, setConfirmAction] = useState(null);

  async function load() {
    setLoading(true); setError('');
    const [dashboard, ruleResult, pathResult, evidenceResult] = await Promise.all([
      api.get('/development/admin/dashboard', 'admin'),
      api.get('/development/admin/renewal-rules', 'admin'),
      api.get('/talent/admin/paths', 'admin'),
      api.get('/talent/admin/evidence/catalog?q=', 'admin'),
    ]);
    setLoading(false);
    if (!dashboard.ok) return setError(dashboard.message || 'Could not load development dashboard.');
    setData(dashboard.data || { coaching: [], certifications: [], renewalCases: [] });
    if (ruleResult.ok) setRules(ruleResult.data || []);
    if (pathResult.ok) setPaths(pathResult.data || []);
    if (evidenceResult.ok) setAssessments(evidenceResult.data?.assessments || []);
  }

  useEffect(() => { load(); }, []);

  async function searchEmployees(event) {
    event.preventDefault();
    if (search.trim().length < 2) return setError('Enter at least two characters.');
    setSaving('search'); setError('');
    const result = await api.get(`/talent/admin/employees/search?q=${encodeURIComponent(search.trim())}`, 'admin');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not search employees.');
    setEmployees(result.data || []);
  }

  async function saveRule(event) {
    event.preventDefault();
    setSaving('rule'); setError(''); setMessage('');
    const result = await api.put('/development/admin/renewal-rules', ruleForm, 'admin');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not save renewal rule.');
    setMessage('Renewal rule saved. Existing credentials will use it during the next lifecycle synchronization.');
    setRuleForm(emptyRule);
    await load();
  }

  async function createPlan(event) {
    event.preventDefault();
    setSaving('plan'); setError(''); setMessage('');
    const result = await api.post('/development/admin/plans', planForm, 'admin');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not create coaching plan.');
    setMessage('Coaching plan created in the employee’s development record.');
    setPlanForm(emptyPlan); setEmployees([]); setSearch('');
    await load();
  }

  async function runAction() {
    if (!confirmAction) return;
    setSaving('confirm'); setError(''); setMessage('');
    const item = confirmAction.item;
    let result;
    if (confirmAction.type === 'renew') {
      result = await api.post(`/development/admin/renewals/${encodeURIComponent(item.caseId)}/renew`, {}, 'admin');
    } else if (confirmAction.type === 'waive') {
      result = await api.post(`/development/admin/renewals/${encodeURIComponent(item.caseId)}/waive`, { waiverReason: confirmAction.reason }, 'admin');
    } else {
      result = await api.post(`/development/admin/certifications/${encodeURIComponent(item.certificationId)}/revoke`, { reason: confirmAction.reason }, 'admin');
    }
    setSaving('');
    if (!result.ok) return setError(result.message || 'Lifecycle action failed.');
    setMessage(result.message || 'Lifecycle action completed.');
    setConfirmAction(null);
    await load();
  }

  const metrics = useMemo(() => ({
    activePlans: data.coaching.filter(item => item.status === 'ACTIVE').length,
    criticalPlans: data.coaching.filter(item => item.priority === 'CRITICAL' && item.status === 'ACTIVE').length,
    activeCredentials: data.certifications.filter(item => ['ACTIVE', 'EXPIRING'].includes(item.status)).length,
    expiring: data.certifications.filter(item => item.status === 'EXPIRING').length,
    overdue: data.renewalCases.filter(item => item.status === 'OVERDUE').length,
    ready: data.renewalCases.filter(item => item.status === 'READY').length,
  }), [data]);

  if (loading) return <div className="dev-loading"><div className="spinner" /><p>Synchronizing certification and development governance…</p></div>;

  return (
    <div className="dev-view">
      <div className="dev-learner-hero"><div><span>Branch and company governance</span><h2>Development Lifecycle</h2><p>Manage coaching plans, certification validity, renewal evidence, waivers, replacement credentials and revocation from one auditable console.</p></div><button className="btn small secondary" onClick={load}>↻ Refresh</button></div>
      {message && <div className="toast ok">{message}</div>}
      {error && <div className="toast bad">{error}</div>}
      <div className="dev-summary-grid"><div><span>Active coaching</span><b>{metrics.activePlans}</b><small>{metrics.criticalPlans} critical priority</small></div><div className="ok"><span>Active credentials</span><b>{metrics.activeCredentials}</b><small>{metrics.expiring} inside renewal window</small></div><div className="warn"><span>Renewal overdue</span><b>{metrics.overdue}</b><small>Past grace date</small></div><div className="ok"><span>Ready to renew</span><b>{metrics.ready}</b><small>All evidence complete</small></div></div>
      <div className="dev-switcher"><button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Lifecycle dashboard</button><button className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}>Renewal rules</button><button className={view === 'coaching' ? 'active' : ''} onClick={() => setView('coaching')}>Create coaching plan</button></div>

      {view === 'dashboard' && <div className="dev-admin-grid"><section className="dev-admin-panel"><div className="dev-section-head"><div><h3>Renewal cases</h3><p>Prioritized by overdue and readiness state.</p></div><span>{data.renewalCases.length}</span></div><div className="dev-admin-list">{data.renewalCases.map(item => <article key={item.caseId}><div><Status value={item.status} /><b>{item.traineeName}</b><span>{item.employeeId} · {item.credentialNumber} · Due {formatDate(item.dueAt)}</span><span>{item.blockerReason || 'All requirements complete.'}</span></div><div>{item.status === 'READY' && <button className="btn small" onClick={() => setConfirmAction({ type: 'renew', item, reason: '' })}>Renew</button>}{!['COMPLETED', 'WAIVED', 'CANCELLED'].includes(item.status) && <button className="btn small secondary" onClick={() => setConfirmAction({ type: 'waive', item, reason: '' })}>Waive</button>}</div></article>)}</div>{!data.renewalCases.length && <div className="dev-empty"><b>No renewal cases</b><p>Cases open automatically from configured renewal windows.</p></div>}</section><section className="dev-admin-panel"><div className="dev-section-head"><div><h3>Credential register</h3><p>Versioned and audit-safe employee credentials.</p></div><span>{data.certifications.length}</span></div><div className="dev-admin-list">{data.certifications.map(item => <article key={item.certificationId}><div><Status value={item.status} /><b>{item.traineeName}</b><span>{item.credentialNumber} · V{item.versionNo}</span><span>Issued {formatDate(item.issuedAt)} · Expires {formatDate(item.expiresAt)}</span></div><div>{['ACTIVE', 'EXPIRING', 'EXPIRED'].includes(item.status) && <button className="btn small secondary dev-danger" onClick={() => setConfirmAction({ type: 'revoke', item, reason: '' })}>Revoke</button>}</div></article>)}</div></section></div>}

      {view === 'rules' && <div className="dev-admin-grid"><section className="dev-admin-panel"><div className="dev-section-head"><div><h3>Renewal policy register</h3><p>Most-specific process and LOB rule takes priority over defaults.</p></div><span>{rules.length}</span></div><div className="dev-admin-list">{rules.map(rule => <article key={rule.renewalRuleId}><div><Status value={rule.active ? 'ACTIVE' : 'INACTIVE'} /><b>{rule.processName || 'Company default'} / {rule.lobName || 'All LOBs'}</b><span>{rule.validityDays} days validity · {rule.renewalWindowDays} day window · {rule.graceDays} day grace</span><span>{rule.learningPathName || rule.learningPathId || 'No path'} · {rule.assessmentName || rule.assessmentId || 'No assessment'}</span></div><div><button className="btn small secondary" onClick={() => setRuleForm({ ...rule, requireNoCriticalRisk: Boolean(rule.requireNoCriticalRisk), requireManagerSignoff: Boolean(rule.requireManagerSignoff) })}>Edit</button></div></article>)}</div></section><form className="dev-form-card dev-admin-panel sticky" onSubmit={saveRule}><h3>Configure renewal rule</h3><div className="dev-form-grid"><label>Process<input value={ruleForm.processName} onChange={event => setRuleForm(form => ({ ...form, processName: event.target.value }))} placeholder="Blank = default" /></label><label>LOB<input value={ruleForm.lobName} onChange={event => setRuleForm(form => ({ ...form, lobName: event.target.value }))} placeholder="Blank = all" /></label></div><div className="dev-form-grid"><label>Validity days<input type="number" min="1" value={ruleForm.validityDays} onChange={event => setRuleForm(form => ({ ...form, validityDays: event.target.value }))} /></label><label>Renewal window<input type="number" min="0" value={ruleForm.renewalWindowDays} onChange={event => setRuleForm(form => ({ ...form, renewalWindowDays: event.target.value }))} /></label></div><label>Grace days<input type="number" min="0" value={ruleForm.graceDays} onChange={event => setRuleForm(form => ({ ...form, graceDays: event.target.value }))} /></label><label>Renewal learning path<select value={ruleForm.learningPathId || ''} onChange={event => setRuleForm(form => ({ ...form, learningPathId: event.target.value }))}><option value="">No path requirement</option>{paths.filter(path => path.status === 'PUBLISHED').map(path => <option key={path.pathId} value={path.pathId}>{path.pathName} · V{path.versionNo}</option>)}</select></label><label>Renewal assessment<select value={ruleForm.assessmentId || ''} onChange={event => setRuleForm(form => ({ ...form, assessmentId: event.target.value }))}><option value="">No assessment requirement</option>{assessments.map(item => <option key={item.referenceId} value={item.referenceId}>{item.referenceTitle} · {item.classroomName}</option>)}</select></label><label>Minimum score<input type="number" min="0" max="100" value={ruleForm.minScore ?? ''} onChange={event => setRuleForm(form => ({ ...form, minScore: event.target.value }))} /></label><label className="dev-checkbox"><input type="checkbox" checked={Boolean(ruleForm.requireNoCriticalRisk)} onChange={event => setRuleForm(form => ({ ...form, requireNoCriticalRisk: event.target.checked }))} /> Require no open critical risk</label><label className="dev-checkbox"><input type="checkbox" checked={Boolean(ruleForm.requireManagerSignoff)} onChange={event => setRuleForm(form => ({ ...form, requireManagerSignoff: event.target.checked }))} /> Require manager sign-off</label><button className="btn" disabled={saving === 'rule'}>{saving === 'rule' ? 'Saving…' : 'Save renewal rule'}</button></form></div>}

      {view === 'coaching' && <div className="dev-admin-grid"><section className="dev-admin-panel"><div className="dev-section-head"><div><h3>Coaching register</h3><p>Active and historical plans in your data scope.</p></div><span>{data.coaching.length}</span></div><div className="dev-admin-list">{data.coaching.map(plan => <article key={plan.planId}><div><Status value={plan.status} /><b>{plan.traineeName} · {plan.title}</b><span>{plan.employeeId} · {plan.batchNo} · {plan.priority}</span><span>{Number(plan.completedGoals || 0)}/{Number(plan.goalCount || 0)} goals · Due {formatDate(plan.dueAt)}</span></div></article>)}</div></section><form className="dev-form-card dev-admin-panel sticky" onSubmit={createPlan}><h3>Create scoped coaching plan</h3><form className="dev-search-form" onSubmit={searchEmployees}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee name, ID, email or mobile" /><button type="submit" className="btn small secondary">{saving === 'search' ? 'Searching…' : 'Search'}</button></form><label>Employee<select required value={planForm.employeeId} onChange={event => { const selected = employees.find(item => item.employeeId === event.target.value); setPlanForm(form => ({ ...form, employeeId: event.target.value, batchNo: selected?.batchNo || '' })); }}><option value="">Select employee</option>{employees.map(item => <option key={item.employeeId} value={item.employeeId}>{item.traineeName || item.employeeId} · {item.employeeId}</option>)}</select></label><label>Batch<input value={planForm.batchNo} onChange={event => setPlanForm(form => ({ ...form, batchNo: event.target.value }))} /></label><label>Plan title<input required value={planForm.title} onChange={event => setPlanForm(form => ({ ...form, title: event.target.value }))} /></label><div className="dev-form-grid"><label>Priority<select value={planForm.priority} onChange={event => setPlanForm(form => ({ ...form, priority: event.target.value }))}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label><label>Due date<input type="date" value={planForm.dueAt} onChange={event => setPlanForm(form => ({ ...form, dueAt: event.target.value }))} /></label></div><label>Success criteria<textarea required rows="4" value={planForm.successCriteria} onChange={event => setPlanForm(form => ({ ...form, successCriteria: event.target.value }))} /></label><button className="btn" disabled={saving === 'plan'}>{saving === 'plan' ? 'Creating…' : 'Create coaching plan'}</button></form></div>}

      {confirmAction && <div className="modal-overlay" onClick={() => setConfirmAction(null)}><div className="modal-box dev-action-modal" onClick={event => event.stopPropagation()}><div className="modal-head"><b>{confirmAction.type === 'renew' ? 'Issue replacement credential' : confirmAction.type === 'waive' ? 'Waive renewal requirements' : 'Revoke credential'}</b><button className="btn small secondary" onClick={() => setConfirmAction(null)}>✕</button></div><p style={{fontSize:11,color:'var(--muted)',lineHeight:1.5}}>{confirmAction.type === 'renew' ? 'A new credential version will be issued and the source credential will be superseded.' : 'This is a sensitive audited action. Provide a detailed business reason.'}</p>{confirmAction.type !== 'renew' && <label>Detailed reason<textarea rows="5" value={confirmAction.reason} onChange={event => setConfirmAction(item => ({ ...item, reason: event.target.value }))} /></label>}<button className={`btn ${confirmAction.type === 'revoke' ? 'dev-danger' : ''}`} disabled={saving === 'confirm' || (confirmAction.type !== 'renew' && confirmAction.reason.trim().length < 20)} onClick={runAction}>{saving === 'confirm' ? 'Processing…' : 'Confirm action'}</button></div></div>}
    </div>
  );
}
