import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const EMPTY_FORM = { loginId: '', pin: '', name: '', branch: '', process: '', lob: '',
  canCreateBatch: false, canOnboardTrainee: false, canUploadLmsReport: false,
  canOverrideAttendance: false, canCloseBatch: false };

export default function CoordinatorsPage({ navigate }) {
  const [coords, setCoords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/admin/coordinators', 'admin').then(r => { if (r.ok) setCoords(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.loginId || !form.pin || !form.name) { setError('Login ID, PIN and Name are required.'); return; }
    setSaving(true);
    const r = await api.post('/admin/coordinators', form, 'admin');
    setSaving(false);
    if (r.ok) {
      setSuccess(`Coordinator "${form.name}" created successfully.`);
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } else {
      setError(r.message || 'Failed to create coordinator.');
    }
  };

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading...</div>;

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
        <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)',margin:0}}>Coordinators</h2>
        <button className="btn-primary" onClick={() => { setShowForm(v => !v); setError(''); setSuccess(''); }}>
          {showForm ? 'Cancel' : '+ New Coordinator'}
        </button>
      </div>

      {success && <div style={{background:'rgba(34,197,94,.15)',border:'1px solid rgba(34,197,94,.3)',borderRadius:'8px',padding:'10px 14px',color:'#22c55e',fontSize:'13px',marginBottom:'16px'}}>{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="glass-panel" style={{marginBottom:'24px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div style={{gridColumn:'1/-1',fontWeight:'700',fontSize:'14px',color:'var(--ink)'}}>New Coordinator</div>

          {error && <div style={{gridColumn:'1/-1',color:'#f87171',fontSize:'12px'}}>{error}</div>}

          {[['loginId','Login ID'],['pin','PIN (min 4 chars)'],['name','Full Name'],['branch','Branch'],['process','Process'],['lob','LOB']].map(([key,label]) => (
            <div key={key}>
              <label style={{fontSize:'11px',color:'var(--muted)',display:'block',marginBottom:'4px'}}>{label}</label>
              <input
                name={key} value={form[key]} onChange={handleChange}
                type={key === 'pin' ? 'password' : 'text'}
                style={{width:'100%',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'6px',padding:'7px 10px',color:'var(--ink)',fontSize:'13px',boxSizing:'border-box'}}
              />
            </div>
          ))}

          <div style={{gridColumn:'1/-1'}}>
            <div style={{fontSize:'11px',color:'var(--muted)',marginBottom:'8px'}}>Permissions</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'12px'}}>
              {[['canCreateBatch','Create Batch'],['canOnboardTrainee','Onboard Trainee'],['canUploadLmsReport','Upload LMS Report'],['canOverrideAttendance','Override Attendance'],['canCloseBatch','Close Batch']].map(([key,label]) => (
                <label key={key} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--ink)',cursor:'pointer'}}>
                  <input type="checkbox" name={key} checked={form[key]} onChange={handleChange} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{gridColumn:'1/-1',display:'flex',justifyContent:'flex-end'}}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create Coordinator'}</button>
          </div>
        </form>
      )}

      {coords.length === 0 && !showForm && <div className="glass-panel"><p style={{color:'var(--muted)',fontSize:'12px'}}>No active coordinators found.</p></div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'12px'}}>
        {coords.map(c => (
          <div key={c.coordinatorLoginId} className="ccard" onClick={() => navigate('coord-detail', { loginId: c.coordinatorLoginId, coordinatorName: c.coordinatorName })}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
              <span style={{fontSize:'14px',fontWeight:'800',color:'var(--ink)'}}>{c.coordinatorName || c.coordinatorLoginId}</span>
              <span className="pill info">Active</span>
            </div>
            <div style={{fontSize:'11px',color:'var(--muted)'}}>{c.batches.length} batch{c.batches.length !== 1 ? 'es' : ''}</div>
            <div style={{marginTop:'8px',display:'flex',flexWrap:'wrap',gap:'4px'}}>
              {c.batches.map(b => (
                <span key={b.batchNo} style={{fontSize:'10px',background:'rgba(29,78,216,.18)',border:'1px solid rgba(96,165,250,.25)',borderRadius:'6px',padding:'2px 8px',color:'#60a5fa',fontWeight:'600'}}>
                  {b.batchNo}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
