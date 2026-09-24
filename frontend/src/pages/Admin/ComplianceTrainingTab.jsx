import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

// Configures the one module + assessment that gets auto-assigned, Mandatory,
// to every brand-new trainee at onboarding (HRMS sync, admin LMS-user
// creation, admin bulk-add, bulk import, coordinator onboarding all trigger
// it -- see services/complianceTraining.js). Existing trainees are only ever
// backfilled through the explicit "Bulk Assign to Existing Trainees" action
// below, never automatically.
export default function ComplianceTrainingTab({ isSuper }) {
  const [settings, setSettings] = useState(null);
  const [modules, setModules] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFilters, setBulkFilters] = useState({ process: '', lob: '', branch: '' });
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/compliance-training/settings', 'admin'),
      api.get('/admin/independent-modules', 'admin'),
      api.get('/admin/assessments', 'admin'),
    ]).then(([settingsRes, modulesRes, assessmentsRes]) => {
      if (settingsRes.ok) setSettings(settingsRes.data);
      if (modulesRes.ok) setModules(modulesRes.data || []);
      if (assessmentsRes.ok) setAssessments(assessmentsRes.data || []);
      setLoading(false);
    });
  }, []);

  function setField(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await api.put('/compliance-training/settings', {
      enabled: settings.enabled,
      moduleId: settings.moduleId || '',
      assessmentId: settings.assessmentId || '',
      assignmentType: settings.assignmentType,
      dueDays: settings.dueDays,
      eligibleProcesses: settings.eligibleProcesses || '',
      eligibleLobs: settings.eligibleLobs || '',
      eligibleBranches: settings.eligibleBranches || '',
    }, 'admin');
    setSaving(false);
    if (res.ok) { setSettings(res.data); setMsg({ type: 'ok', text: 'Compliance training settings saved.' }); }
    else setMsg({ type: 'bad', text: res.message || 'Save failed.' });
  }

  async function runBulkAssign() {
    setBulkRunning(true);
    setBulkResult(null);
    const res = await api.post('/compliance-training/bulk-assign', {
      process: bulkFilters.process || undefined,
      lob: bulkFilters.lob || undefined,
      branch: bulkFilters.branch || undefined,
    }, 'admin');
    setBulkRunning(false);
    if (res.ok) setBulkResult({ ok: true, ...res.data });
    else setBulkResult({ ok: false, message: res.message || 'Bulk assignment failed.' });
  }

  if (loading || !settings) return <div className="empty">Loading compliance training settings…</div>;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Compliance Training Auto-Assignment</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Whenever a new trainee is created — through HRMS sync, admin LMS-user creation, bulk add, bulk import, or coordinator onboarding — this module and assessment are assigned to them automatically, marked Mandatory. Existing trainees are never touched by this automatically; use the bulk-assign action below to backfill them deliberately.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {!isSuper && (
        <div className="toast warn" style={{ marginBottom: 16 }}>Only a Super Admin can change these settings. You can view the current configuration below.</div>
      )}

      <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '20px 22px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, fontWeight: 700, fontSize: 14 }}>
          <input type="checkbox" checked={!!settings.enabled} disabled={!isSuper} onChange={e => setField('enabled', e.target.checked)} style={{ width: 18, height: 18 }} />
          Auto-assign compliance training to new trainees
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Compliance Module</label>
            <select className="select" disabled={!isSuper} value={settings.moduleId || ''} onChange={e => setField('moduleId', e.target.value)}>
              <option value="">— Select a module —</option>
              {modules.map(m => <option key={m.module_id} value={m.module_id}>{m.module_name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Compliance Assessment</label>
            <select className="select" disabled={!isSuper} value={settings.assessmentId || ''} onChange={e => setField('assessmentId', e.target.value)}>
              <option value="">— None —</option>
              {assessments.map(a => <option key={a.assessmentId} value={a.assessmentId}>{a.assessmentName}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 6 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Assignment Type</label>
            <select className="select" disabled={!isSuper} value={settings.assignmentType || 'Mandatory'} onChange={e => setField('assignmentType', e.target.value)}>
              <option value="Mandatory">Mandatory</option>
              <option value="Optional">Optional</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Due in (days after assignment, 0 = no due date)</label>
            <input type="number" min="0" className="input" disabled={!isSuper} value={settings.dueDays ?? 0} onChange={e => setField('dueDays', Math.max(0, parseInt(e.target.value, 10) || 0))} />
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '20px 22px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Eligibility (optional)</div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          By default this applies to every new trainee regardless of process, LOB, or branch. To restrict it, list the values it should apply to, comma-separated — leave a field blank to leave that dimension unrestricted.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Eligible Processes</label>
            <input className="input" disabled={!isSuper} placeholder="e.g. Onfido, KYC" value={settings.eligibleProcesses || ''} onChange={e => setField('eligibleProcesses', e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Eligible LOBs</label>
            <input className="input" disabled={!isSuper} placeholder="e.g. Voice, Backoffice" value={settings.eligibleLobs || ''} onChange={e => setField('eligibleLobs', e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Eligible Branches</label>
            <input className="input" disabled={!isSuper} placeholder="e.g. Noida, Jalandhar" value={settings.eligibleBranches || ''} onChange={e => setField('eligibleBranches', e.target.value)} />
          </div>
        </div>
      </div>

      {isSuper && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 28 }}>
          <button className="btn accent" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
        </div>
      )}

      <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '20px 22px', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setBulkOpen(o => !o)}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Bulk Assign to Existing Trainees</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Backfills the configured compliance training onto trainees who already existed before this was enabled. Never runs automatically.</div>
          </div>
          <span style={{ fontSize: 18, color: 'var(--muted)' }}>{bulkOpen ? '▾' : '▸'}</span>
        </div>

        {bulkOpen && isSuper && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end', marginBottom: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Process (optional)</label>
                <input className="input" placeholder="All processes" value={bulkFilters.process} onChange={e => setBulkFilters(f => ({ ...f, process: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>LOB (optional)</label>
                <input className="input" placeholder="All LOBs" value={bulkFilters.lob} onChange={e => setBulkFilters(f => ({ ...f, lob: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Branch (optional)</label>
                <input className="input" placeholder="All branches" value={bulkFilters.branch} onChange={e => setBulkFilters(f => ({ ...f, branch: e.target.value }))} />
              </div>
              <button
                className="btn"
                style={{ background: '#7c3aed', height: 38 }}
                disabled={bulkRunning}
                onClick={() => {
                  if (window.confirm('Assign the configured compliance training to every matching existing trainee who does not already have it? This cannot be undone in bulk.')) runBulkAssign();
                }}
              >
                {bulkRunning ? 'Assigning…' : 'Run Bulk Assign'}
              </button>
            </div>
            {bulkResult && (
              bulkResult.ok
                ? <div className="toast ok">Done — {bulkResult.assigned} of {bulkResult.total} trainee(s) newly assigned. {Object.entries(bulkResult.skippedByReason || {}).map(([reason, count]) => `${count} skipped (${reason})`).join(', ')}</div>
                : <div className="toast bad">{bulkResult.message}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
