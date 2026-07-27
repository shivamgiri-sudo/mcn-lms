import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../utils/api.js';

const ENGINE_BASE = '/assessment-intelligence/learner';

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function priorityClass(priority) {
  if (priority === 'CRITICAL' || priority === 'HIGH') return 'bad';
  if (priority === 'MEDIUM') return 'warn';
  return 'info';
}

export default function AssessmentModal({ assessmentId, onClose }) {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [responseSeconds, setResponseSeconds] = useState({});
  const [flags, setFlags] = useState({});
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);
  const lastInteractionRef = useRef(Date.now());
  const submittedRef = useRef(false);

  useEffect(() => {
    load();
    return () => clearInterval(timerRef.current);
  }, [assessmentId]);

  async function load() {
    setLoading(true);
    setMessage('');
    const response = await api.get(`${ENGINE_BASE}/assessment/${assessmentId}`, 'trainee');
    setLoading(false);
    if (!response.ok) {
      setMessage(response.message || 'Failed to load assessment.');
      return;
    }
    setData(response.data);
    const seconds = Number(response.data?.assessment?.timeLeftSeconds ?? response.data?.assessment?.effectiveTimeLimitSeconds ?? 0);
    setTimeLeft(Math.max(0, seconds));
    startTimer();
  }

  function startTimer() {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(previous => {
        if (previous === null) return previous;
        if (previous <= 1) {
          clearInterval(timerRef.current);
          queueMicrotask(() => submitAssessment(true));
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  }

  function startAssessment() {
    setStarted(true);
    lastInteractionRef.current = Date.now();
  }

  function chooseAnswer(questionId, option) {
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(3600, Math.round((now - lastInteractionRef.current) / 1000)));
    lastInteractionRef.current = now;
    setResponseSeconds(previous => ({ ...previous, [questionId]: Number(previous[questionId] || 0) + elapsed }));
    setAnswers(previous => ({ ...previous, [questionId]: option }));
  }

  function toggleFlag(questionId) {
    setFlags(previous => ({ ...previous, [questionId]: !previous[questionId] }));
  }

  async function submitAssessment(autoSubmit = false) {
    if (submittedRef.current || submitting || !data?.assessment?.attemptId) return;
    if (!autoSubmit) {
      const unanswered = (data.questions || []).filter(question => !answers[question.questionId]).length;
      if (unanswered > 0 && !window.confirm(`${unanswered} question(s) are unanswered. Submit anyway?`)) return;
    }

    submittedRef.current = true;
    clearInterval(timerRef.current);
    setSubmitting(true);
    setMessage('');
    const response = await api.post(
      `${ENGINE_BASE}/assessment/${assessmentId}/submit`,
      {
        attemptId: data.assessment.attemptId,
        answers,
        responseSeconds,
        flags,
        autoSubmitted: autoSubmit,
      },
      'trainee',
    );
    setSubmitting(false);
    if (response.ok) {
      setResult(response.data);
      return;
    }
    submittedRef.current = false;
    setMessage(response.message || 'Submission failed.');
    if (!autoSubmit && timeLeft > 0) startTimer();
  }

  const answered = Object.keys(answers).length;
  const total = data?.questions?.length || 0;
  const warningTime = timeLeft !== null && timeLeft < 60;
  const accommodation = data?.assessment?.accommodation || null;
  const displayPreferences = accommodation?.displayPreferences || {};
  const fontScale = Math.max(0.9, Math.min(1.5, Number(displayPreferences.fontScale || 1)));
  const highContrast = Boolean(displayPreferences.highContrast);
  const unanswered = Math.max(0, total - answered);
  const progressPct = total ? Math.round((answered / total) * 100) : 0;

  const flaggedCount = useMemo(() => Object.values(flags).filter(Boolean).length, [flags]);

  return (
    <div className="modal-overlay">
      <div
        className="modal-box"
        style={{
          maxWidth: 900,
          fontSize: `${fontScale}em`,
          ...(highContrast ? { background: '#fff', color: '#000', border: '3px solid #000' } : {}),
        }}
      >
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <b>{data?.assessment?.assessmentName || 'Assessment'}</b>
            {data && (
              <div className="row" style={{ gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
                <span className="pill">Pass: {data.assessment.passingPct}%</span>
                <span className="pill">Attempt {data.assessment.attemptNo}/{data.assessment.attemptLimit}</span>
                <span className="pill info">{data.questions.length} governed questions</span>
                {data.assessment.blueprintVersion && <span className="pill accent">Blueprint v{data.assessment.blueprintVersion}</span>}
                {accommodation && <span className="pill ok">Accommodation applied</span>}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {timeLeft !== null && !result && (
              <span className={`pill ${warningTime ? 'bad' : 'info'}`} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 900 }}>
                {warningTime ? '⚠ ' : ''}{formatTime(timeLeft)}
              </span>
            )}
            <button className="btn small secondary" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="modal-body">
          {loading && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}
          {message && <div className="toast bad" style={{ marginBottom: 12 }}>{message}</div>}

          {result && (
            <div>
              <div
                style={{
                  textAlign: 'center',
                  padding: '28px 20px',
                  background: result.result === 'Pass' ? 'var(--ok-soft)' : 'var(--bad-soft)',
                  borderRadius: 16,
                  marginBottom: 18,
                  border: `2px solid ${result.result === 'Pass' ? '#a7f3d0' : '#fecaca'}`,
                }}
              >
                <div style={{ fontSize: 52 }}>{result.result === 'Pass' ? '🎉' : '🧭'}</div>
                <div style={{ fontSize: 44, fontWeight: 900, color: result.result === 'Pass' ? 'var(--ok)' : 'var(--bad)' }}>{result.percentage}%</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: result.result === 'Pass' ? 'var(--ok)' : 'var(--bad)' }}>{result.result}</div>
                <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <span className="pill ok">✓ {result.correct} correct</span>
                  <span className="pill bad">✗ {result.wrong} wrong</span>
                  <span className="pill">{result.blank} blank</span>
                  <span className="pill info">{result.attemptsLeft} attempt(s) left</span>
                </div>
              </div>

              {result.result !== 'Pass' && (
                <div className="warn-box" style={{ marginBottom: 14 }}>
                  <b>Evidence-based next steps are ready.</b> Review the missed concepts before your next attempt.
                </div>
              )}

              {(result.recommendations || []).length > 0 && (
                <section style={{ marginBottom: 18 }}>
                  <h3 className="section-title">Recommended remediation</h3>
                  <div style={{ display: 'grid', gap: 9 }}>
                    {result.recommendations.map(item => (
                      <div key={item.recommendationId || `${item.recommendationType}-${item.referenceId}`} className="card" style={{ padding: 14 }}>
                        <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
                          <div>
                            <b style={{ fontSize: 13.5 }}>{item.title}</b>
                            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{item.reason}</p>
                          </div>
                          <span className={`pill ${priorityClass(item.priority)}`}>{item.priority}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <h3 className="section-title">Answer review</h3>
              {(result.review || []).map((question, index) => (
                <div key={question.questionId} className="card" style={{ marginBottom: 9, padding: 14 }}>
                  <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <b style={{ fontSize: 13 }}>Q{index + 1}. {question.questionText}</b>
                    {question.isCorrect !== null && (
                      <span className={`pill ${question.isCorrect ? 'ok' : 'bad'}`}>{question.isCorrect ? 'Correct' : 'Review'}</span>
                    )}
                  </div>
                  <div className="row" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <span>Your answer: <b>{question.yourAnswer || 'Not answered'}</b></span>
                    {question.correctOption && <span>Correct: <b style={{ color: 'var(--ok)' }}>{question.correctOption}</b></span>}
                    {question.topic && <span className="pill info">{question.topic}</span>}
                    {question.difficulty && <span className="pill">{question.difficulty}</span>}
                  </div>
                  {question.explanation && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>💡 {question.explanation}</div>}
                </div>
              ))}
              <button className="btn secondary" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>Close</button>
            </div>
          )}

          {!started && !result && data && (
            <div>
              <div className="card" style={{ marginBottom: 16, padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Instructions</div>
                <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>
                  {data.assessment.instructions || 'Answer each question carefully. This form is generated and timed by the server.'}
                </p>
                <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <span className="pill info">{data.questions.length} questions</span>
                  <span className="pill info">{data.assessment.timeLimitMins} effective minutes</span>
                  <span className="pill info">Pass at {data.assessment.passingPct}%</span>
                  <span className="pill">{data.assessment.attemptLimit - data.assessment.attemptsUsed} attempt(s) available</span>
                </div>
                {accommodation && (
                  <div className="ok-box" style={{ marginTop: 12 }}>
                    <b>Approved accommodation applied.</b>{' '}
                    Time multiplier {Number(accommodation.timeMultiplier || 1).toFixed(2)}×
                    {accommodation.extraBreakMinutes ? ` · ${accommodation.extraBreakMinutes} extra break minutes` : ''}
                    {accommodation.languageCode ? ` · ${accommodation.languageCode}` : ''}.
                  </div>
                )}
                <div className="warn-box" style={{ marginTop: 12 }}>
                  The server timer began when this form was issued. Current remaining time: <b>{formatTime(timeLeft)}</b>.
                </div>
                {data.bestResult && (
                  <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: data.bestResult.result === 'Pass' ? 'var(--ok-soft)' : 'var(--bad-soft)', fontSize: 13 }}>
                    Previous best: <b>{data.bestResult.bestPercentage}% ({data.bestResult.result})</b>
                  </div>
                )}
              </div>
              <button className="btn accent" style={{ width: '100%', padding: '12px 0' }} onClick={startAssessment} disabled={timeLeft <= 0}>
                Begin governed assessment →
              </button>
            </div>
          )}

          {started && !result && data && (
            <div>
              <div className="card" style={{ marginBottom: 14, padding: 12, position: 'sticky', top: 0, zIndex: 4 }}>
                <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <b style={{ fontSize: 13 }}>{answered}/{total} answered</b>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{unanswered} remaining · {flaggedCount} flagged</span>
                  </div>
                  <b style={{ color: warningTime ? 'var(--bad)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(timeLeft)}</b>
                </div>
                <div className="progress-shell" style={{ height: 6, marginTop: 8 }}><div className="progress-bar" style={{ width: `${progressPct}%` }} /></div>
              </div>

              {data.questions.map((question, index) => (
                <div key={question.questionId} className="card" style={{ marginBottom: 12, border: flags[question.questionId] ? '2px solid var(--warn)' : undefined }}>
                  <div className="row between" style={{ gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <b style={{ fontSize: 13.5, lineHeight: 1.5 }}><span style={{ color: 'var(--accent)' }}>Q{index + 1}.</span> {question.questionText}</b>
                      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        {question.topic && <span className="pill info">{question.topic}</span>}
                        {question.difficulty && <span className="pill">{question.difficulty}</span>}
                        {question.cognitiveLevel && <span className="pill">{question.cognitiveLevel}</span>}
                        <span className="pill accent">{question.marks} mark(s)</span>
                      </div>
                    </div>
                    <button className={`btn small ${flags[question.questionId] ? 'warn' : 'secondary'}`} onClick={() => toggleFlag(question.questionId)}>
                      {flags[question.questionId] ? '⚑ Flagged' : '⚐ Review'}
                    </button>
                  </div>
                  {['A', 'B', 'C', 'D'].filter(option => question[`option${option}`]).map(option => (
                    <button
                      type="button"
                      key={option}
                      className={`option-row${answers[question.questionId] === option ? ' selected' : ''}`}
                      onClick={() => chooseAnswer(question.questionId, option)}
                      style={{ width: '100%', textAlign: 'left' }}
                    >
                      <span style={{ width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', background: answers[question.questionId] === option ? 'var(--brand)' : 'var(--line)', color: answers[question.questionId] === option ? '#fff' : 'var(--muted)', fontWeight: 900, flexShrink: 0 }}>{option}</span>
                      <span>{question[`option${option}`]}</span>
                    </button>
                  ))}
                </div>
              ))}

              <div className="row" style={{ gap: 10, marginTop: 18 }}>
                <button className="btn accent" style={{ flex: 1, justifyContent: 'center', padding: '12px 0' }} onClick={() => submitAssessment(false)} disabled={submitting}>
                  {submitting ? 'Submitting…' : `Submit assessment (${answered}/${total})`}
                </button>
                <button className="btn secondary" onClick={onClose}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
