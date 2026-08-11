import { formatDate } from '../../utils/format.js';

const API_ORIGIN = import.meta.env.VITE_API_URL || '';

function publicUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`;
  return url;
}

function getContentUrl(content) {
  // openUrl is the authenticated route built by the API; the raw Drive link is
  // only a fallback and generally is not reachable by a learner.
  return publicUrl(content.openUrl || content.directMediaUrl || content.driveUrl || content.localFilePath || '');
}

export default function AssignedTab({ assignments }) {
  if (!assignments || assignments.length === 0) {
    return <div className="empty" style={{ marginTop: 16 }}>No direct module assignments right now. Mandatory updates will appear here.</div>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Mandatory updates, refresher modules, process alerts, or branch/process assignments from LMS Admin will appear here.
      </p>
      {assignments.map(a => (
        <div key={a.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <b>{a.moduleName}</b>
                {a.independentModule && <span className="pill info">Independent Module</span>}
              </div>
              {a.message && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{a.message}</p>}
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Assigned: {formatDate(a.createdAt)} {a.dueDate ? `| Due: ${formatDate(a.dueDate)}` : ''}</p>
            </div>
            <span className={`pill ${a.assignmentType === 'Mandatory' ? 'warn' : 'info'}`}>{a.assignmentType}</span>
          </div>

          {(a.contents || []).length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {(a.contents || []).map((content, index) => {
                const url = getContentUrl(content);
                return (
                  <div key={content.repositoryContentId || index} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span className="content-type-badge">{content.contentType || 'content'}</span>
                        <b style={{ fontSize: 13 }}>{content.contentTitle || content.title}</b>
                        {content.required && <span className="pill warn">Required</span>}
                      </div>
                      {content.description && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{content.description}</p>}
                    </div>
                    {url ? <a className="btn small secondary" href={url} target="_blank" rel="noopener">Open</a> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>No link</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
