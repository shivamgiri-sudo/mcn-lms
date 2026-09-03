import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { BranchSelect, ProcessSelect, LobSelect } from '../../components/OrgSelect.jsx';

const PAGE_SIZE = 25;

export default function LeaderboardTab() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ batchNo: '', branch: '', process: '', lob: '' });

  useEffect(() => { load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(nextOffset = offset) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    params.set('limit', PAGE_SIZE);
    params.set('offset', nextOffset);
    const res = await api.get(`/admin/leaderboard?${params.toString()}`, 'admin');
    setLoading(false);
    if (res.ok) {
      setRows(res.data.rows);
      setTotal(res.data.total);
      setOffset(nextOffset);
    } else setError(res.message || 'Could not load leaderboard.');
  }

  function updateFilter(key, value) { setFilters(f => ({ ...f, [key]: value })); }
  function applyFilters(event) { event.preventDefault(); load(0); }
  function resetFilters() { setFilters({ batchNo: '', branch: '', process: '', lob: '' }); setTimeout(() => load(0), 0); }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>🏆 Leaderboard</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Trainee engagement points and badges — sortable by points, filterable by batch/branch/process/LOB.</p>
        </div>
        <button className="btn small secondary" onClick={() => load(offset)}>↺ Refresh</button>
      </div>

      <form onSubmit={applyFilters} className="card" style={{ padding: '14px 16px', marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field">
          <label>Batch No</label>
          <input className="input" value={filters.batchNo} onChange={e => updateFilter('batchNo', e.target.value)} placeholder="e.g. ONF_KYC_MAY'26_001" />
        </div>
        <div className="field">
          <label>Branch</label>
          <BranchSelect value={filters.branch} onChange={next => updateFilter('branch', next)} placeholder="All branches" />
        </div>
        <div className="field">
          <label>Process</label>
          <ProcessSelect value={filters.process} onChange={next => updateFilter('process', next)} placeholder="All processes" />
        </div>
        <div className="field">
          <label>LOB</label>
          <LobSelect process={filters.process} value={filters.lob} onChange={next => updateFilter('lob', next)} placeholder="All LOBs" />
        </div>
        <button className="btn small" type="submit">Apply</button>
        <button className="btn small secondary" type="button" onClick={resetFilters}>Clear</button>
      </form>

      {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="table-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Batch</th>
                <th>Branch</th>
                <th>Process</th>
                <th style={{ textAlign: 'right' }}>Course</th>
                <th style={{ textAlign: 'right' }}>Assessment</th>
                <th style={{ textAlign: 'right' }}>Attendance</th>
                <th style={{ textAlign: 'right' }}>Cert</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Badges</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No leaderboard data for this filter.</td></tr>
              )}
              {!loading && rows.map(row => (
                <tr key={row.employeeId}>
                  <td style={{ fontWeight: 900, color: row.rank <= 3 ? 'var(--warn)' : 'inherit' }}>#{row.rank}</td>
                  <td>{row.employeeId}</td>
                  <td>{row.traineeName || '—'}</td>
                  <td>{row.batchNo || '—'}</td>
                  <td>{row.branch || '—'}</td>
                  <td>{row.process || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{row.coursePoints}</td>
                  <td style={{ textAlign: 'right' }}>{row.assessmentPoints}</td>
                  <td style={{ textAlign: 'right' }}>{row.attendancePoints}</td>
                  <td style={{ textAlign: 'right' }}>{row.certificationPoints}</td>
                  <td style={{ textAlign: 'right', fontWeight: 900 }}>{row.totalPoints}</td>
                  <td>
                    {row.badges.length === 0 ? <span style={{ color: 'var(--muted)' }}>—</span> : row.badges.map(b => (
                      <span key={b.id} title={b.description} style={{ marginRight: 4 }}>🏅</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          <span>{total} trainee{total !== 1 ? 's' : ''} ranked · page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn small secondary" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>← Prev</button>
            <button className="btn small secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => load(offset + PAGE_SIZE)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
