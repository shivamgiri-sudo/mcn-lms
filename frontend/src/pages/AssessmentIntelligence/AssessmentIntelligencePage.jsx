import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '../../utils/browserRouter.jsx';
import { api } from '../../utils/api.js';

const BASE = '/assessment-intelligence';
const EMPTY_BLUEPRINT = { blueprintName: '', totalQuestions: 10, randomizeQuestions: true, randomizeOptions: true };
const EMPTY_RULE = { ruleOrder: 1, topic: '', objectiveCode: '', skillId: '', difficulty: '', questionType: '', cognitiveLevel: '', languageCode: '', questionCount: 1, marksEach: '', negativeMarksEach: '', required: true };
const EMPTY_ACCOMMODATION = { employeeId: '', accommodationType: 'TIME_EXTENSION', timeMultiplier: 1.25, extraBreakMinutes: 0, languageCode: '', effectiveFrom: '', effectiveTo: '', reason: '', displayPreferences: { fontScale: 1, highContrast: false } };

function count(value) {
  return Number(value || 0);
}

function pct(value) {
  return value === null || value === undefined ? '—' : `${Math.round(Number(value || 0))}%`;
}

function statusClass(status) {
  if (['PUBLISHED', 'APPROVED', 'HEALTHY', 'RESOLVED'].includes(status)) return 'ok';
  if (['DRAFT', 'IN_REVIEW', 'INSUFFICIENT_DATA', 'REVIEWING'].includes(status)) return 'info';
  if (['TOO_HARD', 'LOW_DISCRIMINATION', 'HIGH_BLANK_RATE', 'OPEN', 'HIGH', 'CRITICAL'].includes(status)) return 'bad';
  if (['TOO_EASY', 'MEDIUM'].includes(status)) return 'warn';
  return '';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function Card({ children, style }) {
  return <div className="card" style={{ padding: 16, ...style }}>{children}</div>;
}

function Field({ label, children }) {
  return <label style={{ display: 'grid', gap: 5, minWidth: 0 }}><span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 800 }}>{label}</span>{children}</label>;
}

function Input(props) {
  return <input {...props} style={{ width: '100%', minWidth: 0, border: '1.5px solid var(--line)', borderRadius: 9, padding: '8px 10px', background: 'var(--card)', color: 'var(--ink)', ...props.style }} />;
}

function Select(props) {
  return <select {...props} style={{ width: '100%', minWidth: 0, border: '1.5px solid var(--line)', borderRadius: 9, padding: '8px 10px', background: 'var(--card)', color: 'var(--ink)', ...props.style }}>{props.children}</select>;
}

function Textarea(props) {
  return <textarea {...props} style={{ width: '100%', minWidth: 0, border: '1.5px solid var(--line)', borderRadius: 9, padding: '9px 10px', background: 'var(--card)', color: 'var(--ink)', resize: 'vertical', ...props.style }} />;
}

