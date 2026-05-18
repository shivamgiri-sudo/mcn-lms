import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

function normalizeType(f) {
  if (f.contentType && f.contentType !== 'link') return f.contentType;
  const m = f.mimeType || '';
  if (m.includes('video')) return 'video';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('presentation') || m.includes('powerpoint')) return 'ppt';
  if (m.includes('document') || m.includes('word')) return 'doc';
  if (m.includes('spreadsheet') || m.includes('excel')) return 'doc';
  if (m.includes('folder')) return 'folder';
  return 'file';
}

const METHOD_LABEL = {
  service_account: 'Service Account',
  oauth: 'Your Google Account (OAuth)',
  api_key: 'API Key (public folders)',
};

export default function DriveTab() {
  const [classrooms, setClassrooms] = useState([]);
  const [modules, setModules] = useState([]);
  const [selected, setSelected] = useState('');
  const [selectedMod, setSelectedMod] = useState('');
  const [folderId, setFolderId] = useState('');
  const [files, setFiles] = useState([]);
  const [syncMethod, setSyncMethod] = useState(null);
  const [tokenStatus, setTokenStatus] = useState(null);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [loading, setLoading] = useState(false);
  const [addingFile, setAddingFile] = useState(null);
  const [addForm, setAddForm] = useState({ contentTitle: '', contentType: 'video', estimatedMins: '', completionRulePct: 80 });

  useEffect(() => {
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
    refreshStatus();
  }, []);

  function refreshStatus() {
    return api.get('/drive/token-status', 'admin').then(r => {
      if (r.ok) setTokenStatus(r);
      return r;
    });
  }

  async function testConnection() {
    const status = await refreshStatus();
    if (!status.ok) return toast(status.message || 'Could not check Drive connection.', false);
    if (status.method === 'service_account') return toast(`Drive connection ready via Service Account${status.serviceAccountEmail ? `: ${status.serviceAccountEmail}` : ''}.`);
    if (status.method === 'oauth') return toast('Drive connection ready via your Google account.');
    if (status.method === 'api_key') return toast('Drive can browse public folders via API key. Use OAuth or share folders with the service account for private folders.');
    return toast('Drive is not connected yet. Add OAuth credentials or a service account in backend/.env.', false);
  }

  useEffect(() => {
    setSelectedMod('');
    setModules([]);
    if (selected) {
      api.get(`/admin/classrooms/${selected}/modules`, 'admin').then(r => r.ok && setModules(r.data));
      const cl = classrooms.find(c => c.classroomId === selected);
      if (cl?.driveFolderId) setFolderId(cl.driveFolderId);
    }
  }, [selected]);

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 6000); }

  async function connectOAuth() {
    const res = await api.get('/drive/auth-url', 'admin');
    if (res.ok && res.url) {
      const popup = window.open(res.url, 'google-oauth', 'width=520,height=660');
      // Poll until popup closes, then refresh status
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          setTimeout(refreshStatus, 1000);
        }
      }, 800);
    } else {
      toast(res.message || 'OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env', false);
    }
  }

  async function disconnect() {
    await api.post('/drive/disconnect', {}, 'admin');
    refreshStatus();
    toast('Disconnected Google account.');
  }

  function extractFolderId(raw) {
    const m = raw.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : raw.trim();
  }

  async function syncDrive() {
    if (!selected) return toast('Select a classroom first.', false);
    if (!folderId.trim()) return toast('Enter a Drive Folder ID.', false);
    const cleanId = extractFolderId(folderId);
    setFolderId(cleanId);
    setLoading(true);
    const res = await api.post(`/admin/classrooms/${selected}/sync-drive`, { folderId: cleanId }, 'admin');
    setLoading(false);
    if (res.ok) {
      toast(`✓ Synced ${res.data.synced} files from Drive.`);
      setFiles(res.data.files || []);
      setSyncMethod(res.data.method);
    } else toast(res.message || 'Sync failed.', false);
  }

  async function browseFolder() {
    if (!folderId.trim()) return toast('Enter a Drive Folder ID.', false);
    const cleanId = extractFolderId(folderId);
    setFolderId(cleanId);
    setLoading(true);
    const res = await api.get(`/drive/folder/${cleanId}`, 'admin');
    setLoading(false);
    if (res.ok) {
      setFiles(res.data);
      setSyncMethod(res.method);
      toast(`Found ${res.data.length} files.`);
    } else toast(res.message || 'Failed to list folder.', false);
  }

  function addContentFromDriveFile(file) {
    setAddingFile(file);
    // Use cleaned display title (strips numeric prefix + extension)
    const displayTitle = file.displayTitle || file.name.replace(/^[\d.]+[_\s-]+/, '').replace(/\.[^/.]+$/, '').trim();
    setAddForm({
      contentTitle: displayTitle,
      contentType: file.contentType || 'video',
      estimatedMins: '',
      completionRulePct: 80,
      contentOrder: file.sortOrder || '',
    });
  }

  async function confirmAddContent(e) {
    e.preventDefault();
    if (!selectedMod) return toast('Select a module to add this content to.', false);
    const res = await api.post(`/admin/modules/${selectedMod}/contents`, {
      contentTitle: addForm.contentTitle,
      contentType: addForm.contentType,
      driveFileId: addingFile.id,
      driveUrl: `https://drive.google.com/file/d/${addingFile.id}/preview`,
      playerMode: 'Drive Preview',
      estimatedMins: addForm.estimatedMins,
      completionRulePct: addForm.completionRulePct,
      contentOrder: addForm.contentOrder || undefined,
    }, 'admin');
    if (res.ok) {
      toast(`✓ "${addForm.contentTitle}" added to module.`);
      setAddingFile(null);
    } else toast(res.message || 'Failed to add content.', false);
  }

  const isOAuthConnected = tokenStatus?.oauthConnected;
  const isServiceAccount = tokenStatus?.method === 'service_account';
  const hasAnyAccess = tokenStatus?.hasToken;
  const serviceAccountEmail = tokenStatus?.serviceAccountEmail;

  return (
    <div style={{ marginTop: 12 }}>

      {/* Connection status */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <b style={{ fontSize: 14 }}>Google Drive Connection</b>
            <p style={{ fontSize: 13, marginTop: 5 }}>
              {isServiceAccount && (
                <span style={{ color: 'var(--ok)' }}>✓ Service Account active</span>
              )}
              {isOAuthConnected && (
                <span style={{ color: 'var(--ok)' }}>✓ Your Google account is connected — can access any folder you can view</span>
              )}
              {!hasAnyAccess && (
                <span style={{ color: 'var(--warn)' }}>⚠ Not connected — connect your Google account below to sync any folder</span>
              )}
            </p>
            {isOAuthConnected && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                Works like Google Apps Script — accesses any folder your account can view, including view-only shared links.
              </p>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small secondary" onClick={testConnection}>
              Test Connection
            </button>
            {isOAuthConnected ? (
              <button className="btn small secondary" onClick={disconnect}>Disconnect Account</button>
            ) : (
              <button className="btn small accent" onClick={connectOAuth}>
                Connect Google Account (OAuth)
              </button>
            )}
          </div>
        </div>

        {isServiceAccount && serviceAccountEmail && (
          <div className="info-box" style={{ marginTop: 12, fontSize: 13, background: 'rgba(22,163,74,.12)', border: '1px solid rgba(74,222,128,.25)' }}>
            <b>Share your Drive folders with this email to allow sync:</b>
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 13, color: '#60a5fa', background: 'rgba(29,78,216,.15)', borderRadius: 8, padding: '8px 12px', userSelect: 'all', cursor: 'text', border: '1px solid rgba(96,165,250,.25)', wordBreak: 'break-all' }}>
              {serviceAccountEmail}
            </div>
            <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
              In Google Drive: right-click folder → Share → paste email above → Viewer access is enough.
            </div>
          </div>
        )}
        {!isOAuthConnected && !isServiceAccount && (
          <div className="info-box" style={{ marginTop: 12, fontSize: 13 }}>
            <b>How to connect:</b> Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> in <code>backend/.env</code>, restart the backend, then click "Connect Google Account".
            After OAuth is connected, paste any folder ID your account can view and sync it.
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Classroom</label>
            <select className="select" value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">Select classroom...</option>
              {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Target Module (for adding content)</label>
            <select className="select" value={selectedMod} onChange={e => setSelectedMod(e.target.value)} disabled={!selected}>
              <option value="">Select module...</option>
              {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} — {m.moduleTitle}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, gridColumn: '1/-1' }}>
            <label>Drive Folder ID</label>
            <input
              className="input"
              placeholder="Paste folder ID or full Google Drive folder URL — ID is auto-extracted"
              value={folderId}
              onChange={e => setFolderId(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn small secondary" onClick={browseFolder} disabled={loading || !folderId.trim()}>
            {loading ? '...' : '🔍 Browse Folder'}
          </button>
          <button className="btn small" onClick={syncDrive} disabled={loading || !selected || !folderId.trim()}>
            {loading ? 'Syncing...' : '⟳ Sync & Save to Classroom'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            Browse: preview files. Sync: saves metadata to DB.
          </span>
        </div>
        {msg.text && <div className={`toast ${msg.ok ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Drive Files ({files.length})</h3>
              {syncMethod && (
                <span className="pill info" style={{ fontSize: 11 }}>via {METHOD_LABEL[syncMethod] || syncMethod}</span>
              )}
            </div>
            {!selectedMod && <span className="pill warn">Select a module above to add files</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 12, width: 32 }}>{f.sortOrder || ''}</td>
                    <td>
                      <b style={{ fontSize: 13 }}>{f.displayTitle || f.name.replace(/\.[^/.]+$/, '')}</b>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{f.name}</div>
                    </td>
                    <td><span className="content-type-badge">{normalizeType(f)}</span></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <a href={f.viewUrl || `https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noopener" className="btn xs secondary">View ↗</a>
                        <button className="btn xs" onClick={() => addContentFromDriveFile(f)} disabled={!selectedMod}>
                          + Add to Module
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add content modal */}
      {addingFile && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAddingFile(null)}>
          <div className="modal-box" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <b>Add to Module</b>
              <button className="btn small secondary" onClick={() => setAddingFile(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="info-box" style={{ marginBottom: 14 }}>
                <b>Drive file:</b> {addingFile.name}
                <br /><span style={{ fontSize: 12, color: 'var(--muted)' }}>ID: {addingFile.id}</span>
              </div>
              <form onSubmit={confirmAddContent}>
                <div className="field">
                  <label>Content Title *</label>
                  <input className="input" value={addForm.contentTitle} onChange={e => setAddForm(p => ({ ...p, contentTitle: e.target.value }))} required />
                </div>
                <div className="col-2">
                  <div className="field">
                    <label>Content Type</label>
                    <select className="select" value={addForm.contentType} onChange={e => setAddForm(p => ({ ...p, contentType: e.target.value }))}>
                      {['video', 'pdf', 'ppt', 'doc', 'link'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Est. Minutes</label>
                    <input className="input" type="number" min="0" value={addForm.estimatedMins} onChange={e => setAddForm(p => ({ ...p, estimatedMins: e.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>Completion Rule %</label>
                  <input className="input" type="number" min="1" max="100" value={addForm.completionRulePct} onChange={e => setAddForm(p => ({ ...p, completionRulePct: e.target.value }))} />
                </div>
                <button className="btn" type="submit" style={{ width: '100%', marginTop: 14 }}>
                  Add Content to Module
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
