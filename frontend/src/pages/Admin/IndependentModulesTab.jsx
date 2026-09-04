import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { BranchSelect, ProcessSelect, LobSelect } from '../../components/OrgSelect.jsx';

const emptyModule = { moduleName: '', category: '', process: '', lob: '', branch: '', description: '', estimatedMins: 0 };
const emptyRule = { moduleId: '', ruleName: '', scopeType: 'All', scopeValue: '', assignmentType: 'Mandatory', message: '', dueDays: 0 };

export default function IndependentModulesTab() {
  const [modules, setModules] = useState([]);
  const [rules, setRules] = useState([]);
  const [repoItems, setRepoItems] = useState([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moduleForm, setModuleForm] = useState(emptyModule);
  const [editModule, setEditModule] = useState(null);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [expanded, setExpanded] = useState({});
  const [assignContent, setAssignContent] = useState({ moduleId: '', show: false, query: '', results: [] });

  const [report, setReport] = useState(null);

  // Answers "did they actually read it". Time is recorded by the same heartbeat
  // pipeline classroom content uses, now that broadcast content has a progress row.
  async function openReport(m) {
    setReport({ moduleId: m.module_id, moduleName: m.module_name, loading: true });
    const res = await api.get(`/admin/independent-modules/${encodeURIComponent(m.module_id)}/reading-report`, 'admin');
    if (!res.ok) { setMsg(res.message || 'Unable to load the reading report.'); return setReport(null); }
    setReport({ moduleId: m.module_id, moduleName: m.module_name, loading: false, rows: res.data || [], summary: res.summary || {} });
  }

  async function load() {
    setLoading(true);
    const [moduleRes, ruleRes, repoRes] = await Promise.all([
      api.get('/admin/independent-modules', 'admin'),
      api.get('/admin/independent-modules/auto-assign-rules', 'admin'),
      api.get('/admin/content-repository', 'admin'),
    ]);
    setLoading(false);
    if (moduleRes.ok) setModules(moduleRes.data || []);
    if (ruleRes.ok) setRules(ruleRes.data || []);
    if (repoRes.ok) setRepoItems(repoRes.data || []);
    if (!moduleRes.ok || !ruleRes.ok) setMsg('Unable to load independent module data.');
  }

  useEffect(() => { load(); }, []);

  async function createModule(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.post('/admin/independent-modules', moduleForm, 'admin');
    setSaving(false);
    if (!res.ok) return setMsg(res.message || 'Unable to create module.');
    setMsg('\u2713 Independent module created.'); setModuleForm(emptyModule); load();
  }

  async function saveModuleEdit(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.put(`/admin/independent-modules/${editModule.moduleId}`, editModule, 'admin');
    setSaving(false);
    if (!res.ok) return setMsg(res.message || 'Unable to update module.');
    setMsg('\u2713 Module updated.'); setEditModule(null); load();
  }

  async function archiveModule(moduleId) {
    if (!window.confirm('Archive this independent module? This cannot be undone.')) return;
    const res = await api.delete(`/admin/independent-modules/${moduleId}`, 'admin');
    setMsg(res.ok ? '\u2713 Module archived.' : (res.message || 'Unable to archive.')); load();
  }

  async function removeContent(moduleId, repoContentId) {
    if (!window.confirm('Remove this content from the module?')) return;
    const res = await api.delete(`/admin/independent-modules/${moduleId}/contents/${repoContentId}`, 'admin');
    setMsg(res.ok ? '\u2713 Content removed.' : (res.message || 'Unable to remove.')); load();
  }

  async function createRule(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.post(`/admin/independent-modules/${ruleForm.moduleId}/auto-assign-rule`, ruleForm, 'admin');
    setSaving(false);
    if (!res.ok) return setMsg(res.message || 'Unable to create rule.');
    setMsg('\u2713 Auto-assign rule created.'); setRuleForm(emptyRule); load();
  }

  async function deleteRule(ruleId) {
    if (!window.confirm('Disable this auto-assign rule?')) return;
    const res = await api.delete(`/admin/independent-modules/auto-assign-rules/${ruleId}`, 'admin');
    setMsg(res.ok ? '\u2713 Rule disabled.' : (res.message || 'Unable to disable.')); load();
  }

  function toggleExpand(mId) {
    setExpanded(prev => ({ ...prev, [mId]: !prev[mId] }));
  }

  async function searchContentForAssign() {
    const res = await api.get(`/admin/content-repository?q=${encodeURIComponent(assignContent.query)}`, 'admin');
    if (res.ok) setAssignContent(prev => ({ ...prev, results: res.data || [] }));
  }

  async function addContentToModule(repoContentId) {
    const moduleId = assignContent.moduleId;
    const module = modules.find(m => m.module_id === moduleId);
    if (!module) return;
    const contents = (module.contents || []).map(c => ({ repositoryContentId: c.repository_content_id, sortOrder: c.sortOrder, required: c.required }));
    if (contents.some(c => c.repositoryContentId === repoContentId)) {
      return setMsg('Content already in module.');
    }
    contents.push({ repositoryContentId: repoContentId, sortOrder: contents.length + 1, required: true });
    await api.put(`/admin/independent-modules/${moduleId}`, { contents }, 'admin');
    setAssignContent({ moduleId: '', show: false, query: '', results: [] });
    setMsg('\u2713 Content added to module.'); load();
  }

  function openAssignContent(mId) {
    setAssignContent({ moduleId: mId, show: true, query: '', results: [] });
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Independent Modules</h2>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Modules here are not linked with any classroom. They can be assigned directly or by auto assignment rules when new LMS IDs are created.
        </p>
      </div>
      {msg && <div className={msg.startsWith('\u2713') ? 'toast ok' : 'toast bad'}>{msg}</div>}

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Independent Module</h3>
        <form onSubmit={createModule} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <div className="field"><label>Module Name *</label><input className="input" value={moduleForm.moduleName} onChange={e => setModuleForm(p => ({ ...p, moduleName: e.target.value }))} required placeholder="e.g. Compliance Training" /></div>
            <div className="field"><label>Category</label><input className="input" value={moduleForm.category} onChange={e => setModuleForm(p => ({ ...p, category: e.target.value }))} placeholder="Category" /></div>
            <div className="field"><label>Est. Mins</label><input className="input" type="number" value={moduleForm.estimatedMins} onChange={e => setModuleForm(p => ({ ...p, estimatedMins: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ProcessSelect value={moduleForm.process} onChange={next => setModuleForm(p => ({ ...p, process: next }))} />
            <LobSelect process={moduleForm.process} value={moduleForm.lob} onChange={next => setModuleForm(p => ({ ...p, lob: next }))} />
            <BranchSelect value={moduleForm.branch} onChange={next => setModuleForm(p => ({ ...p, branch: next }))} placeholder="All branches" />
          </div>
          <textarea className="input" rows="2" placeholder="Description" value={moduleForm.description} onChange={e => setModuleForm(p => ({ ...p, description: e.target.value }))} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn accent" disabled={saving}>{saving ? 'Creating\u2026' : 'Create Module'}</button></div>
        </form>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Independent Module Library</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 30 }} /> <th>Module</th><th>Process / LOB</th><th>Contents</th><th>Action</th></tr></thead>
            <tbody>
              {modules.map(m => (
                <>
                  <tr key={m.module_id}>
                    <td><span className="clickable" onClick={() => toggleExpand(m.module_id)} style={{ cursor: 'pointer' }}>{expanded[m.module_id] ? '\u25BC' : '\u25B6'}</span></td>
                    <td><b>{m.module_name}</b><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{m.description || m.category || '\u2014'}</span></td>
                    <td>{m.process || '\u2014'} / {m.lob || '\u2014'}{m.branch ? ` \u00b7 ${m.branch}` : ''}</td>
                    <td>{(m.contents || []).length} item(s) &middot; {m.estimated_mins || 0} min</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn small" onClick={() => openAssignContent(m.module_id)}>+ Content</button>
                      <button className="btn small" onClick={() => setEditModule({
                        moduleId: m.module_id, moduleName: m.module_name || '', category: m.category || '', process: m.process || '', lob: m.lob || '', branch: m.branch || '', description: m.description || '', estimatedMins: m.estimated_mins || 0,
                      })}>Edit</button>
                      <button className="btn small secondary" onClick={() => openReport(m)}>⏱ Reading</button>
                      <button className="btn small danger" onClick={() => archiveModule(m.module_id)}>Delete</button>
                    </td>
                  </tr>
                  {expanded[m.module_id] && (
                    <tr key={`${m.module_id}-contents`}>
                      <td colSpan="5" style={{ padding: '0 0 0 40px', background: 'var(--bg2, #f9f9f9)' }}>
                        <table style={{ width: '100%', fontSize: 13 }}>
                          <thead><tr><th>Content</th><th>Type</th><th>Sort</th><th>Required</th><th /></tr></thead>
                          <tbody>
                            {(m.contents || []).map(c => (
                              <tr key={`${m.module_id}-${c.repository_content_id}`}>
                                <td><b>{c.title}</b></td>
                                <td><span className="pill info" style={{ fontSize: 11 }}>{c.content_type}</span></td>
                                <td>{c.sortOrder}</td>
                                <td>{c.required ? '\u2713' : '\u2014'}</td>
                                <td><button className="btn small danger" onClick={() => removeContent(m.module_id, c.repository_content_id)} style={{ fontSize: 11 }}>Remove</button></td>
                              </tr>
                            ))}
                            {(!m.contents || !m.contents.length) && <tr><td colSpan="5" style={{ color: 'var(--muted)', textAlign: 'center', padding: 12 }}>No content assigned. Click "+ Content" to add.</td></tr>}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!modules.length && <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No independent modules created yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Auto Assignment Rules</h3>
        <form onSubmit={createRule} style={{ display: 'grid', gap: 10, marginBottom: 16, padding: 12, background: 'var(--bg2, #f5f5f5)', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr', gap: 10 }}>
            <select className="input" value={ruleForm.moduleId} onChange={e => setRuleForm(p => ({ ...p, moduleId: e.target.value }))} required>
              <option value="">Select Module *</option>
              {modules.map(m => <option key={m.module_id} value={m.module_id}>{m.module_name}</option>)}
            </select>
            <input className="input" placeholder="Rule Name" value={ruleForm.ruleName} onChange={e => setRuleForm(p => ({ ...p, ruleName: e.target.value }))} required />
            <select className="input" value={ruleForm.scopeType} onChange={e => setRuleForm(p => ({ ...p, scopeType: e.target.value, scopeValue: '' }))}>
              <option value="All">All Users</option><option value="Process">Process</option><option value="LOB">LOB</option><option value="Branch">Branch</option><option value="Designation">Designation</option>
            </select>
            {ruleForm.scopeType !== 'All' ? <input className="input" placeholder="Scope Value *" value={ruleForm.scopeValue} onChange={e => setRuleForm(p => ({ ...p, scopeValue: e.target.value }))} required /> : <span />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <select className="input" value={ruleForm.assignmentType} onChange={e => setRuleForm(p => ({ ...p, assignmentType: e.target.value }))}>
              <option>Mandatory</option><option>Optional</option>
            </select>
            <input className="input" type="number" placeholder="Due Days" value={ruleForm.dueDays} onChange={e => setRuleForm(p => ({ ...p, dueDays: e.target.value }))} />
            <input className="input" placeholder="Message" value={ruleForm.message} onChange={e => setRuleForm(p => ({ ...p, message: e.target.value }))} />
            <button className="btn accent" disabled={saving || !ruleForm.moduleId}>{saving ? 'Creating\u2026' : 'Add Rule'}</button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rule</th><th>Module</th><th>Scope</th><th>Type</th><th>Due</th><th /></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.rule_id}>
                  <td><b>{r.rule_name}</b><br /><span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>{r.rule_id}</span></td>
                  <td>{r.module_name || r.module_id}</td>
                  <td>{r.scope_type}{r.scope_value ? `: ${r.scope_value}` : ''}</td>
                  <td><span className={`pill ${r.assignment_type === 'Mandatory' ? 'warn' : 'info'}`}>{r.assignment_type}</span></td>
                  <td>{r.due_days || 0} day(s)</td>
                  <td><button className="btn small danger" onClick={() => deleteRule(r.rule_id)}>Disable</button></td>
                </tr>
              ))}
              {!rules.length && <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No auto assignment rules configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <button className="btn secondary" onClick={load} disabled={loading}>{loading ? 'Loading\u2026' : 'Refresh'}</button>

      {editModule && (
        <div className="modal-overlay" onClick={() => setEditModule(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-head"><b>Edit Independent Module</b><button className="btn small secondary" onClick={() => setEditModule(null)}>\u2715</button></div>
            <form onSubmit={saveModuleEdit} style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
              <div className="field"><label>Module Name *</label><input className="input" value={editModule.moduleName} onChange={e => setEditModule(p => ({ ...p, moduleName: e.target.value }))} required /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field"><label>Category</label><input className="input" value={editModule.category} onChange={e => setEditModule(p => ({ ...p, category: e.target.value }))} /></div>
                <div className="field"><label>Est. Mins</label><input className="input" type="number" value={editModule.estimatedMins} onChange={e => setEditModule(p => ({ ...p, estimatedMins: e.target.value }))} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <ProcessSelect value={editModule.process} onChange={next => setEditModule(p => ({ ...p, process: next }))} />
                <LobSelect process={editModule.process} value={editModule.lob} onChange={next => setEditModule(p => ({ ...p, lob: next }))} />
                <BranchSelect value={editModule.branch} onChange={next => setEditModule(p => ({ ...p, branch: next }))} placeholder="All branches" />
              </div>
              <textarea className="input" rows="2" placeholder="Description" value={editModule.description} onChange={e => setEditModule(p => ({ ...p, description: e.target.value }))} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn secondary" onClick={() => setEditModule(null)}>Cancel</button>
                <button className="btn accent" disabled={saving}>{saving ? 'Saving\u2026' : 'Update Module'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {assignContent.show && (
        <div className="modal-overlay" onClick={() => setAssignContent({ moduleId: '', show: false, query: '', results: [] })}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-head"><b>Add Content to Module</b><button className="btn small secondary" onClick={() => setAssignContent({ moduleId: '', show: false, query: '', results: [] })}>\u2715</button></div>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" value={assignContent.query} onChange={e => setAssignContent(p => ({ ...p, query: e.target.value }))} placeholder="Search content repository\u2026" style={{ flex: 1 }} />
                <button className="btn secondary" onClick={searchContentForAssign}>Search</button>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <thead><tr><th>Title</th><th>Type</th><th>Category</th><th /></tr></thead>
                  <tbody>
                    {(assignContent.results.length ? assignContent.results : repoItems).map(item => (
                      <tr key={item.repository_content_id}>
                        <td><b>{item.title}</b></td>
                        <td><span className="pill info" style={{ fontSize: 11 }}>{item.content_type}</span></td>
                        <td>{item.category || '\u2014'}</td>
                        <td><button className="btn small accent" onClick={() => addContentToModule(item.repository_content_id)}>Add</button></td>
                      </tr>
                    ))}
                    {!repoItems.length && !assignContent.results.length && <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>No content available. Add items in Content Repository first.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="modal-overlay" onClick={() => setReport(null)}>
          <div className="modal-box" style={{ maxWidth: 900 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>Reading report — {report.moduleName}</b>
              <button className="btn small secondary" onClick={() => setReport(null)}>✕</button>
            </div>
            <div style={{ padding: '14px 18px' }}>
              {report.loading && <div className="spinner" />}
              {!report.loading && (
                <>
                  <div className="stat-row" style={{ marginBottom: 12 }}>
                    <div className="stat info"><div className="num">{report.summary.assigned || 0}</div><div className="label">Assigned</div></div>
                    <div className="stat"><div className="num">{report.summary.opened || 0}</div><div className="label">Opened</div></div>
                    <div className="stat warn"><div className="num">{report.summary.notOpened || 0}</div><div className="label">Never opened</div></div>
                    <div className="stat ok"><div className="num">{report.summary.completed || 0}</div><div className="label">Completed</div></div>
                    <div className="stat ok"><div className="num">{report.summary.acknowledged || 0}</div><div className="label">Acknowledged</div></div>
                    <div className="stat"><div className="num">{Math.round((report.summary.averageSecondsSpent || 0) / 6) / 10}m</div><div className="label">Avg time spent</div></div>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: '46vh', overflow: 'auto' }}>
                    <table>
                      <thead><tr><th>Employee</th><th>Name</th><th>Batch</th><th>Assigned via</th><th>Time spent</th><th>Required</th><th>Progress</th><th>Opens</th><th>Last opened</th><th>Acknowledged</th></tr></thead>
                      <tbody>
                        {report.rows.map((r, index) => (
                          <tr key={`${r.employeeId}-${r.contentId}-${index}`}>
                            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.employeeId}</td>
                            <td>{r.traineeName || '—'}</td>
                            <td>{r.batchNo || '—'}</td>
                            <td style={{ fontSize: 11 }}>{r.viaScope || '—'}</td>
                            <td>{r.secondsSpent > 0 ? `${Math.round(r.secondsSpent / 6) / 10} min` : '—'}</td>
                            <td>{r.requiredSeconds > 0 ? `${Math.round(r.requiredSeconds / 6) / 10} min` : (r.estimatedMins ? `${r.estimatedMins} min` : '—')}</td>
                            <td>
                              <span className={`pill ${r.completionStatus === 'Completed' ? 'ok' : (r.openCount > 0 ? 'warn' : '')}`} style={{ fontSize: 11 }}>
                                {r.completionStatus === 'Completed' ? 'Completed' : (r.openCount > 0 ? `${Math.round(r.completionPct)}%` : 'Not opened')}
                              </span>
                            </td>
                            <td>{r.openCount || 0}</td>
                            <td style={{ fontSize: 12 }}>{r.lastOpenedAt ? new Date(r.lastOpenedAt).toLocaleString() : '—'}</td>
                            <td>
                              {r.acknowledged
                                ? <span className="pill ok" style={{ fontSize: 11 }} title={new Date(r.acknowledgedAt).toLocaleString()}>✓ Acknowledged</span>
                                : <span className="pill" style={{ fontSize: 11 }}>Not yet</span>}
                            </td>
                          </tr>
                        ))}
                        {!report.rows.length && <tr><td colSpan="10" style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Nobody is assigned this module yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}