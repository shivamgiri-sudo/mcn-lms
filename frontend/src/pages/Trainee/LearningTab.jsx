import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../../utils/api.js';
import { formatSeconds, pct } from '../../utils/format.js';
import AssessmentModal from './AssessmentModal.jsx';
import ScormLauncher from './ScormLauncher.jsx';

const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';

function getDriveProxyUrl(fileId) {
  const token = localStorage.getItem('lms_token_trainee') || localStorage.getItem('lms_token_admin') || '';
  return `${API_BASE}/drive/proxy/${fileId}?token=${encodeURIComponent(token)}`;
}

export default function LearningTab({ days, onRefresh }) {
  const [openDays, setOpenDays] = useState({ 0: true });
  const [viewingContent, setViewingContent] = useState(null);
  const [assessmentId, setAssessmentId] = useState(null);
  const heartbeatRef = useRef(null);
  const lastSentRef = useRef(Date.now());
  const sessionSecsRef = useRef(0);
  const videoRef = useRef(null);
  const isPausedRef = useRef(false);
  const [lockedMsg, setLockedMsg] = useState(null);
  const [scormPackageId, setScormPackageId] = useState(null);

  const stopHeartbeat = useCallback(async (sendClose = true) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (sendClose && viewingContent) {
      const delta = Math.min(Math.round((Date.now() - lastSentRef.current) / 1000), 120);
      if (delta > 0) {
        await api.post(`/trainee/content/${viewingContent.contentId}/close`, {
          secondsDelta: delta,
          positionSeconds: videoRef.current?.currentTime || 0,
          durationSeconds: videoRef.current?.duration || 0,
          playerMode: viewingContent?.playerMode || 'Auto',
        }, 'trainee');
      }
    }

    sessionSecsRef.current = 0;
    lastSentRef.current = Date.now();
  }, [viewingContent]);

  const startHeartbeat = useCallback((contentId) => {
    lastSentRef.current = Date.now();
    heartbeatRef.current = setInterval(async () => {
      const now = Date.now();
      const elapsed = Math.round((now - lastSentRef.current) / 1000);
      const delta = (isPausedRef.current || document.hidden) ? 0 : Math.min(elapsed, 30);
      lastSentRef.current = now;
      sessionSecsRef.current += delta;
      await api.post(`/trainee/content/${contentId}/heartbeat`, {
        secondsDelta: delta,
        sessionSeconds: sessionSecsRef.current,
        positionSeconds: videoRef.current?.currentTime || 0,
        durationSeconds: videoRef.current?.duration || 0,
        playerMode: viewingContent?.playerMode || 'Auto',
      }, 'trainee');
    }, 30000);
  }, [viewingContent]);

  async function openContent(content) {
    setLockedMsg(null);

    if (content.accessLocked) {
      setLockedMsg(content.lockReason || 'Complete the previous required content first.');
      return;
    }

    if (content.contentType === 'scorm') {
      const match = (content.directMediaUrl || '').match(/\/scorm\/(SCORM-[A-Z0-9]+)\//);
      if (match) {
        setScormPackageId(match[1]);
        return;
      }
    }

    if (viewingContent) await stopHeartbeat(true);
    setViewingContent(content);
    lastSentRef.current = Date.now();
    startHeartbeat(content.contentId);

    const openRes = await api.post(`/trainee/content/${content.contentId}/open`, {}, 'trainee');
    if (openRes.locked) {
      stopHeartbeat(false);
      setViewingContent(null);
      setLockedMsg(openRes.message || 'Complete the previous content first.');
    }
  }

  async function closeContent() {
    await stopHeartbeat(true);
    setViewingContent(null);
    onRefresh && onRefresh();
  }

  useEffect(() => { return () => { stopHeartbeat(false); }; }, []);

  function getYoutubeEmbedUrl(url) {
    try {
      const u = new URL(url);
      let videoId = null;
      if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1);
      else if (u.hostname.includes('youtube.com')) videoId = u.searchParams.get('v') || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/shorts/')[1] : null);
      if (videoId) return `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=0&origin=${encodeURIComponent(window.location.origin)}`;
    } catch {}
    return null;
  }

  function wrapForViewer(proxyUrl, fileId) {
    return { type: 'proxy', url: proxyUrl, fileId };
  }

  function renderContentUrl(c) {
    const url = c.directMediaUrl || '';
    if (url) {
      const ytEmbed = getYoutubeEmbedUrl(url);
      if (ytEmbed) return { type: 'youtube', url: ytEmbed };
      if (!url.includes('drive.google.com')) {
        const ext = url.split('?')[0].split('.').pop().toLowerCase();
        const isVid = ['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext);
        const isPdf = ext === 'pdf';
        const isOffice = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext);
        if (isVid) return { type: 'html5', url };
        if (isPdf) return { type: 'proxy', url };
        if (isOffice) return { type: 'download', url };
        return { type: 'proxy', url };
      }
    }

    if (c.driveFileId) {
      const proxyUrl = getDriveProxyUrl(c.driveFileId);
      return wrapForViewer(proxyUrl, c.driveFileId);
    }

    if (url && url.includes('drive.google.com')) {
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const proxyUrl = getDriveProxyUrl(match[1]);
        return wrapForViewer(proxyUrl, match[1]);
      }
    }

    if (c.driveUrl) {
      const m = c.driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (m) {
        const proxyUrl = getDriveProxyUrl(m[1]);
        return wrapForViewer(proxyUrl, m[1]);
      }
      return { type: 'drive', url: c.driveUrl };
    }

    if (url) return { type: 'drive', url };
    return null;
  }

  const totalContents = days.reduce((acc, d) => acc + d.modules.reduce((a, m) => a + m.contents.filter(c => c.active).length, 0), 0);
  const doneContents = days.reduce((acc, d) => acc + d.modules.reduce((a, m) => a + m.contents.filter(c => c.progress?.completionStatus === 'Completed').length, 0), 0);

  return (
    <div>
      <div className="row between" style={{ margin: '14px 0 10px' }}>
        <h3 className="section-title" style={{ margin: 0 }}>Day-wise Learning Path</h3>
        {totalContents > 0 && <span className="pill info">{doneContents}/{totalContents} completed</span>}
      </div>

      {lockedMsg && (
        <div className="toast warn" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔒</span>
          <span>{lockedMsg}</span>
          <button onClick={() => setLockedMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: .6 }}>✕</button>
        </div>
      )}

      {days.length === 0 && <div className="empty">No classroom content available yet. Contact your coordinator.</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {days.map((day, di) => {
          const dayContents = day.modules.reduce((a, m) => a + m.contents.filter(c => c.active).length, 0);
          const dayDone = day.modules.reduce((a, m) => a + m.contents.filter(c => c.progress?.completionStatus === 'Completed').length, 0);
          const dayPct = dayContents > 0 ? Math.round((dayDone / dayContents) * 100) : 0;
          const isOpen = !!openDays[di];

          return (
            <div key={day.dayNo} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px', cursor: 'pointer', background: isOpen ? 'var(--brand)' : 'var(--card)', color: 'var(--ink)', transition: 'background .15s' }}
                onClick={() => setOpenDays(prev => ({ ...prev, [di]: !isOpen }))}
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

      {viewingContent && <ContentViewerModal content={viewingContent} onClose={closeContent} videoRef={videoRef} onPauseChange={p => { isPausedRef.current = p; }} renderContentUrl={renderContentUrl} />}

      {scormPackageId && (
        <div className="modal-overlay" style={{ padding: 0, alignItems: 'stretch' }}>
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <ScormLauncher packageId={scormPackageId} onClose={() => { setScormPackageId(null); onRefresh && onRefresh(); }} />
          </div>
        </div>
      )}

      {assessmentId && <AssessmentModal assessmentId={assessmentId} onClose={() => { setAssessmentId(null); onRefresh(); }} />}
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
  return prev.progress?.completionStatus !== 'Completed';
}

function ModuleSection({ mod, onOpenContent, onStartAssessment }) {
  const activeContents = mod.contents.filter(c => c.active);
  const done = activeContents.filter(c => c.progress?.completionStatus === 'Completed').length;
  const total = activeContents.length;
  const modPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const unifiedItems = [
    ...activeContents.map(c => ({ kind: 'content', order: c.contentOrder ?? 0, data: c })),
    ...mod.faqs.map(f => ({ kind: 'faq', order: (f.sortOrder ?? 0) + 0.5, data: f })),
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
            const isDone = prog?.completionStatus === 'Completed';
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
                  {prog && <div style={{ fontSize: 11, color: prog.completionPct >= 100 ? 'var(--ok)' : 'var(--muted)', fontWeight: 800, marginTop: 2 }}>{Math.round(prog.completionPct)}%</div>}
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
  const attemptsLeft = assessment.attemptLimit - (result?.totalAttempts || 0);

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
          {result && <p style={{ fontSize: 12.5, marginTop: 5, fontWeight: 800, color: passed ? 'var(--ok)' : 'var(--bad)' }}>Best score: {Math.round(result.bestPercentage)}% — {result.result}</p>}
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

function ContentViewerModal({ content, onClose, videoRef, onPauseChange, renderContentUrl }) {
  const media = renderContentUrl(content);
  const isVideo = content.contentType === 'video';
  const progress = content.progress;
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);
  const [completionState, setCompletionState] = useState({ saving: false, done: progress?.completionStatus === 'Completed' || Number(progress?.completionPct || 0) >= 100, error: '' });

  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
    setLoadTimeout(false);
    setCompletionState({ saving: false, done: progress?.completionStatus === 'Completed' || Number(progress?.completionPct || 0) >= 100, error: '' });
    if (media?.type === 'proxy' || media?.type === 'drive') {
      const t = setTimeout(() => setLoadTimeout(true), 15000);
      return () => clearTimeout(t);
    }
  }, [content.contentId]);

  const canMarkComplete = !!media && !isVideo && media.type !== 'youtube' && !completionState.done;

  async function markComplete(closeAfter = false) {
    if (completionState.saving) return;
    setCompletionState(prev => ({ ...prev, saving: true, error: '' }));
    const res = await api.post(`/trainee/content/${content.contentId}/close`, { completed: true, completionStatus: 'Completed', positionSeconds: videoRef.current?.currentTime || 0, durationSeconds: videoRef.current?.duration || 0, playerMode: content.playerMode || 'Auto' }, 'trainee');

    if (!res.ok) {
      setCompletionState(prev => ({ ...prev, saving: false, error: res.message || 'Unable to mark complete.' }));
      return;
    }

    setCompletionState({ saving: false, done: true, error: '' });
    if (closeAfter) onClose();
  }

  const modalStyle = fullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, maxWidth: '100vw', width: '100vw', borderRadius: 0, display: 'flex', flexDirection: 'column' } : { maxWidth: 1080, width: '95vw' };
  const contentHeight = fullscreen ? 'calc(100vh - 70px)' : '72vh';

  return (
    <div className="modal-overlay" onClick={e => !fullscreen && e.target === e.currentTarget && onClose()} style={fullscreen ? { alignItems: 'stretch', padding: 0 } : {}}>
      <div className="modal-box" style={modalStyle}>
        <div className="modal-head" style={{ flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ fontSize: 15 }}>{content.contentTitle}</b>
            <div className="row" style={{ gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
              <span className="content-type-badge">{content.contentType}</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Activity tracked automatically</span>
              {completionState.done && <span className="pill ok">✓ Completed</span>}
              {completionState.error && <span className="pill bad">{completionState.error}</span>}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {canMarkComplete && <button className="btn small accent" onClick={() => markComplete(false)} disabled={completionState.saving}>{completionState.saving ? 'Saving…' : '✓ Mark Complete'}</button>}
            {media && <a href={media.fileId ? `https://drive.google.com/file/d/${media.fileId}/view` : media.url.replace('/preview', '/view')} target="_blank" rel="noopener" className="btn small secondary" title="Open in new tab" onClick={() => { if (canMarkComplete) markComplete(false); }}>↗ Open</a>}
            <button className="btn small secondary" onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Maximize'}>{fullscreen ? '⊡ Exit Full' : '⊞ Maximize'}</button>
            <button className="btn small secondary" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        {(media?.type === 'drive' || media?.type === 'proxy' || (media?.type === 'html5' && !isVideo)) && progress?.lastPositionSeconds > 0 && <div className="info-box" style={{ fontSize: 13, borderRadius: 0, flexShrink: 0 }}>Last watched: {formatSeconds(progress.lastPositionSeconds)} — content resumes if still open.</div>}

        <div style={{ height: contentHeight, background: '#0f172a', position: 'relative', borderRadius: fullscreen ? 0 : '0 0 var(--radius-xl) var(--radius-xl)', flex: fullscreen ? 1 : undefined }}>
          {!media && <div style={{ color: '#94a3b8', padding: 24, textAlign: 'center', paddingTop: '22vh', fontSize: 14 }}>No content URL configured. Contact admin.</div>}

          {media?.type === 'download' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 56 }}>📄</div>
              <div>
                <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{content.contentTitle}</div>
                <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, maxWidth: 380 }}>This file type ({content.contentType?.toUpperCase() || 'Document'}) cannot be previewed directly in the browser. Download it to view in the appropriate application.</div>
              </div>
              <a href={media.url} download className="btn" style={{ fontSize: 14, padding: '10px 28px' }} onClick={() => markComplete(false)}>⬇ Download {content.contentTitle}</a>
              <button className="btn secondary" style={{ fontSize: 13 }} onClick={() => markComplete(true)} disabled={completionState.saving || completionState.done}>{completionState.done ? '✓ Completed' : completionState.saving ? 'Saving…' : 'Mark complete and close'}</button>
              <a href={media.url} target="_blank" rel="noopener" style={{ fontSize: 12, color: '#64748b' }} onClick={() => markComplete(false)}>Open in new tab ↗</a>
            </div>
          )}

          {media?.type === 'html5' && isVideo && <video ref={videoRef} src={media.url} controls style={{ width: '100%', height: '100%', background: '#000', borderRadius: fullscreen ? 0 : '0 0 var(--radius-xl) var(--radius-xl)' }} onPause={() => onPauseChange(true)} onPlay={() => onPauseChange(false)} onLoadedMetadata={e => { if (progress?.lastPositionSeconds > 0) e.target.currentTime = progress.lastPositionSeconds; }} />}
          {media?.type === 'youtube' && <iframe src={media.url} style={{ width: '100%', height: '100%', border: 0, background: '#000', borderRadius: fullscreen ? 0 : '0 0 var(--radius-xl) var(--radius-xl)' }} allowFullScreen referrerPolicy="no-referrer-when-downgrade" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" title={content.contentTitle} />}

          {(media?.type === 'drive' || media?.type === 'proxy' || (media?.type === 'html5' && !isVideo)) && (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              {canMarkComplete && <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 3 }}><button className="btn small accent" onClick={() => markComplete(false)} disabled={completionState.saving}>{completionState.saving ? 'Saving…' : '✓ Mark Complete'}</button></div>}
              {iframeLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', zIndex: 2, gap: 16 }}>
                  <div style={{ width: 48, height: 48, border: '4px solid rgba(255,255,255,.1)', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>{loadTimeout ? 'Server is warming up — this may take 30–60 seconds on first load…' : 'Loading content…'}</div>
                  {loadTimeout && <div style={{ display: 'flex', gap: 10, marginTop: 4 }}><button className="btn small secondary" style={{ fontSize: 12 }} onClick={() => { setIframeLoading(true); setLoadTimeout(false); setIframeError(false); document.getElementById('lms-content-iframe').src += ''; }}>Retry</button>{media?.fileId && <a href={`https://drive.google.com/file/d/${media.fileId}/view`} target="_blank" rel="noopener" className="btn small secondary" style={{ fontSize: 12 }}>Open in Drive ↗</a>}</div>}
                </div>
              )}
              <iframe id="lms-content-iframe" src={media.url} style={{ width: '100%', height: '100%', border: 0, background: '#fff', borderRadius: fullscreen ? 0 : '0 0 var(--radius-xl) var(--radius-xl)' }} allowFullScreen title={content.contentTitle} onLoad={() => setIframeLoading(false)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
