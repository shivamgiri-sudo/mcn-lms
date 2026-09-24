import { useState, useRef, useEffect, useCallback } from 'react';
import { api, fetchAuthenticatedBlobUrl } from '../../utils/api.js';
import { formatSeconds } from '../../utils/format.js';

// Shared between LearningTab (classroom content) and the Assigned tab
// (independent/"nugget" modules) so both content types get identical
// tracked viewing, heartbeat, completion and Acknowledge behaviour. Opening
// content any other way (a raw <a href> link, for instance) never calls
// /open or /heartbeat, so nothing is tracked and the Acknowledge control
// never appears -- this hook is the one correct way to open content.

const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

function getDriveProxyUrl(fileId) {
  return `${API_BASE}/drive/proxy/${encodeURIComponent(fileId)}`;
}

function protectedLocalUrl(value) {
  const url = String(value || '');
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith('/uploads/content/')) {
      const filename = decodeURIComponent(parsed.pathname.split('/').pop() || '');
      return filename ? `${API_BASE}/content/files/${encodeURIComponent(filename)}` : '';
    }
    if (parsed.pathname.startsWith('/api/content/files/') || parsed.pathname.startsWith('/api/drive/proxy/')) {
      return /^https?:\/\//i.test(url) ? url : `${parsed.pathname}${parsed.search}`;
    }
  } catch {}
  return '';
}

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
  // Drive-proxied content is typically a document/PDF -- see the directStream
  // note below for why this skips the full-file blob fetch.
  return { type: 'proxy', url: proxyUrl, fileId, requiresAuth: true, directStream: true };
}

