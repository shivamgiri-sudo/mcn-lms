import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(startAt, endAt) {
  const minutes = Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`;
}

function statusClass(value) {
  const status = String(value || '').toUpperCase();
  if (['CONFIRMED', 'ATTENDED', 'COMPLETED', 'PRESENT'].includes(status)) return 'ok';
  if (['WAITLISTED', 'LATE', 'IN_PROGRESS'].includes(status)) return 'warn';
  if (['NO_SHOW', 'CANCELLED', 'ABSENT'].includes(status)) return 'bad';
  return 'info';
}

function SessionCard({ session, mode, busy, onEnroll, onCancel, onCheckin, onFeedback }) {
  const blockers = session.prerequisites?.blockers || [];
  const joiningLink = session.virtualJoinUrl || session.venueJoinUrl;
  return (
    <article className="ilt-session-card">
      <div className="ilt-session-date"><b>{new Date(session.startAt).toLocaleDateString('en-IN', { day: '2-digit' })}</b><span>{new Date(session.startAt).toLocaleDateString('en-IN', { month: 'short' })}</span></div>
      <div className="ilt-session-main">
        <div className="ilt-session-title-row"><div><span className={`ilt-status ${statusClass(session.enrollmentStatus || session.status)}`}>{session.enrollmentStatus || session.status}</span><h3>{session.title}</h3></div><span className="ilt-mode">{session.deliveryMode}</span></div>
        <p>{formatDate(session.startAt)} · {duration(session.startAt, session.endAt)} · {session.timezone}</p>
        <p>{session.venueName || session.roomLocation || (session.deliveryMode === 'VIRTUAL' ? 'Virtual session' : 'Venue to be confirmed')}</p>
        <div className="ilt-meta-row"><span>{session.sessionType}</span>{session.batchNo && <span>Batch {session.batchNo}</span>}<span>{session.confirmedCount || 0}/{session.capacity} seats</span>{session.waitlistCount > 0 && <span>{session.waitlistCount} waiting</span>}</div>
        {blockers.length > 0 && <div className="ilt-blockers"><b>Prerequisites pending</b>{blockers.map(item => <span key={`${item.prerequisiteType}-${item.referenceId}`}>{item.prerequisiteType}: {item.referenceId}</span>)}</div>}
        {session.enrollmentStatus === 'WAITLISTED' && <p className="ilt-note warn">Waitlist position: {session.waitlistPosition || '—'}. Promotion is automatic when a seat opens.</p>}
        {mode === 'history' && session.attendanceStatus && <p className={`ilt-note ${statusClass(session.attendanceStatus)}`}>Attendance: {session.attendanceStatus} · {Number(session.attendancePct || 0).toFixed(0)}%</p>}
      </div>
      <div className="ilt-session-actions">
        {mode === 'available' && <button className="btn small" disabled={busy || blockers.length > 0} onClick={() => onEnroll(session)}>{busy ? 'Working…' : session.seatsRemaining > 0 ? 'Reserve seat' : 'Join waitlist'}</button>}
        {mode === 'upcoming' && session.enrollmentStatus === 'CONFIRMED' && <button className="btn small" disabled={busy} onClick={() => onCheckin(session)}>Check in</button>}
        {mode === 'upcoming' && ['CONFIRMED', 'WAITLISTED'].includes(session.enrollmentStatus) && <button className="btn small secondary" disabled={busy} onClick={() => onCancel(session)}>Cancel</button>}
        {mode === 'upcoming' && joiningLink && session.enrollmentStatus === 'CONFIRMED' && <a className="btn small secondary" href={joiningLink} target="_blank" rel="noreferrer">Join session</a>}
        {mode === 'history' && ['ATTENDED', 'NO_SHOW'].includes(session.enrollmentStatus) && <button className="btn small secondary" disabled={busy} onClick={() => onFeedback(session)}>Feedback</button>}
      </div>
    </article>
  );
}

export default function LearnerCalendarView() {
  const [data, setData] = useState({ upcoming: [], available: [], history: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [active, setActive] = useState('upcoming');
  const [checkin, setCheckin] = useState(null);
  const [feedback, setFeedback] = useState(null);

  async function load() {
    setLoading(true); setError('');
    const result = await api.get('/ilt/trainee/calendar', 'trainee');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load the live-training calendar.');
    setData(result.data || { upcoming: [], available: [], history: [], summary: {} });
  }

  useEffect(() => { load(); }, []);

  async function enrol(session) {
    setBusy(session.sessionId); setError(''); setMessage('');
    const result = await api.post(`/ilt/trainee/sessions/${encodeURIComponent(session.sessionId)}/enroll`, {}, 'trainee');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not reserve the session.');
    setMessage(result.message || 'Session reserved.');
    await load();
  }

  async function cancel(session) {
    const reason = window.prompt('Why are you cancelling this session?', 'Schedule conflict');
    if (reason === null) return;
    setBusy(session.sessionId); setError(''); setMessage('');
    const result = await api.post(`/ilt/trainee/enrollments/${encodeURIComponent(session.enrollmentId)}/cancel`, { reason }, 'trainee');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not cancel the enrolment.');
    setMessage('Enrolment cancelled. A waitlisted learner may be promoted automatically.');
    await load();
  }

  async function submitCheckin(event) {
    event.preventDefault();
    setBusy(checkin.sessionId); setError(''); setMessage('');
    const result = await api.post(`/ilt/trainee/sessions/${encodeURIComponent(checkin.sessionId)}/check-in`, { code: checkin.code }, 'trainee');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Check-in failed.');
    setMessage('Check-in recorded successfully.');
    setCheckin(null);
    await load();
  }

  async function submitFeedback(event) {
    event.preventDefault();
    setBusy(feedback.sessionId); setError(''); setMessage('');
    const result = await api.post(`/ilt/trainee/sessions/${encodeURIComponent(feedback.sessionId)}/feedback`, feedback, 'trainee');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save feedback.');
    setMessage('Thank you. Your session feedback was saved.');
    setFeedback(null);
  }

  const sections = useMemo(() => ({ upcoming: data.upcoming || [], available: data.available || [], history: data.history || [] }), [data]);
  if (loading) return <div className="ilt-loading"><div className="spinner" /><p>Loading your live-learning calendar…</p></div>;

  return (
    <section className="ilt-view">
      <div className="ilt-hero"><div><span>Your scheduled learning</span><h1>Live Training Calendar</h1><p>Reserve seats, complete prerequisites, join instructor-led sessions and retain verified attendance evidence.</p></div><button className="btn small secondary" onClick={load}>↻ Refresh</button></div>
      {message && <div className="toast ok">{message}</div>}
      {error && <div className="toast bad">{error}</div>}
      <div className="ilt-summary-grid">
        <div><span>Confirmed</span><b>{data.summary?.confirmed || 0}</b><small>Upcoming reserved seats</small></div>
        <div className="warn"><span>Waitlisted</span><b>{data.summary?.waitlisted || 0}</b><small>Automatic FIFO promotion</small></div>
        <div className="ok"><span>Attended</span><b>{data.summary?.attended || 0}</b><small>Verified live learning</small></div>
        <div><span>Available</span><b>{data.summary?.available || 0}</b><small>Eligible sessions</small></div>
      </div>
      <div className="ilt-switcher"><button className={active === 'upcoming' ? 'active' : ''} onClick={() => setActive('upcoming')}>My schedule ({sections.upcoming.length})</button><button className={active === 'available' ? 'active' : ''} onClick={() => setActive('available')}>Discover ({sections.available.length})</button><button className={active === 'history' ? 'active' : ''} onClick={() => setActive('history')}>History ({sections.history.length})</button></div>
      <div className="ilt-session-list">
        {sections[active].map(session => <SessionCard key={session.sessionId} session={session} mode={active} busy={busy === session.sessionId} onEnroll={enrol} onCancel={cancel} onCheckin={item => setCheckin({ sessionId: item.sessionId, title: item.title, code: '' })} onFeedback={item => setFeedback({ sessionId: item.sessionId, title: item.title, rating: 5, confidenceBefore: 3, confidenceAfter: 4, comments: '' })} />)}
        {!sections[active].length && <div className="ilt-empty"><b>No sessions in this view</b><p>{active === 'available' ? 'New sessions will appear when they match your branch, process, LOB, batch and prerequisites.' : 'Your live-learning record is clear.'}</p></div>}
      </div>

      {checkin && <div className="ilt-modal-backdrop" role="presentation"><form className="ilt-modal" onSubmit={submitCheckin}><div><span>Secure attendance</span><h3>Check in to {checkin.title}</h3><p>Enter the six-digit code shown by the instructor during the active check-in window.</p></div><label>Check-in code<input className="input" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" required value={checkin.code} onChange={event => setCheckin(item => ({ ...item, code: event.target.value.replace(/\D/g, '') }))} /></label><div><button type="button" className="btn secondary" onClick={() => setCheckin(null)}>Cancel</button><button className="btn" disabled={busy === checkin.sessionId || checkin.code.length !== 6}>Confirm check-in</button></div></form></div>}
      {feedback && <div className="ilt-modal-backdrop" role="presentation"><form className="ilt-modal" onSubmit={submitFeedback}><div><span>Session reflection</span><h3>{feedback.title}</h3><p>Your feedback helps improve future sessions and instructor effectiveness.</p></div><div className="ilt-form-grid"><label>Rating<select className="select" value={feedback.rating} onChange={event => setFeedback(item => ({ ...item, rating: Number(event.target.value) }))}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label><label>Confidence after<select className="select" value={feedback.confidenceAfter} onChange={event => setFeedback(item => ({ ...item, confidenceAfter: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label></div><label>Comments<textarea className="input" value={feedback.comments} onChange={event => setFeedback(item => ({ ...item, comments: event.target.value }))} placeholder="What helped most? What should improve?" /></label><div><button type="button" className="btn secondary" onClick={() => setFeedback(null)}>Cancel</button><button className="btn" disabled={busy === feedback.sessionId}>Submit feedback</button></div></form></div>}
    </section>
  );
}
