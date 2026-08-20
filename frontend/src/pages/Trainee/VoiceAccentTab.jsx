import { useEffect, useRef, useState } from 'react';
import { api, uploadFile, fetchAuthenticatedBlobUrl } from '../../utils/api.js';
import { formatDateTime } from '../../utils/format.js';

const STATUS_PILL = { SUBMITTED: 'warn', SCORED: 'ok' };
const DIMENSION_LABEL = {
  clarity: 'Clarity',
  pace: 'Pace',
  accentNeutrality: 'Accent Neutrality',
  tone: 'Tone',
  grammar: 'Grammar',
};

function canRecordAudio() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia;
}

function Recorder({ onCaptured }) {
  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, []);

  async function start() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        onCaptured(blob, seconds);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
      setRecording(true);
    } catch (err) {
      setError('Microphone access denied or unavailable. Use file upload instead.');
    }
  }

  function stop() {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        {!recording ? (
          <button type="button" className="btn small" onClick={start}>🎙️ Start Recording</button>
        ) : (
          <button type="button" className="btn small danger" onClick={stop}>⏹ Stop ({seconds}s)</button>
        )}
        {recording && <span className="pill bad" style={{ animation: 'none' }}>● Recording…</span>}
      </div>
      {error && <div className="toast bad" style={{ marginTop: 10 }}>{error}</div>}
      {previewUrl && !recording && (
        <div style={{ marginTop: 10 }}>
          <audio controls src={previewUrl} style={{ maxWidth: 320, height: 32 }} />
        </div>
      )}
    </div>
  );
}

function SubmitPanel({ onSubmitted }) {
  const [prompts, setPrompts] = useState([]);
  const [promptId, setPromptId] = useState('');
  const [file, setFile] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const recordSupported = canRecordAudio();

  useEffect(() => {
    api.get('/voice-accent/prompts', 'trainee').then(res => { if (res.ok) setPrompts(res.data || []); });
  }, []);

  const activePrompt = prompts.find(p => p.id === promptId);

  async function submit(e) {
    e.preventDefault();
    if (!promptId) return setMsg('Select a prompt first.');
    const audio = file || (recordedBlob ? new File([recordedBlob], `recording-${Date.now()}.webm`, { type: recordedBlob.type || 'audio/webm' }) : null);
    if (!audio) return setMsg('Record your voice or upload an audio file.');

    const fd = new FormData();
    fd.append('promptId', promptId);
    fd.append('audio', audio);
    if (!file && recordedSeconds) fd.append('durationSeconds', String(recordedSeconds));

    setSaving(true);
    const res = await uploadFile('/voice-accent/submissions', fd, 'trainee');
    setSaving(false);
    if (res.ok) {
      setMsg('✓ Recording submitted for review.');
      setFile(null); setRecordedBlob(null); setRecordedSeconds(0); setPromptId('');
      onSubmitted && onSubmitted();
    } else setMsg(res.message || 'Could not submit recording.');
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <b style={{ display: 'block', marginBottom: 10 }}>Record a New Submission</b>
      <form onSubmit={submit}>
        <div className="field">
          <label>Prompt</label>
          <select className="select" value={promptId} onChange={e => { setPromptId(e.target.value); setFile(null); setRecordedBlob(null); }}>
            <option value="">Select a prompt…</option>
            {prompts.map(p => <option key={p.id} value={p.id}>{p.title} · {p.promptType === 'SCENARIO_ROLEPLAY' ? 'Scenario' : 'Script'}</option>)}
          </select>
        </div>
        {activePrompt && (
          <div className="card" style={{ background: 'var(--bg-soft, rgba(127,127,127,0.06))', marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{activePrompt.promptText}</p>
          </div>
        )}
        {activePrompt && (
          <div style={{ marginBottom: 12 }}>
            {recordSupported ? (
              <Recorder onCaptured={(blob, secs) => { setRecordedBlob(blob); setRecordedSeconds(secs); setFile(null); }} />
            ) : (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Microphone recording is not supported in this browser — upload a file instead.</p>
            )}
            <div className="field" style={{ marginTop: 10, maxWidth: 320 }}>
              <label>Or upload a pre-recorded file (webm, mp3, wav, m4a, ogg — max 15MB)</label>
              <input className="input" type="file" accept="audio/*,.webm,.mp3,.wav,.m4a,.ogg" onChange={e => { setFile(e.target.files?.[0] || null); setRecordedBlob(null); }} />
            </div>
          </div>
        )}
        {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'} style={{ marginBottom: 10 }}>{msg}</div>}
        <button className="btn" type="submit" disabled={saving || !activePrompt}>{saving ? 'Submitting…' : 'Submit Recording'}</button>
      </form>
    </div>
  );
}

function MySubmissionAudio({ submission }) {
  const [state, setState] = useState({ status: 'idle', url: '' });

  async function load() {
    setState({ status: 'loading', url: '' });
    const res = await fetchAuthenticatedBlobUrl(submission.audioUrl, 'trainee');
    if (res.ok) setState({ status: 'ready', url: res.url });
    else setState({ status: 'error', url: '', message: res.message });
  }

  useEffect(() => () => { if (state.url) URL.revokeObjectURL(state.url); }, [state.url]);

  if (state.status === 'idle') return <button className="btn xs secondary" onClick={load}>▶ Play My Recording</button>;
  if (state.status === 'loading') return <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</span>;
  if (state.status === 'error') return <span style={{ fontSize: 12 }}>{state.message || 'Could not load audio.'}</span>;
  return <audio controls src={state.url} style={{ maxWidth: 320, height: 32 }} />;
}

function HistoryPanel({ refreshKey }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get('/voice-accent/me/submissions', 'trainee').then(res => {
      setLoading(false);
      if (res.ok) setSubmissions(res.data || []);
    });
  }, [refreshKey]);

  if (loading) return <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" /></div>;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {submissions.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No submissions yet.</div>}
      {submissions.map(s => (
        <div key={s.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row between" style={{ padding: 14, cursor: 'pointer' }} onClick={() => setExpanded(v => v === s.id ? '' : s.id)}>
            <div>
              <b>{s.prompt?.title || 'Prompt'}</b>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{formatDateTime(s.submittedAt)}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {s.overallScore != null && <span className="pill accent">{s.overallScore}/100</span>}
              <span className={`pill ${STATUS_PILL[s.status] || 'info'}`}>{s.status === 'SCORED' ? 'Scored' : 'Pending Review'}</span>
              <span>{expanded === s.id ? '⌃' : '⌄'}</span>
            </div>
          </div>
          {expanded === s.id && (
            <div style={{ padding: '0 14px 14px' }}>
              <MySubmissionAudio submission={s} />
              {s.status === 'SCORED' && (
                <div style={{ marginTop: 12 }}>
                  {s.rubricScores && (
                    <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                      {Object.entries(s.rubricScores).map(([dim, val]) => (
                        <span key={dim} className="pill info">{DIMENSION_LABEL[dim] || dim}: {val}</span>
                      ))}
                    </div>
                  )}
                  {s.feedbackNotes && <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{s.feedbackNotes}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function VoiceAccentTab() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <section>
      <h2 className="section-title" style={{ marginBottom: 4 }}>Voice & Accent Assessment</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 12 }}>Read a script or respond to a scenario, submit your recording, and view feedback once it's scored.</p>
      <SubmitPanel onSubmitted={() => setRefreshKey(k => k + 1)} />
      <HistoryPanel refreshKey={refreshKey} />
    </section>
  );
}