export function renderContentUrl(c) {
  const url = c.directMediaUrl || '';
  if (url) {
    const ytEmbed = getYoutubeEmbedUrl(url);
    if (ytEmbed) return { type: 'youtube', url: ytEmbed };

    const protectedUrl = protectedLocalUrl(url);
    if (protectedUrl) {
      const ext = url.split('?')[0].split('.').pop().toLowerCase();
      const isVid = ['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext);
      const isPdf = ext === 'pdf';
      const isOffice = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext);
      // directStream: video and PDF/iframe content is passed straight to the
      // <video>/<iframe> element instead of being fully downloaded into memory
      // by fetchAuthenticatedBlobUrl first. A large video (or a large PDF) can
      // take longer to fully buffer than the request timeout allows, and gets
      // zero progressive playback in the meantime; the session lookup already
      // supports cookie-only auth via a ?role= hint for exactly this case (see
      // resolveSessionCredential in utils/session.js), so no custom header is
      // needed and the browser's native HTTP range-request streaming just works.
      if (isVid) return { type: 'html5', url: protectedUrl, requiresAuth: true, directStream: true };
      // Images get their own type. Routing them through the iframe branch meant a
      // blob: URL in a frame, which the Content-Security-Policy blocked outright.
      if (IMAGE_EXTENSIONS.includes(ext)) return { type: 'image', url: protectedUrl, requiresAuth: true };
      if (isPdf) return { type: 'proxy', url: protectedUrl, requiresAuth: true, directStream: true };
      if (isOffice) return { type: 'download', url: protectedUrl, requiresAuth: true };
      return { type: 'proxy', url: protectedUrl, requiresAuth: true, directStream: true };
    }

    if (!url.includes('drive.google.com')) {
      const ext = url.split('?')[0].split('.').pop().toLowerCase();
      const isVid = ['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext);
      const isPdf = ext === 'pdf';
      const isOffice = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext);
      if (isVid) return { type: 'html5', url };
      if (IMAGE_EXTENSIONS.includes(ext)) return { type: 'image', url };
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

export function useTrackedContentViewer(onRefresh) {
  const [viewingContent, setViewingContent] = useState(null);
  const [lockedMsg, setLockedMsg] = useState(null);
  const [scormPackageId, setScormPackageId] = useState(null);
  const heartbeatRef = useRef(null);
  const lastSentRef = useRef(Date.now());
  const sessionSecsRef = useRef(0);
  const videoRef = useRef(null);
  const isPausedRef = useRef(false);
  // Ref mirror of viewingContent — lets heartbeat callbacks stay stable without stale closures
  const viewingContentRef = useRef(null);

  const stopHeartbeat = useCallback(async (sendClose = true) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (sendClose && viewingContentRef.current) {
      const content = viewingContentRef.current;
      const delta = Math.min(Math.round((Date.now() - lastSentRef.current) / 1000), 120);
      if (delta > 0) {
        await api.post(`/trainee/content/${content.contentId}/close`, {
          secondsDelta: delta,
          positionSeconds: videoRef.current?.currentTime || 0,
          durationSeconds: videoRef.current?.duration || 0,
          playerMode: content.playerMode || 'Auto',
        }, 'trainee');
      }
    }

    sessionSecsRef.current = 0;
    lastSentRef.current = Date.now();
  }, []); // stable — reads from ref, no state dep

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
        playerMode: viewingContentRef.current?.playerMode || 'Auto',
      }, 'trainee');
    }, 30000);
  }, []); // stable — contentId arg, playerMode from ref

  async function openContent(content) {
    setLockedMsg(null);

    if (!content?.contentId) {
      setLockedMsg('This item has no content to open. Contact your admin.');
      return;
    }

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

    try {
      if (viewingContentRef.current) await stopHeartbeat(true);

      const openRes = await api.post(`/trainee/content/${content.contentId}/open`, {}, 'trainee');
      if (openRes.locked || openRes.ok === false) {
        setLockedMsg(openRes.message || 'Complete the previous content first.');
        return;
      }

      let resolvedMedia = renderContentUrl(content);
      if (resolvedMedia?.requiresAuth && resolvedMedia.directStream) {
        // No blob fetch: the element streams straight from the protected URL,
        // authenticated by the session cookie the browser already sends. The
        // ?role hint disambiguates when a browser has more than one portal
        // session's cookie active at once (see resolveSessionCredential).
        const separator = resolvedMedia.url.includes('?') ? '&' : '?';
        resolvedMedia = { ...resolvedMedia, url: `${resolvedMedia.url}${separator}role=trainee`, requiresAuth: false };
      } else if (resolvedMedia?.requiresAuth) {
        const protectedResult = await fetchAuthenticatedBlobUrl(resolvedMedia.url, 'trainee');
        if (!protectedResult.ok) {
          setLockedMsg(protectedResult.message || 'Unable to open protected learning content.');
          return;
        }
        resolvedMedia = { ...resolvedMedia, url: protectedResult.url, requiresAuth: false, objectUrl: true };
      }

      const resolved = { ...content, resolvedMedia };
      viewingContentRef.current = resolved;
      setViewingContent(resolved);
      lastSentRef.current = Date.now();
      startHeartbeat(content.contentId);
    } catch (err) {
      // Any unexpected exception here previously vanished silently -- the
      // click looked like it did nothing at all. Surface it instead.
      console.error('[useTrackedContentViewer] openContent failed:', err);
      setLockedMsg(err?.message || 'Unable to open this content. Please try again.');
    }
  }

  async function closeContent() {
    const objectUrl = viewingContentRef.current?.resolvedMedia?.objectUrl ? viewingContentRef.current.resolvedMedia.url : '';
    await stopHeartbeat(true);
    viewingContentRef.current = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setViewingContent(null);
    onRefresh && onRefresh();
  }

  function closeScorm() {
    setScormPackageId(null);
    onRefresh && onRefresh();
  }

  // Only runs on unmount — stopHeartbeat is stable so no re-subscriptions on content change
  useEffect(() => () => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    const objectUrl = viewingContentRef.current?.resolvedMedia?.objectUrl ? viewingContentRef.current.resolvedMedia.url : '';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, []);

  return {
    viewingContent, openContent, closeContent,
    lockedMsg, setLockedMsg,
    scormPackageId, closeScorm,
    videoRef, isPausedRef,
  };
}

