import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function AuditLogTab() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({ action: '', module: '', userIdentity: '', userRole: '', status: '' });
  const [loading, setLoading] = useState(false);

  async function load(p = page) {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.action) params.set('action', filters.action);
    if (filters.module) params.set('module', filters.module);
    if (filters.userIdentity) params.set('userIdentity', filters.userIdentity);
    if (filters.userRole) params.set('userRole', filters.userRole);
    if (filters.status) params.set('status', filters.status);
    params.set('page', p);
    params.set('limit', '50');
    const res = await api.get(`/admin/audit-logs?${params.toString()}`, 'admin');
    if (res.ok) { setLogs(res.data); setTotal(res.total); setPage(res.page); }
    setLoading(false);
  }

  useEffect(() => { load(1); }, []);

  async function openDetail(id) {
    const res = await api.get(`/admin/audit-logs/${id}`, 'admin');
    if (res.ok) setDetail(res.data);
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Audit Log Viewer</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="input" style={{ width: 140, fontSize: 12 }} placeholder="Action" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} />
        <input className="input" style={{ width: 120, fontSize: 12 }} placeholder="Module" value={filters.module} onChange={e => setFilters(f => ({ ...f, module: e.target.value }))} />
        <input className="input" style={{ width: 140, fontSize: 12 }} placeholder="User" value={filters.userIdentity} onChange={e => setFilters(f => ({ ...f, userIdentity: e.target.value }))} />
        <input className="input" style={{ width: 120, fontSize: 12 }} placeholder="Role" value={filters.userRole} onChange={e => setFilters(f => ({ ...f, userRole: e.target.value }))} />
        <select className="input" style={{ width: 100, fontSize: 12 }} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Status</option>
          <option value="Success">Success</option>
          <option value="Failed">Failed</option>
        </select>
        <button className="btn small" onClick={() => load(1)}>Search</button>
        <button className="btn small secondary" onClick={() => { setFilters({ action: '', module: '', userIdentity: '', userRole: '', status: '' }); setTimeout(() => load(1), 0); }}>Clear</button>
      </div>
      {loading && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading...</p>}
      {!loading && <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Ref ID</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                <td style={{ fontSize: 12 }}>{l.userIdentity}</td>
                <td style={{ fontSize: 12 }}>{l.userRole}</td>
                <td style={{ fontSize: 12, fontWeight: 600 }}>{l.action}</td>
                <td style={{ fontSize: 12 }}>{l.module || '—'}</td>
                <td style={{ fontSize: 11 }}>{l.referenceId || '—'}</td>
                <td><span className={`pill ${l.status === 'Success' ? 'ok' : 'bad'}`} style={{ fontSize: 10 }}>{l.status}</span></td>
                <td><button className="btn small" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => openDetail(l.id)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && <p style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>No logs found.</p>}
      </div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="btn small secondary" disabled={page <= 1} onClick={() => load(page - 1)}>← Prev</button>
        <span style={{ fontSize: 12 }}>Page {page} / {Math.ceil(total / 50)}</span>
        <button className="btn small secondary" disabled={page >= Math.ceil(total / 50)} onClick={() => load(page + 1)}>Next →</button>
      </div>
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-head"><b>Audit Log Detail</b><button className="btn small secondary" onClick={() => setDetail(null)}>✕</button></div>
            <div className="modal-body" style={{ padding: '16px 20px', fontSize: 13, lineHeight: 1.8 }}>
              <div><b>ID:</b> {detail.id}</div>
              <div><b>User:</b> {detail.userIdentity} <span style={{ color: 'var(--muted)' }}>({detail.userRole})</span></div>
              <div><b>Action:</b> {detail.action}</div>
              <div><b>Module:</b> {detail.module || '—'}</div>
              <div><b>Reference:</b> {detail.referenceId || '—'}</div>
              <div><b>Status:</b> {detail.status}</div>
              <div><b>Source:</b> {detail.source || '—'}</div>
              <div><b>Time:</b> {new Date(detail.createdAt).toLocaleString('en-IN')}</div>
              {detail.oldValue && <div><b>Old Value:</b><pre style={{ background: 'rgba(0,0,0,.05)', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 4, maxHeight: 120, overflow: 'auto' }}>{(() => { try { return JSON.stringify(JSON.parse(detail.oldValue), null, 2); } catch { return detail.oldValue; } })()}</pre></div>}
              {detail.newValue && <div><b>New Value:</b><pre style={{ background: 'rgba(0,0,0,.05)', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 4, maxHeight: 120, overflow: 'auto' }}>{(() => { try { return JSON.stringify(JSON.parse(detail.newValue), null, 2); } catch { return detail.newValue; } })()}</pre></div>}
              {detail.errorDetails && <div><b>Error:</b><pre style={{ background: 'rgba(220,38,38,.1)', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 4 }}>{detail.errorDetails}</pre></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
