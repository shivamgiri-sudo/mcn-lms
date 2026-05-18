import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import BatchCreationWizard from './BatchCreationWizard.jsx';

export default function BatchesPage({ navigate }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });

  function load() {
    api.get('/admin/batches', 'admin').then(r => { if (r.ok) setBatches(r.data); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 5000); }

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    const res = await api.delete(`/admin/batches/${encodeURIComponent(confirmDelete.batchNo)}`, 'admin');
    setDeleting(false);
    setConfirmDelete(null);
    if (res.ok) { toast(`Batch ${confirmDelete.batchNo} deleted.`); load(); }
    else toast(res.message || 'Delete failed.', false);
  }

  if (loading) return <div style={{color:'var(--muted)',padding:'40px',textAlign:'center'}}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{fontSize:'20px',fontWeight:'900',color:'var(--ink)',margin:0}}>Batches</h2>
        <button className="btn" onClick={() => setShowWizard(true)}>+ New Batch</button>
      </div>
      {showWizard && <BatchCreationWizard onClose={() => setShowWizard(false)} onCreated={load} />}

      {msg.text && (
        <div className={`toast ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}

      <div className="glass-panel">
        {batches.length === 0 && <p style={{color:'var(--muted)',fontSize:'12px'}}>No batches found.</p>}
        {batches.length > 0 && (
          <table className="glass-table">
            <thead><tr><th>Batch No</th><th>Name</th><th>Status</th><th>Coordinator</th><th>Trainees</th><th>Course Avg</th><th>At Risk</th><th>Start</th><th>Actions</th></tr></thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.batchNo}>
                  <td style={{fontWeight:'600', cursor:'pointer', color:'var(--brand)'}} onClick={() => navigate('batch-detail', { batchNo: b.batchNo })}>{b.batchNo}</td>
                  <td style={{cursor:'pointer'}} onClick={() => navigate('batch-detail', { batchNo: b.batchNo })}>{b.batchName}</td>
                  <td><span className={`pill ${b.batchStatus==='Active'?'ok':b.batchStatus==='Completed'?'info':'warn'}`}>{b.batchStatus}</span></td>
                  <td>{b.coordinatorName || '—'}</td>
                  <td>{b.traineeCount}</td>
                  <td>{b.avgCourse}%</td>
                  <td>{b.atRiskCount > 0 ? <span className="pill bad">{b.atRiskCount}</span> : <span style={{color:'var(--muted-2)'}}>0</span>}</td>
                  <td>{b.startDate ? new Date(b.startDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td>
                    <button
                      className="btn xs danger"
                      onClick={e => { e.stopPropagation(); setConfirmDelete(b); }}
                      title="Delete batch and all its data"
                    >
                      🗑 Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !deleting && setConfirmDelete(null)}>
          <div className="modal-box" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <b style={{ color: 'var(--bad)' }}>Delete Batch</b>
              <button className="btn small secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.35)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <b style={{ color: '#f87171', fontSize: 14 }}>⚠ This action cannot be undone.</b>
                <p style={{ fontSize: 13, color: '#fca5a5', marginTop: 6, lineHeight: 1.5 }}>
                  Deleting batch <b>{confirmDelete.batchNo}</b> will permanently remove:
                </p>
                <ul style={{ fontSize: 13, color: '#fca5a5', marginTop: 6, paddingLeft: 18, lineHeight: 1.8 }}>
                  <li>All {confirmDelete.traineeCount || 0} trainees in this batch</li>
                  <li>All attendance records</li>
                  <li>All onboarding logs</li>
                  <li>All classroom assignments</li>
                </ul>
              </div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Type the batch number to confirm: <b>{confirmDelete.batchNo}</b>
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn secondary small" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</button>
                <button className="btn danger small" onClick={doDelete} disabled={deleting} style={{ background: '#b91c1c', color: '#fff' }}>
                  {deleting ? 'Deleting...' : 'Yes, Delete Batch'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
