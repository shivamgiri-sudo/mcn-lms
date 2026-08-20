import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const EMPTY_FORM = {
  loginId: '', pin: '', confirmPin: '', name: '',
  designation: '', department: '', employeeCode: '',
  branch: '', process: '', lob: '',
  canCreateBatch: true, canOnboardTrainee: true, canUploadLmsReport: false,
  canOverrideAttendance: false, canCloseBatch: false, canViewManagementDashboard: false,
};

const PERMISSIONS = [
  { key: 'canCreateBatch', label: 'Create Batch' },
  { key: 'canOnboardTrainee', label: 'Onboard Trainee' },
  { key: 'canUploadLmsReport', label: 'Upload LMS Report' },
  { key: 'canOverrideAttendance', label: 'Override Attendance' },
  { key: 'canCloseBatch', label: 'Close Batch' },
  { key: 'canViewManagementDashboard', label: 'View Mgmt Dashboard' },
];

export default function CoordinatorsPage({ navigate }) {
  const [coords, setCoords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [branches, setBranches] = useState([]);
  const [processList, setProcessList] = useState([]); // [{process, lob}]

  const load = () => {
    setLoading(true);
    api.get('/admin/coordinators', 'admin').then(r => { if (r.ok) setCoords(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!showForm) return;
    // Real branch/process/LOB values from live trainee data — no free typing.
    api.get('/admin/broadcast-targets', 'admin').then(r => r.ok && setBranches(r.data.branches || []));
    api.get('/admin/process-lob', 'admin').then(r => r.ok && setProcessList(r.data || []));
  }, [showForm]);

  const uniqueProcesses = [...new Set(processList.map(p => p.process).filter(Boolean))];
  const lobsForProcess = processList.filter(p => p.process === form.process).map(p => p.lob).filter(Boolean);

  function set(key, value) { setForm(f => ({ ...f, [key]: value })); }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    set(name, type === 'checkbox' ? checked : value);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.loginId.trim() || !form.pin || !form.name.trim()) return setError('Login ID, PIN and Name are required.');
    if (form.pin.length < 4) return setError('PIN must be at least 4 characters.');
    if (form.pin !== form.confirmPin) return setError('PIN and Confirm PIN do not match.');

    setSaving(true);
    const payload = {
      loginId: form.loginId.trim(), pin: form.pin, name: form.name.trim(),
      designation: form.designation || null, department: form.department || null, employeeCode: form.employeeCode || null,
      branch: form.branch || null, process: form.process || null, lob: form.lob || null,
      canCreateBatch: form.canCreateBatch, canOnboardTrainee: form.canOnboardTrainee,
      canUploadLmsReport: form.canUploadLmsReport, canOverrideAttendance: form.canOverrideAttendance,
      canCloseBatch: form.canCloseBatch, canViewManagementDashboard: form.canViewManagementDashboard,
    };
    const r = await api.post('/admin/coordinators', payload, 'admin');
    setSaving(false);
    if (r.ok) {
      setSuccess(`Coordinator "${form.name}" created successfully.`);
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } else {
      setError(r.message || 'Failed to create coordinator.');
    }
  }

  if (loading) return <div style={{ color: 'var(--muted)', padding: '40px', textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Coordinators</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Manage batch coordinators and their permissions.</p>
        </div>
        <button className="btn" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }}>+ New Coordinator</button>
      </div>

      {success && (
        <div className="toast ok" style={{ marginBottom: 16 }}>
          {success}
          <button style={{ marginLeft: 8, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setSuccess('')}>✕</button>
        </div>
      )}

      {coords.length === 0 && <div className="glass-panel"><p style={{ color: 'var(--muted)', fontSize: 12 }}>No active coordinators found.</p></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
        {coords.map(c => (
          <div key={c.coordinatorLoginId} className="ccard" onClick={() => navigate('coord-detail', { loginId: c.coordinatorLoginId, coordinatorName: c.coordinatorName })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{c.coordinatorName || c.coordinatorLoginId}</span>
              <span className="pill info">Active</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.batches.length} batch{c.batches.length !== 1 ? 'es' : ''}</div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {c.batches.map(b => (
                <span key={b.batchNo} style={{ fontSize: 10, background: 'rgba(29,78,216,.18)', border: '1px solid rgba(96,165,250,.25)', borderRadius: 6, padding: '2px 8px', color: '#60a5fa', fontWeight: 600 }}>
                  {b.batchNo}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal-box" style={{ maxWidth: 640 }}>
            <div className="modal-head">
              <b>New Coordinator</b>
              <button className="btn small secondary" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                {error && <div style={{ marginBottom: 14, fontSize: 12, color: '#f87171' }}>{error}</div>}

                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: .5 }}>Identity</div>
                <div className="col-2">
                  <div className="field">
                    <label>Login ID *</label>
                    <input className="input" name="loginId" placeholder="e.g. COORD001 or John.Doe" value={form.loginId} onChange={handleChange} required />
                  </div>
                  <div className="field">
                    <label>Full Name *</label>
                    <input className="input" name="name" placeholder="e.g. John Doe" value={form.name} onChange={handleChange} required />
                  </div>
                  <div className="field">
                    <label>Designation</label>
                    <input className="input" name="designation" placeholder="e.g. Training Coordinator" value={form.designation} onChange={handleChange} />
                  </div>
                  <div className="field">
                    <label>Department</label>
                    <input className="input" name="department" placeholder="e.g. Training & Development" value={form.department} onChange={handleChange} />
                  </div>
                  <div className="field">
                    <label>Employee Code</label>
                    <input className="input" name="employeeCode" placeholder="e.g. EMP1001" value={form.employeeCode} onChange={handleChange} />
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Login PIN</div>
                <div className="col-2">
                  <div className="field">
                    <label>PIN * <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(min 4 chars)</span></label>
                    <input className="input" type="password" name="pin" placeholder="Min 4 characters" value={form.pin} onChange={handleChange} required />
                  </div>
                  <div className="field">
                    <label>Confirm PIN *</label>
                    <input className="input" type="password" name="confirmPin" placeholder="Repeat PIN" value={form.confirmPin} onChange={handleChange} required />
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Scope</div>
                <div className="col-2">
                  <div className="field">
                    <label>Branch</label>
                    <select className="select" name="branch" value={form.branch} onChange={handleChange}>
                      <option value="">All / None</option>
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Process</label>
                    <select className="select" value={form.process} onChange={e => setForm(f => ({ ...f, process: e.target.value, lob: '' }))}>
                      <option value="">All / None</option>
                      {uniqueProcesses.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>LOB</label>
                    <select className="select" name="lob" value={form.lob} onChange={handleChange} disabled={!form.process}>
                      <option value="">All / None</option>
                      {lobsForProcess.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Permissions</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16 }}>
                  {PERMISSIONS.map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: form[key] ? 'rgba(22,163,74,.15)' : 'var(--card)', transition: 'all .12s' }}>
                      <input type="checkbox" name={key} checked={!!form[key]} onChange={handleChange} style={{ accentColor: '#22c55e', width: 14, height: 14 }} />
                      <span style={{ fontSize: 12, fontWeight: form[key] ? 700 : 400, color: form[key] ? '#4ade80' : 'var(--muted)' }}>{label}</span>
                    </label>
                  ))}
                </div>

                <button className="btn" type="submit" disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
                  {saving ? 'Creating...' : 'Create Coordinator'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
