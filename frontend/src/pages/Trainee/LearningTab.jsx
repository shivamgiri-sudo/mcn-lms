import { useState } from 'react';
import { formatSeconds, isContentTimeComplete } from '../../utils/format.js';
import AssessmentModal from './AssessmentModal.jsx';
import ScormLauncher from './ScormLauncher.jsx';
import { useTrackedContentViewer, ContentViewerModal } from './useTrackedContentViewer.jsx';

export default function LearningTab({ days, onRefresh }) {
  const [openDays, setOpenDays] = useState({ 1: true });
  const [assessmentId, setAssessmentId] = useState(null);
  const {
    viewingContent, openContent, closeContent,
    lockedMsg, setLockedMsg,
    scormPackageId, closeScorm,
    videoRef, isPausedRef,
  } = useTrackedContentViewer(onRefresh);

  const [contentFilter, setContentFilter] = useState('all');

  const totalContents = days.reduce((acc, d) => acc + d.modules.reduce((a, m) => a + m.contents.filter(c => c.active).length, 0), 0);
  const doneContents = days.reduce((acc, d) => acc + d.modules.reduce((a, m) => a + m.contents.filter(c => c.active && isContentTimeComplete(c.progress)).length, 0), 0);
  const pendingContents = totalContents - doneContents;

  const filteredDays = contentFilter === 'all' ? days : days.filter(day => {
    const allActive = day.modules.flatMap(m => m.contents.filter(c => c.active));
    if (contentFilter === 'pending') return allActive.some(c => !isContentTimeComplete(c.progress));
    if (contentFilter === 'completed') return allActive.some(c => isContentTimeComplete(c.progress));
    return true;
  });

  return (
    <div>
      <div className="row between" style={{ margin: '14px 0 10px', flexWrap: 'wrap', gap: 8 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Day-wise Learning Path</h3>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {totalContents > 0 && <span className="pill info">{doneContents}/{totalContents} done</span>}
          {[
            { key: 'all', label: 'All' },
            { key: 'pending', label: `Pending (${pendingContents})` },
            { key: 'completed', label: 'Completed' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setContentFilter(f.key)}
              className={`btn small${contentFilter === f.key ? ' accent' : ' secondary'}`}
              style={{ padding: '3px 10px', fontSize: 12 }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {lockedMsg && (
        <div className="toast warn" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔒</span>
          <span>{lockedMsg}</span>
          <button onClick={() => setLockedMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: .6 }}>✕</button>
        </div>
      )}

      {days.length === 0 && <div className="empty">No classroom content available yet. Contact your coordinator.</div>}
      {filteredDays.length === 0 && days.length > 0 && (
        <div className="empty">No {contentFilter === 'pending' ? 'pending' : 'completed'} content found.</div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {filteredDays.map((day) => {
          const dayKey = day.dayNo;
          const dayContents = day.modules.reduce((a, m) => a + m.contents.filter(c => c.active).length, 0);
          const dayDone = day.modules.reduce((a, m) => a + m.contents.filter(c => isContentTimeComplete(c.progress)).length, 0);
          const dayPct = dayContents > 0 ? Math.round((dayDone / dayContents) * 100) : 0;
          const isOpen = !!openDays[dayKey];

          return (
            <div key={day.dayNo} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px', cursor: 'pointer', background: isOpen ? 'var(--brand)' : 'var(--card)', color: 'var(--ink)', transition: 'background .15s' }}
                onClick={() => setOpenDays(prev => ({ ...prev, [dayKey]: !isOpen }))}
              >
                <div className="row" style={{ gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: isOpen ? 'rgba(255,255,255,.15)' : 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>{day.dayNo}</div>
                  <div>
                    <b style={{ fontSize: 14 }}>Day {day.dayNo}</b>
                    <div style={{ fontSize: 11, opacity: .75, marginTop: 1 }}>{day.modules.length} module{day.modules.length !== 1 ? 's' : ''} · {dayContents} content{dayContents !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  {dayContents > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: isOpen ? 'rgba(255,255,255,.9)' : (dayPct === 100 ? 'var(--ok)' : 'var(--muted)') }}>{dayPct}%</span>}
                  <span style={{ opacity: .6, fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {isOpen && <div style={{ padding: '14px 16px', background: 'var(--card-solid)' }}>{day.modules.map(mod => <ModuleSection key={mod.moduleId} mod={mod} onOpenContent={openContent} onStartAssessment={id => setAssessmentId(id)} />)}</div>}
            </div>
          );
        })}
      </div>

      {viewingContent && <ContentViewerModal content={viewingContent} onClose={closeContent} videoRef={videoRef} onPauseChange={p => { isPausedRef.current = p; }} />}

      {scormPackageId && (
        <div className="modal-overlay" style={{ padding: 0, alignItems: 'stretch' }}>
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <ScormLauncher packageId={scormPackageId} onClose={closeScorm} />
          </div>
        </div>
      )}

      {assessmentId && <AssessmentModal assessmentId={assessmentId} onClose={() => { setAssessmentId(null); onRefresh && onRefresh(); }} />}
    </div>
  );
}

function isContentSequentiallyLocked(content, allContents) {
  if (content.accessLocked) return true;
  if (!content.locked || content.contentOrder <= 1) return false;
  const sorted = [...allContents].filter(c => c.active).sort((a, b) => a.contentOrder - b.contentOrder);
  const idx = sorted.findIndex(c => c.contentId === content.contentId);
  if (idx <= 0) return false;
  const prev = sorted[idx - 1];
  return !isContentTimeComplete(prev.progress);
}

function ModuleSection({ mod, onOpenContent, onStartAssessment }) {
  const activeContents = mod.contents.filter(c => c.active);
  const done = activeContents.filter(c => isContentTimeComplete(c.progress)).length;
  const total = activeContents.length;
  const modPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const unifiedItems = [
    ...activeContents.map(c => ({ kind: 'content', order: c.contentOrder ?? 0, data: c })),
    ...(mod.faqs || []).map(f => ({ kind: 'faq', order: (f.sortOrder ?? 0) + 0.5, data: f })),
    ...(mod.assessments || []).map(a => {
      const result = mod.assessmentResults?.find(r => r.assessment?.assessmentId === a.assessmentId)?.result || null;
      return { kind: 'assessment', order: (a.sortOrder ?? 0) / 10000 + 0.5, data: a, result };
    }),
  ].sort((a, b) => a.order - b.order || (a.kind === 'content' ? -1 : 1));

  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 14, padding: '12px 14px', marginBottom: 10, background: 'var(--card)' }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div>
          <b style={{ fontSize: 14 }}>{mod.moduleTitle}</b>
          {mod.description && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{mod.description}</p>}
        </div>
        {total > 0 && <span className={`pill ${modPct === 100 ? 'ok' : modPct > 0 ? 'info' : ''}`} style={{ flexShrink: 0 }}>{done}/{total}</span>}
      </div>

      <div style={{ display: 'grid', gap: 7 }}>
        {unifiedItems.map(item => {
          if (item.kind === 'content') {
            const c = item.data;
            const prog = c.progress;
            const isDone = isContentTimeComplete(prog);
            const isInProg = prog?.opened && !isDone;
            const seqLocked = isContentSequentiallyLocked(c, activeContents);
            const lockText = c.lockReason || 'Complete the previous content to unlock';
            return (
              <div key={c.contentId} className={`content-item${isDone ? ' done' : ''}${seqLocked ? ' locked' : ''}`} onClick={() => !seqLocked && onOpenContent(c)} style={seqLocked ? { opacity: .65, cursor: 'default' } : {}} title={seqLocked ? lockText : undefined}>
                {seqLocked ? <span style={{ fontSize: 16, flexShrink: 0 }}>🔒</span> : <span className="content-type-badge">{c.contentType}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13 }}>{c.contentTitle}</b>
                    {isDone && <span className="pill ok">✓ Done</span>}
                    {isInProg && <span className="pill info">In Progress</span>}
                    {seqLocked && <span className="pill warn" style={{ fontSize: 10 }}>Locked</span>}
                  </div>
                  {seqLocked && <p style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 2 }}>{lockText}</p>}
                  {!seqLocked && c.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{c.description}</p>}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 90 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{prog?.totalSecondsSpent ? formatSeconds(prog.totalSecondsSpent) : c.estimatedMins ? `~${c.estimatedMins}m` : ''}</div>
                  {prog && <div style={{ fontSize: 11, color: (prog.completionPct || 0) >= 100 ? 'var(--ok)' : 'var(--muted)', fontWeight: 800, marginTop: 2 }}>{Math.round(prog.completionPct || 0)}%</div>}
                </div>
              </div>
            );
          }
          if (item.kind === 'faq') return <FaqItem key={item.data.faqId} faq={item.data} />;
          if (item.kind === 'assessment') return <AssessmentCard key={item.data.assessmentId} assessment={item.data} result={item.result} onStart={() => onStartAssessment(item.data.assessmentId)} />;
          return null;
        })}
      </div>
    </div>
  );
}

function FaqItem({ faq }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 10, padding: '9px 12px', marginTop: 5, cursor: 'pointer', background: open ? 'rgba(255,255,255,.06)' : 'var(--card)', transition: 'background .15s' }} onClick={() => setOpen(o => !o)}>
      <div className="row between">
        <b style={{ fontSize: 12.5 }}>{faq.question}</b>
        <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 7, fontSize: 13, color: 'var(--ink)', lineHeight: 1.55, borderTop: '1px solid var(--line)', paddingTop: 7 }}>{faq.answer}</div>}
    </div>
  );
}

