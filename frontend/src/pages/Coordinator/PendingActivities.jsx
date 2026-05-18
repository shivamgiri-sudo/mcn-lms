import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import { riskColor } from '../../utils/format.js';

export default function PendingActivities() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await api.get('/coordinator/pending-activities', 'coordinator');
    setLoading(false);
    if (res.ok) setActivities(res.data);
  }

  async function markDone(id, actionTaken) {
    await api.patch(`/coordinator/pending-activities/${id}`, { actionTaken, status: 'Actioned' }, 'coordinator');
    load();
  }

  if (loading) return <div style={{ paddingTop: 30, textAlign: 'center' }}><div className="spinner" /></div>;
  if (activities.length === 0) return <div className="empty" style={{ marginTop: 16 }}>All clear! No pending activities.</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>{activities.length} pending {activities.length === 1 ? 'activity' : 'activities'}</p>
      {activities.map(a => <PendingItem key={a.id} a={a} onDone={markDone} />)}
    </div>
  );
}

function PendingItem({ a, onDone }) {
  const [action, setAction] = useState('');
  return (
    <div className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${riskColor(a.severity)})` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <b>{a.activityTitle}</b>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            {a.traineeName || a.employeeId} {a.batchNo ? `| ${a.batchNo}` : ''} | {a.activityType}
          </p>
        </div>
        <span className={`pill ${riskColor(a.severity)}`}>{a.severity}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="input" style={{ fontSize: 12 }} placeholder="Action taken..." value={action} onChange={e => setAction(e.target.value)} />
        <button className="btn small ok" onClick={() => onDone(a.id, action)}>Done</button>
      </div>
    </div>
  );
}