export function ContentViewerModal({ content, onClose, videoRef, onPauseChange }) {
  const media = content.resolvedMedia || renderContentUrl(content);
  const isVideo = content.contentType === 'video';
  const progress = content.progress;
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);
  const iframeRef = useRef(null);
  const [completionState, setCompletionState] = useState({ saving: false, done: progress?.completionStatus === 'Completed' || Number(progress?.completionPct || 0) >= 100, error: '' });
  // Distinct from completion: an explicit attestation the learner cannot later deny
  // making, captured with a timestamp, IP and user agent on the server. Once set it
  // is permanent for that content version — there is no un-acknowledge, but a
  // "Publish New Version" by an admin makes the recorded version stale and asks
  // for a fresh acknowledgement (see acknowledgedStale below).
  const [ackState, setAckState] = useState({ saving: false, at: progress?.acknowledgedAt || null, version: progress?.acknowledgedVersion ?? null, error: '' });
  const contentVersion = Number(content.contentVersion ?? content.versionNo ?? 1);
  const acknowledgedStale = Boolean(ackState.at) && Number(ackState.version ?? 1) < contentVersion;
  // A separate, deliberate tick before the button even accepts a click — one
  // click alone reads as a possible misclick; a checkbox the learner actively
  // sets, then a button that stays disabled until they do, is the consent
  // pattern audits expect.
  const [ackChecked, setAckChecked] = useState(false);

  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
    setLoadTimeout(false);
    setCompletionState({ saving: false, done: progress?.completionStatus === 'Completed' || Number(progress?.completionPct || 0) >= 100, error: '' });
    setAckState({ saving: false, at: progress?.acknowledgedAt || null, version: progress?.acknowledgedVersion ?? null, error: '' });
    setAckChecked(false);
    if (media?.type === 'proxy' || media?.type === 'drive') {
      const t = setTimeout(() => setLoadTimeout(true), 15000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [content.contentId, media?.type, progress?.completionPct, progress?.completionStatus, progress?.acknowledgedAt]);

  // Hide manual mark-complete for content that has a completionRulePct set (auto-completes via watch time)
  // and for video/youtube (tracked automatically)
  const canMarkComplete = !!media && !isVideo && media.type !== 'youtube' && !completionState.done && !content.completionRulePct;

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

  async function acknowledgeContent() {
    if (ackState.saving || (ackState.at && !acknowledgedStale) || !ackChecked) return;
    setAckState(prev => ({ ...prev, saving: true, error: '' }));
    const res = await api.post(`/trainee/content/${content.contentId}/acknowledge`, {}, 'trainee');
    if (!res.ok) {
      setAckState(prev => ({ ...prev, saving: false, error: res.message || 'Unable to record your acknowledgement.' }));
      return;
    }
    setAckState({ saving: false, at: res.acknowledgedAt || new Date().toISOString(), version: contentVersion, error: '' });
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
              {ackState.at && !acknowledgedStale && <span className="pill ok" title={new Date(ackState.at).toLocaleString()}>✓ Acknowledged</span>}
              {acknowledgedStale && <span className="pill warn" title="This content was updated since you last acknowledged it.">Re-acknowledgement Required</span>}
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

        {/* One acknowledgement control for every content type — video, document, image,
            broadcast nugget. Disabled until time-completion is reached, so it cannot be
            used as a shortcut around actually engaging with the content; permanent once
            recorded, matching the server, which never lets it be un-set. */}
        {completionState.done && (
          <div className={`info-box ${ackState.at && !acknowledgedStale ? '' : 'warn'}`} style={{ fontSize: 13, borderRadius: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            {ackState.at && !acknowledgedStale ? (
              <span>✓ You acknowledged reading this on {new Date(ackState.at).toLocaleString()}.</span>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 220 }}>
                  <input
                    type="checkbox"
                    checked={ackChecked}
                    onChange={e => setAckChecked(e.target.checked)}
                    disabled={ackState.saving}
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span>
                    {acknowledgedStale
                      ? 'This content has been updated. I confirm that I have read and understood the revised content.'
                      : 'I confirm that I have read and understood this content.'}
                  </span>
                </label>
                <button className="btn small accent" onClick={acknowledgeContent} disabled={ackState.saving || !ackChecked}>{ackState.saving ? 'Recording…' : acknowledgedStale ? '✓ Re-Acknowledge' : '✓ I Acknowledge'}</button>
              </>
            )}
            {ackState.error && <span className="pill bad">{ackState.error}</span>}
          </div>
        )}

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
          {media?.type === 'image' && (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', overflow: 'auto', padding: 12, position: 'relative' }}>
              {canMarkComplete && <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 3 }}><button className="btn small accent" onClick={() => markComplete(false)} disabled={completionState.saving}>{completionState.saving ? 'Saving…' : '✓ Mark Complete'}</button></div>}
              <img src={media.url} alt={content.contentTitle} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} />
            </div>
          )}
          {media?.type === 'youtube' && <iframe src={media.url} style={{ width: '100%', height: '100%', border: 0, background: '#000', borderRadius: fullscreen ? 0 : '0 0 var(--radius-xl) var(--radius-xl)' }} allowFullScreen referrerPolicy="no-referrer-when-downgrade" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" title={content.contentTitle} />}

          {(media?.type === 'drive' || media?.type === 'proxy' || (media?.type === 'html5' && !isVideo)) && (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              {canMarkComplete && <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 3 }}><button className="btn small accent" onClick={() => markComplete(false)} disabled={completionState.saving}>{completionState.saving ? 'Saving…' : '✓ Mark Complete'}</button></div>}
              {(iframeLoading || iframeError) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', zIndex: 2, gap: 16 }}>
                  {iframeError ? (
                    <>
                      <div style={{ fontSize: 48, marginBottom: 8 }}>⚠️</div>
                      <div style={{ color: '#f87171', fontSize: 14, fontWeight: 700 }}>Unable to load content</div>
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>The file may be restricted or unavailable.</div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                        <button className="btn small secondary" style={{ fontSize: 12 }} onClick={() => { setIframeLoading(true); setIframeError(false); setLoadTimeout(false); if (iframeRef.current) iframeRef.current.src += ''; }}>Retry</button>
                        {media?.fileId && <a href={`https://drive.google.com/file/d/${media.fileId}/view`} target="_blank" rel="noopener" className="btn small secondary" style={{ fontSize: 12 }}>Open in Drive ↗</a>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 48, height: 48, border: '4px solid rgba(255,255,255,.1)', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>{loadTimeout ? 'Server is warming up — this may take 30–60 seconds on first load…' : 'Loading content…'}</div>
                      {loadTimeout && <div style={{ display: 'flex', gap: 10, marginTop: 4 }}><button className="btn small secondary" style={{ fontSize: 12 }} onClick={() => { setIframeLoading(true); setLoadTimeout(false); setIframeError(false); if (iframeRef.current) iframeRef.current.src += ''; }}>Retry</button>{media?.fileId && <a href={`https://drive.google.com/file/d/${media.fileId}/view`} target="_blank" rel="noopener" className="btn small secondary" style={{ fontSize: 12 }}>Open in Drive ↗</a>}</div>}
                    </>
                  )}
                </div>
              )}
              <iframe ref={iframeRef} src={media.url} style={{ width: '100%', height: '100%', border: 0, background: '#fff', borderRadius: fullscreen ? 0 : '0 0 var(--radius-xl) var(--radius-xl)' }} allowFullScreen title={content.contentTitle} onLoad={() => { setIframeLoading(false); setIframeError(false); }} onError={() => { setIframeLoading(false); setIframeError(true); }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
