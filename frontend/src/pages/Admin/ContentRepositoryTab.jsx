import { useEffect, useState } from 'react';
import { api, uploadFile } from '../../utils/api.js';

const emptyForm = {
  title: '', contentType: 'document', category: '', subCategory: '', process: '', lob: '', tags: '', sourceType: 'local',
  directMediaUrl: '', localFilePath: '', driveFileId: '', driveUrl: '', playerMode: 'Auto', estimatedMins: 0, completionRulePct: 80, description: '',
};
const emptyUpload = { title: '', contentType: '', category: '', subCategory: '', process: '', lob: '', tags: '', description: '', estimatedMins: 0, completionRulePct: 80, file: null };

export default function ContentRepositoryTab() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [upload, setUpload] = useState(emptyUpload);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editItem, setEditItem] = useState(null);

  async function load() {
    setLoading(true); setMsg('');
    const res = await api.get(`/admin/content-repository?q=${encodeURIComponent(query)}`, 'admin');
    setLoading(false);
    if (res.ok) setItems(res.data || []);
    else setMsg(res.message || 'Unable to load content repository.');
  }

  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.post('/admin/content-repository', form, 'admin');
    setSaving(false);
    if (!res.ok) return setMsg(res.message || 'Unable to save repository content.');
    setMsg(`\u2713 ${res.message || 'Repository content saved.'}`); setForm(emptyForm); load();
  }

  async function uploadLocalFile(e) {
    e.preventDefault();
    if (!upload.file) return setMsg('Please choose a local file.');
    setSaving(true); setMsg('');
    const fd = new FormData();
    Object.entries(upload).forEach(([k, v]) => { if (k !== 'file' && v !== undefined && v !== null) fd.append(k, v); });
    fd.append('file', upload.file);
    const res = await uploadFile('/admin/content-repository/upload', fd, 'admin');
    setSaving(false);
    if (!res.ok) return setMsg(res.message || 'Unable to upload file.');
    setMsg(`\u2713 ${res.message || 'Repository file uploaded.'}`); setUpload(emptyUpload); load();
  }

  async function archive(repositoryContentId) {
    if (!window.confirm('Archive this repository item? Classroom content will not be disturbed.')) return;
    const res = await api.delete(`/admin/content-repository/${repositoryContentId}`, 'admin');
    setMsg(res.ok ? '\u2713 Repository item archived.' : (res.message || 'Unable to archive.')); load();
  }

  function openEdit(item) {
    setEditItem({
      repositoryContentId: item.repository_content_id,
      title: item.title || '',
      contentType: item.content_type || 'document',
      category: item.category || '',
      subCategory: item.sub_category || '',
      process: item.process || '',
      lob: item.lob || '',
      tags: item.tags || '',
      sourceType: item.source_type || 'local',
      directMediaUrl: item.direct_media_url || '',
      localFilePath: item.local_file_path || '',
      driveFileId: item.drive_file_id || '',
      driveUrl: item.drive_url || '',
      playerMode: item.player_mode || 'Auto',
      estimatedMins: item.estimated_mins ?? 0,
      completionRulePct: item.completion_rule_pct ?? 80,
      description: item.description || '',
    });
  }

  async function saveEdit(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.put(`/admin/content-repository/${editItem.repositoryContentId}`, editItem, 'admin');
    setSaving(false);
    if (!res.ok) return setMsg(res.message || 'Unable to update repository content.');
    setMsg('\u2713 Repository content updated.'); setEditItem(null); load();
  }

  function setField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  function setUploadField(key, value) { setUpload(prev => ({ ...prev, [key]: value })); }
  function setEditField(key, value) { setEditItem(prev => ({ ...prev, [key]: value })); }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: 0 }}>Content Repository</h2><p style={{ color: 'var(--muted)', marginTop: 4 }}>Standalone master library for reusable content. Classroom creation and Google Drive Sync are not changed.</p></div>
      {msg && <div className={msg.startsWith('\u2713') ? 'toast ok' : 'toast bad'}>{msg}</div>}

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Upload Local File</h3>
        <form onSubmit={uploadLocalFile} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr', gap: 10 }}>
            <input className="input" placeholder="Title optional" value={upload.title} onChange={e => setUploadField('title', e.target.value)} />
            <select className="input" value={upload.contentType} onChange={e => setUploadField('contentType', e.target.value)}><option value="">Auto Type</option><option>document</option><option>video</option><option>pdf</option><option>ppt</option><option>image</option></select>
            <input className="input" placeholder="Category" value={upload.category} onChange={e => setUploadField('category', e.target.value)} />
            <input className="input" type="file" onChange={e => setUploadField('file', e.target.files?.[0] || null)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <input className="input" placeholder="Sub Category" value={upload.subCategory} onChange={e => setUploadField('subCategory', e.target.value)} />
            <input className="input" placeholder="Process" value={upload.process} onChange={e => setUploadField('process', e.target.value)} />
            <input className="input" placeholder="LOB" value={upload.lob} onChange={e => setUploadField('lob', e.target.value)} />
            <input className="input" placeholder="Tags" value={upload.tags} onChange={e => setUploadField('tags', e.target.value)} />
          </div>
          <textarea className="input" rows="2" placeholder="Description" value={upload.description} onChange={e => setUploadField('description', e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn accent" disabled={saving}>{saving ? 'Uploading\u2026' : 'Upload to Repository'}</button></div>
        </form>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Add Repository Link / Path</h3>
        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <div className="field"><label>Title *</label><input className="input" value={form.title} onChange={e => setField('title', e.target.value)} required placeholder="Example: Finnable Salary Eligibility SOP" /></div>
            <div className="field"><label>Type</label><select className="input" value={form.contentType} onChange={e => setField('contentType', e.target.value)}><option>document</option><option>video</option><option>pdf</option><option>ppt</option><option>image</option><option>scorm</option><option>link</option></select></div>
            <div className="field"><label>Source</label><select className="input" value={form.sourceType} onChange={e => setField('sourceType', e.target.value)}><option>local</option><option>url</option><option>drive</option></select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <input className="input" placeholder="Category" value={form.category} onChange={e => setField('category', e.target.value)} />
            <input className="input" placeholder="Sub Category" value={form.subCategory} onChange={e => setField('subCategory', e.target.value)} />
            <input className="input" placeholder="Process" value={form.process} onChange={e => setField('process', e.target.value)} />
            <input className="input" placeholder="LOB" value={form.lob} onChange={e => setField('lob', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input className="input" placeholder="Direct URL / Local Public URL" value={form.directMediaUrl} onChange={e => setField('directMediaUrl', e.target.value)} />
            <input className="input" placeholder="Local File Path" value={form.localFilePath} onChange={e => setField('localFilePath', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
            <input className="input" placeholder="Estimated Mins" type="number" value={form.estimatedMins} onChange={e => setField('estimatedMins', e.target.value)} />
            <input className="input" placeholder="Completion %" type="number" value={form.completionRulePct} onChange={e => setField('completionRulePct', e.target.value)} />
            <input className="input" placeholder="Tags" value={form.tags} onChange={e => setField('tags', e.target.value)} />
          </div>
          <textarea className="input" rows="2" placeholder="Description" value={form.description} onChange={e => setField('description', e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn accent" disabled={saving}>{saving ? 'Saving\u2026' : 'Save to Repository'}</button></div>
        </form>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row between" style={{ marginBottom: 12, gap: 10 }}><h3 style={{ margin: 0 }}>Repository Items</h3><form onSubmit={e => { e.preventDefault(); load(); }} className="row" style={{ gap: 8 }}><input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title/category/process/tags" style={{ width: 280 }} /><button className="btn secondary" disabled={loading}>{loading ? 'Loading\u2026' : 'Search'}</button></form></div>
        <div className="table-wrap"><table><thead><tr><th>Repository ID</th><th>Title</th><th>Type</th><th>Category</th><th>Process / LOB</th><th>Source</th><th>Updated</th><th>Action</th></tr></thead><tbody>{items.map(item => <tr key={item.repository_content_id}><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.repository_content_id}</td><td><b>{item.title}</b><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{item.description || item.tags || '\u2014'}</span></td><td><span className="pill info">{item.content_type}</span></td><td>{item.category || '\u2014'}{item.sub_category ? ` / ${item.sub_category}` : ''}</td><td>{item.process || '\u2014'} / {item.lob || '\u2014'}</td><td>{item.source_type || 'local'}</td><td>{item.updated_at ? new Date(item.updated_at).toLocaleString() : '\u2014'}</td><td style={{ display: 'flex', gap: 4 }}><button className="btn small" onClick={() => openEdit(item)}>Edit</button><button className="btn small danger" onClick={() => archive(item.repository_content_id)}>Archive</button></td></tr>)}{!items.length && <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No repository content found.</td></tr>}</tbody></table></div>
      </div>

      {editItem && (
        <div className="modal-overlay" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-head"><b>Edit Repository Content</b><button className="btn small secondary" onClick={() => setEditItem(null)}>\u2715</button></div>
            <form onSubmit={saveEdit} style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <div className="field"><label>Title *</label><input className="input" value={editItem.title} onChange={e => setEditField('title', e.target.value)} required /></div>
                <div className="field"><label>Type</label><select className="input" value={editItem.contentType} onChange={e => setEditField('contentType', e.target.value)}><option>document</option><option>video</option><option>pdf</option><option>ppt</option><option>image</option><option>scorm</option><option>link</option></select></div>
                <div className="field"><label>Source</label><select className="input" value={editItem.sourceType} onChange={e => setEditField('sourceType', e.target.value)}><option>local</option><option>url</option><option>drive</option></select></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                <input className="input" placeholder="Category" value={editItem.category} onChange={e => setEditField('category', e.target.value)} />
                <input className="input" placeholder="Sub Category" value={editItem.subCategory} onChange={e => setEditField('subCategory', e.target.value)} />
                <input className="input" placeholder="Process" value={editItem.process} onChange={e => setEditField('process', e.target.value)} />
                <input className="input" placeholder="LOB" value={editItem.lob} onChange={e => setEditField('lob', e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input className="input" placeholder="Direct URL / Local Public URL" value={editItem.directMediaUrl} onChange={e => setEditField('directMediaUrl', e.target.value)} />
                <input className="input" placeholder="Drive File ID" value={editItem.driveFileId} onChange={e => setEditField('driveFileId', e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <input className="input" placeholder="Drive URL" value={editItem.driveUrl} onChange={e => setEditField('driveUrl', e.target.value)} />
                <input className="input" placeholder="Est. Mins" type="number" value={editItem.estimatedMins} onChange={e => setEditField('estimatedMins', e.target.value)} />
                <input className="input" placeholder="Completion %" type="number" value={editItem.completionRulePct} onChange={e => setEditField('completionRulePct', e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <input className="input" placeholder="Tags" value={editItem.tags} onChange={e => setEditField('tags', e.target.value)} />
                <select className="input" value={editItem.playerMode} onChange={e => setEditField('playerMode', e.target.value)}><option>Auto</option><option>Manual</option></select>
              </div>
              <textarea className="input" rows="2" placeholder="Description" value={editItem.description} onChange={e => setEditField('description', e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn secondary" onClick={() => setEditItem(null)}>Cancel</button>
                <button className="btn accent" disabled={saving}>{saving ? 'Saving\u2026' : 'Update'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}