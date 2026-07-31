import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';

const emptySession = {
  title: '', description: '', batchNo: '', branch: '', classroomId: '', moduleId: '',
  sessionType: 'ILT', deliveryMode: 'IN_PERSON', venueId: '', virtualJoinUrl: '',
  timezone: 'Asia/Kolkata', startAt: '', endAt: '', capacity: 25, minimumAttendees: 1,
  minimumAttendancePct: 80, waitlistEnabled: true, selfEnrollmentEnabled: true,
  repeatCount: 1, repeatEveryDays: 1, leadInstructorId: '',
};
const emptyVenue = { venueCode: '', venueName: '', branch: '', venueType: 'CLASSROOM', roomLocation: '', timezone: 'Asia/Kolkata', capacity: 25, virtualJoinUrl: '', accessibilityNotes: '', active: true };
const emptyInstructor = { userId: '', userType: 'coordinator', instructorName: '', email: '', branch: '', processName: '', lobName: '', maxDailyMinutes: 480, active: true };
const emptyPolicy = { branch: '', processName: '', lobName: '', defaultCapacity: 25, waitlistEnabled: true, autoPromoteWaitlist: true, selfEnrollmentEnabled: true, minimumAttendancePct: 80, checkinOpenBeforeMins: 30, checkinCloseAfterMins: 30, cancellationCutoffMins: 120, active: true };

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(value) {
  const status = String(value || '').toUpperCase();
  if (['PUBLISHED', 'COMPLETED', 'CONFIRMED', 'ATTENDED', 'PRESENT'].includes(status)) return 'ok';
  if (['DRAFT', 'WAITLISTED', 'LATE', 'IN_PROGRESS'].includes(status)) return 'warn';
  if (['CANCELLED', 'NO_SHOW', 'ABSENT'].includes(status)) return 'bad';
  return 'info';
}

function Field({ label, children }) {
  return <label className="ilt-field"><span>{label}</span>{children}</label>;
}

