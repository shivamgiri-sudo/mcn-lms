import { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api.js';

export default function AssessmentModal({ assessmentId, onClose }) {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);

  useEffect(() => {
    load();
    return () => clearInterval(timerRef.current);
  }, []);

  async function load() {
    setLoading(true);
    const res = await api.get(`/trainee/assessment/${assessmentId}`, 'trainee');
    setLoading(false);
    if (res.ok) setData(res.data);
    else setMsg(res.message || 'Failed to load assessment.');
  }

  function startAssessment() {
    setStarted(true);
    startedAtRef.current = Date.now();
    const secs = (data.assessment.timeLimitMins || 30) * 60;
    setTimeLeft(secs);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); submitAssessment(true); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function submitAssessment(autoSubmit = false) {
    if (!autoSubmit) {
      const unanswered = (data?.questions || []).filter(q => !answers[q.questionId]).length;
      if (unanswered > 0 && !window.confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
    }
    clearInterval(timerRef.current);
    setSubmitting(true);
    const timeTaken = Math.round((Date.now() - (startedAtRef.current || Date.now())) / 1000);
    const res = await api.post(`/trainee/assessment/${assessmentId}/submit`, { answers, timeTakenSeconds: timeTaken }, 'trainee');
    setSubmitting(false);
    if (res.ok) setResult(res.data);
    else setMsg(res.message || 'Submission failed.');
  }

  function formatTime(secs) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const answered = Object.keys(answers).length;
  const total = data?.questions?.length || 0;
  const isWarningTime = timeLeft !== null && timeLeft < 60;

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 760 }}>
        <div className="modal-head">
          <div>
            <b>{data?.assessment?.assessmentName || 'Assessment'}</b>
            {data && (
              <div className="row" style={{ gap: 8, marginTop: 5 }}>
                <span className="pill">Pass: {data.assessment.passingPct}%</span>
                <span className="pill">{data.assessment.attemptsUsed}/{data.assessment.attemptLimit} attempts</span>
              </div>
            )}
          </div>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}
          {msg && <div className="toast bad">{msg}</div>}

          {/* Result view */}
          {result && (
            <div>
              <div style={{
                textAlign: 'center', padding: '28px 20px',
                background: result.result === 'Pass' ? 'var(--ok-soft)' : 'var(--bad-soft)',
                borderRadius: 16, marginBottom: 20,
                border: `2px solid ${result.result === 'Pass' ? '#a7f3d0' : '#fecaca'}`,
              }}>
                <div style={{ fontSize: 52, marginBottom: 4 }}>
                  {result.result === 'Pass' ? '🎉' : '📝'}
                </div>
                <div style={{ fontSize: 44, fontWeight: 900, color: result.result === 'Pass' ? 'var(--ok)' : 'var(--bad)', letterSpacing: '-.03em' }}>
                  {result.percentage}%
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: result.result === 'Pass' ? 'var(--ok)' : 'var(--bad)', marginTop: 4 }}>
                  {result.result}
                </div>
                <div className="row" style={{ gap: 12, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <span className="pill ok">✓ {result.correct} correct</span>
                  <span className="pill bad">✗ {result.wrong} wrong</span>
                  {result.blank > 0 && <span className="pill">{result.blank} skipped</span>}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>Passing score: {result.passingPct}%</div>
              </div>

              {result.result === 'Pass' ? (
                <div className="ok-box" style={{ marginBottom: 14, textAlign: 'center' }}>
                  🎉 Congratulations! You passed with {result.percentage}%.
                  {result.percentage >= 90 && ' Excellent performance!'}
                </div>
              ) : (
                <div className="warn-box" style={{ marginBottom: 14 }}>
                  <b>Not quite there yet.</b> You scored {result.percentage}% but need {result.passingPct}% to pass.
                  {result.attemptsLeft > 0
                    ? ` You have ${result.attemptsLeft} attempt(s) remaining.`
                    : result.attemptsLeft === 0
                    ? ' You have used all your attempts.'
                    : ''}
                </div>
              )}

              <h3 className="section-title">Answer Review</h3>
              {(() => {
                const revealAnswers = result.result === 'Pass' || result.attemptsLeft === 0;
                return (result.review || []).map((q, i) => {
                  const correct = revealAnswers ? q.yourAnswer === q.correctOption : null;
                  const notAnswered = !q.yourAnswer;

                const yourAnswerColor = notAnswered
                  ? 'var(--muted)'
                  : !revealAnswers
                  ? 'var(--fg)'
                  : correct
                  ? 'var(--ok)'
                  : 'var(--bad)';

                const borderColor = notAnswered
                  ? 'var(--line)'
                  : correct === true
                  ? '#a7f3d0'
                  : correct === false
                  ? '#fecaca'
                  : 'var(--line)';

                const bgColor = notAnswered
                  ? '#fafafa'
                  : correct === true
                  ? 'var(--ok-soft)'
                  : correct === false
                  ? 'var(--bad-soft)'
                  : '#fafafa';

                return (
                  <div key={q.questionId} style={{
                    border: `1.5px solid ${borderColor}`,
                    borderRadius: 12, padding: 14, marginBottom: 9,
                    background: bgColor,
                  }}>
                    <b style={{ fontSize: 13 }}>Q{i + 1}. {q.questionText}</b>
                    <div className="row" style={{ gap: 12, marginTop: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5 }}>
                        Your answer:{' '}
                        <b style={{ color: yourAnswerColor }}>
                          {q.yourAnswer || 'Not answered'}
                        </b>
                      </span>
                      {revealAnswers && q.correctOption && (
                        <span style={{ fontSize: 12.5 }}>
                          Correct: <b style={{ color: 'var(--ok)' }}>{q.correctOption}</b>
                        </span>
                      )}
                      {!revealAnswers && !notAnswered && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Answer hidden — attempt again to reveal
                        </span>
                      )}
                    </div>
                    {revealAnswers && q.explanation && (
                      <div style={{ marginTop: 7, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                        💡 {q.explanation}
                      </div>
                    )}
                  </div>
                );
              });
              })()}
              <button className="btn secondary" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>Close</button>
            </div>
          )}

          {/* Intro screen */}
          {!started && !result && data && (
            <div>
              <div className="card" style={{ marginBottom: 18, padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Instructions</div>
                <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>
                  {data.assessment.instructions || 'Answer all questions. Each correct answer carries marks as specified.'}
                </p>
                <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <span className="pill info">{data.questions.length} questions</span>
                  <span className="pill info">{data.assessment.timeLimitMins} minutes</span>
                  <span className="pill info">Pass at {data.assessment.passingPct}%</span>
                  <span className="pill">{data.assessment.attemptLimit - data.assessment.attemptsUsed} attempt(s) left</span>
                </div>
                {data.bestResult && (
                  <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: data.bestResult.result === 'Pass' ? 'var(--ok-soft)' : 'var(--bad-soft)', fontSize: 13 }}>
                    Previous best: <b style={{ color: data.bestResult.result === 'Pass' ? 'var(--ok)' : 'var(--bad)' }}>
                      {data.bestResult.bestPercentage}% ({data.bestResult.result})
                    </b>
                  </div>
                )}
              </div>
              <button className="btn accent" style={{ width: '100%', padding: '12px 0', fontSize: 14 }} onClick={startAssessment}>
                Start Assessment →
              </button>
            </div>
          )}

          {/* Questions */}
          {started && !result && data && (
            <div>
              <div className="row between" style={{ marginBottom: 14, padding: '10px 14px', background: '#f8fafc', borderRadius: 12, border: '1.5px solid var(--line)' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {answered}/{total} answered
                </span>
                <span style={{
                  fontWeight: 900, fontSize: 16, letterSpacing: '.02em',
                  color: isWarningTime ? 'var(--bad)' : answered === total ? 'var(--ok)' : 'var(--ink)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {isWarningTime ? '⚠ ' : ''}{formatTime(timeLeft)}
                </span>
              </div>

              {data.questions.map((q, i) => (
                <div key={q.questionId} className="card" style={{ marginBottom: 12 }}>
                  <b style={{ fontSize: 13.5, lineHeight: 1.5, display: 'block', marginBottom: 10 }}>
                    <span style={{ color: 'var(--accent)', marginRight: 6 }}>Q{i + 1}.</span>
                    {q.questionText}
                  </b>
                  <div>
                    {['A', 'B', 'C', 'D'].filter(opt => q[`option${opt}`]).map(opt => (
                      <div
                        key={opt}
                        className={`option-row${answers[q.questionId] === opt ? ' selected' : ''}`}
                        onClick={() => setAnswers(prev => ({ ...prev, [q.questionId]: opt }))}
                      >
                        <div style={{
                          width: 24, height: 24, borderRadius: 6,
                          background: answers[q.questionId] === opt ? 'var(--brand)' : 'var(--line)',
                          color: answers[q.questionId] === opt ? '#fff' : 'var(--muted)',
                          display: 'grid', placeItems: 'center',
                          fontWeight: 900, fontSize: 11, flexShrink: 0,
                        }}>
                          {opt}
                        </div>
                        <span style={{ fontSize: 13.5 }}>{q[`option${opt}`]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="row" style={{ gap: 10, marginTop: 18 }}>
                <button
                  className="btn accent"
                  style={{ flex: 1, justifyContent: 'center', padding: '12px 0' }}
                  onClick={() => submitAssessment(false)}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting...' : `Submit Assessment (${answered}/${total})`}
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
