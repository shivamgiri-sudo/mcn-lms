import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function CoordinatorsPage({ navigate }) {
  const [coords, setCoords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/coordinators', 'admin').then(r => { if (r.ok) setCoords(r.data); setLoading(false); });
  }, []);

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading...</div>;

  return (
    <div>
      <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)',marginBottom:'20px'}}>Coordinators</h2>
      {coords.length === 0 && <div className="glass-panel"><p style={{color:'var(--muted)',fontSize:'12px'}}>No active coordinators found.</p></div>}
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
