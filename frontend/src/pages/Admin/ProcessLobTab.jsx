import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function ProcessLobTab() {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ process: '', lob: '', active: true, notes: '' });
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await api.get('/admin/process-lob', 'admin');
    if (r.ok) setList(r.data);
  }

  const processes = [...new Set(list.map(l => l.process))].sort();
  const selectedLobs = selected ? list.filter(l => l.process === selected) : [];

  async function save() {
    if (!form.process) return setMsg('Process name required');
    const r = editId
      ? await api.put(`/admin/process-lob/${editId}`, form, 'admin')
      : await api.post('/admin/process-lob', form, 'admin');
    if (r.ok) { setShowModal(false); setForm({ process: '', lob: '', active: true, notes: '' }); setEditId(null); load(); setMsg(''); }
    else setMsg(r.message || 'Failed');
  }

  async function deactivate(id) {
    if (!window.confirm('Deactivate this entry?')) return;
    const r = await api.delete(`/admin/process-lob/${id}`, 'admin');
    if (r.ok) load();
  }

  function openEdit(item) {
    setForm({ process: item.process, lob: item.lob || '', active: item.active, notes: item.notes || '' });
    setEditId(item.id);
    setShowModal(true);
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
        <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)'}}>Process & LOB</h2>
        <button className="btn" onClick={() => { setForm({ process: selected||'', lob: '', active: true, notes: '' }); setEditId(null); setShowModal(true); }}>+ Add</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:'16px'}}>
        <div className="glass-panel">
          <div className="panel-title">Processes</div>
          {processes.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No processes yet.</p>}
          {processes.map(p => {
            const lobCount = list.filter(l => l.process === p).length;
            const activeCount = list.filter(l => l.process === p && l.active).length;
            const isSelected = selected === p;
            return (
              <div
                key={p}
                className="ccard"
                style={{marginBottom:'8px', borderColor: isSelected ? '#60a5fa' : undefined, background: isSelected ? 'rgba(37,99,235,.18)' : undefined}}
                onClick={() => setSelected(p)}
              >
                <div style={{fontWeight:'700',fontSize:'13px',color: isSelected ? '#1d4ed8' : 'var(--ink)'}}>{p}</div>
                <div style={{fontSize:'11px',color:'var(--muted)',marginTop:'4px'}}>{lobCount} LOB{lobCount!==1?'s':''} · {activeCount} active</div>
              </div>
            );
          })}
        </div>

        <div className="glass-panel">
          <div className="panel-title">{selected ? `LOBs under "${selected}"` : 'Select a process'} <span className="panel-sub">{selectedLobs.length} entries</span></div>
          {!selected && <p style={{color:'var(--muted)',fontSize:'12px'}}>Click a process on the left to view its LOBs.</p>}
          {selected && selectedLobs.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No LOBs for this process.</p>}
          {selectedLobs.length > 0 && (
            <table className="glass-table">
              <thead><tr><th>LOB</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead>
              <tbody>
                {selectedLobs.map(item => (
                  <tr key={item.id}>
                    <td style={{fontWeight:'600'}}>{item.lob || '(no LOB)'}</td>
                    <td><span className={`pill ${item.active?'ok':'bad'}`}>{item.active?'Active':'Inactive'}</span></td>
                    <td style={{color:'var(--muted)',fontSize:'11px'}}>{item.notes || '—'}</td>
                    <td>
                      <button className="btn-dark" style={{marginRight:'6px'}} onClick={() => openEdit(item)}>Edit</button>
                      <button className="btn-dark danger" onClick={() => deactivate(item.id)}>Deactivate</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{maxWidth:440}} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>{editId ? 'Edit Entry' : 'Add Process / LOB'}</b>
              <button className="btn small secondary" onClick={() => setShowModal(false)}>Close</button>
            </div>
            <div className="modal-body">
              {msg && <div className="toast bad" style={{marginBottom:'16px'}}>{msg}</div>}
              {[['Process Name', 'process'], ['LOB Name', 'lob'], ['Notes', 'notes']].map(([label, key]) => (
                <div key={key} className="field">
                  <label>{label}</label>
                  <input
                    className="input"
                    value={form[key]}
                    onChange={e => setForm(f => ({...f,[key]:e.target.value}))}
                  />
                </div>
              ))}
              <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer',margin:'14px 0 20px',fontSize:'13px',color:'var(--ink)'}}>
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({...f,active:e.target.checked}))} />
                Active
              </label>
              <div style={{display:'flex',gap:'10px'}}>
                <button className="btn" onClick={save}>Save</button>
                <button className="btn secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
