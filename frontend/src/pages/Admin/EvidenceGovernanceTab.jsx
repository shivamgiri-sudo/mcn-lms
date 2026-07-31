import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './talentAdmin.css';
import './evidenceGovernance.css';

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function EvidenceGovernanceTab() {
  const [view, setView] = useState('mapping');
  const [catalog, setCatalog] = useState({ skills: [], contents: [], assessments: [], contentMaps: [], assessmentMaps: [] });
  const [search, setSearch] = useState('');
  const [mapForm, setMapForm] = useState({ mapType: 'content', referenceId: '', skillId: '', targetLevel: 1, weight: 1 });
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [verifyForm, setVerifyForm] = useState({ skillId: '', currentLevel: 1, targetLevel: 1, confidenceScore: 100, expiresAt: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const references = mapForm.mapType === 'content' ? catalog.contents : catalog.assessments;
  const mappings = useMemo(() => {
    const rows = mapForm.mapType === 'content' ? catalog.contentMaps : catalog.assessmentMaps;
    const referenceIndex = new Map(references.map(item => [item.referenceId, item]));
    return rows.map(row => ({ ...row, reference: referenceIndex.get(row.referenceId) })).filter(row => row.reference);
  }, [catalog, mapForm.mapType, references]);

  async function loadCatalog(query = search) {
    setLoading(true);
    setError('');
    const result = await api.get(`/talent/admin/evidence/catalog?q=${encodeURIComponent(query.trim())}`, 'admin');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load evidence catalog.');
    setCatalog(result.data || { skills: [], contents: [], assessments: [], contentMaps: [], assessmentMaps: [] });
  }

  useEffect(() => { loadCatalog(''); }, []);

  async function saveMapping(event) {
    event.preventDefault();
    setSaving('mapping');
    setError('');
    const result = await api.put(
      `/talent/admin/skills/${encodeURIComponent(mapForm.skillId)}/maps/${mapForm.mapType}`,
      { referenceId: mapForm.referenceId, targetLevel: num(mapForm.targetLevel, 1), weight: num(mapForm.weight, 1) },
      'admin',
    );
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not save evidence mapping.');
    setMessage('Evidence mapping saved. Future completions and assessment results will update the skill profile automatically.');
    await loadCatalog(search);
  }

  async function removeMapping(row) {
    setSaving(`remove:${row.id}`);
    const result = await api.delete(`/talent/admin/skills/${encodeURIComponent(row.skillId)}/maps/${mapForm.mapType}/${encodeURIComponent(row.referenceId)}`, 'admin');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not remove mapping.');
    setMessage('Evidence mapping removed. Existing evidence remains auditable but new evidence will not be generated.');
    await loadCatalog(search);
  }

  async function searchEmployees(event) {
    event.preventDefault();
    if (employeeQuery.trim().length < 2) return setError('Enter at least two characters.');
    setSaving('search');
    setError('');
    const result = await api.get(`/talent/admin/employees/search?q=${encodeURIComponent(employeeQuery.trim())}`, 'admin');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not search employees.');
    setEmployees(result.data || []);
  }

  async function openEmployee(employeeId) {
    setSelectedEmployee(employeeId);
    setSnapshot(null);
    setSaving('profile');
    setError('');
    const result = await api.get(`/talent/admin/employees/${encodeURIComponent(employeeId)}/talent`, 'admin');
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not load employee profile.');
    setSnapshot(result.data);
    const firstSkill = result.data?.profiles?.[0] || result.data?.requirements?.[0];
    setVerifyForm(form => ({
      ...form,
      skillId: firstSkill?.skillId || '',
      currentLevel: firstSkill?.currentLevel || 1,
      targetLevel: firstSkill?.targetLevel || firstSkill?.requiredLevel || 1,
    }));
  }

  async function verifySkill(event) {
    event.preventDefault();
    setSaving('verify');
    setError('');
    const result = await api.put(
      `/talent/admin/skills/profiles/${encodeURIComponent(selectedEmployee)}/${encodeURIComponent(verifyForm.skillId)}`,
      {
        currentLevel: num(verifyForm.currentLevel),
        targetLevel: num(verifyForm.targetLevel),
        confidenceScore: num(verifyForm.confidenceScore, 100),
        expiresAt: verifyForm.expiresAt || undefined,
        notes: verifyForm.notes,
      },
      'admin',
    );
    setSaving('');
    if (!result.ok) return setError(result.message || 'Could not verify skill.');
    setMessage('Skill verification saved with a permanent audit and evidence record.');
    setVerifyForm(form => ({ ...form, notes: '' }));
    await openEmployee(selectedEmployee);
  }

  return (
    <section className="evidence-shell">
      <div className="talent-admin-hero">
        <div><span>Controlled competency evidence</span><h2>Evidence Mapping & Verification</h2><p>Define which learning activity proves a skill, inspect the resulting evidence ledger, and record time-bound expert verification.</p></div>
        <button className="btn small secondary" onClick={() => loadCatalog(search)}>↻ Refresh</button>
      </div>
      {message && <div className="toast ok">{message}</div>}
      {error && <div className="toast bad">{error}</div>}
      <div className="talent-admin-tabs">
        <button className={view === 'mapping' ? 'active' : ''} onClick={() => setView('mapping')}>Evidence mapping</button>
        <button className={view === 'verification' ? 'active' : ''} onClick={() => setView('verification')}>Employee verification</button>
      </div>

      {view === 'mapping' && (
        <div className="talent-admin-layout evidence-layout">
          <div className="talent-admin-panel grow">
            <div className="talent-admin-panel-head"><div><h3>Mapped evidence</h3><p>Content completion and passed assessments generate immutable employee evidence.</p></div><span>{mappings.length} active maps</span></div>
            <form className="evidence-search" onSubmit={event => { event.preventDefault(); loadCatalog(search); }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search skill, content, assessment or classroom" /><button className="btn small secondary">Search</button></form>
            <div className="talent-admin-table-wrap"><table className="talent-admin-table evidence-table"><thead><tr><th>Evidence source</th><th>Skill</th><th>Target</th><th>Weight</th><th>Mapped</th><th /></tr></thead><tbody>{mappings.map(row => <tr key={row.id}><td><b>{row.reference?.referenceTitle}</b><small>{row.referenceId} · {row.reference?.classroomName}</small></td><td>{row.skillName}</td><td>Level {row.targetLevel}</td><td>{row.weight}</td><td>{date(row.updatedAt)}</td><td><button className="btn small secondary" onClick={() => removeMapping(row)} disabled={saving === `remove:${row.id}`}>{saving === `remove:${row.id}` ? 'Removing…' : 'Remove'}</button></td></tr>)}</tbody></table>{!mappings.length && <div className="talent-admin-empty compact"><b>No active mappings in this view</b><p>Use the form to connect learning evidence to a skill.</p></div>}</div>
          </div>
          <form className="talent-admin-panel side" onSubmit={saveMapping}>
            <div className="talent-admin-panel-head"><div><h3>Map evidence</h3><p>A learner earns the target level after satisfying this source.</p></div></div>
            <label className="talent-admin-field"><span>Evidence type</span><select value={mapForm.mapType} onChange={event => setMapForm(form => ({ ...form, mapType: event.target.value, referenceId: '' }))}><option value="content">Content completion</option><option value="assessment">Assessment result</option></select></label>
            <label className="talent-admin-field"><span>Learning source</span><select required value={mapForm.referenceId} onChange={event => setMapForm(form => ({ ...form, referenceId: event.target.value }))}><option value="">Select source</option>{references.map(item => <option key={item.referenceId} value={item.referenceId}>{item.referenceTitle} · {item.classroomName}</option>)}</select></label>
            <label className="talent-admin-field"><span>Skill</span><select required value={mapForm.skillId} onChange={event => setMapForm(form => ({ ...form, skillId: event.target.value }))}><option value="">Select skill</option>{catalog.skills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.skillName} · {skill.category}</option>)}</select></label>
            <div className="talent-admin-form-grid"><label className="talent-admin-field"><span>Target level</span><input type="number" min="1" max="10" value={mapForm.targetLevel} onChange={event => setMapForm(form => ({ ...form, targetLevel: event.target.value }))} /></label><label className="talent-admin-field"><span>Evidence weight</span><input type="number" min="0.1" step="0.1" value={mapForm.weight} onChange={event => setMapForm(form => ({ ...form, weight: event.target.value }))} /></label></div>
            <button className="btn" disabled={saving === 'mapping'}>{saving === 'mapping' ? 'Saving…' : 'Save evidence map'}</button>
          </form>
        </div>
      )}

      {view === 'verification' && (
        <div className="evidence-verify-layout">
          <div className="talent-admin-panel evidence-employee-search">
            <div className="talent-admin-panel-head"><div><h3>Find employee</h3><p>Results are restricted to the administrator’s data scope.</p></div></div>
            <form className="evidence-search" onSubmit={searchEmployees}><input value={employeeQuery} onChange={event => setEmployeeQuery(event.target.value)} placeholder="Name, employee ID, email or mobile" /><button className="btn small">{saving === 'search' ? 'Searching…' : 'Search'}</button></form>
            <div className="evidence-employee-results">{employees.map(employee => <button key={employee.employeeId} className={selectedEmployee === employee.employeeId ? 'active' : ''} onClick={() => openEmployee(employee.employeeId)}><div><b>{employee.traineeName || employee.employeeId}</b><span>{employee.employeeId} · {employee.branch || '—'}</span></div><div><b>{num(employee.gapCount)}</b><span>gaps</span></div></button>)}</div>
          </div>

          <div className="talent-admin-panel grow">
            {saving === 'profile' ? <div className="talent-admin-loading"><div className="spinner" /><p>Recalculating evidence…</p></div> : !snapshot ? <div className="talent-admin-empty"><b>Select an employee</b><p>The full competency profile, requirements, evidence, and learning paths will appear here.</p></div> : (
              <div className="evidence-profile">
                <div className="talent-admin-panel-head"><div><span>{snapshot.trainee?.employeeId} · {snapshot.trainee?.branch}</span><h3>{snapshot.trainee?.traineeName || snapshot.trainee?.employeeId}</h3><p>{snapshot.trainee?.process || '—'} / {snapshot.trainee?.lob || '—'} · {snapshot.trainee?.batchNo || 'No batch'}</p></div><span>{snapshot.summary?.gapCount || 0} gaps</span></div>
                <div className="evidence-profile-kpis"><div><span>Skills</span><b>{snapshot.summary?.totalSkills || 0}</b></div><div><span>Ready</span><b>{snapshot.summary?.readyCount || 0}</b></div><div><span>Critical gaps</span><b>{snapshot.summary?.criticalGaps || 0}</b></div><div><span>Assigned paths</span><b>{snapshot.summary?.assignedPaths || 0}</b></div></div>
                <div className="evidence-profile-grid">{(snapshot.profiles || []).map(profile => <div key={profile.skillId} className={profile.status === 'GAP' ? 'gap' : 'ready'}><div><b>{profile.skillName}</b><span>{profile.category} · {profile.source}</span></div><div><b>{num(profile.currentLevel)} / {num(profile.targetLevel)}</b><span>{profile.status}</span></div></div>)}</div>
                <div className="evidence-ledger"><h4>Recent evidence</h4>{(snapshot.evidence || []).slice(0, 12).map(item => <div key={item.id}><span>{item.evidenceType}</span><div><b>{item.skillName}</b><small>{item.referenceId} · {date(item.evidenceAt)}</small></div><b>Level {num(item.levelAwarded)}</b></div>)}</div>
              </div>
            )}
          </div>

          {snapshot && (
            <form className="talent-admin-panel side evidence-verification-form" onSubmit={verifySkill}>
              <div className="talent-admin-panel-head"><div><h3>Expert verification</h3><p>Manual verification overrides derived evidence until it expires.</p></div></div>
              <label className="talent-admin-field"><span>Skill</span><select required value={verifyForm.skillId} onChange={event => { const profile = snapshot.profiles?.find(item => item.skillId === event.target.value); setVerifyForm(form => ({ ...form, skillId: event.target.value, currentLevel: profile?.currentLevel || 1, targetLevel: profile?.targetLevel || 1 })); }}><option value="">Select skill</option>{catalog.skills.map(skill => <option key={skill.skillId} value={skill.skillId}>{skill.skillName}</option>)}</select></label>
              <div className="talent-admin-form-grid"><label className="talent-admin-field"><span>Verified level</span><input type="number" min="0" max="10" value={verifyForm.currentLevel} onChange={event => setVerifyForm(form => ({ ...form, currentLevel: event.target.value }))} /></label><label className="talent-admin-field"><span>Target level</span><input type="number" min="0" max="10" value={verifyForm.targetLevel} onChange={event => setVerifyForm(form => ({ ...form, targetLevel: event.target.value }))} /></label></div>
              <label className="talent-admin-field"><span>Confidence score</span><input type="number" min="0" max="100" value={verifyForm.confidenceScore} onChange={event => setVerifyForm(form => ({ ...form, confidenceScore: event.target.value }))} /></label>
              <label className="talent-admin-field"><span>Verification expiry</span><input type="date" value={verifyForm.expiresAt} onChange={event => setVerifyForm(form => ({ ...form, expiresAt: event.target.value }))} /></label>
              <label className="talent-admin-field"><span>Evidence notes</span><textarea required rows="4" value={verifyForm.notes} onChange={event => setVerifyForm(form => ({ ...form, notes: event.target.value }))} placeholder="Observed task, calibration, practical demonstration, reviewer context…" /></label>
              <button className="btn" disabled={saving === 'verify'}>{saving === 'verify' ? 'Saving…' : 'Record verification'}</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
