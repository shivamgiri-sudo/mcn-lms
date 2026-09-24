import { useState } from 'react';
import { api } from '../../utils/api.js';

const STATUS_COLORS = {
  'Not Started': '#6b7280',
  'In Progress': '#d97706',
  'Content Completed': '#0891b2',
  'Re-acknowledgement Required': '#dc2626',
  'Completed': '#16a34a',
};

function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color, background: `${color}1a`, whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

// On-screen counterpart to the "Module Completion Detail" CSV export — filters
// by batch/classroom (inherited from ReportsTab) plus employee, acknowledgement
// status, module version, and a date range, with batch-wise and module-wise
// summaries above the row-level detail (sections 9-13 of the acknowledgement
// reporting requirement).
export default function ModuleCompletionDetailPanel({ batchNo, classroomId }) {
  const [employeeId, setEmployeeId] = useState('');
  const [acknowledgementStatus, setAcknowledgementStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function loadReport() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (batchNo) params.set('batchNo', batchNo);
    if (classroomId) params.set('classroomId', classroomId);
    if (employeeId.trim()) params.set('employeeId', employeeId.trim());
    if (acknowledgementStatus) params.set('acknowledgementStatus', acknowledgementStatus);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const res = await api.get(`/admin/reports/module-completion-detail?${params}`, 'admin');
    if (res.ok) setData(res.data);
    else setError(res.message || 'Failed to load report.');
    setLoading(false);
  }

  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
      padding: '18px 22px', marginBottom: 24, boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>📚 Module Completion Detail — On-Screen Report</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Content completion vs. acknowledgement, filterable by employee, status, module version, and date.</div>
        </div>
        <span style={{ fontSize: 18, color: 'var(--muted)' }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Employee ID</label>
              <input className="input" value={employeeId} onChange={e => setEmployeeId(e.target.value)} placeholder="e.g. MAS12345" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Acknowledgement Status</label>
              <select className="select" value={acknowledgementStatus} onChange={e => setAcknowledgementStatus(e.target.value)}>
                <option value="">All</option>
                <option value="Not Started">Not Started</option>
                <option value="In Progress">In Progress</option>
                <option value="Content Completed">Content Completed (Ack Pending)</option>
                <option value="Re-acknowledgement Required">Re-acknowledgement Required</option>
                <option value="Completed">Acknowledged / Completed</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Date From</label>
              <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Date To</label>
              <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <button className="btn" style={{ background: '#7c3aed', padding: '8px 16px', fontSize: 12, height: 38 }} onClick={loadReport} disabled={loading}>
              {loading ? 'Loading…' : 'Load Report'}
            </button>
          </div>

          {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}

          {data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 16 }}>
                <Tile label="Total Assigned" value={data.summary.totalAssigned} />
                <Tile label="Started" value={data.summary.started} />
                <Tile label="Content Completed" value={data.summary.contentCompleted} />
                <Tile label="Acknowledged" value={data.summary.acknowledged} />
                <Tile label="Pending Ack" value={data.summary.pendingAcknowledgement} />
                <Tile label="Not Started" value={data.summary.notStarted} />
                <Tile label="Completion / Ack %" value={`${data.summary.completionPct}%`} sub={`Ack: ${data.summary.acknowledgementPct}%`} />
              </div>

              {data.modules.length > 0 && (
                <div style={{ marginBottom: 16, overflowX: 'auto' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>MODULE-WISE SUMMARY</div>
                  <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
                    <thead>
                      <tr><th>Module</th><th>Version</th><th>Assigned</th><th>Started</th><th>Completed</th><th>Acknowledged</th><th>Pending</th></tr>
                    </thead>
                    <tbody>
                      {data.modules.map(m => (
                        <tr key={`${m.moduleName}|${m.moduleVersion}`}>
                          <td>{m.moduleName}</td><td>V{m.moduleVersion}</td><td>{m.assigned}</td><td>{m.started}</td><td>{m.completed}</td><td>{m.acknowledged}</td><td>{m.pending}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
                  DETAIL — {data.rows.length} row{data.rows.length === 1 ? '' : 's'}{data.rows.length > 300 ? ' (showing first 300 — narrow filters or use CSV export for the full set)' : ''}
                </div>
                <table className="table" style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Employee ID</th><th>Name</th><th>Batch</th><th>Module</th><th>Ver</th><th>Content</th>
                      <th>Completion %</th><th>Status</th><th>Acknowledged At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 300).map((r, i) => (
                      <tr key={`${r.employeeId}-${r.classroomId}-${r.dayNo}-${r.contentTitle}-${i}`}>
                        <td>{r.employeeId}</td><td>{r.traineeName}</td><td>{r.batchNo}</td>
                        <td>{r.moduleName}</td><td>V{r.moduleVersion}</td><td>{r.contentTitle}</td>
                        <td>{r.completionPct}%</td>
                        <td><StatusPill status={r.status} /></td>
                        <td>{r.acknowledgedAt ? new Date(r.acknowledgedAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.rows.length && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No rows match these filters.</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
