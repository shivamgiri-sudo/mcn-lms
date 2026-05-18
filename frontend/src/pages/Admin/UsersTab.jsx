import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const ROLES = ['Coordinator', 'Manager', 'Trainer', 'Admin', 'Viewer'];
const PERMISSIONS = [
  { key: 'canCreateBatch', label: 'Create Batch' },
  { key: 'canOnboardTrainee', label: 'Onboard Trainee' },
  { key: 'canUploadLmsReport', label: 'Upload LMS Report' },
  { key: 'canOverrideAttendance', label: 'Override Attendance' },
  { key: 'canCloseBatch', label: 'Close Batch' },
  { key: 'canViewManagementDashboard', label: 'View Mgmt Dashboard' },
];

const EMPTY_FORM = {
  loginId: '', pin: '', confirmPin: '', name: '',
  role: 'Coordinator', portalAccess: 'Coordinator',
  branch: '', process: '', lob: '', designation: '', department: '', employeeCode: '',
  canCreateBatch: true, canOnboardTrainee: true, canUploadLmsReport: false,
  canOverrideAttendance: false, canCloseBatch: false, canViewManagementDashboard: false,
};

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [processList, setProcessList] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPin, setNewPin] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadUsers();
    api.get('/admin/process-lob', 'admin').then(r => r.ok && setProcessList(r.data));
  }, []);

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 6000); }

  async function loadUsers() {
    const res = await api.get('/admin/portal-users', 'admin');
    if (res.ok) setUsers(res.data);
  }

  function openCreate() { setForm(EMPTY_FORM); setShowCreate(true); setEditing(null); }
  function openEdit(u) {
    setForm({
      loginId: u.loginId, pin: '', confirmPin: '', name: u.name || '',
      role: u.role || 'Coordinator', portalAccess: u.portalAccess || 'Coordinator',
      branch: u.branch || '', process: u.process || '', lob: u.lob || '',
      designation: '', department: '', employeeCode: '',
      canCreateBatch: u.canCreateBatch || false,
      canOnboardTrainee: u.canOnboardTrainee || false,
      canUploadLmsReport: u.canUploadLmsReport || false,
      canOverrideAttendance: u.canOverrideAttendance || false,
      canCloseBatch: u.canCloseBatch || false,
      canViewManagementDashboard: u.canViewManagementDashboard || false,
    });
    setEditing(u);
    setShowCreate(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!editing && form.pin !== form.confirmPin) return toast('PINs do not match.', false);
    if (!editing && form.pin.length < 4) return toast('PIN must be at least 4 characters.', false);
    if (!form.loginId.trim() || !form.name.trim()) return toast('Login ID and Name are required.', false);
    setLoading(true);

    const payload = {
      loginId: form.loginId.trim(),
      name: form.name.trim(),
      role: form.role,
      portalAccess: form.portalAccess || form.role,
      branch: form.branch || null,
      process: form.process || null,
      lob: form.lob || null,
      canCreateBatch: form.canCreateBatch,
      canOnboardTrainee: form.canOnboardTrainee,
      canUploadLmsReport: form.canUploadLmsReport,
      canOverrideAttendance: form.canOverrideAttendance,
      canCloseBatch: form.canCloseBatch,
      canViewManagementDashboard: form.canViewManagementDashboard,
    };
    if (!editing) payload.pin = form.pin;

    let res;
    if (editing) {
      res = await api.put(`/admin/portal-users/${editing.id}`, payload, 'admin');
    } else {
      res = await api.post('/admin/portal-users', payload, 'admin');
    }
    setLoading(false);
    if (res.ok) {
      toast(editing ? `User ${form.loginId} updated.` : `User ${form.loginId} created.`);
      setShowCreate(false);
      setEditing(null);
      loadUsers();
    } else {
      toast(res.message || 'Failed.', false);
    }
  }

  async function deactivateUser(u) {
    if (!window.confirm(`Deactivate ${u.loginId}? They will lose portal access.`)) return;
    const res = await api.delete(`/admin/portal-users/${u.id}`, 'admin');
    if (res.ok) { toast('User deactivated.'); loadUsers(); }
    else toast(res.message || 'Failed.', false);
  }

  async function submitPinReset(e) {
    e.preventDefault();
    if (!newPin || newPin.length < 4) return toast('PIN must be at least 4 characters.', false);
    const res = await api.post(`/admin/portal-users/${resetTarget.id}/reset-pin`, { pin: newPin }, 'admin');
    if (res.ok) { toast('PIN reset successfully.'); setResetTarget(null); setNewPin(''); }
    else toast(res.message || 'Failed.', false);
  }

  const uniqueProcesses = [...new Set(processList.map(p => p.process).filter(Boolean))];
  const lobsForProcess = processList.filter(p => p.process === form.process).map(p => p.lob);

  const filtered = users.filter(u =>
    !search || u.loginId.toLowerCase().includes(search.toLowerCase()) ||
    (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.branch || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.process || '').toLowerCase().includes(search.toLowerCase())
  );

  const roleColor = r => r === 'Admin' ? '#f87171' : r === 'Manager' ? '#fbbf24' : r === 'Trainer' ? '#a78bfa' : '#60a5fa';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Portal Users</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Manage coordinators, trainers, and managers who can log in to the coordinator portal.</p>
        </div>
        <button className="btn" onClick={openCreate}>+ New User</button>
      </div>

      {msg.text && (
        <div className={`toast ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 8, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg({ text: '', ok: true })}>✕</button>
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 400 }}
          placeholder="Search by login ID, name, branch, process..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Users table */}
      <div className="table-wrap">
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontSize: 13 }}>
            {users.length === 0 ? 'No portal users yet. Click "New User" to add one.' : 'No users match your search.'}
          </div>
        )}
        {filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Login ID</th>
                <th>Name</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Process / LOB</th>
                <th>Permissions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td><b style={{ fontSize: 12 }}>{u.loginId}</b></td>
                  <td style={{ fontSize: 12 }}>{u.name || '—'}</td>
                  <td>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${roleColor(u.role)}22`, color: roleColor(u.role) }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{u.branch || '—'}</td>
                  <td style={{ fontSize: 12 }}>{u.process || '—'}{u.lob ? ` / ${u.lob}` : ''}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {u.canCreateBatch && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(22,163,74,.18)', color: '#4ade80' }}>Batches</span>}
                      {u.canOnboardTrainee && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(29,78,216,.18)', color: '#60a5fa' }}>Onboard</span>}
                      {u.canViewManagementDashboard && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(124,58,237,.18)', color: '#a78bfa' }}>Mgmt</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${u.active ? 'ok' : 'bad'}`} style={{ fontSize: 10 }}>
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                    {u.locked && <span className="pill warn" style={{ fontSize: 10, marginLeft: 4 }}>Locked</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn xs secondary" onClick={() => openEdit(u)}>Edit</button>
                      <button className="btn xs secondary" onClick={() => { setResetTarget(u); setNewPin(''); }}>Reset PIN</button>
                      <button className="btn xs danger" onClick={() => deactivateUser(u)}>Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && (setShowCreate(false), setEditing(null))}>
          <div className="modal-box" style={{ maxWidth: 640 }}>
            <div className="modal-head">
              <b>{editing ? `Edit User — ${editing.loginId}` : 'New Portal User'}</b>
              <button className="btn small secondary" onClick={() => { setShowCreate(false); setEditing(null); }}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                {/* Identity */}
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10, letterSpacing: .5 }}>Identity</div>
                <div className="col-2">
                  <div className="field">
                    <label>Login ID *</label>
                    <input
                      className="input"
                      placeholder="e.g. COORD001 or John.Doe"
                      value={form.loginId}
                      onChange={e => setForm(p => ({ ...p, loginId: e.target.value }))}
                      disabled={!!editing}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Full Name *</label>
                    <input
                      className="input"
                      placeholder="e.g. John Doe"
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Designation</label>
                    <input className="input" placeholder="e.g. Training Coordinator" value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Department</label>
                    <input className="input" placeholder="e.g. Training & Development" value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Employee Code</label>
                    <input className="input" placeholder="e.g. EMP1001" value={form.employeeCode} onChange={e => setForm(p => ({ ...p, employeeCode: e.target.value }))} />
                  </div>
                </div>

                {!editing && (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Login PIN</div>
                    <div className="col-2">
                      <div className="field">
                        <label>PIN *</label>
                        <input
                          className="input"
                          type="password"
                          placeholder="Min 4 characters"
                          value={form.pin}
                          onChange={e => setForm(p => ({ ...p, pin: e.target.value }))}
                          required={!editing}
                        />
                      </div>
                      <div className="field">
                        <label>Confirm PIN *</label>
                        <input
                          className="input"
                          type="password"
                          placeholder="Repeat PIN"
                          value={form.confirmPin}
                          onChange={e => setForm(p => ({ ...p, confirmPin: e.target.value }))}
                          required={!editing}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Role & Access */}
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Role & Scope</div>
                <div className="col-2">
                  <div className="field">
                    <label>Role *</label>
                    <select className="select" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value, portalAccess: e.target.value }))}>
                      {ROLES.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Branch</label>
                    <input className="input" placeholder="e.g. Bangalore, Mumbai" value={form.branch} onChange={e => setForm(p => ({ ...p, branch: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Process</label>
                    <select className="select" value={form.process} onChange={e => setForm(p => ({ ...p, process: e.target.value, lob: '' }))}>
                      <option value="">All / None</option>
                      {uniqueProcesses.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>LOB</label>
                    <select className="select" value={form.lob} onChange={e => setForm(p => ({ ...p, lob: e.target.value }))} disabled={!form.process}>
                      <option value="">All / None</option>
                      {lobsForProcess.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>
                </div>

                {/* Permissions */}
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Permissions</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                  {PERMISSIONS.map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: form[key] ? 'rgba(22,163,74,.15)' : 'var(--card)', transition: 'all .12s' }}>
                      <input type="checkbox" checked={!!form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} style={{ accentColor: '#22c55e', width: 14, height: 14 }} />
                      <span style={{ fontSize: 12, fontWeight: form[key] ? 700 : 400, color: form[key] ? '#4ade80' : 'var(--muted)' }}>{label}</span>
                    </label>
                  ))}
                </div>

                <button className="btn" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                  {loading ? '...' : editing ? 'Save Changes' : 'Create User'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Reset PIN Modal */}
      {resetTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setResetTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <b>Reset PIN — {resetTarget.loginId}</b>
              <button className="btn small secondary" onClick={() => setResetTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={submitPinReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label>New PIN *</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Min 4 characters"
                    value={newPin}
                    onChange={e => setNewPin(e.target.value)}
                    required
                  />
                </div>
                <button className="btn" type="submit">Set New PIN</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
