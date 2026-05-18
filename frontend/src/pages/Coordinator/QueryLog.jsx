import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import { formatDateTime } from '../../utils/format.js';

export default function QueryLog() {
  const [queries, setQueries] = useState([]);
  const [filter, setFilter] = useState('Open');

  useEffect(() => { load(); }, [filter]);

  async function load() {
    const res = await api.get(`/coordinator/queries?status=${filter === 'All' ? '' : filter}`, 'coordinator');
    if (res.ok) setQueries(res.data);
  }

  async function answer(id, text) {
    await api.patch(`/coordinator/queries/${id}`, { coordinatorAnswer: text }, 'coordinator');
    load();
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['Open', 'Answered', 'All'].map(s => (
          <button key={s} className={`tab-btn${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>
      {queries.length === 0 && <div className="empty">No {filter.toLowerCase()} questions.</div>}
      {queries.map(q => <QueryRow key={q.id} q={q} onAnswer={answer} />)}
    </div>
  );
}

function QueryRow({ q, onAnswer }) {
  const [text, setText] = useState('');
  const statusColor = { Open: 'warn', Answered: 'ok', Closed: '' };

  return (
    <div className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${q.priority === 'Critical' ? 'bad' : q.priority === 'High' ? 'warn' : 'line'})` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 14 }}>{q.question}</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {q.traineeName || q.employeeId} &nbsp;|&nbsp; {q.category} &nbsp;|&nbsp; {q.batchNo} &nbsp;|&nbsp; {formatDateTime(q.createdAt)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
          <span className={`pill ${q.priority === 'Critical' ? 'bad' : q.priority === 'High' ? 'warn' : ''}`}>{q.priority}</span>
          <span className={`pill ${statusColor[q.status]}`}>{q.status}</span>
        </div>
      </div>
      {q.coordinatorAnswer && (
        <div style={{ marginTop: 8, borderLeft: '4px solid var(--ok)', background: '#ecfdf5', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}>
          <b>Answer:</b> {q.coordinatorAnswer} <span style={{ color: 'var(--muted)' }}>— {q.answeredBy} ({formatDateTime(q.answeredAt)})</span>
        </div>
      )}
      {q.status === 'Open' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <textarea className="input" style={{ minHeight: 55, fontSize: 12 }} placeholder="Type your answer..." value={text} onChange={e => setText(e.target.value)} />
          <button className="btn small ok" onClick={() => onAnswer(q.id, text)} disabled={!text.trim()}>Answer</button>
        </div>
      )}
    </div>
  );
}