export default function OperationsCalendarView({ role }) {
  const prefix = `/ilt/${role}`;
  const [dashboard, setDashboard] = useState({ sessions: [], summary: {} });
  const [catalog, setCatalog] = useState({ venues: [], instructors: [], policies: [], classrooms: [], modules: [], batches: [], skills: [] });
  const [view, setView] = useState('calendar');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [checkinCode, setCheckinCode] = useState(null);
  const [sessionForm, setSessionForm] = useState(emptySession);
  const [venueForm, setVenueForm] = useState(emptyVenue);
  const [instructorForm, setInstructorForm] = useState(emptyInstructor);
  const [policyForm, setPolicyForm] = useState(emptyPolicy);
  const [filter, setFilter] = useState('');

  async function load() {
    setLoading(true); setError('');
    const [dashboardResult, catalogResult] = await Promise.all([
      api.get(`${prefix}/dashboard`, role),
      api.get(`${prefix}/catalog`, role),
    ]);
    setLoading(false);
    if (!dashboardResult.ok) return setError(dashboardResult.message || 'Could not load the live-training dashboard.');
    setDashboard(dashboardResult.data || { sessions: [], summary: {} });
    if (catalogResult.ok) setCatalog(catalogResult.data || {});
  }

  useEffect(() => { load(); }, [role]);

  async function openSession(sessionId) {
    setBusy(`detail-${sessionId}`); setError('');
    const result = await api.get(`${prefix}/sessions/${encodeURIComponent(sessionId)}`, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not load session details.');
    setSelected(result.data);
  }

  async function createSession(event) {
    event.preventDefault();
    setBusy('create'); setError(''); setMessage('');
    const body = {
      ...sessionForm,
      instructorAssignments: sessionForm.leadInstructorId ? [{ instructorId: sessionForm.leadInstructorId, instructorRole: 'LEAD' }] : [],
    };
    const result = await api.post(`${prefix}/sessions`, body, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not create the session.');
    setMessage(result.message || 'Draft session created.');
    setSessionForm(emptySession);
    setView('calendar');
    await load();
  }

  async function lifecycle(action, sessionId, body = {}) {
    setBusy(`${action}-${sessionId}`); setError(''); setMessage('');
    const result = await api.post(`${prefix}/sessions/${encodeURIComponent(sessionId)}/${action}`, body, role);
    setBusy('');
    if (!result.ok) return setError(result.message || `Could not ${action} the session.`);
    setMessage(result.message || `Session ${action} completed.`);
    if (action === 'check-in-code') setCheckinCode({ ...result.data, sessionId });
    await load();
    if (selected?.session?.sessionId === sessionId) await openSession(sessionId);
  }

  async function bulkEnroll(session) {
    if (!session.batchNo) return setError('Select a batch-specific session before bulk enrolment.');
    await lifecycle('enroll', session.sessionId, { batchNo: session.batchNo });
  }

  async function cancelSession(session) {
    const reason = window.prompt('Provide the session cancellation reason:', 'Operational schedule change');
    if (reason === null) return;
    await lifecycle('cancel', session.sessionId, { reason });
  }

  async function saveAttendance(employeeId, attendanceStatus) {
    const sessionId = selected?.session?.sessionId;
    if (!sessionId) return;
    setBusy(`attendance-${employeeId}`); setError(''); setMessage('');
    const result = await api.put(`${prefix}/sessions/${encodeURIComponent(sessionId)}/attendance/${encodeURIComponent(employeeId)}`, { attendanceStatus, source: 'INSTRUCTOR' }, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save attendance.');
    setMessage(`Attendance saved for ${employeeId}.`);
    await openSession(sessionId);
  }

  async function saveVenue(event) {
    event.preventDefault(); setBusy('venue'); setError(''); setMessage('');
    const result = await api.post('/ilt/admin/venues', venueForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not create venue.');
    setMessage('Venue created.'); setVenueForm(emptyVenue); await load();
  }

  async function saveInstructor(event) {
    event.preventDefault(); setBusy('instructor'); setError(''); setMessage('');
    const result = await api.post('/ilt/admin/instructors', instructorForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save instructor.');
    setMessage('Instructor profile saved.'); setInstructorForm(emptyInstructor); await load();
  }

  async function savePolicy(event) {
    event.preventDefault(); setBusy('policy'); setError(''); setMessage('');
    const result = await api.put('/ilt/admin/policies', policyForm, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save policy.');
    setMessage('Live-training policy saved.'); setPolicyForm(emptyPolicy); await load();
  }

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return dashboard.sessions || [];
    return (dashboard.sessions || []).filter(item => [item.title, item.sessionCode, item.batchNo, item.venueName, item.branch, item.processName].some(value => String(value || '').toLowerCase().includes(query)));
  }, [dashboard.sessions, filter]);
  const modules = useMemo(() => (catalog.modules || []).filter(item => !sessionForm.classroomId || item.classroomId === sessionForm.classroomId), [catalog.modules, sessionForm.classroomId]);
  const selectedAttendance = useMemo(() => new Map((selected?.attendance || []).map(item => [item.employeeId, item])), [selected]);

  if (loading) return <div className="ilt-loading"><div className="spinner" /><p>Loading live-training operations…</p></div>;

  return (
    <section className="ilt-view">
      <div className="ilt-hero"><div><span>{role === 'admin' ? 'Branch and company governance' : 'Owned-batch operations'}</span><h1>{role === 'admin' ? 'Instructor-led Training Governance' : 'Batch Training Calendar'}</h1><p>Create conflict-free sessions, protect capacity, promote waitlists automatically and finalize attendance into auditable LMS evidence.</p></div><button className="btn small secondary" onClick={load}>↻ Refresh</button></div>
      {message && <div className="toast ok">{message}</div>}
      {error && <div className="toast bad">{error}</div>}
      <div className="ilt-summary-grid">
        <div><span>Total sessions</span><b>{dashboard.summary?.total || 0}</b><small>{dashboard.summary?.draft || 0} drafts</small></div>
        <div className="ok"><span>Published</span><b>{dashboard.summary?.published || 0}</b><small>Open and scheduled</small></div>
        <div className="warn"><span>Waitlisted</span><b>{dashboard.summary?.waitlisted || 0}</b><small>Pending seat promotion</small></div>
        <div><span>Utilization</span><b>{Number(dashboard.summary?.averageUtilization || 0).toFixed(0)}%</b><small>{dashboard.summary?.noShows || 0} no-shows</small></div>
      </div>
      <div className="ilt-switcher">
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Calendar</button>
        <button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}>Create session</button>
        {role === 'admin' && <button className={view === 'governance' ? 'active' : ''} onClick={() => setView('governance')}>Venues & policy</button>}
      </div>

      {view === 'calendar' && <div className="ilt-operations-grid"><section className="ilt-panel"><div className="ilt-section-head"><div><h2>Session register</h2><p>Draft, published, running and completed sessions in your scope.</p></div><input className="input ilt-search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search session, batch or venue" /></div><div className="ilt-register">{filtered.map(session => <article key={session.sessionId} className={selected?.session?.sessionId === session.sessionId ? 'selected' : ''}><div><span className={`ilt-status ${statusClass(session.status)}`}>{session.status}</span><h3>{session.title}</h3><p>{session.sessionCode} · {formatDate(session.startAt)}</p><div><span>{session.deliveryMode}</span>{session.batchNo && <span>Batch {session.batchNo}</span>}<span>{session.confirmedCount}/{session.capacity} seats</span>{session.waitlistCount > 0 && <span>{session.waitlistCount} waiting</span>}</div></div><div className="ilt-register-actions"><button className="btn xs secondary" onClick={() => openSession(session.sessionId)} disabled={busy === `detail-${session.sessionId}`}>Open</button>{session.status === 'DRAFT' && <button className="btn xs" onClick={() => lifecycle('publish', session.sessionId)} disabled={busy}>Publish</button>}{session.status === 'PUBLISHED' && session.batchNo && <button className="btn xs secondary" onClick={() => bulkEnroll(session)} disabled={busy}>Enrol batch</button>}{session.status === 'PUBLISHED' && <button className="btn xs secondary" onClick={() => lifecycle('check-in-code', session.sessionId)} disabled={busy}>Check-in code</button>}{session.status === 'PUBLISHED' && <button className="btn xs danger" onClick={() => cancelSession(session)} disabled={busy}>Cancel</button>}</div></article>)}{!filtered.length && <div className="ilt-empty"><b>No matching sessions</b><p>Create the first draft or change the search filter.</p></div>}</div></section>
      <aside className="ilt-panel ilt-detail-panel">{selected ? <><div className="ilt-section-head"><div><span className={`ilt-status ${statusClass(selected.session.status)}`}>{selected.session.status}</span><h2>{selected.session.title}</h2><p>{selected.session.sessionCode} · {formatDate(selected.session.startAt)}</p></div><button className="btn xs secondary" onClick={() => setSelected(null)}>Close</button></div><div className="ilt-detail-meta"><span><b>Venue</b>{selected.session.venueName || 'Virtual / TBD'}</span><span><b>Capacity</b>{selected.enrollments.filter(item => ['CONFIRMED', 'ATTENDED'].includes(item.status)).length}/{selected.session.capacity}</span><span><b>Waitlist</b>{selected.enrollments.filter(item => item.status === 'WAITLISTED').length}</span><span><b>Attendance rule</b>{Number(selected.session.minimumAttendancePct || 0).toFixed(0)}%</span></div><h3 className="ilt-subtitle">Instructors</h3><div className="ilt-chip-list">{selected.instructors.map(item => <span key={item.id}>{item.instructorName} · {item.instructorRole}</span>)}{!selected.instructors.length && <span>No instructor assigned</span>}</div><h3 className="ilt-subtitle">Learners and attendance</h3><div className="ilt-attendance-list">{selected.enrollments.filter(item => item.status !== 'CANCELLED').map(item => { const attendance = selectedAttendance.get(item.employeeId); return <article key={item.enrollmentId}><div><b>{item.traineeName || item.employeeId}</b><span>{item.employeeId} · {item.status}{item.waitlistPosition ? ` #${item.waitlistPosition}` : ''}</span>{attendance && <small>{attendance.attendanceStatus} · {Number(attendance.attendancePct || 0).toFixed(0)}%</small>}</div>{selected.session.status !== 'COMPLETED' && item.status !== 'WAITLISTED' && <div><button className="btn xs ok" disabled={busy === `attendance-${item.employeeId}`} onClick={() => saveAttendance(item.employeeId, 'PRESENT')}>Present</button><button className="btn xs danger" disabled={busy === `attendance-${item.employeeId}`} onClick={() => saveAttendance(item.employeeId, 'ABSENT')}>Absent</button></div>}</article>})}</div>{selected.session.status === 'PUBLISHED' && <div className="ilt-detail-actions"><button className="btn secondary" onClick={() => lifecycle('check-in-code', selected.session.sessionId)} disabled={busy}>Generate check-in code</button><button className="btn" onClick={() => lifecycle('finalize', selected.session.sessionId)} disabled={busy}>Finalize attendance</button></div>}</> : <div className="ilt-empty"><b>Open a session</b><p>Review instructors, enrolments, attendance and lifecycle actions here.</p></div>}</aside></div>}

      {view === 'create' && <div className="ilt-form-layout"><form className="ilt-panel ilt-form-card" onSubmit={createSession}><div className="ilt-section-head"><div><h2>Create live session</h2><p>Sessions remain draft until conflict and lead-instructor gates pass.</p></div></div><div className="ilt-form-grid"><Field label="Session title"><input className="input" required value={sessionForm.title} onChange={event => setSessionForm(form => ({ ...form, title: event.target.value }))} /></Field><Field label="Batch"><select className="select" required={role === 'coordinator'} value={sessionForm.batchNo} onChange={event => { const batch = (catalog.batches || []).find(item => item.batchNo === event.target.value); setSessionForm(form => ({ ...form, batchNo: event.target.value, branch: batch?.branch || form.branch, classroomId: form.classroomId })); }}><option value="">Open / no batch</option>{(catalog.batches || []).map(item => <option key={item.batchNo} value={item.batchNo}>{item.batchName} · {item.batchNo}</option>)}</select></Field></div>{role === 'admin' && <Field label="Branch"><input className="input" value={sessionForm.branch} onChange={event => setSessionForm(form => ({ ...form, branch: event.target.value }))} placeholder="Derived from batch when selected" /></Field>}<Field label="Description"><textarea className="input" value={sessionForm.description} onChange={event => setSessionForm(form => ({ ...form, description: event.target.value }))} /></Field><div className="ilt-form-grid"><Field label="Classroom"><select className="select" value={sessionForm.classroomId} onChange={event => setSessionForm(form => ({ ...form, classroomId: event.target.value, moduleId: '' }))}><option value="">No classroom link</option>{(catalog.classrooms || []).map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroomName}</option>)}</select></Field><Field label="Module"><select className="select" value={sessionForm.moduleId} onChange={event => setSessionForm(form => ({ ...form, moduleId: event.target.value }))}><option value="">No module link</option>{modules.map(item => <option key={item.moduleId} value={item.moduleId}>Day {item.dayNo} · {item.moduleTitle}</option>)}</select></Field></div><div className="ilt-form-grid"><Field label="Session type"><select className="select" value={sessionForm.sessionType} onChange={event => setSessionForm(form => ({ ...form, sessionType: event.target.value }))}>{['ILT', 'VILT', 'WORKSHOP', 'PRACTICE', 'CALIBRATION', 'COACHING'].map(item => <option key={item}>{item}</option>)}</select></Field><Field label="Delivery mode"><select className="select" value={sessionForm.deliveryMode} onChange={event => setSessionForm(form => ({ ...form, deliveryMode: event.target.value }))}>{['IN_PERSON', 'VIRTUAL', 'HYBRID'].map(item => <option key={item}>{item}</option>)}</select></Field></div><div className="ilt-form-grid"><Field label="Venue"><select className="select" value={sessionForm.venueId} onChange={event => { const venue = (catalog.venues || []).find(item => item.venueId === event.target.value); setSessionForm(form => ({ ...form, venueId: event.target.value, capacity: venue ? Math.min(Number(form.capacity), Number(venue.capacity)) : form.capacity })); }}><option value="">No physical venue</option>{(catalog.venues || []).map(item => <option key={item.venueId} value={item.venueId}>{item.venueName} · {item.capacity} seats</option>)}</select></Field><Field label="Lead instructor"><select className="select" required value={sessionForm.leadInstructorId} onChange={event => setSessionForm(form => ({ ...form, leadInstructorId: event.target.value }))}><option value="">Select instructor</option>{(catalog.instructors || []).map(item => <option key={item.instructorId} value={item.instructorId}>{item.instructorName}</option>)}</select></Field></div>{['VIRTUAL', 'HYBRID'].includes(sessionForm.deliveryMode) && <Field label="Virtual join URL"><input className="input" type="url" value={sessionForm.virtualJoinUrl} onChange={event => setSessionForm(form => ({ ...form, virtualJoinUrl: event.target.value }))} /></Field>}<div className="ilt-form-grid"><Field label="Starts"><input className="input" type="datetime-local" required value={sessionForm.startAt} onChange={event => setSessionForm(form => ({ ...form, startAt: event.target.value }))} /></Field><Field label="Ends"><input className="input" type="datetime-local" required value={sessionForm.endAt} onChange={event => setSessionForm(form => ({ ...form, endAt: event.target.value }))} /></Field></div><div className="ilt-form-grid three"><Field label="Capacity"><input className="input" type="number" min="1" max="10000" value={sessionForm.capacity} onChange={event => setSessionForm(form => ({ ...form, capacity: Number(event.target.value) }))} /></Field><Field label="Attendance %"><input className="input" type="number" min="0" max="100" value={sessionForm.minimumAttendancePct} onChange={event => setSessionForm(form => ({ ...form, minimumAttendancePct: Number(event.target.value) }))} /></Field><Field label="Occurrences"><input className="input" type="number" min="1" max="60" value={sessionForm.repeatCount} onChange={event => setSessionForm(form => ({ ...form, repeatCount: Number(event.target.value) }))} /></Field></div><div className="ilt-check-row"><label><input type="checkbox" checked={sessionForm.waitlistEnabled} onChange={event => setSessionForm(form => ({ ...form, waitlistEnabled: event.target.checked }))} /> Enable waitlist</label><label><input type="checkbox" checked={sessionForm.selfEnrollmentEnabled} onChange={event => setSessionForm(form => ({ ...form, selfEnrollmentEnabled: event.target.checked }))} /> Allow self-enrolment</label></div><button className="btn" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create draft session'}</button></form><aside className="ilt-panel ilt-guidance"><span>Publication gates</span><h3>What the LMS checks</h3><ul><li>A confirmed lead instructor is assigned.</li><li>The venue has enough capacity.</li><li>The venue, batch and instructors have no overlapping published session.</li><li>Registration, attendance and waitlist rules remain server-controlled.</li></ul></aside></div>}

      {view === 'governance' && role === 'admin' && <div className="ilt-governance-grid"><form className="ilt-panel ilt-form-card" onSubmit={saveVenue}><h2>Create venue</h2><div className="ilt-form-grid"><Field label="Venue code"><input className="input" required value={venueForm.venueCode} onChange={event => setVenueForm(form => ({ ...form, venueCode: event.target.value }))} /></Field><Field label="Venue name"><input className="input" required value={venueForm.venueName} onChange={event => setVenueForm(form => ({ ...form, venueName: event.target.value }))} /></Field></div><div className="ilt-form-grid"><Field label="Branch"><input className="input" value={venueForm.branch} onChange={event => setVenueForm(form => ({ ...form, branch: event.target.value }))} /></Field><Field label="Capacity"><input className="input" type="number" min="1" value={venueForm.capacity} onChange={event => setVenueForm(form => ({ ...form, capacity: Number(event.target.value) }))} /></Field></div><Field label="Location"><input className="input" value={venueForm.roomLocation} onChange={event => setVenueForm(form => ({ ...form, roomLocation: event.target.value }))} /></Field><button className="btn" disabled={busy === 'venue'}>Save venue</button></form><form className="ilt-panel ilt-form-card" onSubmit={saveInstructor}><h2>Instructor profile</h2><div className="ilt-form-grid"><Field label="User ID"><input className="input" required value={instructorForm.userId} onChange={event => setInstructorForm(form => ({ ...form, userId: event.target.value }))} /></Field><Field label="Instructor name"><input className="input" required value={instructorForm.instructorName} onChange={event => setInstructorForm(form => ({ ...form, instructorName: event.target.value }))} /></Field></div><div className="ilt-form-grid"><Field label="Email"><input className="input" type="email" value={instructorForm.email} onChange={event => setInstructorForm(form => ({ ...form, email: event.target.value }))} /></Field><Field label="Branch"><input className="input" value={instructorForm.branch} onChange={event => setInstructorForm(form => ({ ...form, branch: event.target.value }))} /></Field></div><button className="btn" disabled={busy === 'instructor'}>Save instructor</button></form><form className="ilt-panel ilt-form-card" onSubmit={savePolicy}><h2>Capacity and attendance policy</h2><div className="ilt-form-grid"><Field label="Branch"><input className="input" value={policyForm.branch} onChange={event => setPolicyForm(form => ({ ...form, branch: event.target.value }))} placeholder="Blank = company default" /></Field><Field label="Default capacity"><input className="input" type="number" min="1" value={policyForm.defaultCapacity} onChange={event => setPolicyForm(form => ({ ...form, defaultCapacity: Number(event.target.value) }))} /></Field></div><div className="ilt-form-grid three"><Field label="Attendance %"><input className="input" type="number" min="0" max="100" value={policyForm.minimumAttendancePct} onChange={event => setPolicyForm(form => ({ ...form, minimumAttendancePct: Number(event.target.value) }))} /></Field><Field label="Check-in before"><input className="input" type="number" min="0" value={policyForm.checkinOpenBeforeMins} onChange={event => setPolicyForm(form => ({ ...form, checkinOpenBeforeMins: Number(event.target.value) }))} /></Field><Field label="Cancel cutoff"><input className="input" type="number" min="0" value={policyForm.cancellationCutoffMins} onChange={event => setPolicyForm(form => ({ ...form, cancellationCutoffMins: Number(event.target.value) }))} /></Field></div><div className="ilt-check-row"><label><input type="checkbox" checked={policyForm.autoPromoteWaitlist} onChange={event => setPolicyForm(form => ({ ...form, autoPromoteWaitlist: event.target.checked }))} /> Auto-promote waitlist</label><label><input type="checkbox" checked={policyForm.selfEnrollmentEnabled} onChange={event => setPolicyForm(form => ({ ...form, selfEnrollmentEnabled: event.target.checked }))} /> Self-enrolment</label></div><button className="btn" disabled={busy === 'policy'}>Save policy</button></form></div>}

      {checkinCode && <div className="ilt-modal-backdrop"><div className="ilt-modal ilt-code-modal"><span>Instructor check-in code</span><h2>{checkinCode.code}</h2><p>Valid from {formatDate(checkinCode.openAt)} until {formatDate(checkinCode.closeAt)}. Display it only to confirmed attendees.</p><button className="btn" onClick={() => setCheckinCode(null)}>Close</button></div></div>}
    </section>
  );
}
