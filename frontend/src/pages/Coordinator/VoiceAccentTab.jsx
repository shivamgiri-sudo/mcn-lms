import { useEffect, useState } from 'react';
import { api, fetchAuthenticatedBlobUrl } from '../../utils/api.js';
import { formatDateTime } from '../../utils/format.js';

const STATUS_PILL = { SUBMITTED: 'warn', SCORED: 'ok' };
const DEFAULT_DIMENSIONS = ['clarity', 'pace', 'accentNeutrality', 'tone', 'grammar'];
const DIMENSION_LABEL = {
  clarity: 'Clarity',
  pace: 'Pace',
  accentNeutrality: 'Accent Neutrality',
  tone: 'Tone',
  grammar: 'Grammar',
};

function CreatePromptForm({ onCreated, portalType }) {
  const [title, setTitle] = useState('');
  const [promptText, setPromptText] = useState('');
  const [promptType, setPromptType] = useState('SCRIPT_READING');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !promptText.trim()) return setMsg('Title and prompt text are required.');
    setSaving(true);
    const res = await api.post('/voice-accent/admin/prompts', {
      title, promptText, promptType, category: category || undefined, level: level || undefined,
    }, portalType);
    setSaving(false);
    if (res.ok) {
      setMsg('✓ Prompt created.');
      setTitle(''); setPromptText(''); setCategory(''); setLevel('');
      onCreated && onCreated();
    } else setMsg(res.message || 'Could not create prompt.');
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <b style={{ display: 'block', marginBottom: 10 }}>Create a New Prompt</b>
      <form onSubmit={submit}>
        <div className="col-3">
          <div className="field">
            <label>Title</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Customer Greeting Script" />
          </div>
          <div className="field">
            <label>Prompt Type</label>
            <select className="select" value={promptType} onChange={e => setPromptType(e.target.value)}>
              <option value="SCRIPT_READING">Script Reading</option>
              <option value="SCENARIO_ROLEPLAY">Scenario Role-play</option>
            </select>
          </div>
          <div className="field">
            <label>Category (optional)</label>
            <input className="input" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Voice Process" />
          </div>
        </div>
        <div className="field">
          <label>{promptType === 'SCENARIO_ROLEPLAY' ? 'Scenario Description' : 'Script / Passage Text'}</label>
          <textarea className="input" rows={4} value={promptText} onChange={e => setPromptText(e.target.value)} placeholder="What the trainee should read or respond to..." />
        </div>
        <div className="field" style={{ maxWidth: 240 }}>
          <label>Level (optional)</label>
          <input className="input" value={level} onChange={e => setLevel(e.target.value)} placeholder="e.g. Beginner" />
        </div>
        {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Prompt'}</button>
      </form>
    </div>
  );
}

