import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../utils/api.js';

const DIFFICULTY_COLOR = { EASY: 'ok', MEDIUM: 'warn', HARD: 'bad' };
const DIFFICULTY_LABEL = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

// Net WPM: (chars typed / 5 - errors) / minutes
function calcWpm(totalKeystrokes, errorCount, durationSeconds) {
  if (durationSeconds < 1) return 0;
  const minutes = durationSeconds / 60;
  const netWords = (totalKeystrokes - errorCount) / 5;
  return Math.max(0, Math.round(netWords / minutes));
}

function calcRawWpm(totalKeystrokes, durationSeconds) {
  if (durationSeconds < 1) return 0;
  return Math.max(0, Math.round((totalKeystrokes / 5) / (durationSeconds / 60)));
}

function calcAccuracy(correctKeystrokes, totalKeystrokes) {
  if (!totalKeystrokes) return 100;
  return parseFloat(((correctKeystrokes / totalKeystrokes) * 100).toFixed(1));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// SVG sparkline for session WPM trend
function Sparkline({ values, width = 80, height = 28 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 4) + 2;
    const y = height - 2 - ((v / max) * (height - 4));
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Character-by-character highlighted passage display with cursor
function PassageDisplay({ body, typedChars, startIndex = 0 }) {
  const cursorPos = startIndex + typedChars.length;
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 20, lineHeight: 1.8, letterSpacing: '.02em', padding: '18px 20px', background: 'var(--surface2, rgba(127,127,127,0.07))', borderRadius: 10, userSelect: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflowY: 'auto' }}>
      {body.split('').map((ch, i) => {
        const relIdx = i - startIndex;
        // Already passed (before the active window)
        if (relIdx < 0) {
          return <span key={i} style={{ color: 'var(--muted)', opacity: 0.4 }}>{ch}</span>;
        }
        // Current cursor position
        if (i === cursorPos) {
          return (
            <span key={i} style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 0, top: 0,
                borderLeft: '2px solid var(--accent)',
                height: '1.2em', animation: 'blink 1s step-end infinite',
                pointerEvents: 'none',
              }} />
              {ch}
            </span>
          );
        }
        // Typed characters
        if (relIdx < typedChars.length) {
          const typed = typedChars[relIdx];
          const correct = typed === ch;
          return (
            <span key={i} style={{
              color: correct ? 'var(--ok)' : 'var(--bad)',
              background: correct ? 'transparent' : 'var(--bad-soft, #fee2e2)',
              borderRadius: 2,
            }}>
              {ch}
            </span>
          );
        }
        // Untyped
        return <span key={i}>{ch}</span>;
      })}
    </div>
  );
}

