/**
 * ScormLauncher — full-window SCORM 1.2 + 2004 player
 *
 * How it works:
 * 1. Fetches session data + package info from /api/scorm/session/:packageId
 * 2. Injects SCORM API shim into an iframe via srcdoc (not src) so the shim
 *    runs in the same window before the package JS initialises
 * 3. The shim implements both SCORM 1.2 (API) and SCORM 2004 (API_1484_11)
 * 4. On LMSSetValue / SetValue calls the shim batches and POSTs to backend
 * 5. On LMSFinish / Terminate the final state is flushed and the parent is notified
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../utils/api.js';

const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';

function buildShimHtml({ entryUrl, learnerId, learnerName, sessionData, packageId, scormVersion, apiBase, mastery }) {
  // Normalise existing CMI values from DB
  const cmi = sessionData || {};
  const completionStatus = cmi.completionStatus || 'not attempted';
  const successStatus = cmi.successStatus || 'unknown';
  const scoreRaw = cmi.scoreRaw ?? '';
  const scoreMax = cmi.scoreMax ?? '';
  const scoreMin = cmi.scoreMin ?? '';
  const scoreScaled = cmi.scoreScaled ?? '';
  const suspendData = (cmi.suspendData || '').replace(/`/g, '\\`');
  const location = cmi.location || '';
  const totalTime = cmi.totalTime || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body,html{width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:none}</style>
<script>
(function() {
  // ── Shared state ──────────────────────────────────────────────────────────
  var _dirty = false;
  var _terminated = false;
  var _data = {
    // SCORM 1.2 / 2004 shared fields
    'cmi.core.student_id': ${JSON.stringify(learnerId)},
    'cmi.core.student_name': ${JSON.stringify(learnerName)},
    'cmi.core.lesson_status': ${JSON.stringify(completionStatus === 'completed' || completionStatus === 'passed' ? 'passed' : completionStatus === 'not attempted' ? 'not attempted' : 'incomplete')},
    'cmi.core.lesson_location': ${JSON.stringify(location)},
    'cmi.core.score.raw': ${JSON.stringify(String(scoreRaw))},
    'cmi.core.score.max': ${JSON.stringify(String(scoreMax))},
    'cmi.core.score.min': ${JSON.stringify(String(scoreMin))},
    'cmi.core.total_time': ${JSON.stringify(totalTime)},
    'cmi.suspend_data': ${JSON.stringify(suspendData)},
    'cmi.core.exit': '',
    // SCORM 2004
    'cmi.learner_id': ${JSON.stringify(learnerId)},
    'cmi.learner_name': ${JSON.stringify(learnerName)},
    'cmi.completion_status': ${JSON.stringify(completionStatus)},
    'cmi.success_status': ${JSON.stringify(successStatus)},
    'cmi.score.raw': ${JSON.stringify(String(scoreRaw))},
    'cmi.score.max': ${JSON.stringify(String(scoreMax))},
    'cmi.score.min': ${JSON.stringify(String(scoreMin))},
    'cmi.score.scaled': ${JSON.stringify(String(scoreScaled))},
    'cmi.location': ${JSON.stringify(location)},
    'cmi.total_time': ${JSON.stringify(totalTime)},
    'cmi.suspend_data': ${JSON.stringify(suspendData)},
    'cmi.exit': '',
    'cmi.entry': ${JSON.stringify(completionStatus === 'not attempted' ? 'ab-initio' : 'resume')},
  };

  function _flush(onDone) {
    if (!_dirty) { if (onDone) onDone(); return; }
    _dirty = false;
    var payload = {
      completionStatus: _data['cmi.completion_status'] || _data['cmi.core.lesson_status'],
      successStatus: _data['cmi.success_status'],
      scoreRaw: parseFloat(_data['cmi.score.raw'] || _data['cmi.core.score.raw']) || null,
      scoreMax: parseFloat(_data['cmi.score.max'] || _data['cmi.core.score.max']) || null,
      scoreMin: parseFloat(_data['cmi.score.min'] || _data['cmi.core.score.min']) || null,
      scoreScaled: parseFloat(_data['cmi.score.scaled']) || null,
      totalTime: _data['cmi.total_time'] || _data['cmi.core.total_time'],
      suspendData: _data['cmi.suspend_data'],
      location: _data['cmi.location'] || _data['cmi.core.lesson_location'],
      exitStatus: _data['cmi.exit'] || _data['cmi.core.exit'],
    };
    var csrf = '';
    try { var m = document.cookie.match(/(?:^|;)\s*lms_trainee_csrf=([^;]*)/); if (m) csrf = decodeURIComponent(m[1]); } catch(e) {}
    var xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.open('POST', ${JSON.stringify(apiBase + '/scorm/session/' + packageId)}, false); // sync for LMSFinish
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('x-lms-role', 'trainee');
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.send(JSON.stringify(payload));
    if (onDone) onDone();
  }

  // Notify parent frame when finished
  function _notifyParent(reason) {
    try { window.parent.postMessage({ type: 'scorm:finished', reason: reason }, '*'); } catch(e) {}
  }

  // ── SCORM 1.2 API ─────────────────────────────────────────────────────────
  window.API = {
    LMSInitialize: function() { return 'true'; },
    LMSGetValue: function(k) { return _data[k] != null ? String(_data[k]) : ''; },
    LMSSetValue: function(k, v) {
      _data[k] = v;
      _dirty = true;
      // Map 1.2 lesson_status to 2004 fields too
      if (k === 'cmi.core.lesson_status') {
        if (v === 'passed' || v === 'failed') { _data['cmi.success_status'] = v; _data['cmi.completion_status'] = 'completed'; }
        else if (v === 'completed') { _data['cmi.completion_status'] = 'completed'; }
        else if (v === 'incomplete') { _data['cmi.completion_status'] = 'incomplete'; }
      }
      if (k === 'cmi.core.score.raw') _data['cmi.score.raw'] = v;
      if (k === 'cmi.core.lesson_location') _data['cmi.location'] = v;
      if (k === 'cmi.core.total_time') _data['cmi.total_time'] = v;
      return 'true';
    },
    LMSCommit: function() { _flush(); return 'true'; },
    LMSFinish: function() { _flush(); _terminated = true; _notifyParent('finish'); return 'true'; },
    LMSGetLastError: function() { return '0'; },
    LMSGetErrorString: function() { return ''; },
    LMSGetDiagnostic: function() { return ''; },
  };

  // ── SCORM 2004 API ────────────────────────────────────────────────────────
  window.API_1484_11 = {
    Initialize: function() { return 'true'; },
    GetValue: function(k) { return _data[k] != null ? String(_data[k]) : ''; },
    SetValue: function(k, v) {
      _data[k] = v;
      _dirty = true;
      if (k === 'cmi.completion_status') _data['cmi.core.lesson_status'] = v;
      if (k === 'cmi.success_status' && (v === 'passed' || v === 'failed')) _data['cmi.core.lesson_status'] = v;
      if (k === 'cmi.score.raw') _data['cmi.core.score.raw'] = v;
      if (k === 'cmi.location') _data['cmi.core.lesson_location'] = v;
      return 'true';
    },
    Commit: function() { _flush(); return 'true'; },
    Terminate: function() { _flush(); _terminated = true; _notifyParent('terminate'); return 'true'; },
    GetLastError: function() { return '0'; },
    GetErrorString: function() { return ''; },
    GetDiagnostic: function() { return ''; },
  };

  // Auto-flush every 30s and on page unload
  setInterval(function() { _flush(); }, 30000);
  window.addEventListener('beforeunload', function() { _flush(); });
})();
<\/script>
</head>
<body>
<iframe src="${entryUrl}" allow="fullscreen" allowfullscreen></iframe>
</body>
</html>`;
}

export default function ScormLauncher({ packageId, onClose }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState('');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef(null);

  const load = useCallback(async () => {
    setStatus('loading');
    const res = await api.get(`/scorm/session/${packageId}`, 'trainee');
    if (!res.ok) {
      setErrorMsg(res.message || 'Could not load SCORM package.');
      setStatus('error');
      return;
    }
    setSessionInfo(res);
    setStatus('ready');
  }, [packageId]);

  useEffect(() => { load(); }, [load]);

  // Listen for finish message from shim
  useEffect(() => {
    function handler(e) {
      if (e.data?.type === 'scorm:finished') {
        setStatus('completed');
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, background: '#0f172a' }}>
        <div style={{ width: 48, height: 48, border: '4px solid rgba(255,255,255,.1)', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading SCORM package…</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, background: '#0f172a', padding: 24 }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ color: '#f87171', fontSize: 14, textAlign: 'center' }}>{errorMsg}</div>
        <button className="btn small secondary" onClick={onClose}>Close</button>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, background: '#0f172a', padding: 24 }}>
        <div style={{ fontSize: 48 }}>🎓</div>
        <div style={{ color: '#4ade80', fontSize: 18, fontWeight: 700 }}>Module Complete!</div>
        <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
          Your progress has been saved.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn small secondary" onClick={() => { setStatus('ready'); }}>Relaunch</button>
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const { session, package: pkg, learner } = sessionInfo;
  const apiBase = API_BASE;

  // Build absolute entry URL
  const entryUrl = pkg.packageUrl.startsWith('http')
    ? `${pkg.packageUrl}/${pkg.entryPoint}`
    : `${window.location.origin}${pkg.packageUrl}/${pkg.entryPoint}`;

  const shimHtml = buildShimHtml({
    entryUrl,
    learnerId: learner.id,
    learnerName: learner.name,
    sessionData: session,
    packageId,
    scormVersion: pkg.scormVersion,
    apiBase,
    mastery: pkg.mastery,
  });

  const containerStyle = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#0f172a' }
    : { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' };

  return (
    <div style={containerStyle}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pkg.title}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            SCORM {pkg.scormVersion} · Progress auto-saved
          </div>
        </div>
        <span style={{ fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,.06)', borderRadius: 6, padding: '3px 8px' }}>
          {session?.completionStatus || 'not attempted'}
        </span>
        {session?.scoreRaw != null && (
          <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>
            Score: {session.scoreRaw}%
          </span>
        )}
        <button
          onClick={() => setFullscreen(f => !f)}
          style={{ background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 13 }}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? '⊡' : '⊞'}
        </button>
        <button
          onClick={onClose}
          style={{ background: 'rgba(239,68,68,.15)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: '#f87171', fontSize: 13 }}
        >
          ✕ Close
        </button>
      </div>

      {/* SCORM iframe with shim injected via srcdoc */}
      <iframe
        ref={iframeRef}
        srcDoc={shimHtml}
        style={{ flex: 1, border: 'none', background: '#fff' }}
        title={pkg.title}
        allow="fullscreen"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
      />
    </div>
  );
}