function PromptsPanel({ portalType }) {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await api.get('/voice-accent/admin/prompts', portalType);
    setLoading(false);
    if (res.ok) setPrompts(res.data || []);
  }

  useEffect(() => { load(); }, [portalType]);

  async function toggleActive(prompt) {
    const res = await api.patch(`/voice-accent/admin/prompts/${prompt.id}`, { active: !prompt.active }, portalType);
    if (res.ok) load();
  }

  return (
    <section>
      <CreatePromptForm onCreated={load} portalType={portalType} />
      {loading ? <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {prompts.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No prompts created yet.</div>}
          {prompts.map(p => (
            <div key={p.id} className="card" style={{ padding: 14 }}>
              <div className="row between">
                <div>
                  <b>{p.title}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {p.promptType === 'SCENARIO_ROLEPLAY' ? 'Scenario Role-play' : 'Script Reading'} {p.category ? `· ${p.category}` : ''} {p.level ? `· ${p.level}` : ''}
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className={`pill ${p.active ? 'ok' : 'info'}`}>{p.active ? 'Active' : 'Inactive'}</span>
                  <button className="btn xs secondary" onClick={() => toggleActive(p)}>{p.active ? 'Deactivate' : 'Activate'}</button>
                </div>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{p.promptText}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RubricForm({ submission, onScored, portalType }) {
  const existing = submission.rubricScores || {};
  const dimensions = [...new Set([...DEFAULT_DIMENSIONS, ...Object.keys(existing)])];
  const [scores, setScores] = useState(() => {
    const init = {};
    dimensions.forEach(d => { init[d] = existing[d] ?? ''; });
    return init;
  });
  const [overallScore, setOverallScore] = useState(submission.overallScore ?? '');
  const [feedbackNotes, setFeedbackNotes] = useState(submission.feedbackNotes || '');
  const [newDimension, setNewDimension] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  function addDimension() {
    const key = newDimension.trim();
    if (!key || scores[key] !== undefined) return;
    setScores(prev => ({ ...prev, [key]: '' }));
    setNewDimension('');
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const rubricScores = {};
    Object.entries(scores).forEach(([k, v]) => { if (v !== '') rubricScores[k] = Number(v); });
    const res = await api.patch(`/voice-accent/admin/submissions/${submission.id}/score`, {
      overallScore: overallScore === '' ? undefined : Number(overallScore),
      rubricScores,
      feedbackNotes: feedbackNotes || undefined,
    }, portalType);
    setSaving(false);
    if (res.ok) { setMsg('✓ Score saved.'); onScored && onScored(res.data); }
    else setMsg(res.message || 'Could not save score.');
  }

  return (
    <form onSubmit={submit} style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
        {Object.keys(scores).map(dim => (
          <div className="field" key={dim} style={{ minWidth: 140 }}>
            <label>{DIMENSION_LABEL[dim] || dim}</label>
            <input className="input" type="number" min="0" max="100" value={scores[dim]} onChange={e => setScores(prev => ({ ...prev, [dim]: e.target.value }))} placeholder="0-100" />
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input className="input" style={{ maxWidth: 200 }} placeholder="Add custom dimension" value={newDimension} onChange={e => setNewDimension(e.target.value)} />
        <button type="button" className="btn xs secondary" onClick={addDimension}>+ Add Dimension</button>
      </div>
      <div className="col-3">
        <div className="field">
          <label>Overall Score (0-100)</label>
          <input className="input" type="number" min="0" max="100" value={overallScore} onChange={e => setOverallScore(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Feedback Notes</label>
        <textarea className="input" rows={3} value={feedbackNotes} onChange={e => setFeedbackNotes(e.target.value)} />
      </div>
      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
      <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : submission.status === 'SCORED' ? 'Update Score' : 'Save Score'}</button>
    </form>
  );
}

function AudioPlayer({ submission, portalType }) {
  const [state, setState] = useState({ status: 'idle', url: '' });

  async function load() {
    setState({ status: 'loading', url: '' });
    const res = await fetchAuthenticatedBlobUrl(submission.audioUrl, portalType);
    if (res.ok) setState({ status: 'ready', url: res.url });
    else setState({ status: 'error', url: '', message: res.message });
  }

  useEffect(() => () => { if (state.url) URL.revokeObjectURL(state.url); }, [state.url]);

  if (state.status === 'idle') return <button className="btn xs secondary" onClick={load}>▶ Load Audio</button>;
  if (state.status === 'loading') return <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading audio…</span>;
  if (state.status === 'error') return <span style={{ fontSize: 12, color: 'var(--bad, #c0392b)' }}>{state.message || 'Could not load audio.'}</span>;
  return <audio controls src={state.url} style={{ maxWidth: 320, height: 32 }} />;
}

function SubmissionsPanel({ portalType }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('SUBMITTED');
  const [batchNo, setBatchNo] = useState('');
  const [expanded, setExpanded] = useState('');

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (batchNo) params.set('batchNo', batchNo);
    const res = await api.get(`/voice-accent/admin/submissions?${params.toString()}`, portalType);
    setLoading(false);
    if (!res.ok) return setError(res.message || 'Could not load submissions.');
    setError('');
    setSubmissions(res.data || []);
  }

  useEffect(() => { load(); }, [statusFilter, portalType]);

  return (
    <section>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Review Queue</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>Listen to recordings and score against the rubric.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ maxWidth: 160 }} placeholder="Filter by batch no" value={batchNo} onChange={e => setBatchNo(e.target.value)} onBlur={load} />
          <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="SUBMITTED">Pending Review</option>
            <option value="SCORED">Scored</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {submissions.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No submissions in this view.</div>}
          {submissions.map(s => (
            <div key={s.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="row between" style={{ padding: 14, cursor: 'pointer' }} onClick={() => setExpanded(v => v === s.id ? '' : s.id)}>
                <div>
                  <b>{s.employeeName || s.employeeId}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{s.employeeId} · {s.batchNo || '—'} · {s.prompt?.title || 'Prompt'}</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {s.overallScore != null && <span className="pill accent">{s.overallScore}/100</span>}
                  <span className={`pill ${STATUS_PILL[s.status] || 'info'}`}>{s.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{formatDateTime(s.submittedAt)}</span>
                  <span>{expanded === s.id ? '⌃' : '⌄'}</span>
                </div>
              </div>
              {expanded === s.id && (
                <>
                  <div style={{ padding: '0 14px 10px' }}><AudioPlayer submission={s} portalType={portalType} /></div>
                  <RubricForm submission={s} portalType={portalType} onScored={load} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// portalType: 'coordinator' (scoped to owned batches, default) or 'admin'
// (scoped to branch for branch admins, unrestricted for super admins).
export default function VoiceAccentTab({ portalType = 'coordinator' }) {
  const [view, setView] = useState('review');

  return (
    <section>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button className={`btn small${view === 'review' ? '' : ' secondary'}`} onClick={() => setView('review')}>Review Queue</button>
        <button className={`btn small${view === 'prompts' ? '' : ' secondary'}`} onClick={() => setView('prompts')}>Manage Prompts</button>
      </div>
      {view === 'review' ? <SubmissionsPanel portalType={portalType} /> : <PromptsPanel portalType={portalType} />}
    </section>
  );
}