export default function AssessmentIntelligencePage() {
  const [searchParams] = useSearchParams();
  const requestedRole = searchParams.get('role') === 'coordinator' ? 'coordinator' : 'admin';
  const role = localStorage.getItem(`lms_token_${requestedRole}`) ? requestedRole : localStorage.getItem('lms_token_admin') ? 'admin' : 'coordinator';
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [assessments, setAssessments] = useState([]);
  const [selectedId, setSelectedId] = useState(searchParams.get('assessmentId') || '');
  const [studio, setStudio] = useState(null);
  const [coordinatorRows, setCoordinatorRows] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [blueprintForm, setBlueprintForm] = useState(EMPTY_BLUEPRINT);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);
  const [accommodationForm, setAccommodationForm] = useState(EMPTY_ACCOMMODATION);
  const [accommodations, setAccommodations] = useState([]);
  const [accommodationQuery, setAccommodationQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [role]);
  useEffect(() => {
    if (role === 'admin' && selectedId) loadStudio(selectedId);
  }, [selectedId, role]);

  async function load() {
    setLoading(true);
    setMessage('');
    if (role === 'coordinator') {
      const response = await api.get(`${BASE}/coordinator/summary`, 'coordinator');
      setLoading(false);
      if (response.ok) setCoordinatorRows(response.data || []);
      else setMessage(response.message || 'Unable to load assessment analytics.');
      return;
    }
    const response = await api.get(`${BASE}/admin/assessments`, 'admin');
    setLoading(false);
    if (!response.ok) {
      setMessage(response.message || 'Unable to load assessments.');
      return;
    }
    setAssessments(response.data || []);
    if (!selectedId && response.data?.[0]?.assessmentId) setSelectedId(response.data[0].assessmentId);
  }

  async function loadStudio(assessmentId = selectedId) {
    if (!assessmentId) return;
    setMessage('');
    const response = await api.get(`${BASE}/admin/assessments/${assessmentId}/studio`, 'admin');
    if (response.ok) setStudio(response.data);
    else setMessage(response.message || 'Unable to load assessment studio.');
  }

  async function runAction(request, successMessage, refresh = true) {
    setSaving(true);
    setMessage('');
    const response = await request();
    setSaving(false);
    if (!response.ok) {
      setMessage(response.message || 'Action failed.');
      return null;
    }
    setMessage(successMessage);
    if (refresh) {
      await load();
      if (selectedId) await loadStudio(selectedId);
    }
    return response;
  }

  async function createBlueprint(event) {
    event.preventDefault();
    const response = await runAction(
      () => api.post(`${BASE}/admin/assessments/${selectedId}/blueprints`, blueprintForm, 'admin'),
      'Draft blueprint created.',
    );
    if (response) setBlueprintForm(EMPTY_BLUEPRINT);
  }

  async function addRule(event) {
    event.preventDefault();
    const draft = studio?.blueprints?.find(item => item.status === 'DRAFT');
    if (!draft) return setMessage('Create a draft blueprint before adding rules.');
    const response = await runAction(
      () => api.post(`${BASE}/admin/blueprints/${draft.blueprintId}/rules`, ruleForm, 'admin'),
      'Blueprint rule added.',
    );
    if (response) setRuleForm(previous => ({ ...EMPTY_RULE, ruleOrder: Number(previous.ruleOrder || 0) + 1 }));
  }

  async function submitBlueprintReview(blueprintId) {
    await runAction(() => api.post(`${BASE}/admin/blueprints/${blueprintId}/submit-review`, {}, 'admin'), 'Blueprint validated and submitted for review.');
  }

  async function publishBlueprint(blueprintId) {
    if (!window.confirm('Publish this reviewed blueprint? The current published version will be retired.')) return;
    await runAction(() => api.post(`${BASE}/admin/blueprints/${blueprintId}/publish`, {}, 'admin'), 'Blueprint published. New attempts will use this version.');
  }

  async function retireBlueprint(blueprintId) {
    if (!window.confirm('Retire this blueprint? Existing attempt evidence will remain unchanged.')) return;
    await runAction(() => api.post(`${BASE}/admin/blueprints/${blueprintId}/retire`, {}, 'admin'), 'Blueprint retired.');
  }

  async function saveQuestion(question, updates) {
    await runAction(
      () => api.put(`${BASE}/admin/questions/${question.questionId}/metadata`, { ...question, ...updates }, 'admin'),
      'Question governance metadata updated.',
    );
  }

  async function recalculateAnalytics() {
    await runAction(
      () => api.post(`${BASE}/admin/assessments/${selectedId}/recalculate-analytics`, {}, 'admin'),
      'Item analytics recalculated from finalized attempts.',
    );
  }

  async function updateAlert(alertId, status) {
    const resolutionNotes = ['RESOLVED', 'DISMISSED'].includes(status)
      ? window.prompt('Enter detailed resolution notes (minimum 20 characters):')
      : '';
    if (['RESOLVED', 'DISMISSED'].includes(status) && (!resolutionNotes || resolutionNotes.trim().length < 20)) return;
    await runAction(
      () => api.put(`${BASE}/admin/quality-alerts/${alertId}`, { status, resolutionNotes }, 'admin'),
      `Quality alert moved to ${status}.`,
    );
  }

  async function loadAccommodations() {
    const query = accommodationQuery ? `?q=${encodeURIComponent(accommodationQuery)}` : '';
    const response = await api.get(`${BASE}/admin/accommodations${query}`, 'admin');
    if (response.ok) setAccommodations(response.data || []);
    else setMessage(response.message || 'Unable to load accommodations.');
  }

  async function createAccommodation(event) {
    event.preventDefault();
    const response = await runAction(
      () => api.post(`${BASE}/admin/accommodations`, accommodationForm, 'admin'),
      'Accommodation approved and will apply to new attempt forms.',
      false,
    );
    if (response) {
      setAccommodationForm(EMPTY_ACCOMMODATION);
      await loadAccommodations();
    }
  }

  async function revokeAccommodation(accommodationId) {
    const reason = window.prompt('Enter detailed revocation reason (minimum 20 characters):');
    if (!reason || reason.trim().length < 20) return;
    await runAction(
      () => api.post(`${BASE}/admin/accommodations/${accommodationId}/revoke`, { reason }, 'admin'),
      'Accommodation revoked for future attempts.',
      false,
    );
    await loadAccommodations();
  }

  const summary = useMemo(() => ({
    assessments: assessments.length,
    approvedQuestions: assessments.reduce((sum, item) => sum + count(item.approvedQuestions), 0),
    published: assessments.filter(item => item.blueprintStatus === 'PUBLISHED').length,
    alerts: assessments.reduce((sum, item) => sum + count(item.openQualityAlerts), 0),
  }), [assessments]);

  if (loading) return <div className="wrap"><div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div></div>;

  if (role === 'coordinator') {
    return (
      <div className="wrap">
        <Header role="Coordinator" message={message} />
        <div className="kpi-grid" style={{ marginBottom: 14 }}>
          <Kpi label="Owned assessments" value={coordinatorRows.length} />
          <Kpi label="Submitted attempts" value={coordinatorRows.reduce((sum, item) => sum + count(item.submittedAttempts), 0)} />
          <Kpi label="Quality issues" value={coordinatorRows.reduce((sum, item) => sum + count(item.qualityIssues), 0)} />
          <Kpi label="Open alerts" value={coordinatorRows.reduce((sum, item) => sum + count(item.openAlerts), 0)} />
        </div>
        <Card>
          <h2 className="section-title">Own-batch assessment scorecard</h2>
          {!coordinatorRows.length ? <div className="empty">No active owned batches have assessments.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['Assessment', 'Classroom', 'Scope', 'Attempts', 'Average', 'Passes', 'Analysed items', 'Quality issues', 'Alerts'].map(label => <th key={label} style={th}>{label}</th>)}</tr></thead>
                <tbody>{coordinatorRows.map(row => <tr key={row.assessmentId}>
                  <td style={td}><b>{row.assessmentName}</b></td>
                  <td style={td}>{row.classroomName}</td>
                  <td style={td}>{[row.branch, row.process, row.lob].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={td}>{count(row.submittedAttempts)}</td>
                  <td style={td}>{pct(row.averagePercentage)}</td>
                  <td style={td}>{count(row.passedAttempts)}</td>
                  <td style={td}>{count(row.analysedItems)}</td>
                  <td style={td}><span className={`pill ${count(row.qualityIssues) ? 'bad' : 'ok'}`}>{count(row.qualityIssues)}</span></td>
                  <td style={td}><span className={`pill ${count(row.openAlerts) ? 'warn' : 'ok'}`}>{count(row.openAlerts)}</span></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="wrap">
      <Header role="Administrator" message={message} />
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <Kpi label="Assessments" value={summary.assessments} />
        <Kpi label="Approved questions" value={summary.approvedQuestions} />
        <Kpi label="Published blueprints" value={summary.published} />
        <Kpi label="Open quality alerts" value={summary.alerts} />
      </div>

      <div className="assessment-layout">
        <aside>
          <Card style={{ position: 'sticky', top: 12 }}>
            <div className="row between" style={{ marginBottom: 10 }}><b>Assessment catalogue</b><button className="btn small secondary" onClick={load}>↺</button></div>
            <Input placeholder="Filter assessments" onChange={event => {
              const query = event.target.value.toLowerCase();
              document.querySelectorAll('[data-assessment-item]').forEach(element => { element.style.display = element.dataset.search.includes(query) ? '' : 'none'; });
            }} />
            <div style={{ display: 'grid', gap: 7, marginTop: 10, maxHeight: '68vh', overflowY: 'auto' }}>
              {assessments.map(item => (
                <button
                  type="button"
                  data-assessment-item
                  data-search={`${item.assessmentName} ${item.classroomName} ${item.branch} ${item.process} ${item.lob}`.toLowerCase()}
                  key={item.assessmentId}
                  onClick={() => setSelectedId(item.assessmentId)}
                  style={{ border: selectedId === item.assessmentId ? '2px solid var(--accent)' : '1.5px solid var(--line)', borderRadius: 10, padding: 10, textAlign: 'left', background: selectedId === item.assessmentId ? 'var(--accent-soft)' : 'var(--card)', color: 'var(--ink)', cursor: 'pointer' }}
                >
                  <b style={{ fontSize: 12.5 }}>{item.assessmentName}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{item.classroomName} · {item.process || '—'}</div>
                  <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                    <span className={`pill ${statusClass(item.blueprintStatus)}`}>{item.blueprintStatus || 'Legacy form'}</span>
                    {count(item.openQualityAlerts) > 0 && <span className="pill bad">{count(item.openQualityAlerts)} alerts</span>}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </aside>

        <main style={{ minWidth: 0 }}>
          {!studio ? <Card><div className="empty">Select an assessment to open the studio.</div></Card> : (
            <>
              <Card style={{ marginBottom: 12 }}>
                <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <span className="pill accent">Assessment Intelligence</span>
                    <h2 style={{ margin: '7px 0 3px' }}>{studio.assessment.assessmentName}</h2>
                    <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>{studio.assessment.classroomName} · {[studio.assessment.branch, studio.assessment.process, studio.assessment.lob].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                    <span className="pill">Pass {studio.assessment.passingPct}%</span>
                    <span className="pill">{studio.assessment.attemptLimit} attempts</span>
                    <span className="pill">{studio.assessment.timeLimitMins} minutes</span>
                  </div>
                </div>
              </Card>

              <div className="tabs" style={{ marginBottom: 12 }}>
                {['overview', 'blueprints', 'questions', 'analytics', 'accommodations'].map(tab => <button key={tab} className={`tab-btn${activeTab === tab ? ' active' : ''}`} onClick={() => { setActiveTab(tab); if (tab === 'accommodations') loadAccommodations(); }}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
              </div>

              {activeTab === 'overview' && <Overview studio={studio} onRecalculate={recalculateAnalytics} saving={saving} />}
              {activeTab === 'blueprints' && <Blueprints studio={studio} blueprintForm={blueprintForm} setBlueprintForm={setBlueprintForm} createBlueprint={createBlueprint} ruleForm={ruleForm} setRuleForm={setRuleForm} addRule={addRule} onSubmitReview={submitBlueprintReview} onPublish={publishBlueprint} onRetire={retireBlueprint} saving={saving} />}
              {activeTab === 'questions' && <Questions studio={studio} onSave={saveQuestion} saving={saving} />}
              {activeTab === 'analytics' && <Analytics studio={studio} onRecalculate={recalculateAnalytics} onUpdateAlert={updateAlert} saving={saving} />}
              {activeTab === 'accommodations' && <Accommodations form={accommodationForm} setForm={setAccommodationForm} rows={accommodations} query={accommodationQuery} setQuery={setAccommodationQuery} onSearch={loadAccommodations} onCreate={createAccommodation} onRevoke={revokeAccommodation} saving={saving} />}
            </>
          )}
        </main>
      </div>

      <style>{`.assessment-layout{display:grid;grid-template-columns:minmax(230px,280px) minmax(0,1fr);gap:12px}.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}@media(max-width:900px){.assessment-layout{grid-template-columns:1fr}.assessment-layout aside .card{position:static!important}.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.kpi-grid{grid-template-columns:1fr}.tabs{overflow-x:auto}.tab-btn{white-space:nowrap}}`}</style>
    </div>
  );
}

function Header({ role, message }) {
  return <><div className="hero"><div className="brand"><div className="logo">AI</div><div><h1>Assessment Intelligence</h1><p>Blueprints · Integrity · Quality evidence · Remediation</p></div></div><div className="row"><span className="pill accent">{role}</span><a className="btn small secondary" href={role === 'Administrator' ? '/admin' : '/coordinator'}>Back to portal</a></div></div>{message && <div className={`toast ${message.toLowerCase().includes('fail') || message.toLowerCase().includes('unable') ? 'bad' : 'ok'}`} style={{ marginBottom: 12 }}>{message}</div>}</>;
}

function Kpi({ label, value }) {
  return <div className="kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>;
}

function Overview({ studio, onRecalculate, saving }) {
  const published = studio.blueprints.find(item => item.status === 'PUBLISHED');
  const healthy = studio.analytics.filter(item => item.qualityStatus === 'HEALTHY').length;
  return <div style={{ display: 'grid', gap: 12 }}><div className="kpi-grid"><Kpi label="Question bank" value={studio.questions.length} /><Kpi label="Approved" value={studio.questions.filter(item => item.reviewStatus === 'APPROVED').length} /><Kpi label="Analysed items" value={studio.analytics.length} /><Kpi label="Healthy items" value={healthy} /></div><Card><div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}><div><h3 className="section-title">Current delivery policy</h3>{published ? <p style={{ fontSize: 13 }}>Published blueprint <b>v{published.versionNo}</b> generates <b>{published.totalQuestions}</b> questions using {published.rules.length} rule(s).</p> : <p style={{ fontSize: 13, color: 'var(--muted)' }}>No published blueprint. Existing approved questions remain available through legacy-compatible secure form generation.</p>}</div><button className="btn small accent" onClick={onRecalculate} disabled={saving}>Recalculate item evidence</button></div></Card><Card><h3 className="section-title">Quality queue</h3>{!studio.alerts.length ? <div className="empty">No question-quality alerts.</div> : <div style={{ display: 'grid', gap: 8 }}>{studio.alerts.slice(0, 8).map(alert => <div key={alert.alertId} className="row between" style={{ gap: 10, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}><div><b style={{ fontSize: 12.5 }}>{alert.alertType}</b><div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{alert.questionId} · opened {formatDate(alert.openedAt)}</div></div><span className={`pill ${statusClass(alert.severity)}`}>{alert.severity}</span></div>)}</div>}</Card></div>;
}

function Blueprints({ studio, blueprintForm, setBlueprintForm, createBlueprint, ruleForm, setRuleForm, addRule, onSubmitReview, onPublish, onRetire, saving }) {
  const draft = studio.blueprints.find(item => item.status === 'DRAFT');
  return <div style={{ display: 'grid', gap: 12 }}><Card><h3 className="section-title">Versioned blueprints</h3>{!studio.blueprints.length ? <div className="empty">No blueprint created.</div> : <div style={{ display: 'grid', gap: 9 }}>{studio.blueprints.map(item => <div key={item.blueprintId} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 13 }}><div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}><div><b>{item.blueprintName} · v{item.versionNo}</b><div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{item.totalQuestions} questions · {item.rules.length} rule(s) · updated {formatDate(item.updatedAt)}</div></div><div className="row" style={{ gap: 7, flexWrap: 'wrap' }}><span className={`pill ${statusClass(item.status)}`}>{item.status}</span>{item.status === 'DRAFT' && <button className="btn small accent" onClick={() => onSubmitReview(item.blueprintId)}>Validate & review</button>}{item.status === 'IN_REVIEW' && <button className="btn small accent" onClick={() => onPublish(item.blueprintId)}>Publish</button>}{item.status !== 'RETIRED' && <button className="btn small secondary" onClick={() => onRetire(item.blueprintId)}>Retire</button>}</div></div>{item.rules.length > 0 && <div style={{ overflowX: 'auto', marginTop: 10 }}><table style={{ width: '100%', minWidth: 660, borderCollapse: 'collapse' }}><thead><tr>{['#', 'Topic/objective', 'Skill', 'Difficulty', 'Type', 'Count', 'Marks'].map(label => <th key={label} style={th}>{label}</th>)}</tr></thead><tbody>{item.rules.map(rule => <tr key={rule.ruleId}><td style={td}>{rule.ruleOrder}</td><td style={td}>{rule.topic || rule.objectiveCode || 'Any'}</td><td style={td}>{rule.skillName || 'Any'}</td><td style={td}>{rule.difficulty || 'Any'}</td><td style={td}>{rule.questionType || 'Any'}</td><td style={td}>{rule.questionCount}</td><td style={td}>{rule.marksEach || 'Original'}</td></tr>)}</tbody></table></div>}</div>)}</div>}</Card>{!draft && <Card><h3 className="section-title">Create next draft version</h3><form onSubmit={createBlueprint} style={{ display: 'grid', gap: 10 }}><div className="form-grid"><Field label="Blueprint name"><Input value={blueprintForm.blueprintName} onChange={event => setBlueprintForm({ ...blueprintForm, blueprintName: event.target.value })} required /></Field><Field label="Total questions"><Input type="number" min="1" max="500" value={blueprintForm.totalQuestions} onChange={event => setBlueprintForm({ ...blueprintForm, totalQuestions: Number(event.target.value) })} required /></Field></div><div className="row" style={{ gap: 14, flexWrap: 'wrap' }}><label><input type="checkbox" checked={blueprintForm.randomizeQuestions} onChange={event => setBlueprintForm({ ...blueprintForm, randomizeQuestions: event.target.checked })} /> Randomize questions</label><label><input type="checkbox" checked={blueprintForm.randomizeOptions} onChange={event => setBlueprintForm({ ...blueprintForm, randomizeOptions: event.target.checked })} /> Randomize options</label></div><button className="btn accent" disabled={saving}>Create draft</button></form></Card>}{draft && <Card><h3 className="section-title">Add rule to {draft.blueprintName}</h3><form onSubmit={addRule} style={{ display: 'grid', gap: 10 }}><div className="form-grid"><Field label="Rule order"><Input type="number" min="1" value={ruleForm.ruleOrder} onChange={event => setRuleForm({ ...ruleForm, ruleOrder: Number(event.target.value) })} /></Field><Field label="Question count"><Input type="number" min="1" value={ruleForm.questionCount} onChange={event => setRuleForm({ ...ruleForm, questionCount: Number(event.target.value) })} /></Field><Field label="Topic"><Input value={ruleForm.topic} onChange={event => setRuleForm({ ...ruleForm, topic: event.target.value })} placeholder="Optional exact topic" /></Field><Field label="Objective code"><Input value={ruleForm.objectiveCode} onChange={event => setRuleForm({ ...ruleForm, objectiveCode: event.target.value })} placeholder="Optional" /></Field><Field label="Skill"><Select value={ruleForm.skillId} onChange={event => setRuleForm({ ...ruleForm, skillId: event.target.value })}><option value="">Any skill</option>{studio.skills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.skillName}</option>)}</Select></Field><Field label="Difficulty"><Select value={ruleForm.difficulty} onChange={event => setRuleForm({ ...ruleForm, difficulty: event.target.value })}><option value="">Any</option><option>Basic</option><option>Easy</option><option>Medium</option><option>Hard</option><option>Advanced</option></Select></Field><Field label="Question type"><Select value={ruleForm.questionType} onChange={event => setRuleForm({ ...ruleForm, questionType: event.target.value })}><option value="">Any</option>{['SINGLE_CHOICE','MULTI_CHOICE','TRUE_FALSE','SCENARIO','CASE_STUDY','AUDIO','VIDEO'].map(value => <option key={value}>{value}</option>)}</Select></Field><Field label="Cognitive level"><Select value={ruleForm.cognitiveLevel} onChange={event => setRuleForm({ ...ruleForm, cognitiveLevel: event.target.value })}><option value="">Any</option>{['REMEMBER','UNDERSTAND','APPLY','ANALYSE','EVALUATE','CREATE'].map(value => <option key={value}>{value}</option>)}</Select></Field><Field label="Marks each"><Input type="number" min="0.01" step="0.01" value={ruleForm.marksEach} onChange={event => setRuleForm({ ...ruleForm, marksEach: event.target.value })} placeholder="Use question marks" /></Field><Field label="Negative marks each"><Input type="number" min="0" step="0.01" value={ruleForm.negativeMarksEach} onChange={event => setRuleForm({ ...ruleForm, negativeMarksEach: event.target.value })} placeholder="Use question value" /></Field></div><button className="btn accent" disabled={saving}>Add blueprint rule</button></form></Card>}<style>{`.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(max-width:620px){.form-grid{grid-template-columns:1fr}}`}</style></div>;
}

function Questions({ studio, onSave, saving }) {
  const [editing, setEditing] = useState(null);
  return <Card><div className="row between" style={{ marginBottom: 10 }}><h3 className="section-title" style={{ margin: 0 }}>Question governance</h3><span className="pill info">{studio.questions.length} questions</span></div><div style={{ display: 'grid', gap: 9 }}>{studio.questions.map(question => <div key={question.questionId} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 13 }}><div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}><div><b style={{ fontSize: 13 }}>{question.questionText}</b><div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}><span className={`pill ${statusClass(question.reviewStatus)}`}>{question.reviewStatus}</span><span className="pill">{question.difficulty}</span>{question.topic && <span className="pill info">{question.topic}</span>}<span className="pill">Used {count(question.usageCount)}×</span></div></div><button className="btn small secondary" onClick={() => setEditing(editing?.questionId === question.questionId ? null : { ...question })}>Edit</button></div>{editing?.questionId === question.questionId && <form onSubmit={event => { event.preventDefault(); onSave(question, editing).then(() => setEditing(null)); }} style={{ display: 'grid', gap: 9, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}><div className="form-grid"><Field label="Topic"><Input value={editing.topic || ''} onChange={event => setEditing({ ...editing, topic: event.target.value })} /></Field><Field label="Objective code"><Input value={editing.objectiveCode || ''} onChange={event => setEditing({ ...editing, objectiveCode: event.target.value })} /></Field><Field label="Skill"><Select value={editing.skillId || ''} onChange={event => setEditing({ ...editing, skillId: event.target.value })}><option value="">No skill</option>{studio.skills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.skillName}</option>)}</Select></Field><Field label="Difficulty"><Input value={editing.difficulty || ''} onChange={event => setEditing({ ...editing, difficulty: event.target.value })} /></Field><Field label="Question type"><Select value={editing.questionType || 'SINGLE_CHOICE'} onChange={event => setEditing({ ...editing, questionType: event.target.value })}>{['SINGLE_CHOICE','MULTI_CHOICE','TRUE_FALSE','SCENARIO','CASE_STUDY','AUDIO','VIDEO'].map(value => <option key={value}>{value}</option>)}</Select></Field><Field label="Cognitive level"><Select value={editing.cognitiveLevel || 'UNDERSTAND'} onChange={event => setEditing({ ...editing, cognitiveLevel: event.target.value })}>{['REMEMBER','UNDERSTAND','APPLY','ANALYSE','EVALUATE','CREATE'].map(value => <option key={value}>{value}</option>)}</Select></Field><Field label="Review status"><Select value={editing.reviewStatus || 'DRAFT'} onChange={event => setEditing({ ...editing, reviewStatus: event.target.value })}>{['DRAFT','IN_REVIEW','APPROVED','RETIRED','REJECTED'].map(value => <option key={value}>{value}</option>)}</Select></Field><Field label="Maximum exposure"><Input type="number" min="1" value={editing.maxExposureCount || ''} onChange={event => setEditing({ ...editing, maxExposureCount: event.target.value })} placeholder="Unlimited" /></Field></div><Field label="Review notes"><Textarea rows="3" value={editing.reviewNotes || ''} onChange={event => setEditing({ ...editing, reviewNotes: event.target.value })} /></Field><button className="btn accent" disabled={saving}>Save governance metadata</button></form>}</div>)}</div><style>{`.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(max-width:620px){.form-grid{grid-template-columns:1fr}}`}</style></Card>;
}

