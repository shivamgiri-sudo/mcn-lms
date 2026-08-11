import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const BULK_CSV_TEMPLATE = 'loginId,name,pin,role,branch,process,lob,designation,department,employeeCode,canCreateBatch,canOnboardTrainee,canUploadLmsReport,canOverrideAttendance,canCloseBatch,canViewManagementDashboard\nCOORD001,John Doe,1234,Coordinator,Bangalore,Collections,LOB1,Training Coordinator,Training,,true,true,false,false,false,false\n';

function parseBulkUsersCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
    const bool = v => v === 'true' || v === '1' || v === 'yes';
    return {
      loginId: obj.loginid || obj['login id'] || '',
      name: obj.name || '',
      pin: obj.pin || '',
      role: obj.role || 'Coordinator',
      portalAccess: obj.role || 'Coordinator',
      branch: obj.branch || null,
      process: obj.process || null,
      lob: obj.lob || null,
      designation: obj.designation || null,
      department: obj.department || null,
      employeeCode: obj.employeecode || obj['employee code'] || null,
      canCreateBatch: bool(obj.cancreatebatch),
      canOnboardTrainee: bool(obj.canonboardtrainee),
      canUploadLmsReport: bool(obj.canuploadlmsreport),
      canOverrideAttendance: bool(obj.canoverrideattendance),
      canCloseBatch: bool(obj.canclosebatch),
      canViewManagementDashboard: bool(obj.canviewmanagementdashboard),
    };
  }).filter(u => u.loginId && u.name && u.pin);
}

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
  email: '', mobile: '',
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
  const [showBulk, setShowBulk] = useState(false);
  const [bulkDragging, setBulkDragging] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  // Role change modal
  const [roleChangeTarget, setRoleChangeTarget] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [roleChangePin, setRoleChangePin] = useState('');
  const [roleChangeLoading, setRoleChangeLoading] = useState(false);

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
      designation: u.designation || '', department: u.department || '', employeeCode: u.employeeCode || '',
      email: u.email || '', mobile: u.mobile || '',
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
      designation: form.designation || null,
      department: form.department || null,
      employeeCode: form.employeeCode || null,
      email: form.email || null,
      mobile: form.mobile || null,
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

  function openRoleChange(u) {
    setRoleChangeTarget(u);
    setNewRole(u.role || 'Coordinator');
    setRoleChangePin('');
  }

  async function handleRoleChange(e) {
    e.preventDefault();
    if (!newRole) return;
    const crossTable = (roleChangeTarget.role === 'Admin') !== (newRole === 'Admin');
    if (crossTable && roleChangePin.length < 4) {
      return toast(`A new ${newRole === 'Admin' ? 'password' : 'PIN'} (min 4 chars) is required when changing to/from Admin.`, false);
    }
    setRoleChangeLoading(true);
    const res = await api.post(`/admin/portal-users/${roleChangeTarget.id}/change-role`, {
      newRole,
      newPin: crossTable ? roleChangePin : undefined,
    }, 'admin');
    setRoleChangeLoading(false);
    if (res.ok) {
      toast(res.message || `Role changed to ${newRole}.`);
      setRoleChangeTarget(null);
      loadUsers();
    } else {
      toast(res.message || 'Role change failed.', false);
    }
  }

  async function submitPinReset(e) {
    e.preventDefault();
    const isAdmin = resetTarget?.role === 'Admin';
    if (!newPin || newPin.length < 4) return toast(`${isAdmin ? 'Password' : 'PIN'} must be at least 4 characters.`, false);
    const res = await api.post(`/admin/portal-users/${resetTarget.id}/reset-pin`, { pin: newPin }, 'admin');
    if (res.ok) { toast(`${isAdmin ? 'Password' : 'PIN'} reset successfully.`); setResetTarget(null); setNewPin(''); }
    else toast(res.message || 'Failed.', false);
  }

  function handleBulkFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const rows = parseBulkUsersCsv(e.target.result);
      setBulkPreview(rows);
    };
    reader.readAsText(file);
  }

  async function submitBulkImport() {
    if (!bulkPreview?.length) return;
    setBulkLoading(true);
    const res = await api.post('/admin/portal-users/bulk', { users: bulkPreview }, 'admin');
    setBulkLoading(false);
    if (res.ok) {
      toast(`Created ${res.data?.success} users${res.data?.failed ? `, ${res.data.failed} failed` : ''}.`);
      setShowBulk(false);
      setBulkPreview(null);
      loadUsers();
    } else {
      toast(res.message || 'Bulk import failed.', false);
    }
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" onClick={() => { setShowBulk(true); setBulkPreview(null); }}>⬆ Bulk CSV</button>
          <button className="btn" onClick={openCreate}>+ New User</button>
        </div>
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
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${roleColor(u.role)}22`, color: roleColor(u.role) }}>
                        {u.role}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: u.role === 'Admin' ? 'rgba(139,92,246,.18)' : 'rgba(29,78,216,.18)',
                        color: u.role === 'Admin' ? '#a78bfa' : '#60a5fa',
                        border: `1px solid ${u.role === 'Admin' ? 'rgba(139,92,246,.3)' : 'rgba(29,78,216,.3)'}`,
                        letterSpacing: '.04em',
                      }}>
                        {u.role === 'Admin' ? 'Admin portal' : 'Coord portal'}
                      </span>
                    </div>
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
                      <button className="btn xs secondary" onClick={() => openRoleChange(u)} title="Change role or promote to Admin">⇄ Role</button>
                      <button className="btn xs secondary" onClick={() => { setResetTarget(u); setNewPin(''); }}>{u.role === 'Admin' ? 'Reset Password' : 'Reset PIN'}</button>
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

                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Contact & Notifications</div>
                <div className="col-2">
                  <div className="field">
                    <label>Email</label>
                    <input className="input" type="email" placeholder="coord@teammas.in" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Mobile</label>
                    <input className="input" type="tel" placeholder="9876543210" value={form.mobile} onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))} />
                  </div>
                </div>

                {!editing && (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', margin: '14px 0 10px', letterSpacing: .5 }}>Login PIN</div>
                    <div className="col-2">
                      <div className="field">
                        <label>{form.role === 'Admin' ? 'Password *' : 'PIN *'}</label>
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
                        <label>{form.role === 'Admin' ? 'Confirm Password *' : 'Confirm PIN *'}</label>
                        <input
                          className="input"
                          type="password"
                          placeholder={form.role === 'Admin' ? 'Repeat password' : 'Repeat PIN'}
                          value={form.confirmPin}
                          onChange={e => setForm(p => ({ ...p, confirmPin: e.target.value }))}
                          required={!editing}
                        />
                      </div>
                      {form.role === 'Admin' && (
                        <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--warn)', background: 'rgba(217,119,6,.1)', border: '1px solid var(--warn)', borderRadius: 8, padding: '8px 12px' }}>
                          ⚠ Admin users log into the <b>Admin portal</b> with their Login ID + Password. They cannot log into the Coordinator portal.
                        </div>
                      )}
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

      {/* Bulk CSV Modal */}
      {showBulk && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && (setShowBulk(false), setBulkPreview(null))}>
          <div className="modal-box" style={{ maxWidth: 680 }}>
            <div className="modal-head">
              <b>Bulk Create Portal Users</b>
              <button className="btn small secondary" onClick={() => { setShowBulk(false); setBulkPreview(null); }}>✕</button>
            </div>
            <div className="modal-body">
              {!bulkPreview ? (
                <>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                    Upload a CSV with columns: loginId, name, pin, role, branch, process, lob, designation, department, employeeCode, canCreateBatch, canOnboardTrainee, canUploadLmsReport, canOverrideAttendance, canCloseBatch, canViewManagementDashboard
                  </p>
                  <div
                    onDragOver={e => { e.preventDefault(); setBulkDragging(true); }}
                    onDragLeave={() => setBulkDragging(false)}
                    onDrop={e => { e.preventDefault(); setBulkDragging(false); handleBulkFile(e.dataTransfer.files[0]); }}
                    style={{
                      border: `2px dashed ${bulkDragging ? 'var(--accent)' : 'var(--line)'}`,
                      borderRadius: 12, padding: '36px 24px', textAlign: 'center',
                      background: bulkDragging ? 'var(--accent-soft)' : 'var(--card)',
                      cursor: 'pointer', marginBottom: 14, transition: 'all .15s',
                    }}
                    onClick={() => document.getElementById('bulk-users-input').click()}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📤</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drag & drop CSV or click to browse</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Supports .csv files</div>
                    <input id="bulk-users-input" type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleBulkFile(e.target.files[0])} />
                  </div>
                  <a
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(BULK_CSV_TEMPLATE)}`}
                    download="portal-users-template.csv"
                    style={{ fontSize: 12, color: 'var(--brand)', textDecoration: 'none' }}
                  >
                    ⬇ Download CSV Template
                  </a>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--ink)' }}>Preview — {bulkPreview.length} users found</div>
                  <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 14 }}>
                    <table>
                      <thead><tr><th>Login ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Process</th><th>Designation</th></tr></thead>
                      <tbody>
                        {bulkPreview.map((u, i) => (
                          <tr key={i}>
                            <td style={{ fontSize: 12 }}>{u.loginId}</td>
                            <td style={{ fontSize: 12 }}>{u.name}</td>
                            <td style={{ fontSize: 12 }}>{u.role}</td>
                            <td style={{ fontSize: 12 }}>{u.branch || '—'}</td>
                            <td style={{ fontSize: 12 }}>{u.process || '—'}</td>
                            <td style={{ fontSize: 12 }}>{u.designation || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn" onClick={submitBulkImport} disabled={bulkLoading} style={{ flex: 1 }}>
                      {bulkLoading ? 'Creating...' : `Create ${bulkPreview.length} Users`}
                    </button>
                    <button className="btn secondary" onClick={() => setBulkPreview(null)}>Re-upload</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reset PIN / Password Modal */}
      {resetTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setResetTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <b>{resetTarget.role === 'Admin' ? 'Reset Password' : 'Reset PIN'} — {resetTarget.loginId}</b>
              <button className="btn small secondary" onClick={() => setResetTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={submitPinReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label>{resetTarget.role === 'Admin' ? 'New Password *' : 'New PIN *'}</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Min 4 characters"
                    value={newPin}
                    onChange={e => setNewPin(e.target.value)}
                    required
                  />
                </div>
                <button className="btn" type="submit">Set New {resetTarget.role === 'Admin' ? 'Password' : 'PIN'}</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Role Modal ── */}
      {roleChangeTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setRoleChangeTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <b>Change Role — {roleChangeTarget.loginId}</b>
              <button className="btn small secondary" onClick={() => setRoleChangeTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleRoleChange} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Current role info */}
                <div style={{ background: 'var(--card)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>Current role: </span>
                  <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{roleChangeTarget.role}</span>
                  <span style={{ margin: '0 8px', color: 'var(--muted)' }}>→</span>
                  <span style={{ fontWeight: 700, color: 'var(--brand)' }}>{newRole}</span>
                </div>

                <div className="field" style={{ margin: 0 }}>
                  <label>New Role *</label>
                  <select className="select" value={newRole} onChange={e => setNewRole(e.target.value)} required>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                {/* Cross-table warning + new PIN prompt */}
                {newRole !== roleChangeTarget.role && (roleChangeTarget.role === 'Admin') !== (newRole === 'Admin') && (
                  <div style={{ background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.3)', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
                    <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                      {newRole === 'Admin'
                        ? '⚠ Promoting to Admin — this creates an Admin portal account.'
                        : '⚠ Removing Admin access — this creates a Coordinator portal account.'}
                    </div>
                    <div style={{ color: '#78350f', fontSize: 12, lineHeight: 1.5 }}>
                      {newRole === 'Admin'
                        ? 'The user will log in via the Admin portal with a password. Their coordinator account will be deactivated.'
                        : 'The user will log in via the Coordinator portal with a PIN. Their admin account will be deactivated.'}
                    </div>
                    <div className="field" style={{ margin: '12px 0 0' }}>
                      <label style={{ fontSize: 12 }}>New {newRole === 'Admin' ? 'Password' : 'PIN'} for {newRole} access *</label>
                      <input
                        className="input"
                        type="password"
                        placeholder={`Min 4 characters — ${newRole === 'Admin' ? 'Admin password' : 'Coordinator PIN'}`}
                        value={roleChangePin}
                        onChange={e => setRoleChangePin(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}

                {newRole === roleChangeTarget.role && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                    Select a different role to make a change.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn" type="submit" disabled={roleChangeLoading || newRole === roleChangeTarget.role} style={{ flex: 1 }}>
                    {roleChangeLoading ? 'Changing…' : `Change to ${newRole}`}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setRoleChangeTarget(null)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