function AssessmentCard({ assessment, result, onStart }) {
  const passed = result?.result === 'Pass';
  const locked = !!assessment.accessLocked;
  // null attemptLimit means unlimited — treat as Infinity so attemptsLeft > 0 is always true
  const attemptsLeft = assessment.attemptLimit != null
    ? assessment.attemptLimit - (result?.totalAttempts || 0)
    : Infinity;

  return (
    <div style={{ border: locked ? '1.5px solid var(--warn)' : '1.5px solid #c7d2fe', background: locked ? 'var(--warn-soft)' : 'linear-gradient(135deg, var(--accent-soft), rgba(255,255,255,.04))', borderRadius: 13, padding: '12px 14px', opacity: locked ? .78 : 1 }}>
      <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span className="pill accent">Assessment</span>
            <b style={{ fontSize: 13.5 }}>{assessment.assessmentName}</b>
            {locked && <span className="pill warn">Locked</span>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Pass: {assessment.passingPct}% &nbsp;·&nbsp;{result?.totalAttempts || 0}/{assessment.attemptLimit} attempts used &nbsp;·&nbsp;{assessment.timeLimitMins}m limit</p>
          {locked && <p style={{ fontSize: 12, color: 'var(--warn)', marginTop: 5 }}>{assessment.lockReason || 'Complete required content first.'}</p>}
          {result && <p style={{ fontSize: 12.5, marginTop: 5, fontWeight: 800, color: passed ? 'var(--ok)' : 'var(--bad)' }}>Best score: {Math.round(result.bestPercentage || 0)}% — {result.result}</p>}
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          {passed && <span className="pill ok">✓ Passed</span>}
          {!passed && locked && <span className="pill warn">Complete Content</span>}
          {!passed && !locked && attemptsLeft <= 0 && <span className="pill bad">No attempts left</span>}
          {!passed && !locked && attemptsLeft > 0 && <button className="btn small accent" onClick={onStart}>{(result?.totalAttempts || 0) > 0 ? 'Retry' : 'Start Assessment'}</button>}
        </div>
      </div>
    </div>
  );
}

// ContentViewerModal now lives in useTrackedContentViewer.jsx, shared with
// the Assigned tab's independent/"nugget" modules.