export default function TypingPracticeTab() {
  const [mode, setMode] = useState('PASSAGE'); // 'PASSAGE' | 'TIMED_DRILL'
  const [prompts, setPrompts] = useState(null);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [promptBody, setPromptBody] = useState('');
  const [drillDuration, setDrillDuration] = useState(60);

  // Session state
  const [phase, setPhase] = useState('pick'); // 'pick' | 'active' | 'result'
  const [typedChars, setTypedChars] = useState([]);
  const [startIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [warnFocus, setWarnFocus] = useState(false);
  const [pasteCount, setPasteCount] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [history, setHistory] = useState(null);

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const pasteRef = useRef(0);
  const focusRef = useRef(0);
  const keystrokeRef = useRef([]);
  // Keep a stable ref to selectedPrompt and mode for finishSession callback
  const selectedPromptRef = useRef(null);
  const modeRef = useRef('PASSAGE');

  useEffect(() => { selectedPromptRef.current = selectedPrompt; }, [selectedPrompt]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    api.get('/typing/prompts', 'trainee').then(res => {
      setPrompts(res.ok ? (res.data || []) : []);
      setLoadingPrompts(false);
    });
    api.get('/typing/me/sessions?limit=20', 'trainee').then(res => {
      if (res.ok) setHistory(res.data || []);
    });
  }, []);

  // Anti-cheat: track tab/window blur and visibility changes
  useEffect(() => {
    function onVisChange() {
      if (document.hidden) {
        focusRef.current++;
        setFocusCount(c => c + 1);
        if (focusRef.current >= 3) setWarnFocus(true);
      }
    }
    function onBlur() {
      focusRef.current++;
      setFocusCount(c => c + 1);
      if (focusRef.current >= 3) setWarnFocus(true);
    }
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Clean up timer on unmount
  useEffect(() => () => clearInterval(timerRef.current), []);

  const finishSession = useCallback(async () => {
    clearInterval(timerRef.current);
    const log = keystrokeRef.current;
    // Use last keystroke timestamp for actual typing duration (excludes focus-lost time)
    const lastKeystrokeMs = log.length > 0 ? log[log.length - 1].t : 0;
    const durationSeconds = Math.max(1, Math.round(lastKeystrokeMs / 1000));
    const correctCount = log.filter(k => k.correct).length;
    const errCount = log.filter(k => !k.correct).length;
    const charsTyped = log.length;
    const wpm = calcWpm(charsTyped, errCount, durationSeconds);
    const rawWpm = calcRawWpm(charsTyped, durationSeconds);
    const accuracy = calcAccuracy(correctCount, charsTyped);

    setSaving(true);
    setPhase('result');

    const res = await api.post('/typing/sessions', {
      promptId: selectedPromptRef.current?.id,
      mode: modeRef.current,
      wpm,
      rawWpm,
      accuracy,
      errorCount: errCount,
      durationSeconds,
      pasteEventCount: pasteRef.current,
      focusLostCount: focusRef.current,
      keystrokeLog: log.slice(0, 2000),
    }, 'trainee');

    setSaving(false);
    if (res.ok) {
      setResult(res.data);
      api.get('/typing/me/sessions?limit=20', 'trainee').then(r => { if (r.ok) setHistory(r.data || []); });
    } else {
      setResult({ error: res.message || 'Could not save session.' });
    }
  }, []);

  async function startSession(prompt) {
    const res = await api.get(`/typing/prompts/${prompt.id}`, 'trainee');
    if (!res.ok) return;
    setSelectedPrompt(prompt);
    selectedPromptRef.current = prompt;
    setPromptBody(res.data.body || '');
    setTypedChars([]);
    setElapsed(0);
    setRemaining(mode === 'TIMED_DRILL' ? drillDuration : 0);
    setErrorCount(0);
    keystrokeRef.current = [];
    pasteRef.current = 0;
    focusRef.current = 0;
    setPasteCount(0);
    setFocusCount(0);
    setWarnFocus(false);
    setResult(null);
    setPhase('active');
    startTimeRef.current = Date.now();

    clearInterval(timerRef.current);
    if (mode === 'TIMED_DRILL') {
      let rem = drillDuration;
      timerRef.current = setInterval(() => {
        rem--;
        setRemaining(rem);
        setElapsed(e => e + 1);
        if (rem <= 0) { clearInterval(timerRef.current); finishSession(); }
      }, 1000);
    } else {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    // autoFocus on the textarea handles initial focus
  }

  function handleKeyDown(e) {
    if (phase !== 'active') return;
    const body = promptBody;
    const currentPos = startIndex + typedChars.length;

    if (e.key === 'Backspace') {
      e.preventDefault();
      setTypedChars(tc => tc.slice(0, -1));
      return;
    }
    if (e.key.length !== 1) return;
    e.preventDefault(); // prevent browser from inserting text into textarea

    const expected = body[currentPos] ?? '';
    const correct = e.key === expected;
    const t = Date.now() - (startTimeRef.current || Date.now());
    keystrokeRef.current = [...keystrokeRef.current, { t, k: e.key, correct }];
    if (!correct) setErrorCount(ec => ec + 1);
    const newTyped = [...typedChars, e.key];
    setTypedChars(newTyped);

    // PASSAGE: auto-finish when all chars typed
    if (mode === 'PASSAGE' && currentPos + 1 >= body.length) {
      finishSession();
    }
  }

  const activePrompts = prompts ? prompts.filter(p => p.mode === mode) : [];

  // ── Active session ─────────────────────────────────────────────────────────
  if (phase === 'active') {
    return (
      <div>
        {/* Blink keyframe injected inline once */}
        <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

        {warnFocus && (
          <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid var(--warn)', background: 'var(--warn-soft, #fef3c7)' }}>
            <b style={{ color: 'var(--warn)' }}>⚠ Warning:</b>{' '}
            <span style={{ fontSize: 13 }}>Keep this window active or your session may be voided.</span>
          </div>
        )}

        <div className="row between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span className={`pill ${DIFFICULTY_COLOR[selectedPrompt?.difficulty] || ''}`}>
              {DIFFICULTY_LABEL[selectedPrompt?.difficulty] || selectedPrompt?.difficulty}
            </span>
            <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700 }}>{selectedPrompt?.title}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {mode === 'TIMED_DRILL' ? (
              <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: remaining <= 10 ? 'var(--bad)' : 'var(--accent)' }}>
                {formatTime(remaining)}
              </span>
            ) : (
              <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: 'var(--muted)' }}>
                {formatTime(elapsed)}
              </span>
            )}
            <button className="btn small secondary" onClick={() => { clearInterval(timerRef.current); setPhase('pick'); }}>
              ✕ Cancel
            </button>
          </div>
        </div>

        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
        <div onClick={() => textareaRef.current?.focus()} style={{ cursor: 'text' }}>
          <PassageDisplay body={promptBody} typedChars={typedChars} startIndex={startIndex} />
        </div>

        <textarea
          id="typing-textarea"
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          onPaste={e => { e.preventDefault(); pasteRef.current++; setPasteCount(pasteRef.current); }}
          onDrop={e => e.preventDefault()}
          onContextMenu={e => e.preventDefault()}
          defaultValue=""
          placeholder="Click here and start typing…"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          style={{
            width: '100%', minHeight: 90, marginTop: 14,
            fontFamily: 'monospace', fontSize: 20,
            padding: '12px 16px', borderRadius: 10,
            border: '2px solid var(--accent)',
            background: 'var(--bg, #fff)',
            resize: 'none', outline: 'none', boxSizing: 'border-box',
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        <div className="row" style={{ marginTop: 10, gap: 18, fontSize: 13, color: 'var(--muted)' }}>
          <span>Typed: <b style={{ color: 'var(--fg)' }}>{startIndex + typedChars.length}</b></span>
          <span>Errors: <b style={{ color: errorCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>{errorCount}</b></span>
          {pasteCount > 0 && <span style={{ color: 'var(--bad)' }}>⚠ Paste blocked ({pasteCount}×)</span>}
          {mode === 'TIMED_DRILL' && (
            <button className="btn small" onClick={() => finishSession()} style={{ marginLeft: 'auto' }}>
              Submit Now
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Result screen ──────────────────────────────────────────────────────────
  if (phase === 'result') {
    const r = result || {};
    return (
      <div>
        <h3 style={{ marginBottom: 16 }}>
          Session Complete {r.isVoided ? '— Voided' : '✓'}
        </h3>

        {r.error && (
          <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid var(--bad)' }}>
            <b style={{ color: 'var(--bad)' }}>Error saving session:</b> {r.error}
          </div>
        )}

        {r.isVoided && (
          <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid var(--bad)', background: 'var(--bad-soft, #fee2e2)' }}>
            <b style={{ color: 'var(--bad)' }}>Session Voided</b>
            <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--muted)' }}>
              {r.voidReason === 'paste_attempts'
                ? 'Copy-paste was detected.'
                : 'Window focus was lost too many times.'}{' '}
              This session will not count toward your score or streak.
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
          {[
            {
              label: 'WPM',
              value: r.wpm ?? '—',
              color: r.wpm >= 60 ? 'var(--ok)' : r.wpm >= 40 ? 'var(--warn)' : 'var(--fg)',
            },
            {
              label: 'Accuracy',
              value: r.accuracy != null ? `${r.accuracy}%` : '—',
              color: r.accuracy >= 95 ? 'var(--ok)' : r.accuracy >= 80 ? 'var(--warn)' : 'var(--bad)',
            },
            {
              label: 'Points',
              value: r.isVoided ? '0' : (r.leaderboardPts ?? '—'),
              color: 'var(--accent)',
            },
            {
              label: 'Streak',
              value: r.isVoided ? '—' : `${r.streak ?? 0} days`,
              color: r.streak >= 7 ? 'var(--ok)' : 'var(--fg)',
            },
          ].map(kpi => (
            <div key={kpi.label} className="kpi-card" style={{ padding: '16px 20px' }}>
              <div className="kpi-label" style={{ fontSize: 13, marginBottom: 4 }}>{kpi.label}</div>
              <div className="kpi-value" style={{ color: kpi.color, fontSize: 32, fontWeight: 900 }}>
                {saving ? '…' : kpi.value}
              </div>
            </div>
          ))}
        </div>

        {r.isPersonalBest && !r.isVoided && (
          <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid var(--ok)' }}>
            <b>🏆 New Personal Best!</b>
          </div>
        )}

        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <button className="btn accent" onClick={() => setPhase('pick')}>Practice Again</button>
        </div>
      </div>
    );
  }

  // ── Prompt picker ──────────────────────────────────────────────────────────
  return (
    <div>
      <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>⌨️ Typing Practice</h3>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={`btn small${mode === 'PASSAGE' ? ' accent' : ' secondary'}`}
            onClick={() => setMode('PASSAGE')}
          >
            Passage Test
          </button>
          <button
            className={`btn small${mode === 'TIMED_DRILL' ? ' accent' : ' secondary'}`}
            onClick={() => setMode('TIMED_DRILL')}
          >
            Timed Drill
          </button>
        </div>
      </div>

      {mode === 'TIMED_DRILL' && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)', marginRight: 4 }}>Duration:</span>
          {[60, 180, 300].map(d => (
            <button
              key={d}
              className={`btn small${drillDuration === d ? ' accent' : ' secondary'}`}
              onClick={() => setDrillDuration(d)}
            >
              {d === 60 ? '1 min' : d === 180 ? '3 min' : '5 min'}
            </button>
          ))}
        </div>
      )}

      {loadingPrompts ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-card" style={{ height: 90 }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginBottom: 20 }}>
          {activePrompts.map(p => (
            <div
              key={p.id}
              className="card"
              style={{ cursor: 'pointer', padding: '14px 16px' }}
              onClick={() => startSession(p)}
            >
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className={`pill ${DIFFICULTY_COLOR[p.difficulty] || ''}`}>
                  {DIFFICULTY_LABEL[p.difficulty] || p.difficulty}
                </span>
                {p.mode === 'TIMED_DRILL' && p.durationSeconds && (
                  <span className="pill">{Math.round(p.durationSeconds / 60)}m</span>
                )}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {p.wordCount ? `${p.wordCount} words` : ''}
                {p.wordCount && p.tags?.length ? ' · ' : ''}
                {(Array.isArray(p.tags) ? p.tags : []).slice(0, 2).join(', ')}
              </div>
              <div style={{ marginTop: 10 }}>
                <span className="btn small accent" style={{ pointerEvents: 'none' }}>Start →</span>
              </div>
            </div>
          ))}
          {activePrompts.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>No prompts available for this mode.</p>
          )}
        </div>
      )}

      {/* Recent session history */}
      {history && history.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            My Recent Sessions
          </div>
          {/* Sparkline trend: last 10 WPM values */}
          {history.filter(s => !s.isVoided).length >= 2 && (
            <div style={{ marginBottom: 10 }}>
              <Sparkline values={history.filter(s => !s.isVoided).slice(0, 10).reverse().map(s => s.wpm || 0)} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>WPM trend (last {Math.min(10, history.filter(s => !s.isVoided).length)} valid sessions)</span>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Date', 'Mode', 'WPM', 'Accuracy', 'Duration', 'Status', 'Pts'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '7px 8px' }}>
                      {new Date(s.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </td>
                    <td style={{ padding: '7px 8px' }}>
                      <span className="pill">{s.mode === 'TIMED_DRILL' ? 'Drill' : 'Passage'}</span>
                    </td>
                    <td style={{ padding: '7px 8px', fontWeight: 700 }}>{s.wpm}</td>
                    <td style={{ padding: '7px 8px' }}>{s.accuracy}%</td>
                    <td style={{ padding: '7px 8px' }}>{s.durationSeconds}s</td>
                    <td style={{ padding: '7px 8px' }}>
                      {s.isVoided
                        ? <span className="pill bad">Voided</span>
                        : <span className="pill ok">Valid</span>}
                    </td>
                    <td style={{ padding: '7px 8px', fontWeight: 700, color: 'var(--accent)' }}>
                      {s.isVoided ? 0 : (s.leaderboardPts ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
