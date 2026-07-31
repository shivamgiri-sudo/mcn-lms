import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './talentAdmin.css';

const EMPTY_SKILL = { skillCode: '', skillName: '', category: '', levelScale: 5, description: '' };
const EMPTY_REQUIREMENT = { skillId: '', processName: '', lobName: '', department: '', designation: '', requiredLevel: 1, weight: 1, critical: false };
const EMPTY_PATH = { pathCode: '', pathName: '', description: '', audienceProcess: '', audienceLob: '', audienceBranch: '', mandatory: false, versionNo: 1 };
const EMPTY_STEP = { stepOrder: 1, stepType: 'CONTENT', referenceId: '', stepTitle: '', required: true, minScore: '', minLevel: '', prerequisiteStepId: '', dueDays: '' };

function value(event) {
  const { name, type, checked, value: fieldValue } = event.target;
  return [name, type === 'checkbox' ? checked : fieldValue];
}

function number(input, fallback = 0) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(input) {
  if (!input) return '—';
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Stat({ label, value: statValue, note }) {
  return <div className="talent-admin-stat"><span>{label}</span><b>{statValue}</b>{note ? <small>{note}</small> : null}</div>;
}

function FormField({ label, children, hint }) {
  return <label className="talent-admin-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

export default function TalentArchitectureTab() {
  const [view, setView] = useState('skills');
  const [permissions, setPermissions] = useState([]);
  const [skills, setSkills] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [paths, setPaths] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [steps, setSteps] = useState([]);
  const [skillForm, setSkillForm] = useState(EMPTY_SKILL);
  const [requirementForm, setRequirementForm] = useState(EMPTY_REQUIREMENT);
  const [pathForm, setPathForm] = useState(EMPTY_PATH);
  const [stepForm, setStepForm] = useState(EMPTY_STEP);
  const [enrolmentText, setEnrolmentText] = useState('');
  const [enrolmentDue, setEnrolmentDue] = useState('');
  const [roleGrant, setRoleGrant] = useState({ userType: 'admin', roleKey: '*', permissionKey: '', allowed: true, dataScope: 'branch' });
  const [userGrant, setUserGrant] = useState({ userId: '', userType: 'coordinator', permissionKey: '', allowed: true, dataScope: 'own_batch', expiresAt: '', reason: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const permissionSet = useMemo(() => new Set(permissions.map(item => item.permissionKey)), [permissions]);
  const can = key => permissionSet.has(key);
  const activeSkills = useMemo(() => skills.filter(item => item.active), [skills]);
  const publishedPaths = useMemo(() => paths.filter(item => item.status === 'PUBLISHED' && item.active), [paths]);

  async function loadAll() {
    setLoading(true);
    setError('');
    const effective = await api.get('/talent/permissions/effective', 'admin');
    if (!effective.ok) {
      setLoading(false);
      return setError(effective.message || 'The permission migration has not been applied.');
    }
    setPermissions(effective.data || []);

    const [skillResult, requirementResult, pathResult] = await Promise.all([
      api.get('/talent/admin/skills', 'admin'),
      api.get('/talent/admin/requirements', 'admin'),
      api.get('/talent/admin/paths', 'admin'),
    ]);
    if (skillResult.ok) setSkills(skillResult.data || []);
    if (requirementResult.ok) setRequirements(requirementResult.data || []);
    if (pathResult.ok) setPaths(pathResult.data || []);
    const missing = [skillResult, requirementResult, pathResult].find(result => !result.ok);
    if (missing) setError(missing.message || 'Some talent data could not be loaded.');

    if ((effective.data || []).some(item => item.permissionKey === 'access.permissions.manage')) {
      const matrixResult = await api.get('/talent/admin/permissions', 'admin');
      if (matrixResult.ok) setMatrix(matrixResult.data);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  function notify(textValue, bad = false) {
    bad ? setError(textValue) : setMessage(textValue);
    if (bad) setMessage(''); else setError('');
  }

  async function saveSkill(event) {
    event.preventDefault();
    setSaving('skill');
    const result = await api.post('/talent/admin/skills', { ...skillForm, levelScale: number(skillForm.levelScale, 5) }, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not create skill.', true);
    setSkillForm(EMPTY_SKILL);
    notify('Skill created and ready for requirements or evidence mapping.');
    loadAll();
  }

  async function saveRequirement(event) {
    event.preventDefault();
    setSaving('requirement');
    const result = await api.put('/talent/admin/requirements', {
      ...requirementForm,
      requiredLevel: number(requirementForm.requiredLevel, 1),
      weight: number(requirementForm.weight, 1),
    }, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not save requirement.', true);
    setRequirementForm(EMPTY_REQUIREMENT);
    notify('Competency requirement saved.');
    loadAll();
  }

  async function savePath(event) {
    event.preventDefault();
    setSaving('path');
    const result = await api.post('/talent/admin/paths', { ...pathForm, versionNo: number(pathForm.versionNo, 1) }, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not create path.', true);
    setPathForm(EMPTY_PATH);
    notify('Draft learning path created. Add its ordered steps next.');
    await loadAll();
    if (result.data?.pathId) await openPath(result.data.pathId);
  }

  async function openPath(pathId) {
    const result = await api.get(`/talent/admin/paths/${encodeURIComponent(pathId)}/steps`, 'admin');
    if (!result.ok) return notify(result.message || 'Could not open path.', true);
    setSelectedPath(result.data.path);
    setSteps(result.data.steps || []);
    const nextOrder = (result.data.steps || []).reduce((max, step) => Math.max(max, number(step.stepOrder)), 0) + 1;
    setStepForm({ ...EMPTY_STEP, stepOrder: nextOrder });
    setView('paths');
  }

  async function addStep(event) {
    event.preventDefault();
    if (!selectedPath) return;
    setSaving('step');
    const payload = {
      ...stepForm,
      stepOrder: number(stepForm.stepOrder, 1),
      minScore: stepForm.minScore === '' ? undefined : number(stepForm.minScore),
      minLevel: stepForm.minLevel === '' ? undefined : number(stepForm.minLevel),
      dueDays: stepForm.dueDays === '' ? undefined : number(stepForm.dueDays),
      prerequisiteStepId: stepForm.prerequisiteStepId || undefined,
    };
    const result = await api.post(`/talent/admin/paths/${selectedPath.path_id}/steps`, payload, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not add step.', true);
    notify('Learning path step added.');
    await openPath(selectedPath.path_id);
    loadAll();
  }

  async function publishPath() {
    if (!selectedPath) return;
    setSaving('publish');
    const result = await api.post(`/talent/admin/paths/${selectedPath.path_id}/publish`, {}, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not publish path.', true);
    notify('Learning path published and available for assignment.');
    setSelectedPath(null);
    setSteps([]);
    loadAll();
  }

  async function assignPath(event) {
    event.preventDefault();
    if (!selectedPath) return;
    const employeeIds = [...new Set(enrolmentText.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))];
    setSaving('enrol');
    const result = await api.post(`/talent/admin/paths/${selectedPath.path_id}/enrollments`, { employeeIds, dueAt: enrolmentDue || undefined }, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not assign path.', true);
    setEnrolmentText('');
    setEnrolmentDue('');
    notify(`Assigned to ${result.data.created} learner(s); ${result.data.alreadyEnrolled} already enrolled.`);
    loadAll();
  }

  async function saveRoleGrant(event) {
    event.preventDefault();
    setSaving('role-grant');
    const result = await api.put('/talent/admin/permissions/role', roleGrant, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not update role grant.', true);
    notify('Role permission updated. Changes become effective within one minute.');
    loadAll();
  }

  async function saveUserGrant(event) {
    event.preventDefault();
    setSaving('user-grant');
    const result = await api.put('/talent/admin/permissions/user', { ...userGrant, expiresAt: userGrant.expiresAt || undefined }, 'admin');
    setSaving('');
    if (!result.ok) return notify(result.message || 'Could not update user override.', true);
    notify('User permission override updated.');
    setUserGrant(current => ({ ...current, userId: '', reason: '' }));
    loadAll();
  }

  if (loading) return <div className="talent-admin-loading"><div className="spinner" /><p>Loading talent architecture…</p></div>;

  const summary = {
    skills: skills.filter(item => item.active).length,
    requirements: requirements.filter(item => item.active).length,
    paths: paths.filter(item => item.active).length,
    published: publishedPaths.length,
    enrolments: paths.reduce((sum, item) => sum + number(item.enrollmentCount), 0),
    profiled: skills.reduce((sum, item) => sum + number(item.profiledEmployees), 0),
  };

  return (
    <div className="talent-admin-shell">
      <div className="talent-admin-hero">
        <div>
          <span>Enterprise talent architecture</span>
          <h2>Skills, Competencies & Learning Paths</h2>
          <p>Connect role expectations to LMS evidence and convert gaps into governed, prerequisite-aware development paths.</p>
        </div>
        <button className="btn small secondary" onClick={loadAll}>↻ Refresh</button>
      </div>

      {message && <div className="toast ok talent-admin-toast">{message}</div>}
      {error && <div className="toast bad talent-admin-toast">{error}</div>}

      <div className="talent-admin-stats">
        <Stat label="Active skills" value={summary.skills} />
        <Stat label="Role requirements" value={summary.requirements} />
        <Stat label="Learning paths" value={summary.paths} note={`${summary.published} published`} />
        <Stat label="Enrolments" value={summary.enrolments} />
        <Stat label="Profiled records" value={summary.profiled} />
      </div>

      <div className="talent-admin-tabs">
        {[
          ['skills', 'Skill catalog'],
          ['requirements', 'Role requirements'],
          ['paths', 'Learning paths'],
          ...(can('access.permissions.manage') ? [['access', 'Access control']] : []),
        ].map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}
      </div>

      {view === 'skills' && (
        <div className="talent-admin-layout">
          <div className="talent-admin-panel grow">
            <div className="talent-admin-panel-head"><div><h3>Skill catalog</h3><p>Reusable capabilities shared by roles, content, assessments and learning paths.</p></div><span>{skills.length} skills</span></div>
            <div className="talent-admin-table-wrap">
              <table className="talent-admin-table">
                <thead><tr><th>Skill</th><th>Category</th><th>Scale</th><th>Requirements</th><th>Evidence maps</th><th>Profiles</th></tr></thead>
                <tbody>{skills.map(skill => (
                  <tr key={skill.skillId} className={!skill.active ? 'disabled' : ''}>
                    <td><b>{skill.skillName}</b><small>{skill.skillCode}</small></td>
                    <td>{skill.category}</td><td>1–{skill.levelScale}</td>
                    <td>{number(skill.requirementCount)}</td>
                    <td>{number(skill.contentMapCount) + number(skill.assessmentMapCount)}</td>
                    <td>{number(skill.profiledEmployees)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          {can('talent.skills.manage') && (
            <form className="talent-admin-panel side" onSubmit={saveSkill}>
              <div className="talent-admin-panel-head"><div><h3>Create skill</h3><p>Use a durable, business-readable skill code.</p></div></div>
              <FormField label="Skill name"><input required name="skillName" value={skillForm.skillName} onChange={event => { const [key, next] = value(event); setSkillForm(form => ({ ...form, [key]: next })); }} /></FormField>
              <FormField label="Skill code" hint="Generated from the name when blank."><input name="skillCode" value={skillForm.skillCode} onChange={event => { const [key, next] = value(event); setSkillForm(form => ({ ...form, [key]: next })); }} placeholder="KYC_DOCUMENT_REVIEW" /></FormField>
              <FormField label="Category"><input required name="category" value={skillForm.category} onChange={event => { const [key, next] = value(event); setSkillForm(form => ({ ...form, [key]: next })); }} placeholder="Process, Quality, Behavioural…" /></FormField>
              <FormField label="Level scale"><input type="number" min="1" max="10" name="levelScale" value={skillForm.levelScale} onChange={event => { const [key, next] = value(event); setSkillForm(form => ({ ...form, [key]: next })); }} /></FormField>
              <FormField label="Description"><textarea name="description" rows="4" value={skillForm.description} onChange={event => { const [key, next] = value(event); setSkillForm(form => ({ ...form, [key]: next })); }} /></FormField>
              <button className="btn" disabled={saving === 'skill'}>{saving === 'skill' ? 'Creating…' : 'Create skill'}</button>
            </form>
          )}
        </div>
      )}

      {view === 'requirements' && (
        <div className="talent-admin-layout">
          <div className="talent-admin-panel grow">
            <div className="talent-admin-panel-head"><div><h3>Role competency matrix</h3><p>Blank dimensions act as company-wide defaults; specific process/LOB rules override through the highest target.</p></div></div>
            <div className="talent-admin-table-wrap">
              <table className="talent-admin-table">
                <thead><tr><th>Skill</th><th>Scope</th><th>Required</th><th>Critical</th><th>Weight</th></tr></thead>
                <tbody>{requirements.map(row => (
                  <tr key={row.id} className={!row.active ? 'disabled' : ''}>
                    <td><b>{row.skillName}</b><small>{row.category}</small></td>
                    <td>{[row.department, row.designation, row.processName, row.lobName].filter(Boolean).join(' · ') || 'Company default'}</td>
                    <td>Level {row.requiredLevel}</td><td>{row.critical ? 'Yes' : 'No'}</td><td>{row.weight}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          {can('talent.skills.manage') && (
            <form className="talent-admin-panel side" onSubmit={saveRequirement}>
              <div className="talent-admin-panel-head"><div><h3>Set requirement</h3><p>Saving the same skill and scope updates the existing requirement.</p></div></div>
              <FormField label="Skill"><select required name="skillId" value={requirementForm.skillId} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }}><option value="">Select skill</option>{activeSkills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.skillName}</option>)}</select></FormField>
              <div className="talent-admin-form-grid">
                <FormField label="Process"><input name="processName" value={requirementForm.processName} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /></FormField>
                <FormField label="LOB"><input name="lobName" value={requirementForm.lobName} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /></FormField>
                <FormField label="Department"><input name="department" value={requirementForm.department} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /></FormField>
                <FormField label="Designation"><input name="designation" value={requirementForm.designation} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /></FormField>
              </div>
              <div className="talent-admin-form-grid">
                <FormField label="Required level"><input type="number" min="1" max="10" name="requiredLevel" value={requirementForm.requiredLevel} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /></FormField>
                <FormField label="Weight"><input type="number" min="0.1" step="0.1" name="weight" value={requirementForm.weight} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /></FormField>
              </div>
              <label className="talent-admin-check"><input type="checkbox" name="critical" checked={requirementForm.critical} onChange={event => { const [key, next] = value(event); setRequirementForm(form => ({ ...form, [key]: next })); }} /><span>Critical skill for readiness</span></label>
              <button className="btn" disabled={saving === 'requirement'}>{saving === 'requirement' ? 'Saving…' : 'Save requirement'}</button>
            </form>
          )}
        </div>
      )}

      {view === 'paths' && (
        <div className="talent-admin-layout path-layout">
          <div className="talent-admin-panel path-list-panel">
            <div className="talent-admin-panel-head"><div><h3>Learning paths</h3><p>Versioned, published journeys with measurable completion gates.</p></div></div>
            <div className="talent-admin-paths">{paths.map(path => (
              <button key={path.pathId} className={selectedPath?.path_id === path.pathId ? 'active' : ''} onClick={() => openPath(path.pathId)}>
                <div><b>{path.pathName}</b><small>{path.pathCode} · v{path.versionNo}</small></div>
                <div><span className={`talent-admin-badge ${path.status.toLowerCase()}`}>{path.status}</span><small>{number(path.stepCount)} steps · {number(path.enrollmentCount)} enrolled</small></div>
              </button>
            ))}</div>
            {can('talent.paths.manage') && (
              <form className="talent-admin-create-path" onSubmit={savePath}>
                <h4>Create draft</h4>
                <FormField label="Path name"><input required name="pathName" value={pathForm.pathName} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /></FormField>
                <div className="talent-admin-form-grid"><FormField label="Path code"><input name="pathCode" value={pathForm.pathCode} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /></FormField><FormField label="Version"><input type="number" min="1" name="versionNo" value={pathForm.versionNo} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /></FormField></div>
                <div className="talent-admin-form-grid"><FormField label="Process"><input name="audienceProcess" value={pathForm.audienceProcess} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /></FormField><FormField label="LOB"><input name="audienceLob" value={pathForm.audienceLob} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /></FormField></div>
                <FormField label="Description"><textarea name="description" rows="3" value={pathForm.description} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /></FormField>
                <label className="talent-admin-check"><input type="checkbox" name="mandatory" checked={pathForm.mandatory} onChange={event => { const [key, next] = value(event); setPathForm(form => ({ ...form, [key]: next })); }} /><span>Mandatory development path</span></label>
                <button className="btn" disabled={saving === 'path'}>{saving === 'path' ? 'Creating…' : 'Create draft path'}</button>
              </form>
            )}
          </div>

          <div className="talent-admin-panel grow">
            {!selectedPath ? <div className="talent-admin-empty"><b>Select a learning path</b><p>Open a path to inspect steps, add prerequisites, publish, or enrol learners.</p></div> : (
              <>
                <div className="talent-admin-panel-head path-detail-head"><div><span>{selectedPath.path_code} · v{selectedPath.version_no}</span><h3>{selectedPath.path_name}</h3><p>{selectedPath.description || 'No description'}</p></div><span className={`talent-admin-badge ${String(selectedPath.status).toLowerCase()}`}>{selectedPath.status}</span></div>
                <div className="talent-admin-step-list">{steps.length ? steps.map(step => (
                  <div className="talent-admin-step" key={step.stepId}>
                    <span>{step.stepOrder}</span><div><b>{step.stepTitle}</b><small>{step.stepType} · {step.referenceId}</small>{step.prerequisiteStepId ? <small>Requires step {steps.find(item => item.stepId === step.prerequisiteStepId)?.stepOrder || 'earlier'}</small> : null}</div><div>{step.required ? 'Required' : 'Optional'}{step.minScore != null ? <small>Score ≥ {step.minScore}%</small> : null}{step.minLevel != null ? <small>Level ≥ {step.minLevel}</small> : null}</div>
                  </div>
                )) : <div className="talent-admin-empty compact"><b>No steps yet</b><p>Add content, assessments, skill gates, classroom membership or manual sign-off.</p></div>}</div>

                {selectedPath.status === 'DRAFT' && can('talent.paths.manage') && (
                  <form className="talent-admin-step-form" onSubmit={addStep}>
                    <h4>Add ordered step</h4>
                    <div className="talent-admin-form-grid three"><FormField label="Order"><input type="number" min="1" name="stepOrder" value={stepForm.stepOrder} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /></FormField><FormField label="Type"><select name="stepType" value={stepForm.stepType} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }}>{['CONTENT', 'ASSESSMENT', 'SKILL', 'CLASSROOM', 'MANUAL'].map(item => <option key={item}>{item}</option>)}</select></FormField><FormField label="Reference ID"><input required name="referenceId" value={stepForm.referenceId} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /></FormField></div>
                    <FormField label="Step title"><input required name="stepTitle" value={stepForm.stepTitle} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /></FormField>
                    <div className="talent-admin-form-grid three"><FormField label="Minimum score"><input type="number" min="0" max="100" name="minScore" value={stepForm.minScore} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /></FormField><FormField label="Minimum level"><input type="number" min="0" max="10" name="minLevel" value={stepForm.minLevel} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /></FormField><FormField label="Due after days"><input type="number" min="0" name="dueDays" value={stepForm.dueDays} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /></FormField></div>
                    <FormField label="Prerequisite"><select name="prerequisiteStepId" value={stepForm.prerequisiteStepId} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }}><option value="">No prerequisite</option>{steps.filter(step => number(step.stepOrder) < number(stepForm.stepOrder)).map(step => <option key={step.stepId} value={step.stepId}>Step {step.stepOrder}: {step.stepTitle}</option>)}</select></FormField>
                    <label className="talent-admin-check"><input type="checkbox" name="required" checked={stepForm.required} onChange={event => { const [key, next] = value(event); setStepForm(form => ({ ...form, [key]: next })); }} /><span>Required for path completion</span></label>
                    <div className="talent-admin-actions"><button className="btn" disabled={saving === 'step'}>{saving === 'step' ? 'Adding…' : 'Add step'}</button><button type="button" className="btn secondary" onClick={publishPath} disabled={!steps.length || saving === 'publish'}>{saving === 'publish' ? 'Publishing…' : 'Publish path'}</button></div>
                  </form>
                )}

                {selectedPath.status === 'PUBLISHED' && can('talent.paths.assign') && (
                  <form className="talent-admin-enrol" onSubmit={assignPath}>
                    <h4>Assign to employees</h4>
                    <FormField label="Employee IDs" hint="Separate multiple IDs with commas, spaces or new lines."><textarea required rows="4" value={enrolmentText} onChange={event => setEnrolmentText(event.target.value)} placeholder="EMP001, EMP002" /></FormField>
                    <FormField label="Completion deadline"><input type="date" value={enrolmentDue} onChange={event => setEnrolmentDue(event.target.value)} /></FormField>
                    <button className="btn" disabled={saving === 'enrol'}>{saving === 'enrol' ? 'Assigning…' : 'Assign learning path'}</button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {view === 'access' && can('access.permissions.manage') && matrix && (
        <div className="talent-admin-layout">
          <div className="talent-admin-panel grow">
            <div className="talent-admin-panel-head"><div><h3>Permission matrix</h3><p>Role grants establish defaults. User overrides take priority and may expire automatically.</p></div><span>{matrix.roleGrants?.length || 0} role grants</span></div>
            <div className="talent-admin-table-wrap"><table className="talent-admin-table"><thead><tr><th>Role</th><th>Permission</th><th>Scope</th><th>Allowed</th><th>Updated</th></tr></thead><tbody>{(matrix.roleGrants || []).map(row => <tr key={row.id}><td><b>{row.userType}</b><small>{row.roleKey}</small></td><td>{row.permissionKey}</td><td>{row.dataScope}</td><td>{row.allowed ? 'Yes' : 'No'}</td><td>{formatDate(row.updatedAt)}</td></tr>)}</tbody></table></div>
            <h4 className="talent-admin-subhead">Active user overrides</h4>
            <div className="talent-admin-table-wrap"><table className="talent-admin-table"><thead><tr><th>User</th><th>Permission</th><th>Scope</th><th>Allowed</th><th>Expires</th></tr></thead><tbody>{(matrix.overrides || []).map(row => <tr key={row.id}><td><b>{row.userId}</b><small>{row.userType}</small></td><td>{row.permissionKey}</td><td>{row.dataScope}</td><td>{row.allowed ? 'Yes' : 'No'}</td><td>{formatDate(row.expiresAt)}</td></tr>)}</tbody></table></div>
          </div>
          <div className="talent-admin-stack">
            <form className="talent-admin-panel side" onSubmit={saveRoleGrant}>
              <div className="talent-admin-panel-head"><div><h3>Role grant</h3><p>Exact role grants override the wildcard role.</p></div></div>
              <div className="talent-admin-form-grid"><FormField label="User type"><select value={roleGrant.userType} onChange={event => setRoleGrant(form => ({ ...form, userType: event.target.value }))}>{['admin', 'coordinator', 'trainee', 'management'].map(item => <option key={item}>{item}</option>)}</select></FormField><FormField label="Role key"><input value={roleGrant.roleKey} onChange={event => setRoleGrant(form => ({ ...form, roleKey: event.target.value }))} /></FormField></div>
              <FormField label="Permission"><select required value={roleGrant.permissionKey} onChange={event => setRoleGrant(form => ({ ...form, permissionKey: event.target.value }))}><option value="">Select permission</option>{(matrix.permissions || []).map(item => <option key={item.permissionKey} value={item.permissionKey}>{item.permissionKey}</option>)}</select></FormField>
              <FormField label="Data scope"><select value={roleGrant.dataScope} onChange={event => setRoleGrant(form => ({ ...form, dataScope: event.target.value }))}>{['self', 'own_batch', 'branch', 'company'].map(item => <option key={item}>{item}</option>)}</select></FormField>
              <label className="talent-admin-check"><input type="checkbox" checked={roleGrant.allowed} onChange={event => setRoleGrant(form => ({ ...form, allowed: event.target.checked }))} /><span>Allow this permission</span></label>
              <button className="btn" disabled={saving === 'role-grant'}>{saving === 'role-grant' ? 'Saving…' : 'Save role grant'}</button>
            </form>
            <form className="talent-admin-panel side" onSubmit={saveUserGrant}>
              <div className="talent-admin-panel-head"><div><h3>User override</h3><p>Use temporary overrides for delegation or exception handling.</p></div></div>
              <div className="talent-admin-form-grid"><FormField label="User ID"><input required value={userGrant.userId} onChange={event => setUserGrant(form => ({ ...form, userId: event.target.value }))} /></FormField><FormField label="User type"><select value={userGrant.userType} onChange={event => setUserGrant(form => ({ ...form, userType: event.target.value }))}>{['admin', 'coordinator', 'trainee', 'management'].map(item => <option key={item}>{item}</option>)}</select></FormField></div>
              <FormField label="Permission"><select required value={userGrant.permissionKey} onChange={event => setUserGrant(form => ({ ...form, permissionKey: event.target.value }))}><option value="">Select permission</option>{(matrix.permissions || []).map(item => <option key={item.permissionKey} value={item.permissionKey}>{item.permissionKey}</option>)}</select></FormField>
              <div className="talent-admin-form-grid"><FormField label="Data scope"><select value={userGrant.dataScope} onChange={event => setUserGrant(form => ({ ...form, dataScope: event.target.value }))}>{['self', 'own_batch', 'branch', 'company'].map(item => <option key={item}>{item}</option>)}</select></FormField><FormField label="Expires"><input type="datetime-local" value={userGrant.expiresAt} onChange={event => setUserGrant(form => ({ ...form, expiresAt: event.target.value }))} /></FormField></div>
              <FormField label="Reason"><textarea required rows="3" value={userGrant.reason} onChange={event => setUserGrant(form => ({ ...form, reason: event.target.value }))} /></FormField>
              <label className="talent-admin-check"><input type="checkbox" checked={userGrant.allowed} onChange={event => setUserGrant(form => ({ ...form, allowed: event.target.checked }))} /><span>Allow this permission</span></label>
              <button className="btn" disabled={saving === 'user-grant'}>{saving === 'user-grant' ? 'Saving…' : 'Save user override'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
