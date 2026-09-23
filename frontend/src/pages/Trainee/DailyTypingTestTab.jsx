import { useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api.js';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Renders the character-level diff returned by the server (op: match | substitute
// | missing | extra) as highlighted spans, so a trainee can see exactly where
// their typed text diverged from the original paragraph.
function MistakesView({ originalText, ops }) {
  if (!ops) return null;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Highlighted Differences</div>
        <div style={{ lineHeight: 1.9, fontFamily: 'monospace', fontSize: 14, padding: 14, borderRadius: 10, background: 'var(--card)', border: '1px solid var(--line)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {ops.map((op, i) => {
            if (op.type === 'match') return <span key={i}>{op.expected}</span>;
            if (op.type === 'substitute') return <span key={i} title={`Typed "${op.typed}" instead of "${op.expected}"`} style={{ background: 'rgba(220,38,38,.22)', color: '#dc2626', textDecoration: 'underline', borderRadius: 2 }}>{op.typed}</span>;
            if (op.type === 'missing') return <span key={i} title="Missing character" style={{ background: 'rgba(217,119,6,.22)', color: '#d97706', borderRadius: 2 }}>{op.expected}</span>;
            return <span key={i} title="Extra character" style={{ background: 'rgba(124,58,237,.22)', color: '#7c3aed', borderRadius: 2, textDecoration: 'line-through' }}>{op.typed}</span>;
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          <span><span style={{ background: 'rgba(220,38,38,.22)', color: '#dc2626', padding: '1px 6px', borderRadius: 3 }}>wrong</span> substituted</span>
          <span><span style={{ background: 'rgba(217,119,6,.22)', color: '#d97706', padding: '1px 6px', borderRadius: 3 }}>missing</span> not typed</span>
          <span><span style={{ background: 'rgba(124,58,237,.22)', color: '#7c3aed', padding: '1px 6px', borderRadius: 3 }}>extra</span> shouldn't be there</span>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, onViewMistakes }) {
  const passed = result.status === 'Pass';
  return (
    <div className="card" style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 4px' }}>Daily Typing Test — Result</h2>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>Time Taken: {fmtClock(result.timeTakenSeconds)}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, margin: '18px 0' }}>
        <div className="card" style={{ padding: 16, background: 'rgba(37,99,235,.08)', border: '1px solid rgba(37,99,235,.25)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Typing Speed</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#2563eb' }}>{result.grossWpm}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>WPM</div>
        </div>
        <div className="card" style={{ padding: 16, background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.25)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Accuracy</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#16a34a' }}>{result.accuracyPct}%</div>
        </div>
        <div className="card" style={{ padding: 16, background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.25)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Net Speed</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#7c3aed' }}>{result.netWpm}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>WPM</div>
        </div>
        <div className="card" style={{ padding: 16, background: passed ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)', border: `1px solid ${passed ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.25)'}` }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Status</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: passed ? '#16a34a' : '#dc2626' }}>{passed ? '✓ PASS' : '✕ FAIL'}</div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        {passed
          ? `Great job! You met today's target of ${result.wpmTarget} WPM and ${result.accuracyTarget}% accuracy.`
          : `Keep practicing — today's target is ${result.wpmTarget} WPM at ${result.accuracyTarget}% accuracy.`}
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, fontSize: 12, color: 'var(--muted)', margin: '10px 0 18px' }}>
        <span>Total Characters: <b style={{ color: 'var(--ink)' }}>{result.totalChars}</b></span>
        <span>Correct Characters: <b style={{ color: 'var(--ink)' }}>{result.correctChars}</b></span>
        <span>Errors: <b style={{ color: 'var(--ink)' }}>{result.incorrectChars}</b></span>
      </div>
      <button className="btn secondary" onClick={onViewMistakes}>View Mistakes</button>
    </div>
  );
}

function TrendChart({ data, field, label, color }) {
  if (!data?.length) return <div className="empty" style={{ padding: 20 }}>Not enough attempts yet for a trend.</div>;
  return (
    <Line
      data={{
        labels: data.map(d => d.date.slice(5)),
        datasets: [{ label, data: data.map(d => d[field]), borderColor: color, backgroundColor: `${color}26`, fill: true, tension: 0.3 }],
      }}
      options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }}
    />
  );
}