function Analytics({ studio, onRecalculate, onUpdateAlert, saving }) {
  return <div style={{ display: 'grid', gap: 12 }}><Card><div className="row between" style={{ marginBottom: 10 }}><h3 className="section-title" style={{ margin: 0 }}>Item analytics</h3><button className="btn small accent" onClick={onRecalculate} disabled={saving}>Recalculate</button></div>{!studio.analytics.length ? <div className="empty">No finalized attempt sample yet.</div> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}><thead><tr>{['Question', 'Sample', 'Correct', 'Blank', 'Avg time', 'Discrimination', 'Quality'].map(label => <th key={label} style={th}>{label}</th>)}</tr></thead><tbody>{studio.analytics.map(item => <tr key={item.questionId}><td style={td}>{item.questionId}</td><td style={td}>{count(item.sampleSize)}</td><td style={td}>{pct(item.correctPct)}</td><td style={td}>{pct(item.blankPct)}</td><td style={td}>{Math.round(Number(item.avgResponseSeconds || 0))}s</td><td style={td}>{item.discriminationIndex === null ? '—' : `${Number(item.discriminationIndex).toFixed(1)} pts`}</td><td style={td}><span className={`pill ${statusClass(item.qualityStatus)}`}>{item.qualityStatus}</span></td></tr>)}</tbody></table></div>}</Card><Card><h3 className="section-title">Question-quality alerts</h3>{!studio.alerts.length ? <div className="empty">No alerts.</div> : <div style={{ display: 'grid', gap: 9 }}>{studio.alerts.map(alert => <div key={alert.alertId} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 13 }}><div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}><div><b>{alert.alertType}</b><div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{alert.questionId} · {formatDate(alert.openedAt)}</div></div><div className="row" style={{ gap: 6 }}><span className={`pill ${statusClass(alert.severity)}`}>{alert.severity}</span><span className={`pill ${statusClass(alert.status)}`}>{alert.status}</span></div></div>{!['RESOLVED','DISMISSED'].includes(alert.status) && <div className="row" style={{ gap: 7, marginTop: 10 }}><button className="btn small secondary" onClick={() => onUpdateAlert(alert.alertId, 'REVIEWING')}>Claim review</button><button className="btn small accent" onClick={() => onUpdateAlert(alert.alertId, 'RESOLVED')}>Resolve</button><button className="btn small secondary" onClick={() => onUpdateAlert(alert.alertId, 'DISMISSED')}>Dismiss</button></div>}</div>)}</div>}</Card></div>;
}

