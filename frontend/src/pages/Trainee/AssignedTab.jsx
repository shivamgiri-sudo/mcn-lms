import { useState } from 'react';
import { formatDate } from '../../utils/format.js';
import AssessmentModal from './AssessmentModal.jsx';

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

export default function AssignedTab({ assignments, onRefresh, onOpenContent }) {
  const [openAssessmentId, setOpenAssessmentId] = useState(null);

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
                {a.estimatedMins > 0 && (
                  <span className="pill" style={{ fontSize: 11 }} title="Time this is expected to take">
                    ⏱ {a.estimatedMins} min
                  </span>
                )}
              </div>
              {a.message && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{a.message}</p>}
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Assigned: {formatDate(a.createdAt)} {a.dueDate ? `| Due: ${formatDate(a.dueDate)}` : ''}</p>
            </div>
            <span className={`pill ${a.assignmentType === 'Mandatory' ? 'warn' : 'info'}`}>{a.assignmentType}</span>
          </div>

          {a.assessment && (
            <AssignedAssessmentRow
              assessment={a.assessment}
              result={a.assessmentResult}
              onStart={() => setOpenAssessmentId(a.assessment.assessmentId)}
            />
          )}

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
                        {content.estimatedMins > 0 && !(a.estimatedMins > 0) && (
                          <span className="pill" style={{ fontSize: 11 }} title="Time the admin expects this to take">
                            ⏱ {content.estimatedMins} min read
                          </span>
                        )}
                      </div>
                      {content.description && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{content.description}</p>}
                    </div>
                    {/* Opening through the tracked viewer is what records the time
                        spent. A raw link opened a new tab and measured nothing, so an
                        admin could never tell whether the reading time was met. */}
                    {onOpenContent
                      ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <button className="btn small secondary" onClick={() => onOpenContent(content)}>Open</button>
                          {content.progress && (
                            <span style={{ fontSize: 11, color: content.progress.acknowledgedAt ? 'var(--ok)' : (content.progress.completionStatus === 'Completed' ? 'var(--warn)' : 'var(--muted)') }}>
                              {content.progress.acknowledgedAt
                                ? '✓ Acknowledged'
                                : (content.progress.completionStatus === 'Completed'
                                  ? 'Read — not yet acknowledged'
                                  : `${Math.round(content.progress.completionPct || 0)}% read`)}
                            </span>
                          )}
                        </div>
                      )
                      : (url ? <a className="btn small secondary" href={url} target="_blank" rel="noopener">Open</a> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>No link</span>)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {openAssessmentId && (
        <AssessmentModal
          assessmentId={openAssessmentId}
          onClose={() => { setOpenAssessmentId(null); onRefresh && onRefresh(); }}
        />
      )}
    </div>
  );
}

// Pass/fail/attempts state for a broadcast-attached PKT — same shape and thresholds as the
// classroom AssessmentCard in LearningTab.jsx, so a trainee sees consistent messaging
// whether the test came from their curriculum or a broadcast.
function AssignedAssessmentRow({ assessment, result, onStart }) {
  const passed = result?.result === 'Pass';
  const attemptsLeft = assessment.attemptLimit != null
    ? assessment.attemptLimit - (result?.totalAttempts || 0)
    : Infinity;

  return (
    <div style={{ marginTop: 12, border: '1.5px solid #c7d2fe', background: 'linear-gradient(135deg, var(--accent-soft), rgba(255,255,255,.04))', borderRadius: 12, padding: '10px 14px' }}>
      <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span className="pill accent">PKT</span>
            <b style={{ fontSize: 13.5 }}>{assessment.assessmentName}</b>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Pass: {assessment.passingPct}% &nbsp;·&nbsp;{result?.totalAttempts || 0}/{assessment.attemptLimit ?? '∞'} attempts used &nbsp;·&nbsp;{assessment.timeLimitMins}m limit</p>
          {result && <p style={{ fontSize: 12.5, marginTop: 5, fontWeight: 800, color: passed ? 'var(--ok)' : 'var(--bad)' }}>Best score: {Math.round(result.bestPercentage || 0)}% — {result.result}</p>}
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          {passed && <span className="pill ok">✓ Passed</span>}
          {!passed && attemptsLeft <= 0 && <span className="pill bad">No attempts left</span>}
          {!passed && attemptsLeft > 0 && <button className="btn small accent" onClick={onStart}>{(result?.totalAttempts || 0) > 0 ? 'Retry Test (PKT)' : 'Take Test (PKT)'}</button>}
        </div>
      </div>
    </div>
  );
}
