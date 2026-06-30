import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

function HrmsMapping({ onToast }) {
  const [status, setStatus] = useState(null);
  const [detected, setDetected] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState('');

  async function load() {
    setLoading(true);
    const [s, d, c] = await Promise.all([
      api.get('/admin/hrms/status', 'admin'),
      api.get('/admin/hrms/detect', 'admin'),
      api.get('/admin/hrms/config', 'admin'),
    ]);
    if (s.ok) setStatus(s.data);
    if (d.ok) setDetected(d.data || []);
    if (c.ok) setConfig(c.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function getEntityConfig(entity) {
    return config?.[entity] || { table: '', cols: {} };
  }

  function setEntityTable(entity, table) {
    const detectedTable = detected.find(d => d.table === table);
    const guess = detectedTable?.guess;
    const newConfig = { ...config };
    newConfig[entity] = { table, cols: guess?.cols || {} };
    setConfig(newConfig);
  }

  function setEntityCol(entity, target, source) {
    const newConfig = { ...config };
    if (!newConfig[entity]) newConfig[entity] = { table: '', cols: {} };
    newConfig[entity].cols = { ...newConfig[entity].cols, [target]: source };
    setConfig(newConfig);
  }

  async function saveConfig() {
    if (!config) return;
    const res = await api.put('/admin/hrms/config', { mapping: config }, 'admin');
    if (res.ok) onToast('HRMS mapping config saved.', true);
    else onToast(res.message || 'Failed to save config.', false);
  }

  async function doSync(entity) {
    const endpoint = { branch: 'branches', department: 'departments', designation: 'designations' }[entity];
    setSyncing(entity);
    const res = await api.post(`/admin/hrms/sync/${endpoint}`, {}, 'admin');
    setSyncing('');
    if (res.ok) onToast(`${entity}: ${res.message}`, true);
    else onToast(res.message || `Failed to sync ${entity}.`, false);
  }

  const entities = [
    { key: 'branch', label: 'Branch', cols: [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'active', label: 'Active' }] },
    { key: 'department', label: 'Department', cols: [{ key: 'name', label: 'Name' }, { key: 'active', label: 'Active' }] },
    { key: 'designation', label: 'Designation', cols: [{ key: 'title', label: 'Title' }, { key: 'active', label: 'Active' }] },
  ];

  const statusIcon = status?.reachable ? '\u2705' : '\u274C';

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>HRMS Sync Configuration</h3>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, fontSize: 13 }}>
        <span>{statusIcon} <b>mas_hrms</b>: {status?.reachable ? `Connected (${status.tables} tables)` : status?.message || 'Checking...'}</span>
        <button className="btn xs secondary" onClick={load} disabled={loading}>Refresh Status</button>
      </div>

      {status?.tablesList?.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Available tables: {status.tablesList.join(', ')}
        </div>
      )}

      {entities.map(entity => {
        const ecfg = getEntityConfig(entity.key);
        const tableCols = detected.find(d => d.table === ecfg.table)?.columns || [];
        return (
          <div key={entity.key} style={{ marginBottom: 16, padding: 12, background: 'var(--bg2, #f5f5f5)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b>{entity.label}</b>
              <button className="btn xs accent" disabled={syncing === entity.key} onClick={() => doSync(entity.key)}>
                {syncing === entity.key ? 'Syncing...' : `Sync Now`}
              </button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="field">
                <label style={{ fontSize: 12 }}>Source Table</label>
                <select className="input" value={ecfg.table} onChange={e => setEntityTable(entity.key, e.target.value)}>
                  <option value="">(select table)</option>
                  {(detected.length ? detected : (status?.tablesList || []).map(t => ({ table: t, columns: [] }))).map(d => (
                    <option key={d.table} value={d.table}>{d.table}</option>
                  ))}
                </select>
              </div>
              {ecfg.table && (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${entity.cols.length}, 1fr)`, gap: 8 }}>
                  {entity.cols.map(col => (
                    <div key={col.key} className="field">
                      <label style={{ fontSize: 12 }}>{col.label} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>&#8594; {col.key}</span></label>
                      <select className="input" value={ecfg.cols?.[col.key] || ''} onChange={e => setEntityCol(entity.key, col.key, e.target.value)}>
                        <option value="">(map column)</option>
                        {tableCols.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={saveConfig}>Save Mapping Config</button>
      </div>
    </div>
  );
}

function MasterTable({ title, icon, items, columns, onAdd, onEdit, onDelete, loading }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 16, border: '1px solid var(--line)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{icon} {title}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{items.length} entries</span>
        </div>
        <button className="btn xs" style={{ background: '#1d4ed8', borderRadius: 10, padding: '6px 12px', fontSize: 12 }} onClick={onAdd}>+ Add</button>
      </div>
      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)', fontSize: 13 }}>No entries yet</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--card-solid)' }}>
              {columns.map(c => <th key={c.key} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5 }}>{c.label}</th>)}
              <th style={{ padding: '10px 16px', width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} style={{ borderTop: '1px solid var(--line)', background: i % 2 === 0 ? 'transparent' : 'var(--card-solid)' }}>
                {columns.map(c => (
                  <td key={c.key} style={{ padding: '10px 16px', color: 'var(--ink)' }}>
                    {c.key === 'active' ? (
                      <span className={`pill ${item.active ? 'ok' : 'bad'}`} style={{ fontSize: 10 }}>{item.active ? 'Active' : 'Inactive'}</span>
                    ) : (item[c.key] || '—')}
                  </td>
                ))}
                <td style={{ padding: '10px 16px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn xs secondary" onClick={() => onEdit(item)}>Edit</button>
                    <button className="btn xs danger" onClick={() => onDelete(item)}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FieldModal({ title, fields, initial, onClose, onSave, loading }) {
  const [form, setForm] = useState(initial || {});
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <b>{title}</b>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form onSubmit={e => { e.preventDefault(); onSave(form); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map(f => (
              <div key={f.key} className="field">
                <label>{f.label}{f.required ? ' *' : ''}</label>
                {f.type === 'checkbox' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.checked }))} />
                    <span style={{ fontSize: 13, color: 'var(--ink)' }}>{f.checkLabel || 'Active'}</span>
                  </label>
                ) : (
                  <input
                    className="input"
                    placeholder={f.placeholder || ''}
                    value={form[f.key] || ''}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    required={f.required}
                  />
                )}
              </div>
            ))}
            <button className="btn" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? 'Saving...' : 'Save'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function OrgTab() {
  const [branches, setBranches] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [modal, setModal] = useState(null); // { type, item }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 5000); }

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [b, d, dep] = await Promise.all([
      api.get('/admin/org/branches', 'admin'),
      api.get('/admin/org/designations', 'admin'),
      api.get('/admin/org/departments', 'admin'),
    ]);
    if (b.ok) setBranches(b.data);
    if (d.ok) setDesignations(d.data);
    if (dep.ok) setDepartments(dep.data);
  }

  async function handleSave(form) {
    if (!modal) return;
    const { type, item } = modal;
    const endpoint = {
      branch: '/admin/org/branches',
      designation: '/admin/org/designations',
      department: '/admin/org/departments',
    }[type];

    setSaving(true);
    let res;
    if (item?.id) {
      res = await api.put(`${endpoint}/${item.id}`, form, 'admin');
    } else {
      res = await api.post(endpoint, form, 'admin');
    }
    setSaving(false);
    if (res.ok) {
      toast(item?.id ? 'Updated.' : 'Created.');
      setModal(null);
      loadAll();
    } else {
      toast(res.message || 'Failed.', false);
    }
  }

  async function handleDelete(type, item) {
    const label = item.branchName || item.title || item.name;
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    const endpoint = {
      branch: '/admin/org/branches',
      designation: '/admin/org/designations',
      department: '/admin/org/departments',
    }[type];
    const res = await api.delete(`${endpoint}/${item.id}`, 'admin');
    if (res.ok) { toast('Deleted.'); loadAll(); }
    else toast(res.message || 'Failed.', false);
  }

  const branchFields = [
    { key: 'branchName', label: 'Branch Name', required: true, placeholder: 'e.g. Bangalore' },
    { key: 'branchCode', label: 'Branch Code', placeholder: 'e.g. BLR' },
    { key: 'city', label: 'City', placeholder: 'e.g. Bangalore' },
    { key: 'state', label: 'State', placeholder: 'e.g. Karnataka' },
    { key: 'active', label: 'Status', type: 'checkbox', checkLabel: 'Active' },
  ];
  const designationFields = [
    { key: 'title', label: 'Designation Title', required: true, placeholder: 'e.g. Training Coordinator' },
    { key: 'department', label: 'Department', placeholder: 'e.g. Training & Development' },
    { key: 'active', label: 'Status', type: 'checkbox', checkLabel: 'Active' },
  ];
  const departmentFields = [
    { key: 'name', label: 'Department Name', required: true, placeholder: 'e.g. Training & Development' },
    { key: 'active', label: 'Status', type: 'checkbox', checkLabel: 'Active' },
  ];

  const getInitial = (type, item) => {
    if (!item) {
      if (type === 'branch') return { active: true };
      return { active: true };
    }
    return { ...item };
  };

  const getFields = type => ({ branch: branchFields, designation: designationFields, department: departmentFields }[type]);
  const getTitle = (type, editing) => {
    const labels = { branch: 'Branch', designation: 'Designation', department: 'Department' };
    return `${editing ? 'Edit' : 'Add'} ${labels[type]}`;
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Organization</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Manage branches, designations, and departments used across the system.</p>
      </div>

      {msg.text && (
        <div className={`toast ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 8, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg({ text: '', ok: true })}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 20 }}>
        <MasterTable
          title="Branches"
          icon="🌿"
          items={branches}
          columns={[
            { key: 'branchName', label: 'Branch Name' },
            { key: 'branchCode', label: 'Code' },
            { key: 'city', label: 'City' },
            { key: 'state', label: 'State' },
            { key: 'active', label: 'Status' },
          ]}
          onAdd={() => setModal({ type: 'branch', item: null })}
          onEdit={item => setModal({ type: 'branch', item })}
          onDelete={item => handleDelete('branch', item)}
        />

        <MasterTable
          title="Designations"
          icon="🎯"
          items={designations}
          columns={[
            { key: 'title', label: 'Designation' },
            { key: 'department', label: 'Department' },
            { key: 'active', label: 'Status' },
          ]}
          onAdd={() => setModal({ type: 'designation', item: null })}
          onEdit={item => setModal({ type: 'designation', item })}
          onDelete={item => handleDelete('designation', item)}
        />

        <MasterTable
          title="Departments"
          icon="🏬"
          items={departments}
          columns={[
            { key: 'name', label: 'Department Name' },
            { key: 'active', label: 'Status' },
          ]}
          onAdd={() => setModal({ type: 'department', item: null })}
          onEdit={item => setModal({ type: 'department', item })}
          onDelete={item => handleDelete('department', item)}
        />
      </div>

      <HrmsMapping onToast={(text, ok) => toast(text, ok)} />

      {modal && (
        <FieldModal
          title={getTitle(modal.type, !!modal.item?.id)}
          fields={getFields(modal.type)}
          initial={getInitial(modal.type, modal.item)}
          onClose={() => setModal(null)}
          onSave={handleSave}
          loading={saving}
        />
      )}
    </div>
  );
}