export default function DailyTypingTestTab() {
  const [view, setView] = useState('take'); // 'take' | 'history'
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | active | submitted
  const [attempt, setAttempt] = useState(null); // { attemptId, paragraphText, durationSeconds }
  const [remaining, setRemaining] = useState(0);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState(null);
  const [showMistakes, setShowMistakes] = useState(false);
  const [mistakesData, setMistakesData] = useState(null);
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState(null);
  const textareaRef = useRef(null);
  const timerRef = useRef(null);
  const submittingRef = useRef(false);
  // Kept in sync with `typed` on every keystroke so the countdown interval
  // (created once per attempt, in beginCountdown) always submits the latest text
  // at auto-submit time without needing to be recreated on every keystroke.
  const typedRef = useRef('');
  useEffect(() => { typedRef.current = typed; }, [typed]);

  useEffect(() => { loadStatus(); return () => clearInterval(timerRef.current); }, []);

  async function loadStatus() {
    setLoading(true);
    const res = await api.get('/typing-test/status', 'trainee');
    setLoading(false);
    if (!res.ok) { setMsg(res.message || 'Failed to load.'); return; }
    setStatus(res.data);
    if (res.data.resumable) {
      beginCountdown(res.data.resumable.attemptId, res.data.resumable.paragraphText, res.data.resumable.durationSeconds, res.data.resumable.remainingSeconds);
    }
  }

  function beginCountdown(attemptId, paragraphText, durationSeconds, remainingSeconds) {
    setAttempt({ attemptId, paragraphText, durationSeconds });
    setRemaining(remainingSeconds);
    setPhase('active');
    setTyped('');
    submittingRef.current = false;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          doSubmit(attemptId, true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function startTest() {
    setMsg('');
    const res = await api.post('/typing-test/start', {}, 'trainee');
    if (!res.ok) { setMsg(res.message || 'Could not start the test.'); return; }
    beginCountdown(res.data.attemptId, res.data.paragraphText, res.data.durationSeconds, res.data.remainingSeconds);
  }

  async function doSubmit(attemptId, auto = false) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    clearInterval(timerRef.current);
    const res = await api.post(`/typing-test/attempts/${attemptId}/submit`, { typedText: typedRef.current }, 'trainee');
    if (!res.ok) {
      setMsg(res.message || 'Submission failed.');
      setPhase('idle');
      loadStatus();
      return;
    }
    setResult(res.data);
    setPhase('submitted');
    setMsg(auto ? 'Time\'s up — your test was submitted automatically.' : '');
  }

  function handleManualSubmit() {
    if (!attempt) return;
    doSubmit(attempt.attemptId, false);
  }

  async function openMistakes(attemptId) {
    const res = await api.get(`/typing-test/attempts/${attemptId}/mistakes`, 'trainee');
    if (res.ok) { setMistakesData(res.data); setShowMistakes(true); }
  }

  async function loadHistory() {
    setView('history');
    if (history) return;
    const res = await api.get('/typing-test/me/history', 'trainee');
    if (res.ok) setHistory(res.data);
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading Daily Typing Test…</div>;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
        <button className={`btn small ${view === 'take' ? 'accent' : 'secondary'}`} onClick={() => setView('take')}>⌨️ Take Test</button>
        <button className={`btn small ${view === 'history' ? 'accent' : 'secondary'}`} onClick={loadHistory}>📈 My Typing Performance</button>
      </div>

      {msg && <div className="toast bad">{msg}</div>}

      {view === 'take' && (
        <>
          {phase === 'submitted' && result && !showMistakes && (
            <ResultCard result={result} onViewMistakes={() => { setMistakesData({ originalText: result.originalText, ops: result.ops }); setShowMistakes(true); }} />
          )}

          {showMistakes && mistakesData && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Error Review</h3>
                <button className="btn small secondary" onClick={() => setShowMistakes(false)}>✕ Close</button>
              </div>
              <MistakesView originalText={mistakesData.originalText} ops={mistakesData.ops} />
            </div>
          )}

          {phase === 'active' && attempt && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Daily Typing Test</h2>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Today's Date: {new Date().toLocaleDateString()}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Time Remaining</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: remaining <= 30 ? '#dc2626' : 'var(--ink)', fontFamily: 'monospace' }}>{fmtClock(remaining)}</div>
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Paragraph to Type</div>
              <div
                onCopy={e => e.preventDefault()}
                style={{ userSelect: 'none', lineHeight: 1.8, fontSize: 15, padding: 14, borderRadius: 10, background: 'var(--card)', border: '1px solid var(--line)', marginBottom: 14 }}
              >
                {attempt.paragraphText}
              </div>

              <textarea
                ref={textareaRef}
                className="input"
                style={{ width: '100%', minHeight: 180, fontSize: 15, lineHeight: 1.7, resize: 'vertical', fontFamily: 'inherit' }}
                value={typed}
                onChange={e => setTyped(e.target.value)}
                onPaste={e => e.preventDefault()}
                onDrop={e => e.preventDefault()}
                onContextMenu={e => e.preventDefault()}
                placeholder="Start typing the paragraph above exactly as shown…"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn accent" onClick={handleManualSubmit}>Submit Test</button>
              </div>
            </div>
          )}

          {phase === 'idle' && status && (
            status.alreadyCompletedMessage ? (
              <div className="card" style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                <h3>{status.alreadyCompletedMessage}</h3>
                {status.todayResult && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 20, margin: '14px 0' }}>
                      <span>Net WPM: <b>{status.todayResult.netWpm}</b></span>
                      <span>Accuracy: <b>{status.todayResult.accuracyPct}%</b></span>
                      <span className={`pill ${status.todayResult.status === 'Pass' ? 'ok' : 'bad'}`}>{status.todayResult.status}</span>
                    </div>
                    <button className="btn secondary" onClick={() => openMistakes(status.todayResult.id)}>View Mistakes</button>
                  </>
                )}
              </div>
            ) : (
              <div className="card" style={{ padding: 24, textAlign: 'center' }}>
                <h2 style={{ marginTop: 0 }}>Daily Typing Test</h2>
                <p style={{ color: 'var(--muted)' }}>Today's Date: {new Date().toLocaleDateString()}</p>
                <p>Typing Time: <b>{fmtClock(status.settings.durationSeconds)}</b> Minutes</p>
                <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 480, margin: '0 auto 18px' }}>
                  A random paragraph will appear once you start. Type it exactly as shown — the countdown begins immediately and the test submits automatically when time runs out.
                </p>
                <button className="btn accent" style={{ fontSize: 15, padding: '10px 28px' }} onClick={startTest}>Start Test</button>
              </div>
            )
          )}
        </>
      )}

      {view === 'history' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {!history ? (
            <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                {[
                  ['Tests Completed', history.stats.testsCompleted],
                  ['Best WPM', history.stats.bestWpm],
                  ['Average WPM', history.stats.avgWpm],
                  ['Average Accuracy', `${history.stats.avgAccuracy}%`],
                  ['Pass %', `${history.stats.passPct}%`],
                ].map(([label, value]) => (
                  <div key={label} className="card" style={{ padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 16 }}>
                <h4 style={{ marginTop: 0 }}>WPM Trend (last {history.trend30.length} days)</h4>
                <TrendChart data={history.trend30} field="netWpm" label="Net WPM" color="#2563eb" />
              </div>
              <div className="card" style={{ padding: 16 }}>
                <h4 style={{ marginTop: 0 }}>Accuracy Trend (last {history.trend30.length} days)</h4>
                <TrendChart data={history.trend30} field="accuracyPct" label="Accuracy %" color="#16a34a" />
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Gross WPM</th><th>Net WPM</th><th>Accuracy</th><th>Errors</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {history.history.map(h => (
                      <tr key={h.id}>
                        <td>{new Date(h.attemptDate).toLocaleDateString()}</td>
                        <td>{h.grossWpm}</td>
                        <td>{h.netWpm}</td>
                        <td>{h.accuracyPct}%</td>
                        <td>{h.errorCount}</td>
                        <td><span className={`pill ${h.status === 'Pass' ? 'ok' : 'bad'}`}>{h.status}</span></td>
                        <td><button className="btn small secondary" onClick={() => openMistakes(h.id)}>Mistakes</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {showMistakes && mistakesData && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Error Review</h3>
                <button className="btn small secondary" onClick={() => setShowMistakes(false)}>✕ Close</button>
              </div>
              <MistakesView originalText={mistakesData.originalText} ops={mistakesData.ops} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
