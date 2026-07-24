const COPY = {
  trainee: {
    eyebrow: 'Instructor-led learning',
    title: 'Live Training Calendar',
    description: 'Discover eligible sessions, reserve a seat, monitor your waitlist position, securely check in and review verified attendance.',
    action: 'Open my calendar',
  },
  coordinator: {
    eyebrow: 'Owned-batch operations',
    title: 'Batch Training Calendar',
    description: 'Create conflict-free sessions, manage batch enrolment, display secure check-in codes and finalize attendance evidence.',
    action: 'Open batch calendar',
  },
  admin: {
    eyebrow: 'Training governance',
    title: 'Instructor-led Training',
    description: 'Manage venues, instructors, capacity policies, waitlists, attendance controls and branch or company session reporting.',
    action: 'Open training governance',
  },
};

export default function TrainingCalendarEntryCard({ role = 'trainee' }) {
  const copy = COPY[role] || COPY.trainee;
  return (
    <section className="panel" style={{ overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: '50%', background: 'var(--accent-soft)', right: -70, top: -90 }} />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 22, alignItems: 'center' }}>
        <div>
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 7 }}>{copy.eyebrow}</span>
          <h2 style={{ margin: 0, fontSize: 23 }}>{copy.title}</h2>
          <p style={{ margin: '7px 0 0', color: 'var(--muted)', maxWidth: 720 }}>{copy.description}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            {['Calendar', 'Capacity', 'Waitlist', 'Attendance', 'Evidence'].map(item => <span className="pill info" key={item}>{item}</span>)}
          </div>
        </div>
        <a className="btn" href={`/training-calendar?role=${role}`}>{copy.action} →</a>
      </div>
      <style>{`@media(max-width:620px){.panel>div[style*="grid-template-columns"]{grid-template-columns:1fr!important}.panel a.btn{width:max-content}}`}</style>
    </section>
  );
}
