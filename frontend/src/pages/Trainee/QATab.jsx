import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';
import { formatDateTime } from '../../utils/format.js';

export default function QATab() {
  const [questions, setQuestions] = useState([]);
  const [filter, setFilter] = useState({ status: 'All', priority: 'All', search: '' });
  const [showAsk, setShowAsk] = useState(false);
  const [form, setForm] = useState({ category: 'Process Doubt', priority: 'Normal', question: '' });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const res = await api.get('/trainee/questions', 'trainee');
    if (res.ok) setQuestions(res.data);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.question.trim()) return setMsg('Question text required.');
    setSubmitting(true);
    const res = await api.post('/trainee/questions', form, 'trainee');
    setSubmitting(false);
    if (res.ok) { setShowAsk(false); setForm({ category: 'Process Doubt', priority: 'Normal', question: '' }); setMsg(''); load(); }
    else setMsg(res.message || 'Failed to submit.');
  }

  const filtered = questions.filter(q => {
    if (filter.status !== 'All' && q.status !== filter.status) return false;
    if (filter.priority !== 'All' && q.priority !== filter.priority) return false;
    if (filter.search && !q.question.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
  });

  const statusColor = { Open: 'warn', Answered: 'ok', Closed: '' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 10px' }}>
        <h3 className="section-title" style={{ margin: 0 }}>My Questions & Answers</h3>
        <button className="btn small" onClick={() => setShowAsk(true)}>Ask New Question</button>
      </div>

      {/* Filters */}
      <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 130px 140px auto', gap: 10, marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Search</label>
          <input className="input" placeholder="Search questions..." value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Status</label>
          <select className="select" value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
            {['All', 'Open', 'Answered', 'Closed'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Priority</label>
          <select className="select" value={filter.priority} onChange={e => setFilter(p => ({ ...p, priority: e.target.value }))}>
            {['All', 'Normal', 'High', 'Critical'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ alignSelf: 'flex-end' }}><button className="btn small secondary" onClick={load}>↺</button></div>
      </div>

      {/* Questions list */}
      <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto', paddingRight: 6 }}>
        {filtered.length === 0 && <div className="empty">No questions found. Ask your first question!</div>}
        {filtered.map(q => (
          <div key={q.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid var(--${statusColor[q.status] || 'line'})` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700 }}>{q.question}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{q.category} &nbsp;|&nbsp; {formatDateTime(q.createdAt)}</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <span className={`pill ${q.priority === 'Critical' ? 'bad' : q.priority === 'High' ? 'warn' : ''}`}>{q.priority}</span>
                <span className={`pill ${statusColor[q.status]}`}>{q.status}</span>
              </div>
            </div>
            {q.status === 'Answered' && q.coordinatorAnswer && (
              <div style={{ marginTop: 10, borderLeft: '4px solid var(--ok)', background: '#ecfdf5', borderRadius: 10, padding: '9px 12px', fontSize: 13, color: '#064e3b' }}>
                <b>Answer:</b> {q.coordinatorAnswer}
                <p style={{ fontSize: 11, color: '#047857', marginTop: 4 }}>Answered by {q.answeredBy} &nbsp;|&nbsp; {formatDateTime(q.answeredAt)}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Ask modal */}
      {showAsk && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAsk(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <b>Raise a Question</b>
              <button className="btn small secondary" onClick={() => setShowAsk(false)}>Close</button>
            </div>
            <div className="modal-body">
              <form onSubmit={submit}>
                <div className="field">
                  <label>Category</label>
                  <select className="select" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {['Process Doubt', 'LMS Issue', 'Content Issue', 'Assessment', 'Other'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Priority</label>
                  <select className="select" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    {['Normal', 'High', 'Critical'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Your question</label>
                  <textarea className="input" placeholder="Write your question here..." value={form.question} onChange={e => setForm(p => ({ ...p, question: e.target.value }))} />
                </div>
                {msg && <div className="toast bad">{msg}</div>}
                <button className="btn" type="submit" disabled={submitting} style={{ width: '100%', marginTop: 10 }}>
                  {submitting ? 'Submitting...' : 'Submit Question'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
