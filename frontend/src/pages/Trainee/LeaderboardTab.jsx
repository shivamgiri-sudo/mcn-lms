import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

function RankPill({ rank }) {
  if (!rank) return <span className="pill">Unranked</span>;
  const cls = rank === 1 ? 'ok' : rank <= 3 ? 'warn' : '';
  return <span className={`pill ${cls}`}>#{rank}</span>;
}

export default function LeaderboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    const res = await api.get('/trainee/leaderboard/me', 'trainee');
    setLoading(false);
    if (res.ok) setData(res.data);
    else setError(res.message || 'Could not load leaderboard.');
  }

  if (loading) return <div style={{ color: 'var(--muted)', padding: '40px', textAlign: 'center' }}>Loading leaderboard…</div>;
  if (error) return <div className="toast bad">{error}</div>;

  const me = data?.me || {};
  const top = data?.top || [];
  const scopeLabel = { batch: 'your batch', branch: 'your branch', process: 'your process', company: 'the company' }[data?.scope] || 'your group';

  const breakdown = [
    { label: 'Course', value: me.coursePoints || 0, cls: 'ok' },
    { label: 'Assessments', value: me.assessmentPoints || 0, cls: 'warn' },
    { label: 'Attendance', value: me.attendancePoints || 0, cls: 'accent' },
    { label: 'Certification', value: me.certificationPoints || 0, cls: 'bad' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>🏆 Leaderboard</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Points and badges earned from your learning activity, ranked against {scopeLabel}.</p>
        </div>
        <button className="btn small secondary" onClick={load}>↺ Refresh</button>
      </div>

      <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)' }}>Your Standing</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent)' }}>{me.totalPoints || 0}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>points</span>
              <RankPill rank={me.rank} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 320 }}>
            {(me.badges || []).length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No badges yet — keep learning!</span>}
            {(me.badges || []).map(badge => (
              <span key={badge.id} className="pill ok" title={badge.description} style={{ fontSize: 11 }}>🏅 {badge.label}</span>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 16 }}>
          {breakdown.map(item => (
            <div key={item.label} className="kpi-card" style={{ padding: '10px 12px' }}>
              <div className="kpi-label">{item.label}</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 10 }}>
          Top 10 — {scopeLabel}
        </div>
        {top.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>No points on the board yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {top.map(row => (
              <div
                key={row.employeeId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  background: row.employeeId === me.employeeId ? 'var(--accent-soft, rgba(99,102,241,.1))' : 'transparent',
                  border: row.employeeId === me.employeeId ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontWeight: 900, width: 28, textAlign: 'center', color: row.rank <= 3 ? 'var(--warn)' : 'var(--muted)' }}>#{row.rank}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.traineeName || row.employeeId}{row.employeeId === me.employeeId ? ' (You)' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {row.badges.slice(0, 3).map(badge => <span key={badge.id} title={badge.label} style={{ fontSize: 13 }}>🏅</span>)}
                  <span style={{ fontWeight: 900, fontSize: 13 }}>{row.totalPoints} pts</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