function Accommodations({ form, setForm, rows, query, setQuery, onSearch, onCreate, onRevoke, saving }) {
  return <div style={{ display: 'grid', gap: 12 }}><Card><h3 className="section-title">Approve learner accommodation</h3><form onSubmit={onCreate} style={{ display: 'grid', gap: 10 }}><div className="form-grid"><Field label="Employee ID"><Input value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })} required /></Field><Field label="Accommodation type"><Select value={form.accommodationType} onChange={event => setForm({ ...form, accommodationType: event.target.value })}><option>TIME_EXTENSION</option><option>BREAK_SUPPORT</option><option>DISPLAY_SUPPORT</option><option>LANGUAGE_SUPPORT</option><option>COMBINED</option></Select></Field><Field label="Time multiplier"><Input type="number" min="1" max="3" step="0.05" value={form.timeMultiplier} onChange={event => setForm({ ...form, timeMultiplier: Number(event.target.value) })} /></Field><Field label="Extra break minutes"><Input type="number" min="0" max="120" value={form.extraBreakMinutes} onChange={event => setForm({ ...form, extraBreakMinutes: Number(event.target.value) })} /></Field><Field label="Effective from"><Input type="datetime-local" value={form.effectiveFrom} onChange={event => setForm({ ...form, effectiveFrom: event.target.value })} /></Field><Field label="Effective to"><Input type="datetime-local" value={form.effectiveTo} onChange={event => setForm({ ...form, effectiveTo: event.target.value })} /></Field><Field label="Language code"><Input value={form.languageCode} onChange={event => setForm({ ...form, languageCode: event.target.value })} placeholder="en-IN" /></Field><Field label="Font scale"><Input type="number" min="0.9" max="1.5" step="0.1" value={form.displayPreferences.fontScale} onChange={event => setForm({ ...form, displayPreferences: { ...form.displayPreferences, fontScale: Number(event.target.value) } })} /></Field></div><label><input type="checkbox" checked={form.displayPreferences.highContrast} onChange={event => setForm({ ...form, displayPreferences: { ...form.displayPreferences, highContrast: event.target.checked } })} /> High-contrast assessment display</label><Field label="Detailed reason"><Textarea rows="3" minLength="20" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} required /></Field><button className="btn accent" disabled={saving}>Approve accommodation</button></form></Card><Card><div className="row between" style={{ gap: 10, marginBottom: 10, flexWrap: 'wrap' }}><h3 className="section-title" style={{ margin: 0 }}>Accommodation register</h3><div className="row" style={{ gap: 7 }}><Input placeholder="Employee or name" value={query} onChange={event => setQuery(event.target.value)} /><button className="btn small secondary" onClick={onSearch}>Search</button></div></div>{!rows.length ? <div className="empty">Search to load the accommodation register.</div> : <div style={{ display: 'grid', gap: 8 }}>{rows.map(row => <div key={row.accommodationId} style={{ border: '1.5px solid var(--line)', borderRadius: 11, padding: 12 }}><div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}><div><b>{row.traineeName || row.employeeId}</b><div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{row.employeeId} · {row.branch || '—'} · {row.process || '—'}</div></div><div className="row" style={{ gap: 6 }}><span className={`pill ${statusClass(row.status)}`}>{row.status}</span>{row.status === 'APPROVED' && <button className="btn small secondary" onClick={() => onRevoke(row.accommodationId)}>Revoke</button>}</div></div><div style={{ fontSize: 12, marginTop: 8 }}>{Number(row.timeMultiplier || 1).toFixed(2)}× time · {count(row.extraBreakMinutes)} extra break minutes · {formatDate(row.effectiveFrom)} to {formatDate(row.effectiveTo)}</div><p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>{row.reason}</p></div>)}</div>}</Card><style>{`.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(max-width:620px){.form-grid{grid-template-columns:1fr}}`}</style></div>;
}

const th = { textAlign: 'left', padding: '8px 9px', fontSize: 11, color: 'var(--muted)', borderBottom: '1.5px solid var(--line)', whiteSpace: 'nowrap' };
const td = { padding: '9px', fontSize: 12, borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
