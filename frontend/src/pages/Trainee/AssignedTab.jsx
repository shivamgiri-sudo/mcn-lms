import { formatDate } from '../../utils/format.js';

export default function AssignedTab({ assignments }) {
  if (!assignments || assignments.length === 0)
    return <div className="empty" style={{ marginTop: 16 }}>No direct module assignments right now. Mandatory updates will appear here.</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Mandatory updates, refresher modules, process alerts, or branch/process assignments from LMS Admin will appear here.</p>
      {assignments.map(a => (
        <div key={a.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <b>{a.moduleName}</b>
              {a.message && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{a.message}</p>}
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Assigned: {formatDate(a.createdAt)} {a.dueDate ? `| Due: ${formatDate(a.dueDate)}` : ''}</p>
            </div>
            <span className={`pill ${a.assignmentType === 'Mandatory' ? 'warn' : 'info'}`}>{a.assignmentType}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
