import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

const emptyForm = {
  title: '',
  contentType: 'document',
  category: '',
  subCategory: '',
  process: '',
  lob: '',
  tags: '',
  sourceType: 'local',
  directMediaUrl: '',
  localFilePath: '',
  driveFileId: '',
  driveUrl: '',
  playerMode: 'Auto',
  estimatedMins: 0,
  completionRulePct: 80,
  description: '',
};

export default function ContentRepositoryTab() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setMsg('');
    const res = await api.get(`/admin/content-repository?q=${encodeURIComponent(query)}`, 'admin');
    setLoading(false);
    if (res.ok) setItems(res.data || []);
    else setMsg(res.message || 'Unable to load content repository.');
  }

  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const res = await api.post('/admin/content-repository', form, 'admin');
    setSaving(false);
    if (!res.ok) {
      setMsg(res.message || 'Unable to save repository content.');
      return;
    }
    setMsg(`✓ ${res.message || 'Repository content saved.'}`);
    setForm(emptyForm);
    load();
  }

  async function archive(repositoryContentId) {
    if (!window.confirm('Archive this repository item? Classroom content will not be disturbed.')) return;
    const res = await api.delete(`/admin/content-repository/${repositoryContentId}`, 'admin');
    setMsg(res.ok ? '✓ Repository item archived.' : (res.message || 'Unable to archive.'));
    load();
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0 }}>Content Repository</h2>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Standalone master library for SOPs, videos, PDFs, PPTs, FAQs, and reusable learning assets. This does not change classroom creation flow.
        </p>
      </div>

      {msg && <div className={msg.startsWith('✓') ? 'toast ok' : 'toast bad'}>{msg}</div>}

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Add Repository Content</h3>
        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <div className="field"><label>Title *</label><input className="input" value={form.title} onChange={e => setField('title', e.target.value)} required placeholder="Example: Finnable Salary Eligibility SOP" /></div>
            <div className="field"><label>Type</label><select className="input" value={form.contentType} onChange={e => setField('contentType', e.target.value)}><option>document</option><option>video</option><option>pdf</option><option>ppt</option><option>image</option><option>scorm</option><option>link</option></select></div>
            <div className="field"><label>Source</label><select className="input" value={form.sourceType} onChange={e => setField('sourceType', e.target.value)}><option>local</option><option>url</option><option>drive</option></select></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <div className="field"><label>Category</label><input className="input" value={form.category} onChange={e => setField('category', e.target.value)} placeholder="SOP / Product / Compliance" /></div>
            <div className="field"><label>Sub Category</label><input className="input" value={form.subCategory} onChange={e => setField('subCategory', e.target.value)} placeholder="Eligibility / Objection" /></div>
            <div className="field"><label>Process</label><input className="input" value={form.process} onChange={e => setField('process', e.target.value)} placeholder="Finnable / BBB" /></div>
            <div className="field"><label>LOB</label><input className="input" value={form.lob} onChange={e => setField('lob', e.target.value)} placeholder="Bajaj Thin" /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Direct URL / Local Public URL</label><input className="input" value={form.directMediaUrl} onChange={e => setField('directMediaUrl', e.target.value)} placeholder="http://local-server:4000/uploads/content/file.pdf" /></div>
            <div className="field"><label>Local File Path</label><input className="input" value={form.localFilePath} onChange={e => setField('localFilePath', e.target.value)} placeholder="D:\\MCN_LMS_Uploads\\content\\file.pdf" /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Drive File ID optional</label><input className="input" value={form.driveFileId} onChange={e => setField('driveFileId', e.target.value)} /></div>
            <div className="field"><label>Drive URL optional</label><input className="input" value={form.driveUrl} onChange={e => setField('driveUrl', e.target.value)} /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
            <div className="field"><label>Estimated Mins</label><input className="input" type="number" value={form.estimatedMins} onChange={e => setField('estimatedMins', e.target.value)} /></div>
            <div className="field"><label>Completion %</label><input className="input" type="number" value={form.completionRulePct} onChange={e => setField('completionRulePct', e.target.value)} /></div>
            <div className="field"><label>Tags</label><input className="input" value={form.tags} onChange={e => setField('tags', e.target.value)} placeholder="salary, eligibility, PF" /></div>
          </div>

          <div className="field"><label>Description</label><textarea className="input" rows="3" value={form.description} onChange={e => setField('description', e.target.value)} /></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn accent" disabled={saving}>{saving ? 'Saving…' : 'Save to Repository'}</button></div>
        </form>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row between" style={{ marginBottom: 12, gap: 10 }}>
          <h3 style={{ margin: 0 }}>Repository Items</h3>
          <form onSubmit={e => { e.preventDefault(); load(); }} className="row" style={{ gap: 8 }}>
            <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title/category/process/tags" style={{ width: 280 }} />
            <button className="btn secondary" disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
          </form>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Repository ID</th><th>Title</th><th>Type</th><th>Category</th><th>Process / LOB</th><th>Source</th><th>Updated</th><th>Action</th></tr></thead>
            <tbody>
              {items.map(item => (
                <tr key={item.repository_content_id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.repository_content_id}</td>
                  <td><b>{item.title}</b><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{item.description || item.tags || '—'}</span></td>
                  <td><span className="pill info">{item.content_type}</span></td>
                  <td>{item.category || '—'}{item.sub_category ? ` / ${item.sub_category}` : ''}</td>
                  <td>{item.process || '—'} / {item.lob || '—'}</td>
                  <td>{item.source_type || 'local'}</td>
                  <td>{item.updated_at ? new Date(item.updated_at).toLocaleString() : '—'}</td>
                  <td><button className="btn small danger" onClick={() => archive(item.repository_content_id)}>Archive</button></td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No repository content found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
