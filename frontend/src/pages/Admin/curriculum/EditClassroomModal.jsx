import { useState, useEffect } from 'react';
import { api, uploadFile } from '../../../utils/api.js';
import { BranchSelect, ProcessSelect, LobSelect } from '../../../components/OrgSelect.jsx';

function parseCsvRows(rawCsv) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < rawCsv.length; i++) {
    const ch = rawCsv[i], next = rawCsv[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (ch === '"') { quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(v => v !== '')) rows.push(row);
      row = []; cell = '';
    } else { cell += ch; }
  }
  row.push(cell.trim());
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

export default function EditClassroomModal({ classroom, onClose, onSaved }) {
  const [modules, setModules] = useState([]);
  const [selectedMod, setSelectedMod] = useState(null);
  const [tab, setTab] = useState('modules');
  const [msg, setMsg] = useState({ text: '', ok: true });
  const [loading, setLoading] = useState(false);

  // Module add
  const [modForm, setModForm] = useState({ dayNo: '', moduleTitle: '', moduleOrder: '', description: '' });

  // Drive sync
  const [folderId, setFolderId] = useState(classroom.driveFolderId || '');
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveLoading, setDriveLoading] = useState(false);

  // Content upload
  const [contentForm, setContentForm] = useState({ contentTitle: '', contentType: 'video', driveFileId: '', driveUrl: '', directMediaUrl: '', playerMode: 'Auto', contentOrder: '', estimatedMins: '', completionRulePct: 80 });
  const [contentFile, setContentFile] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);
  const [contentMode, setContentMode] = useState('single');

  // SCORM
  const [scormFile, setScormFile] = useState(null);
  const [scormTitle, setScormTitle] = useState('');
  const [scormUploading, setScormUploading] = useState(false);
  const [scormResult, setScormResult] = useState(null);

  // MCQ
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState('');
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [mcqUploading, setMcqUploading] = useState(false);

  // FAQ
  const [faqBulkFiles, setFaqBulkFiles] = useState([]);
  const [faqMode, setFaqMode] = useState('single');
  const [faqForm, setFaqForm] = useState({ question: '', answer: '', sortOrder: '' });

  useEffect(() => { loadModules(); loadAssessments(); }, []);

  function toast(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 5000); }

  async function loadModules() {
    const r = await api.get(`/admin/classrooms/${classroom.classroomId}/modules`, 'admin');
    if (r.ok) setModules(r.data);
  }
  async function loadAssessments() {
    const r = await api.get('/admin/assessments', 'admin');
    if (r.ok) setAssessments(r.data.filter(a => a.classroomId === classroom.classroomId));
  }

  async function addModule(e) {
    e.preventDefault(); setLoading(true);
    const r = await api.post(`/admin/classrooms/${classroom.classroomId}/modules`, modForm, 'admin');
    setLoading(false);
    if (r.ok) { toast('Module added.'); setModForm({ dayNo: '', moduleTitle: '', moduleOrder: '', description: '' }); loadModules(); onSaved?.(); }
    else toast(r.message || 'Failed.', false);
  }

  async function syncDrive() {
    if (!folderId.trim()) return toast('Enter a folder ID or URL.', false);
    const m = folderId.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
    const cleanId = m ? m[1] : folderId.trim();
    setFolderId(cleanId);
    setDriveLoading(true);
    const r = await api.post(`/admin/classrooms/${classroom.classroomId}/sync-drive`, { folderId: cleanId }, 'admin');
    setDriveLoading(false);
    if (r.ok) { setDriveFiles(r.data.files || []); toast(`Synced ${r.data.synced} files.`); onSaved?.(); }
    else toast(r.message || 'Sync failed.', false);
  }

  async function addDriveFileToMod(file) {
    if (!selectedMod) return toast('Select a module first.', false);
    const r = await api.post(`/admin/modules/${selectedMod}/contents`, {
      contentTitle: file.displayTitle || file.name,
      contentType: file.contentType || 'video',
      driveFileId: file.id,
      driveUrl: `https://drive.google.com/file/d/${file.id}/preview`,
      playerMode: 'Auto',
      contentOrder: file.sortOrder,
      estimatedMins: file.contentType === 'video' ? 10 : 5,
      completionRulePct: 80,
    }, 'admin');
    if (r.ok) toast(`Added "${file.displayTitle || file.name}" to module.`);
    else toast(r.message || 'Failed.', false);
  }

  async function addAllDriveFiles() {
    if (!selectedMod) return toast('Select a module first.', false);
    setLoading(true);
    let added = 0;
    for (let i = 0; i < driveFiles.length; i++) {
      const f = driveFiles[i];
      const r = await api.post(`/admin/modules/${selectedMod}/contents`, {
        contentTitle: f.displayTitle || f.name,
        contentType: f.contentType || 'video',
        driveFileId: f.id,
        driveUrl: `https://drive.google.com/file/d/${f.id}/preview`,
        playerMode: 'Auto',
        contentOrder: i + 1,
        estimatedMins: f.contentType === 'video' ? 10 : 5,
        completionRulePct: 80,
      }, 'admin');
      if (r.ok) added++;
    }
    setLoading(false);
    toast(`Added ${added} of ${driveFiles.length} files in sequence order.`);
  }

  async function addSingleContent(e) {
    e.preventDefault();
    if (!selectedMod) return toast('Select a module.', false);
    setLoading(true);
    let r;
    if (contentFile) {
      const fd = new FormData();
      fd.append('file', contentFile);
      Object.entries(contentForm).forEach(([k, v]) => v && fd.append(k, String(v)));
      r = await uploadFile(`/admin/modules/${selectedMod}/contents`, fd, 'admin');
    } else {
      r = await api.post(`/admin/modules/${selectedMod}/contents`, contentForm, 'admin');
    }
    setLoading(false);
    if (r.ok) { toast('Content added.'); setContentForm({ contentTitle: '', contentType: 'video', driveFileId: '', driveUrl: '', directMediaUrl: '', playerMode: 'Auto', contentOrder: '', estimatedMins: '', completionRulePct: 80 }); setContentFile(null); }
    else toast(r.message || 'Failed.', false);
  }

  function guessMime(f) {
    const n = f.name.toLowerCase();
    if (n.match(/\.(mp4|webm|mov)$/)) return 'video';
    if (n.endsWith('.pdf')) return 'pdf';
    if (n.match(/\.pptx?$/)) return 'ppt';
    if (n.match(/\.docx?$/)) return 'doc';
    return 'doc';
  }

  async function uploadBulkContent() {
    if (!selectedMod || !bulkFiles.length) return toast('Select a module and files.', false);
    setLoading(true);
    let uploaded = 0;
    for (let i = 0; i < bulkFiles.length; i++) {
      const item = bulkFiles[i];
      const fd = new FormData();
      fd.append('file', item.file);
      fd.append('contentTitle', item.title);
      fd.append('contentType', item.type);
      fd.append('estimatedMins', String(item.estimatedMins || ''));
      fd.append('completionRulePct', '80');
      fd.append('contentOrder', String(i + 1));
      fd.append('playerMode', 'Auto');
      const r = await uploadFile(`/admin/modules/${selectedMod}/contents`, fd, 'admin');
      if (r.ok) uploaded++;
    }
    setLoading(false);
    setBulkFiles([]);
    toast(`Uploaded ${uploaded} of ${bulkFiles.length} files.`);
  }

  function handleCsvDrop(file) {
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = e => {
      const rows = parseCsvRows(e.target.result);
      if (rows.length < 2) return;
      const header = rows[0].map(h => h.trim().replace(/"/g, ''));
      const preview = rows.slice(1, 6).map(vals => { const r = {}; header.forEach((h, i) => { r[h] = vals[i] || ''; }); return r; });
      setCsvPreview({ header, rows: preview, total: rows.length - 1 });
    };
    reader.readAsText(file);
  }

  async function uploadMcqCsv() {
    if (!csvFile || !selectedAssessment) return toast('Select assessment and CSV file.', false);
    setMcqUploading(true);
    const text = await csvFile.text();
    const r = await api.post(`/admin/assessments/${selectedAssessment}/questions/upload-csv`, { csv: text }, 'admin');
    setMcqUploading(false);
    if (r.ok) { toast(`Uploaded ${r.count} questions.`); setCsvFile(null); setCsvPreview(null); }
    else toast(r.message || 'Upload failed.', false);
  }

  async function addFaq(e) {
    e.preventDefault();
    if (!selectedMod) return toast('Select a module.', false);
    const r = await api.post(`/admin/modules/${selectedMod}/faqs`, faqForm, 'admin');
    if (r.ok) { toast('FAQ added.'); setFaqForm({ question: '', answer: '', sortOrder: '' }); }
    else toast(r.message || 'Failed.', false);
  }

  async function uploadBulkFaqs() {
    if (!selectedMod || !faqBulkFiles.length) return toast('Select a module and files.', false);
    setLoading(true);
    const fd = new FormData();
    faqBulkFiles.forEach(f => fd.append('files', f));
    const r = await uploadFile(`/admin/modules/${selectedMod}/faqs/bulk-upload`, fd, 'admin');
    setLoading(false);
    if (r.ok) { setFaqBulkFiles([]); toast(r.message || `${r.data?.length || 0} FAQ(s) uploaded.`); }
    else toast(r.message || 'Upload failed.', false);
  }

  const TYPE_META_INNER = {
    video: { icon: '▶', color: '#60a5fa', bg: 'rgba(29,78,216,.2)' },
    pdf:   { icon: '📄', color: '#f87171', bg: 'rgba(220,38,38,.18)' },
    ppt:   { icon: '📊', color: '#fbbf24', bg: 'rgba(217,119,6,.18)' },
    doc:   { icon: '📝', color: '#4ade80', bg: 'rgba(22,163,74,.18)' },
  };

  const [detailsForm, setDetailsForm] = useState({ classroomName: '', process: '', lob: '', branch: '', description: '' });

  useEffect(() => {
    if (classroom) {
      setDetailsForm({
        classroomName: classroom.classroomName || '',
        process: classroom.process || '',
        lob: classroom.lob || '',
        branch: classroom.branch || '',
        description: classroom.description || '',
      });
    }
  }, [classroom]);

  async function saveDetails(e) {
    e.preventDefault();
    setLoading(true);
    const r = await api.put(`/admin/classrooms/${classroom.classroomId}`, detailsForm, 'admin');
    setLoading(false);
    if (r.ok) { toast('Classroom updated.'); onSaved?.(); }
    else toast(r.message || 'Failed to update.', false);
  }

  const TABS = [
    { id: 'details', label: 'ℹ Details' },
    { id: 'modules', label: '+ Add Module' },
    { id: 'drive', label: '☁ Drive Sync' },
    { id: 'content', label: '🎬 Add Content' },
    { id: 'scorm', label: '📦 SCORM Upload' },
    { id: 'mcq', label: '❓ MCQ Upload' },
    { id: 'faq', label: '📎 FAQ / SOP' },
  ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 820, width: '100%', maxHeight: '92vh' }}>
        <div className="modal-head">
          <div>
            <b>Edit Classroom — {classroom.classroomName}</b>
            <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--muted)' }}>{classroom.process}{classroom.lob ? ` / ${classroom.lob}` : ''}</span>
          </div>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: tab === t.id ? 'rgba(37,99,235,.18)' : 'transparent',
              color: tab === t.id ? '#60a5fa' : 'var(--muted)',
              borderBottom: tab === t.id ? '2px solid #2563eb' : '2px solid transparent',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>{t.label}</button>
          ))}
        </div>

        <div className="modal-body" style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: 'calc(92vh - 120px)' }}>
          {msg.text && (
            <div className={`toast ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 14 }}>
              {msg.text}
              <button style={{ marginLeft: 8, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg({ text: '', ok: true })}>✕</button>
            </div>
          )}

          {/* Details tab */}
          {tab === 'details' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Classroom Details</div>
              <form onSubmit={saveDetails}>
                <div className="field"><label>Classroom Name</label><input className="input" value={detailsForm.classroomName} onChange={e => setDetailsForm(p => ({ ...p, classroomName: e.target.value }))} required /></div>
                <div className="col-2">
                  <div className="field"><label>Process</label><ProcessSelect value={detailsForm.process} onChange={next => setDetailsForm(p => ({ ...p, process: next }))} /></div>
                  <div className="field"><label>LOB</label><LobSelect process={detailsForm.process} value={detailsForm.lob} onChange={next => setDetailsForm(p => ({ ...p, lob: next }))} /></div>
                </div>
                <div className="field"><label>Branch</label><BranchSelect value={detailsForm.branch} onChange={next => setDetailsForm(p => ({ ...p, branch: next }))} /></div>
                <div className="field"><label>Description</label><textarea className="input" rows={3} value={detailsForm.description} onChange={e => setDetailsForm(p => ({ ...p, description: e.target.value }))} /></div>
                <button className="btn" type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Changes'}</button>
              </form>
            </div>
          )}

          {/* Module add tab */}
          {tab === 'modules' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Add a New Day / Module</div>
              <form onSubmit={addModule}>
                <div className="col-2">
                  <div className="field">
                    <label>Day No *</label>
                    <input className="input" type="number" min="1" value={modForm.dayNo} onChange={e => setModForm(p => ({ ...p, dayNo: e.target.value }))} required />
                  </div>
                  <div className="field">
                    <label>Module Order</label>
                    <input className="input" type="number" min="0" value={modForm.moduleOrder} onChange={e => setModForm(p => ({ ...p, moduleOrder: e.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>Module Title *</label>
                  <input className="input" value={modForm.moduleTitle} onChange={e => setModForm(p => ({ ...p, moduleTitle: e.target.value }))} required />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input className="input" value={modForm.description} onChange={e => setModForm(p => ({ ...p, description: e.target.value }))} />
                </div>
                <button className="btn" type="submit" disabled={loading}>{loading ? '...' : 'Add Module'}</button>
              </form>

              {/* Existing modules list */}
              {modules.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>Existing Modules ({modules.length})</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {modules.map(m => (
                      <div key={m.moduleId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)' }}>
                        <span style={{ fontSize: 11, fontWeight: 900, padding: '3px 8px', borderRadius: 6, background: 'rgba(29,78,216,.2)', color: '#60a5fa' }}>D{m.dayNo}</span>
                        <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>{m.moduleTitle}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{m._count?.contents || 0} content · {m._count?.faqs || 0} FAQs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Drive sync tab */}
          {tab === 'drive' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Sync Content from Google Drive</div>
              <div className="field">
                <label>Drive Folder ID or URL</label>
                <input className="input" placeholder="Paste folder ID or full Drive URL" value={folderId} onChange={e => setFolderId(e.target.value)} />
              </div>

              {/* Module selector */}
              <div className="field">
                <label>Target Module (to add files to)</label>
                <select className="select" value={selectedMod || ''} onChange={e => setSelectedMod(e.target.value)}>
                  <option value="">Select module...</option>
                  {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} — {m.moduleTitle}</option>)}
                </select>
              </div>

              <div className="row" style={{ gap: 10, marginBottom: 14 }}>
                <button className="btn small" onClick={syncDrive} disabled={driveLoading || !folderId.trim()}>
                  {driveLoading ? 'Syncing...' : '⟳ Sync Drive Folder'}
                </button>
              </div>

              {driveFiles.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>Drive Files ({driveFiles.length})</div>
                    {selectedMod && (
                      <button className="btn small secondary" onClick={addAllDriveFiles} disabled={loading}>
                        {loading ? '...' : `+ Add All to Module`}
                      </button>
                    )}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Action</th></tr></thead>
                      <tbody>
                        {driveFiles.map(f => (
                          <tr key={f.id}>
                            <td style={{ fontSize: 11, color: 'var(--muted)', width: 32 }}>{f.sortOrder}</td>
                            <td>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{f.displayTitle || f.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{f.name}</div>
                            </td>
                            <td><span className="content-type-badge">{f.contentType || 'video'}</span></td>
                            <td>
                              <button className="btn xs" onClick={() => addDriveFileToMod(f)} disabled={!selectedMod}>+ Add</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content upload tab */}
          {tab === 'content' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Add Content to a Module</div>

              {/* Module selector */}
              <div className="field">
                <label>Target Module *</label>
                <select className="select" value={selectedMod || ''} onChange={e => setSelectedMod(e.target.value)}>
                  <option value="">Select module...</option>
                  {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} — {m.moduleTitle}</option>)}
                </select>
              </div>

              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--card)', borderRadius: 10, padding: 4 }}>
                {[['single', 'Single Upload'], ['bulk', 'Bulk Upload']].map(([k, label]) => (
                  <button key={k} onClick={() => setContentMode(k)} style={{
                    flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: contentMode === k ? 'var(--card-solid)' : 'transparent',
                    color: contentMode === k ? 'var(--ink)' : 'var(--muted)',
                    fontWeight: contentMode === k ? 700 : 500, fontSize: 12,
                    boxShadow: contentMode === k ? 'var(--shadow-sm)' : 'none', transition: 'all .12s',
                  }}>{label}</button>
                ))}
              </div>

              {contentMode === 'single' && (
                <form onSubmit={addSingleContent}>
                  <div className="col-2">
                    <div className="field">
                      <label>Type</label>
                      <select className="select" value={contentForm.contentType} onChange={e => setContentForm(p => ({ ...p, contentType: e.target.value }))}>
                        {['video','pdf','ppt','doc','link','html'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Player Mode</label>
                      <select className="select" value={contentForm.playerMode} onChange={e => setContentForm(p => ({ ...p, playerMode: e.target.value }))}>
                        {['Auto','HTML5','Drive Preview','Direct'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="field"><label>Order</label><input className="input" type="number" value={contentForm.contentOrder} onChange={e => setContentForm(p => ({ ...p, contentOrder: e.target.value }))} /></div>
                    <div className="field"><label>Est. Minutes</label><input className="input" type="number" value={contentForm.estimatedMins} onChange={e => setContentForm(p => ({ ...p, estimatedMins: e.target.value }))} /></div>
                    <div className="field"><label>Completion %</label><input className="input" type="number" max="100" value={contentForm.completionRulePct} onChange={e => setContentForm(p => ({ ...p, completionRulePct: e.target.value }))} /></div>
                  </div>
                  <div className="field"><label>Content Title</label><input className="input" value={contentForm.contentTitle} onChange={e => setContentForm(p => ({ ...p, contentTitle: e.target.value }))} /></div>
                  <div className="card" style={{ background: 'var(--card)', margin: '10px 0' }}>
                    <b style={{ fontSize: 12 }}>Source — pick one</b>
                    <div className="field" style={{ marginTop: 8 }}><label>Drive File ID</label><input className="input" value={contentForm.driveFileId} onChange={e => setContentForm(p => ({ ...p, driveFileId: e.target.value }))} /></div>
                    <div className="field"><label>Direct / YouTube URL</label><input className="input" value={contentForm.directMediaUrl} onChange={e => setContentForm(p => ({ ...p, directMediaUrl: e.target.value }))} /></div>
                    <div className="field"><label>Upload File</label><input type="file" accept="video/*,.pdf,.ppt,.pptx,.doc,.docx,.html" onChange={e => setContentFile(e.target.files[0])} /></div>
                  </div>
                  <button className="btn" type="submit" disabled={loading || !selectedMod}>{loading ? '...' : 'Add Content'}</button>
                </form>
              )}

              {contentMode === 'bulk' && (
                <div>
                  <div
                    onDragOver={e => { e.preventDefault(); }}
                    onDrop={e => { e.preventDefault(); const files = Array.from(e.dataTransfer.files); setBulkFiles(prev => [...prev, ...files.map(f => ({ file: f, title: f.name.replace(/\.[^/.]+$/, ''), type: guessMime(f) }))]); }}
                    onClick={() => document.getElementById('ecm-bulk-input').click()}
                    style={{ border: '2px dashed rgba(255,255,255,.2)', borderRadius: 14, padding: '32px 24px', textAlign: 'center', background: 'rgba(255,255,255,.04)', cursor: 'pointer', marginBottom: 14 }}
                  >
                    <input id="ecm-bulk-input" type="file" multiple accept="video/*,.pdf,.ppt,.pptx,.doc,.docx,.html" style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files); setBulkFiles(prev => [...prev, ...files.map(f => ({ file: f, title: f.name.replace(/\.[^/.]+$/, ''), type: guessMime(f) }))]); e.target.value = ''; }} />
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drop files here or click to browse</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Videos, PDFs, PPTs, DOCs</div>
                  </div>
                  {bulkFiles.length > 0 && (
                    <div>
                      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 6, marginBottom: 10 }}>
                        {bulkFiles.map((item, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px' }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{TYPE_META_INNER[item.type]?.icon || '📄'}</span>
                            <input value={item.title} onChange={e => setBulkFiles(prev => prev.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))} style={{ flex: 1, fontSize: 12, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', color: 'var(--ink)' }} />
                            <button onClick={() => setBulkFiles(prev => prev.filter((_, xi) => xi !== i))} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15 }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <button className="btn" style={{ width: '100%' }} onClick={uploadBulkContent} disabled={loading || !selectedMod}>
                        {loading ? 'Uploading...' : `⬆ Upload ${bulkFiles.length} Files`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SCORM tab */}
          {tab === 'scorm' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 6 }}>Upload SCORM Package</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
                Upload a <b>.zip</b> SCORM 1.2 or SCORM 2004 package. The package is unzipped automatically,
                the manifest is parsed, and a content item is created in the selected module.
                Learner progress (score, completion, suspend data) is tracked per-trainee.
              </p>

              {!selectedMod && (
                <div className="info-box" style={{ marginBottom: 12 }}>Select a module from the list on the left first.</div>
              )}

              {selectedMod && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Package Title <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional — auto-detected from manifest)</span></label>
                    <input className="input" placeholder="e.g. Compliance Awareness Module"
                      value={scormTitle} onChange={e => setScormTitle(e.target.value)} />
                  </div>

                  <div className="field" style={{ margin: 0 }}>
                    <label>SCORM ZIP File</label>
                    <div
                      style={{
                        border: `2px dashed ${scormFile ? 'var(--ok)' : 'var(--line)'}`,
                        borderRadius: 10, padding: '24px 16px', textAlign: 'center',
                        cursor: 'pointer', background: scormFile ? 'rgba(22,163,74,.05)' : 'var(--card)',
                      }}
                      onClick={() => document.getElementById('scorm-zip-input').click()}
                    >
                      {scormFile ? (
                        <div>
                          <div style={{ fontSize: 20, marginBottom: 6 }}>📦</div>
                          <div style={{ fontWeight: 700, color: 'var(--ok)', fontSize: 13 }}>{scormFile.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            {(scormFile.size / 1024 / 1024).toFixed(1)} MB · Click to change
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 24, marginBottom: 8 }}>📦</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Click to select SCORM ZIP file</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Max 500 MB · SCORM 1.2 and 2004 supported</div>
                        </div>
                      )}
                    </div>
                    <input id="scorm-zip-input" type="file" accept=".zip" style={{ display: 'none' }}
                      onChange={e => { setScormFile(e.target.files[0] || null); setScormResult(null); }} />
                  </div>

                  {scormResult && (
                    <div className={`toast ${scormResult.ok ? 'ok' : 'bad'}`}>
                      {scormResult.ok
                        ? `✓ "${scormResult.data.title}" uploaded (SCORM ${scormResult.data.scormVersion}). Content item created.`
                        : scormResult.message}
                    </div>
                  )}

                  <button
                    className="btn"
                    disabled={!scormFile || scormUploading}
                    onClick={async () => {
                      setScormUploading(true); setScormResult(null);
                      const fd = new FormData();
                      fd.append('file', scormFile);
                      fd.append('moduleId', selectedMod.moduleId);
                      if (scormTitle.trim()) fd.append('contentTitle', scormTitle.trim());
                      const token = localStorage.getItem('lms_token_admin') || '';
                      const res = await fetch('/api/scorm/upload', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                        body: fd,
                      }).then(r => r.json()).catch(() => ({ ok: false, message: 'Upload failed' }));
                      setScormUploading(false);
                      setScormResult(res);
                      if (res.ok) { setScormFile(null); setScormTitle(''); }
                    }}
                  >
                    {scormUploading ? '⏳ Uploading & extracting…' : '📦 Upload SCORM Package'}
                  </button>

                  <div style={{ background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)', padding: '12px 14px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                    <b style={{ color: 'var(--ink)' }}>What happens after upload:</b><br />
                    1. ZIP is extracted to <code>uploads/scorm/SCORM-XXXXXXXX/</code><br />
                    2. <code>imsmanifest.xml</code> is parsed for title, entry point and version<br />
                    3. A content item of type <b>scorm</b> is added to this module<br />
                    4. Learners see a "Launch" button — the SCORM API (1.2 &amp; 2004) runs in-browser<br />
                    5. Score, completion status and suspend data are saved per-trainee
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MCQ tab */}
          {tab === 'mcq' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Upload MCQ Questions (CSV)</div>
              <div className="field">
                <label>Assessment</label>
                <select className="select" value={selectedAssessment} onChange={e => setSelectedAssessment(e.target.value)}>
                  <option value="">Select assessment...</option>
                  {assessments.map(a => <option key={a.assessmentId} value={a.assessmentId}>{a.assessmentName}</option>)}
                </select>
                {assessments.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    No assessments found for this classroom. Create one in the Questions & MCQ tab first.
                  </div>
                )}
              </div>

              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleCsvDrop(e.dataTransfer.files[0]); }}
                onClick={() => document.getElementById('ecm-csv-input').click()}
                style={{ border: '2px dashed rgba(255,255,255,.2)', borderRadius: 14, padding: '32px 24px', textAlign: 'center', background: 'rgba(255,255,255,.04)', cursor: 'pointer', marginBottom: 14 }}
              >
                <input id="ecm-csv-input" type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleCsvDrop(e.target.files[0])} />
                <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drop CSV file here or click to browse</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Format: question, option_a, option_b, option_c, option_d, correct, marks, difficulty, explanation</div>
              </div>

              {csvPreview && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Preview: {csvPreview.total} questions</div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Question</th><th>A</th><th>B</th><th>Correct</th><th>Marks</th></tr></thead>
                      <tbody>
                        {csvPreview.rows.map((r, i) => (
                          <tr key={i}>
                            <td style={{ fontSize: 11, maxWidth: 200 }}>{r.question}</td>
                            <td style={{ fontSize: 11 }}>{r.option_a}</td>
                            <td style={{ fontSize: 11 }}>{r.option_b}</td>
                            <td style={{ fontSize: 11, fontWeight: 700 }}>{r.correct}</td>
                            <td style={{ fontSize: 11 }}>{r.marks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button className="btn" onClick={uploadMcqCsv} disabled={mcqUploading || !selectedAssessment}>
                      {mcqUploading ? '...' : `Upload ${csvPreview.total} Questions`}
                    </button>
                    <button className="btn small secondary" onClick={() => { setCsvFile(null); setCsvPreview(null); }}>Clear</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FAQ tab */}
          {tab === 'faq' && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Add FAQs / SOPs to a Module</div>

              {/* Module selector */}
              <div className="field">
                <label>Target Module *</label>
                <select className="select" value={selectedMod || ''} onChange={e => setSelectedMod(e.target.value)}>
                  <option value="">Select module...</option>
                  {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} — {m.moduleTitle}</option>)}
                </select>
              </div>

              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--card)', borderRadius: 10, padding: 4 }}>
                {[['single', 'Manual Entry'], ['bulk', 'Bulk File Upload (PDF/DOC/PPT)']].map(([k, label]) => (
                  <button key={k} onClick={() => setFaqMode(k)} style={{
                    flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: faqMode === k ? 'var(--card-solid)' : 'transparent',
                    color: faqMode === k ? 'var(--ink)' : 'var(--muted)',
                    fontWeight: faqMode === k ? 700 : 500, fontSize: 12,
                    boxShadow: faqMode === k ? 'var(--shadow-sm)' : 'none', transition: 'all .12s',
                  }}>{label}</button>
                ))}
              </div>

              {faqMode === 'single' && (
                <form onSubmit={addFaq}>
                  <div className="field"><label>Question *</label><input className="input" value={faqForm.question} onChange={e => setFaqForm(p => ({ ...p, question: e.target.value }))} required /></div>
                  <div className="field"><label>Answer *</label><textarea className="input" rows={3} value={faqForm.answer} onChange={e => setFaqForm(p => ({ ...p, answer: e.target.value }))} required /></div>
                  <div className="field"><label>Sort Order</label><input className="input" type="number" value={faqForm.sortOrder} onChange={e => setFaqForm(p => ({ ...p, sortOrder: e.target.value }))} /></div>
                  <button className="btn" type="submit" disabled={!selectedMod}>Add FAQ</button>
                </form>
              )}

              {faqMode === 'bulk' && (
                <div>
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); setFaqBulkFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
                    onClick={() => document.getElementById('ecm-faq-input').click()}
                    style={{ border: '2px dashed rgba(255,255,255,.2)', borderRadius: 14, padding: '32px 24px', textAlign: 'center', background: 'rgba(255,255,255,.04)', cursor: 'pointer', marginBottom: 14 }}
                  >
                    <input id="ecm-faq-input" type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx" style={{ display: 'none' }} onChange={e => { setFaqBulkFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = ''; }} />
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drop PDF, DOC, PPT files here</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Each file becomes a downloadable FAQ entry</div>
                  </div>
                  {faqBulkFiles.length > 0 && (
                    <div>
                      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 6, marginBottom: 10 }}>
                        {faqBulkFiles.map((f, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
                            <span style={{ fontSize: 18 }}>📄</span>
                            <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>{f.name}</span>
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{(f.size / 1024).toFixed(0)} KB</span>
                            <button onClick={() => setFaqBulkFiles(prev => prev.filter((_, xi) => xi !== i))} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15 }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <button className="btn" style={{ width: '100%' }} onClick={uploadBulkFaqs} disabled={loading || !selectedMod}>
                        {loading ? 'Uploading...' : `⬆ Upload ${faqBulkFiles.length} File(s) as FAQs`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
