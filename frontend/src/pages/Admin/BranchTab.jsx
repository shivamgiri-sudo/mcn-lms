import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

export default function BranchTab() {
  const [branches, setBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('users');
  const [msg, setMsg] = useState({ text: '', ok: true });

  useEffect(() => { loadBranches(); }, []);

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 5000); }

  async function loadBranches() {
    setLoading(true);
    const res = await api.get('/admin/branches', 'admin');
    setLoading(false);
    if (res.ok) setBranches(res.data);
    else toast(res.message || 'Failed to load branches.', false);
  }

  async function loadBranchDetail(branch) {
    setSelected(branch);
    setDetail(null);
    const res = await api.get(`/admin/branches/${encodeURIComponent(branch)}`, 'admin');
    if (res.ok) setDetail(res.data);
  }

  const riskColor = r => r === 'CRITICAL' ? 'crit' : r === 'HIGH' ? 'bad' : r === 'MEDIUM' ? 'warn' : 'ok';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Branch Management</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>View branches, assigned processes, coordinators and trainees.</p>
        </div>
        <button className="btn small secondary" onClick={loadBranches}>↺ Refresh</button>
      </div>

      {msg.text && (
        <div className={`toast ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 8, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg({ text: '', ok: true })}>✕</button>
        </div>
      )}

      {loading && <div style={{ color: 'var(--muted)', padding: '40px', textAlign: 'center' }}>Loading branches...</div>}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14 }}>
          {/* Branch list */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>
              {branches.length} Branch{branches.length !== 1 ? 'es' : ''}
            </div>
            {branches.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--card)', borderRadius: 14, border: '1.5px dashed var(--line)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🏢</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>No branches found</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Branches appear here once batches or coordinators are assigned to them.</div>
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {branches.map(b => (
                <div
                  key={b.branch}
                  onClick={() => loadBranchDetail(b.branch)}
                  style={{
                    padding: '14px 16px', borderRadius: 12, border: '1.5px solid',
                    borderColor: selected === b.branch ? '#2563eb' : 'var(--line)',
                    background: selected === b.branch ? 'rgba(37,99,235,.15)' : 'var(--card-solid)',
                    cursor: 'pointer', transition: 'all .12s',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, color: selected === b.branch ? '#60a5fa' : 'var(--ink)' }}>
                    🏢 {b.branch}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    {b.processes.length > 0 ? b.processes.join(', ') : 'No processes'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(22,163,74,.18)', color: '#4ade80' }}>
                      {b.activeBatches} active batch{b.activeBatches !== 1 ? 'es' : ''}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(29,78,216,.18)', color: '#60a5fa' }}>
                      {b.users.length} user{b.users.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail panel */}
          <div>
            {!selected && (
              <div style={{ display: 'grid', placeItems: 'center', minHeight: 320, background: 'var(--card)', borderRadius: 16, border: '1.5px dashed var(--line)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>←</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>Select a branch to view details</div>
                </div>
              </div>
            )}

            {selected && !detail && (
              <div style={{ display: 'grid', placeItems: 'center', minHeight: 200 }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading...</div>
              </div>
            )}

            {selected && detail && (
              <div>
                {/* Banner */}
                <div style={{
                  background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
                  borderRadius: 14, padding: '18px 22px', marginBottom: 16,
                }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .5 }}>Branch</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginTop: 4 }}>🏢 {detail.branch}</div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>{detail.batches.length} batches total</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>·</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>{detail.users.length} portal users</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>·</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>{detail.trainees.length} active trainees</span>
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--card)', borderRadius: 10, padding: 4 }}>
                  {[['users', `Users (${detail.users.length})`], ['batches', `Batches (${detail.batches.length})`], ['trainees', `Trainees (${detail.trainees.length})`]].map(([k, label]) => (
                    <button key={k} onClick={() => setDetailTab(k)} style={{
                      flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: detailTab === k ? 'var(--card-solid)' : 'transparent',
                      color: detailTab === k ? 'var(--ink)' : 'var(--muted)',
                      fontWeight: detailTab === k ? 700 : 500, fontSize: 12,
                      boxShadow: detailTab === k ? 'var(--shadow-sm)' : 'none', transition: 'all .12s',
                    }}>{label}</button>
                  ))}
                </div>

                {/* Users tab */}
                {detailTab === 'users' && (
                  <div>
                    {detail.users.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '32px', background: 'var(--card)', borderRadius: 12, border: '1.5px dashed var(--line)' }}>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>No portal users assigned to this branch.</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Go to Users tab to assign a user to this branch.</div>
                      </div>
                    )}
                    <div style={{ display: 'grid', gap: 8 }}>
                      {detail.users.map(u => (
                        <div key={u.loginId} style={{
                          background: 'var(--card-solid)', borderRadius: 12, border: '1px solid var(--line)',
                          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14,
                        }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(29,78,216,.2)', color: '#60a5fa', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>
                            {(u.name || u.loginId).slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{u.name || u.loginId}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                              {u.loginId} · {u.role}{u.process ? ` · ${u.process}` : ''}
                            </div>
                          </div>
                          <span className="pill info" style={{ fontSize: 10 }}>{u.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Batches tab */}
                {detailTab === 'batches' && (
                  <div className="table-wrap">
                    {detail.batches.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)', fontSize: 13 }}>No batches for this branch.</div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Batch No</th>
                            <th>Process / LOB</th>
                            <th>Coordinator</th>
                            <th>Trainees</th>
                            <th>Start Date</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.batches.map(b => (
                            <tr key={b.batchNo}>
                              <td><b style={{ fontSize: 12 }}>{b.batchNo}</b></td>
                              <td style={{ fontSize: 12 }}>{b.process}{b.lob ? ` / ${b.lob}` : ''}</td>
                              <td style={{ fontSize: 12 }}>{b.coordinatorName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{b.totalTrainees}</td>
                              <td style={{ fontSize: 12 }}>{b.startDate ? new Date(b.startDate).toLocaleDateString('en-IN') : '—'}</td>
                              <td>
                                <span className={`pill ${b.batchStatus === 'Active' ? 'ok' : b.batchStatus === 'Completed' ? 'info' : 'warn'}`}>
                                  {b.batchStatus}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Trainees tab */}
                {detailTab === 'trainees' && (
                  <div className="table-wrap">
                    {detail.trainees.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)', fontSize: 13 }}>No active trainees in this branch.</div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Employee ID</th>
                            <th>Name</th>
                            <th>Batch</th>
                            <th>Process</th>
                            <th>Course %</th>
                            <th>Risk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.trainees.map(t => (
                            <tr key={t.employeeId}>
                              <td>
                                <span style={{ fontFamily: 'monospace', fontSize: 12 }}><b>{t.employeeId}</b></span>
                                {t.empIdType === 'TEMP' && (
                                  <span style={{ marginLeft: 6, background: '#d97706', color: '#fff', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px' }}>TEMP</span>
                                )}
                              </td>
                              <td style={{ fontSize: 12 }}>{t.traineeName}</td>
                              <td style={{ fontSize: 12 }}>{t.batchNo || '—'}</td>
                              <td style={{ fontSize: 12 }}>{t.process || '—'}</td>
                              <td style={{ fontSize: 12 }}>{Math.round(t.courseCompletionPct || 0)}%</td>
                              <td><span className={`pill ${riskColor(t.riskStatus)}`} style={{ fontSize: 10 }}>{t.riskStatus}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
