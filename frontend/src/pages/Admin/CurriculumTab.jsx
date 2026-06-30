import { useState, useEffect } from 'react';
import { api, uploadFile } from '../../utils/api.js';
import ClassroomWizard from './ClassroomWizard.jsx';
import EditClassroomModal from './curriculum/EditClassroomModal.jsx';
import ContentCard from './curriculum/ContentCard.jsx';
import DeleteClassroomModal from './curriculum/DeleteClassroomModal.jsx';
import TYPE_META from './curriculum/constants.js';

function ClassroomCard({ cl, selected, onClick }) {
  const colors = ['#1d4ed8', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
  const hue = colors[cl.classroomName.charCodeAt(0) % colors.length];
  const initials = cl.classroomName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        borderRadius: 14,
        border: `2px solid ${selected ? hue : 'var(--line)'}`,
        background: selected ? `${hue}22` : 'var(--card-solid)',
        padding: '14px 16px',
        transition: 'all .15s',
        boxShadow: selected ? `0 0 0 3px ${hue}22` : 'var(--shadow-sm)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {selected && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: 3,
          background: `linear-gradient(90deg, ${hue}, ${hue}99)`,
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, background: selected ? hue : 'rgba(255,255,255,.12)',
          color: selected ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center',
          fontWeight: 900, fontSize: 15, flexShrink: 0, transition: 'all .15s',
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: selected ? hue : 'var(--ink)', lineHeight: 1.3 }}>{cl.classroomName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{cl.process}{cl.lob ? ` / ${cl.lob}` : ''}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: selected ? `${hue}20` : 'rgba(255,255,255,.1)', color: selected ? hue : 'var(--muted)' }}>
              {cl._count?.modules || 0} modules
            </span>
            {cl.driveFolderId && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(29,78,216,.2)', color: '#60a5fa' }}>
                ☁ Drive
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleCard({ mod, selected, onSelect, onDelete }) {
  const dayColors = { 1: '#1d4ed8', 2: '#16a34a', 3: '#d97706', 4: '#dc2626', 5: '#7c3aed' };
  const c = dayColors[(mod.dayNo % 5) || 5] || '#1d4ed8';

  return (
    <div
      onClick={onSelect}
      style={{
        cursor: 'pointer',
        borderRadius: 12,
        border: `1.5px solid ${selected ? c : 'var(--line)'}`,
        background: selected ? `${c}22` : 'var(--card-solid)',
        padding: '12px 14px',
        transition: 'all .12s',
        boxShadow: selected ? `0 0 0 2px ${c}44` : 'none',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: selected ? c : 'rgba(255,255,255,.1)',
        color: selected ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center',
        fontWeight: 900, fontSize: 12, flexShrink: 0, transition: 'all .12s',
      }}>
        D{mod.dayNo}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: selected ? c : 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {mod.moduleTitle}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {mod._count?.contents || 0} items · {mod._count?.faqs || 0} FAQs
        </div>
      </div>
      <button
        className="btn xs danger"
        style={{ flexShrink: 0, padding: '3px 8px', fontSize: 11 }}
        onClick={e => { e.stopPropagation(); onDelete(mod.moduleId); }}
      >
        ✕
      </button>
    </div>
  );
}

export default function CurriculumTab() {
  const [classrooms, setClassrooms] = useState([]);
  const [selectedCl, setSelectedCl] = useState(null);
  const [modules, setModules] = useState([]);
  const [selectedMod, setSelectedMod] = useState(null);
  const [contents, setContents] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState(null);
  const [showAddMod, setShowAddMod] = useState(false);
  const [showAddContent, setShowAddContent] = useState(false);
  const [showAddFaq, setShowAddFaq] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('content');
  const [deleteClModal, setDeleteClModal] = useState(null); // classroom to delete
  const [clSearch, setClSearch] = useState({ name: '', process: '', branch: '' });

  const [modForm, setModForm] = useState({ dayNo: '', moduleTitle: '', moduleOrder: '', description: '' });
  const [contentForm, setContentForm] = useState({ contentType: 'video', contentTitle: '', driveFileId: '', driveUrl: '', directMediaUrl: '', playerMode: 'Auto', contentOrder: '', estimatedMins: '', completionRulePct: 80, description: '' });
  const [contentFile, setContentFile] = useState(null);
  const [faqForm, setFaqForm] = useState({ question: '', answer: '', sortOrder: '' });
  const [faqAddMode, setFaqAddMode] = useState('single'); // 'single' | 'bulk'
  const [faqBulkFiles, setFaqBulkFiles] = useState([]);
  const [faqBulkDragging, setFaqBulkDragging] = useState(false);
  const [faqBulkUploading, setFaqBulkUploading] = useState(false);
  const [contentAddMode, setContentAddMode] = useState('single'); // 'single' | 'bulk'
  const [bulkFiles, setBulkFiles] = useState([]);
  const [bulkDragging, setBulkDragging] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);

  useEffect(() => { loadClassrooms(); }, []);
  useEffect(() => { if (selectedCl) loadModules(selectedCl.classroomId); }, [selectedCl]);
  useEffect(() => {
    if (selectedMod) { loadContents(selectedMod.moduleId); loadFaqs(selectedMod.moduleId); }
  }, [selectedMod]);

  async function loadClassrooms() {
    const res = await api.get('/admin/classrooms', 'admin');
    if (res.ok) setClassrooms(res.data);
  }
  async function loadModules(cid) {
    const res = await api.get(`/admin/classrooms/${cid}/modules`, 'admin');
    if (res.ok) setModules(res.data);
  }
  async function loadContents(mid) {
    const res = await api.get(`/admin/modules/${mid}/contents`, 'admin');
    if (res.ok) setContents(res.data);
  }
  async function loadFaqs(mid) {
    const res = await api.get(`/admin/modules/${mid}/faqs`, 'admin');
    if (res.ok) setFaqs(res.data);
  }

  async function createModule(e) {
    e.preventDefault(); setLoading(true);
    const res = await api.post(`/admin/classrooms/${selectedCl.classroomId}/modules`, modForm, 'admin');
    setLoading(false);
    if (res.ok) { setShowAddMod(false); setModForm({ dayNo: '', moduleTitle: '', moduleOrder: '', description: '' }); loadModules(selectedCl.classroomId); }
    else setMsg(res.message || 'Failed.');
  }

  async function createContent(e) {
    e.preventDefault(); setLoading(true);
    if (contentFile) {
      const fd = new FormData();
      fd.append('file', contentFile);
      Object.entries(contentForm).forEach(([k, v]) => v && fd.append(k, v));
      const res = await uploadFile(`/admin/modules/${selectedMod.moduleId}/contents`, fd, 'admin');
      setLoading(false);
      if (res.ok) { setShowAddContent(false); setContentFile(null); resetContentForm(); loadContents(selectedMod.moduleId); }
      else setMsg(res.message || 'Upload failed.');
    } else {
      const res = await api.post(`/admin/modules/${selectedMod.moduleId}/contents`, contentForm, 'admin');
      setLoading(false);
      if (res.ok) { setShowAddContent(false); resetContentForm(); loadContents(selectedMod.moduleId); }
      else setMsg(res.message || 'Failed.');
    }
  }

  async function createFaq(e) {
    e.preventDefault(); setLoading(true);
    const res = await api.post(`/admin/modules/${selectedMod.moduleId}/faqs`, faqForm, 'admin');
    setLoading(false);
    if (res.ok) { setShowAddFaq(false); setFaqForm({ question: '', answer: '', sortOrder: '' }); loadFaqs(selectedMod.moduleId); }
    else setMsg(res.message || 'Failed.');
  }

  async function deleteModule(moduleId) {
    if (!window.confirm('Deactivate this module?')) return;
    await api.delete(`/admin/modules/${moduleId}`, 'admin');
    setSelectedMod(null);
    loadModules(selectedCl.classroomId);
  }

  async function deleteContent(contentId) {
    if (!window.confirm('Remove this content?')) return;
    await api.delete(`/admin/contents/${contentId}`, 'admin');
    loadContents(selectedMod.moduleId);
  }

  async function deleteClassroomConfirmed(classroomId, confirmName) {
    // Pass confirmName in body — use a custom fetch since api.delete doesn't support body
    const token = localStorage.getItem('lms_token_admin') || '';
    const BASE = (import.meta.env.VITE_API_URL || '') + '/api';
    const r = await fetch(`${BASE}/admin/classrooms/${classroomId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ confirmName }),
    }).then(x => x.json()).catch(() => ({ ok: false, message: 'Network error' }));
    if (r.ok) {
      setDeleteClModal(null);
      setSelectedCl(null);
      setSelectedMod(null);
      setModules([]);
      setContents([]);
      setFaqs([]);
      setMsg('');
      loadClassrooms();
    } else {
      setDeleteClModal(prev => ({ ...prev, error: r.message }));
    }
  }

  function resetContentForm() {
    setContentForm({ contentType: 'video', contentTitle: '', driveFileId: '', driveUrl: '', directMediaUrl: '', playerMode: 'Auto', contentOrder: '', estimatedMins: '', completionRulePct: 80, description: '' });
  }

  function guessMimeType(file) {
    const n = file.name.toLowerCase();
    if (n.endsWith('.mp4') || n.endsWith('.webm') || n.endsWith('.mov')) return 'video';
    if (n.endsWith('.pdf')) return 'pdf';
    if (n.endsWith('.ppt') || n.endsWith('.pptx')) return 'ppt';
    if (n.endsWith('.doc') || n.endsWith('.docx')) return 'doc';
    if (n.endsWith('.html') || n.endsWith('.htm')) return 'html';
    return 'doc';
  }

  function handleBulkDrop(e) {
    e.preventDefault();
    setBulkDragging(false);
    const files = Array.from(e.dataTransfer.files);
    setBulkFiles(prev => [...prev, ...files.map(f => ({ file: f, title: f.name.replace(/\.[^/.]+$/, ''), type: guessMimeType(f), estimatedMins: '', completionRulePct: 80 }))]);
  }

  function handleBulkFileInput(e) {
    const files = Array.from(e.target.files);
    setBulkFiles(prev => [...prev, ...files.map(f => ({ file: f, title: f.name.replace(/\.[^/.]+$/, ''), type: guessMimeType(f), estimatedMins: '', completionRulePct: 80 }))]);
    e.target.value = '';
  }

  async function uploadBulkFiles() {
    if (!bulkFiles.length || !selectedMod) return;
    setBulkUploading(true);
    let uploaded = 0;
    for (let i = 0; i < bulkFiles.length; i++) {
      const item = bulkFiles[i];
      const fd = new FormData();
      fd.append('file', item.file);
      fd.append('contentTitle', item.title);
      fd.append('contentType', item.type);
      fd.append('estimatedMins', String(item.estimatedMins || ''));
      fd.append('completionRulePct', String(item.completionRulePct || 80));
      fd.append('contentOrder', String(i + 1 + contents.length));
      fd.append('playerMode', 'Auto');
      const res = await uploadFile(`/admin/modules/${selectedMod.moduleId}/contents`, fd, 'admin');
      if (res.ok) uploaded++;
    }
    setBulkUploading(false);
    setBulkFiles([]);
    setShowAddContent(false);
    setContentAddMode('single');
    setMsg(`Uploaded ${uploaded} of ${bulkFiles.length} files.`);
    loadContents(selectedMod.moduleId);
  }

  async function uploadBulkFaqs() {
    if (!faqBulkFiles.length || !selectedMod) return;
    setFaqBulkUploading(true);
    const fd = new FormData();
    faqBulkFiles.forEach(f => fd.append('files', f));
    const res = await uploadFile(`/admin/modules/${selectedMod.moduleId}/faqs/bulk-upload`, fd, 'admin');
    setFaqBulkUploading(false);
    if (res.ok) {
      setFaqBulkFiles([]);
      setShowAddFaq(false);
      setFaqAddMode('single');
      setMsg(res.message || `${res.data?.length || 0} FAQ document(s) uploaded.`);
      loadFaqs(selectedMod.moduleId);
    } else {
      setMsg(res.message || 'Upload failed.');
    }
  }

  const totalContent = modules.reduce((sum, m) => sum + (m._count?.contents || 0), 0);

  return (
    <div style={{ marginTop: 12 }}>
      {msg && (
        <div className="toast bad" style={{ marginBottom: 12 }}>
          {msg}
          <button style={{ marginLeft: 10, cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit' }} onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 280px 1fr', gap: 14, minHeight: 560, alignItems: 'start' }}>

        {/* ── Classrooms column ── */}
        <div style={{ minWidth: 0, maxHeight: '80vh', overflowY: 'auto', overflowX: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)' }}>Classrooms</div>
            </div>
            <button
              className="btn xs"
              style={{ background: '#1d4ed8', borderRadius: 10, padding: '6px 12px', fontSize: 12 }}
              onClick={() => setShowWizard(true)}
            >
              + New
            </button>
          </div>
          {/* Search/filter */}
          <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
            <input
              className="input"
              style={{ fontSize: 12, padding: '6px 10px' }}
              placeholder="Search by name..."
              value={clSearch.name}
              onChange={e => setClSearch(p => ({ ...p, name: e.target.value }))}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <input
                className="input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder="Process..."
                value={clSearch.process}
                onChange={e => setClSearch(p => ({ ...p, process: e.target.value }))}
              />
              <input
                className="input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder="Branch..."
                value={clSearch.branch}
                onChange={e => setClSearch(p => ({ ...p, branch: e.target.value }))}
              />
            </div>
          </div>
          {(() => {
            const filtered = classrooms.filter(cl => {
              const q = clSearch.name.toLowerCase();
              const p = clSearch.process.toLowerCase();
              const b = clSearch.branch.toLowerCase();
              return (!q || cl.classroomName.toLowerCase().includes(q)) &&
                     (!p || (cl.process || '').toLowerCase().includes(p)) &&
                     (!b || (cl.branch || '').toLowerCase().includes(b));
            });
            return (
              <>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{filtered.length} of {classrooms.length}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {filtered.map(cl => (
              <div key={cl.classroomId}>
              <ClassroomCard
                cl={cl}
                selected={selectedCl?.classroomId === cl.classroomId}
                onClick={() => { setSelectedCl(cl); setSelectedMod(null); }}
              />
              {selectedCl?.classroomId === cl.classroomId && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button
                    className="btn xs"
                    style={{ flex: 1, background: 'rgba(255,255,255,.07)', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }}
                    onClick={() => setEditingClassroom(cl)}
                  >
                    ✏ Edit / Add Content
                  </button>
                  <button
                    className="btn xs"
                    style={{ background: 'rgba(220,38,38,.15)', color: '#f87171', border: '1px solid rgba(220,38,38,.35)', borderRadius: 8, fontSize: 11, padding: '4px 8px' }}
                    onClick={() => setDeleteClModal({ cl, confirmName: '', step: 1, error: '' })}
                    title="Delete classroom permanently"
                  >
                    🗑
                  </button>
                </div>
              )}
              </div>
                  ))}
                  {filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--card)', borderRadius: 14, border: '1.5px dashed var(--line)' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🏫</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{classrooms.length === 0 ? 'No classrooms yet' : 'No match'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>{classrooms.length === 0 ? 'Create one to get started' : 'Try different filters'}</div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>

        {/* ── Modules column ── */}
        <div style={{ minWidth: 0, maxHeight: '80vh', overflowY: 'auto', overflowX: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)' }}>Modules</div>
              {selectedCl && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{modules.length} modules · {totalContent} items</div>}
            </div>
            {selectedCl && (
              <button className="btn xs" style={{ borderRadius: 10, padding: '6px 12px', fontSize: 12 }} onClick={() => setShowAddMod(true)}>
                + Add
              </button>
            )}
          </div>

          {!selectedCl ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', background: 'var(--card)', borderRadius: 14, border: '1.5px dashed var(--line)' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>←</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Select a classroom first</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {modules.map(mod => (
                <ModuleCard
                  key={mod.moduleId}
                  mod={mod}
                  selected={selectedMod?.moduleId === mod.moduleId}
                  onSelect={() => setSelectedMod(mod)}
                  onDelete={deleteModule}
                />
              ))}
              {modules.length === 0 && (
                <div style={{ textAlign: 'center', padding: '28px 12px', background: 'var(--card)', borderRadius: 12, border: '1.5px dashed var(--line)' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>📦</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No modules yet</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Content + FAQs column ── */}
        <div style={{ minWidth: 0, maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' }}>
          {!selectedMod ? (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 340, background: 'var(--card)', borderRadius: 16, border: '1.5px dashed var(--line)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>
                  {selectedCl ? 'Select a module to manage content' : 'Select a classroom first'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 6 }}>
                  Videos, PDFs, PPTs, links and more
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Module header banner */}
              <div style={{
                background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
                borderRadius: 14, padding: '16px 20px', marginBottom: 16,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .5 }}>
                    Day {selectedMod.dayNo} · {selectedCl?.classroomName}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 4 }}>{selectedMod.moduleTitle}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', marginTop: 4 }}>
                    {contents.length} content items · {faqs.length} FAQs
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn small"
                    style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 10 }}
                    onClick={() => setShowAddContent(true)}
                  >
                    + Content
                  </button>
                  <button
                    className="btn small"
                    style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 10 }}
                    onClick={() => setShowAddFaq(true)}
                  >
                    + FAQ
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--card)', borderRadius: 10, padding: 4 }}>
                {['content', 'faqs'].map(t => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    style={{
                      flex: 1, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: activeTab === t ? 'var(--card-solid)' : 'transparent',
                      color: activeTab === t ? 'var(--ink)' : 'var(--muted)',
                      fontWeight: activeTab === t ? 700 : 500, fontSize: 13,
                      boxShadow: activeTab === t ? 'var(--shadow-sm)' : 'none',
                      transition: 'all .12s',
                    }}
                  >
                    {t === 'content' ? `Content (${contents.length})` : `FAQs (${faqs.length})`}
                  </button>
                ))}
              </div>

              {/* Content list */}
              {activeTab === 'content' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {contents.map((c, ci) => (
                    <ContentCard
                      key={c.contentId}
                      c={c}
                      isFirst={ci === 0}
                      isLast={ci === contents.length - 1}
                      onMoveUp={ci > 0 ? async () => {
                        const prev = contents[ci - 1];
                        await Promise.all([
                          api.put(`/admin/contents/${c.contentId}`, { contentOrder: prev.contentOrder || ci }, 'admin'),
                          api.put(`/admin/contents/${prev.contentId}`, { contentOrder: c.contentOrder || ci + 1 }, 'admin'),
                        ]);
                        loadContents(selectedMod.moduleId);
                      } : null}
                      onMoveDown={ci < contents.length - 1 ? async () => {
                        const next = contents[ci + 1];
                        await Promise.all([
                          api.put(`/admin/contents/${c.contentId}`, { contentOrder: next.contentOrder || ci + 2 }, 'admin'),
                          api.put(`/admin/contents/${next.contentId}`, { contentOrder: c.contentOrder || ci + 1 }, 'admin'),
                        ]);
                        loadContents(selectedMod.moduleId);
                      } : null}
                      onToggleLock={async () => {
                        await api.put(`/admin/content/${c.contentId}/lock`, { locked: !c.locked }, 'admin');
                        loadContents(selectedMod.moduleId);
                      }}
                      onDelete={() => deleteContent(c.contentId)}
                      onSave={async (draft) => {
                        const res = await api.put(`/admin/contents/${c.contentId}`, {
                          estimatedMins: Number(draft.estimatedMins) || 0,
                          completionRulePct: Number(draft.completionRulePct) || 80,
                        }, 'admin');
                        if (!res.ok) throw new Error(res.message || 'Save failed.');
                        loadContents(selectedMod.moduleId);
                      }}
                    />
                  ))}
                  {contents.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '36px', background: 'var(--card)', borderRadius: 12, border: '1.5px dashed var(--line)' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🎬</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>No content yet</div>
                      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>Add videos, PDFs, or sync from Drive</div>
                    </div>
                  )}
                </div>
              )}

              {/* FAQs list */}
              {activeTab === 'faqs' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {faqs.map(f => (
                    <div key={f.faqId} style={{
                      background: 'var(--card-solid)', borderRadius: 12, border: '1.5px solid var(--line)',
                      padding: '14px 16px', boxShadow: 'var(--shadow-sm)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', flex: 1 }}>
                          {f.answer.startsWith('[') ? '📎 ' : 'Q: '}{f.question}
                        </div>
                        <button onClick={async () => { if (!window.confirm('Remove FAQ?')) return; await api.delete(`/admin/faqs/${f.faqId}`, 'admin'); loadFaqs(selectedMod.moduleId); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>✕</button>
                      </div>
                      {f.answer.startsWith('[') ? (
                        (() => {
                          const match = f.answer.match(/\[([^\]]+)\] (.+)/);
                          return match ? (
                            <a href={match[2]} target="_blank" rel="noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--brand)', textDecoration: 'none', paddingLeft: 12, borderLeft: '3px solid var(--accent-soft)' }}>
                              {match[1] === 'PDF Document' ? '📄' : match[1].startsWith('PPT') ? '📊' : '📝'} View {match[1]} ↗
                            </a>
                          ) : <div style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 12, borderLeft: '3px solid var(--accent-soft)' }}>{f.answer}</div>;
                        })()
                      ) : (
                        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, paddingLeft: 12, borderLeft: '3px solid var(--accent-soft)' }}>
                          {f.answer}
                        </div>
                      )}
                    </div>
                  ))}
                  {faqs.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '36px', background: 'var(--card)', borderRadius: 12, border: '1.5px dashed var(--line)' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>❓</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>No FAQs yet</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Classroom Creation Wizard ── */}
      {showWizard && (
        <ClassroomWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => { loadClassrooms(); setShowWizard(false); }}
        />
      )}

      {/* ── Edit Classroom Modal ── */}
      {editingClassroom && (
        <EditClassroomModal
          classroom={editingClassroom}
          onClose={() => setEditingClassroom(null)}
          onSaved={() => { loadClassrooms(); if (selectedCl) loadModules(selectedCl.classroomId); }}
        />
      )}

      {/* ── Add Module Modal ── */}
      {showAddMod && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddMod(false)}>
          <div className="modal-box" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <b>Add Module — {selectedCl?.classroomName}</b>
              <button className="btn small secondary" onClick={() => setShowAddMod(false)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={createModule}>
                <div className="col-2">
                  <div className="field"><label>Day No *</label><input className="input" type="number" min="1" value={modForm.dayNo} onChange={e => setModForm(p => ({ ...p, dayNo: e.target.value }))} required /></div>
                  <div className="field"><label>Module Order</label><input className="input" type="number" min="0" value={modForm.moduleOrder} onChange={e => setModForm(p => ({ ...p, moduleOrder: e.target.value }))} /></div>
                </div>
                <div className="field"><label>Module Title *</label><input className="input" value={modForm.moduleTitle} onChange={e => setModForm(p => ({ ...p, moduleTitle: e.target.value }))} required /></div>
                <div className="field"><label>Description</label><input className="input" value={modForm.description} onChange={e => setModForm(p => ({ ...p, description: e.target.value }))} /></div>
                <button className="btn" type="submit" disabled={loading} style={{ marginTop: 10 }}>{loading ? '...' : 'Add Module'}</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Content Modal ── */}
      {showAddContent && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddContent(false)}>
          <div className="modal-box" style={{ maxWidth: 620 }}>
            <div className="modal-head">
              <b>Add Content — {selectedMod?.moduleTitle}</b>
              <button className="btn small secondary" onClick={() => { setShowAddContent(false); setBulkFiles([]); setContentAddMode('single'); }}>✕</button>
            </div>
            <div className="modal-body">
              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--card)', borderRadius: 10, padding: 4 }}>
                {[['single', 'Single Upload'], ['bulk', 'Bulk Upload / Drag & Drop']].map(([k, label]) => (
                  <button key={k} onClick={() => setContentAddMode(k)} style={{
                    flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: contentAddMode === k ? 'var(--card-solid)' : 'transparent',
                    color: contentAddMode === k ? 'var(--ink)' : 'var(--muted)',
                    fontWeight: contentAddMode === k ? 700 : 500, fontSize: 12,
                    boxShadow: contentAddMode === k ? 'var(--shadow-sm)' : 'none', transition: 'all .12s',
                  }}>{label}</button>
                ))}
              </div>

              {/* BULK mode */}
              {contentAddMode === 'bulk' && (
                <div>
                  <div
                    onDragOver={e => { e.preventDefault(); setBulkDragging(true); }}
                    onDragLeave={() => setBulkDragging(false)}
                    onDrop={handleBulkDrop}
                    onClick={() => document.getElementById('bulk-file-input').click()}
                    style={{
                      border: `2px dashed ${bulkDragging ? '#1d4ed8' : '#d1d5db'}`,
                      borderRadius: 14, padding: '36px 24px', textAlign: 'center',
                      background: bulkDragging ? 'rgba(37,99,235,.12)' : 'rgba(255,255,255,.04)', cursor: 'pointer', marginBottom: 14,
                      transition: 'all .15s',
                    }}
                  >
                    <input id="bulk-file-input" type="file" multiple accept="video/*,.pdf,.ppt,.pptx,.doc,.docx,.html,.htm" style={{ display: 'none' }} onChange={handleBulkFileInput} />
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Drop files here or click to browse</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Videos, PDFs, PPTs, DOCs, HTML files — multiple at once</div>
                  </div>

                  {bulkFiles.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                        {bulkFiles.length} files queued
                      </div>
                      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 8, marginBottom: 14 }}>
                        {bulkFiles.map((item, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: TYPE_META[item.type]?.bg || 'rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>
                              {TYPE_META[item.type]?.icon || '📄'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <input
                                value={item.title}
                                onChange={e => setBulkFiles(prev => prev.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))}
                                style={{ width: '100%', fontSize: 12, fontWeight: 600, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', color: 'var(--ink)' }}
                              />
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{item.file.name} · {(item.file.size / 1024 / 1024).toFixed(1)}MB</div>
                            </div>
                            <select
                              value={item.type}
                              onChange={e => setBulkFiles(prev => prev.map((x, xi) => xi === i ? { ...x, type: e.target.value } : x))}
                              style={{ fontSize: 11, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 6px', color: 'var(--ink)', WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none', flexShrink: 0, width: 60 }}
                            >
                              {['video','pdf','ppt','doc','html','link'].map(t => <option key={t}>{t}</option>)}
                            </select>
                            <button onClick={() => setBulkFiles(prev => prev.filter((_, xi) => xi !== i))} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={uploadBulkFiles} disabled={bulkUploading}>
                        {bulkUploading ? `Uploading…` : `⬆ Upload ${bulkFiles.length} Files`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* SINGLE mode */}
              {contentAddMode === 'single' && (
              <form onSubmit={createContent}>
                <div className="col-2">
                  <div className="field">
                    <label>Type</label>
                    <select className="select" value={contentForm.contentType} onChange={e => setContentForm(p => ({ ...p, contentType: e.target.value }))}>
                      {['video', 'pdf', 'ppt', 'doc', 'link', 'html'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Player Mode</label>
                    <select className="select" value={contentForm.playerMode} onChange={e => setContentForm(p => ({ ...p, playerMode: e.target.value }))}>
                      {['Auto', 'HTML5', 'Drive Preview', 'Direct'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Order</label><input className="input" type="number" value={contentForm.contentOrder} onChange={e => setContentForm(p => ({ ...p, contentOrder: e.target.value }))} /></div>
                  <div className="field"><label>Est. Minutes</label><input className="input" type="number" value={contentForm.estimatedMins} onChange={e => setContentForm(p => ({ ...p, estimatedMins: e.target.value }))} /></div>
                  <div className="field"><label>Completion Rule %</label><input className="input" type="number" max="100" value={contentForm.completionRulePct} onChange={e => setContentForm(p => ({ ...p, completionRulePct: e.target.value }))} /></div>
                </div>
                <div className="field"><label>Content Title</label><input className="input" value={contentForm.contentTitle} onChange={e => setContentForm(p => ({ ...p, contentTitle: e.target.value }))} /></div>
                <div className="card" style={{ marginTop: 10, marginBottom: 10, background: 'var(--card)' }}>
                  <b style={{ fontSize: 13 }}>Content Source — choose ONE</b>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>YouTube URL</label>
                    <input className="input" placeholder="https://www.youtube.com/watch?v=..." value={contentForm.youtubeUrl || ''} onChange={e => setContentForm(p => ({ ...p, youtubeUrl: e.target.value, directMediaUrl: e.target.value || p.directMediaUrl }))} />
                  </div>
                  <div className="field"><label>Google Drive File ID</label><input className="input" placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" value={contentForm.driveFileId} onChange={e => setContentForm(p => ({ ...p, driveFileId: e.target.value }))} /></div>
                  <div className="field"><label>Direct URL</label><input className="input" placeholder="https://example.com/video.mp4 or any link" value={contentForm.directMediaUrl} onChange={e => setContentForm(p => ({ ...p, directMediaUrl: e.target.value, youtubeUrl: '' }))} /></div>
                  <div className="field"><label>Upload Local File (PDF, Doc, Video, HTML)</label><input type="file" accept="video/*,.pdf,.ppt,.pptx,.doc,.docx,.html,.htm" onChange={e => setContentFile(e.target.files[0])} /></div>
                </div>
                <div className="field"><label>Description</label><textarea className="input" value={contentForm.description} onChange={e => setContentForm(p => ({ ...p, description: e.target.value }))} /></div>
                <button className="btn" type="submit" disabled={loading} style={{ marginTop: 10 }}>{loading ? 'Uploading...' : 'Add Content'}</button>
              </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add FAQ Modal ── */}
      {showAddFaq && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && (setShowAddFaq(false), setFaqBulkFiles([]), setFaqAddMode('single'))}>
          <div className="modal-box" style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <b>Add FAQ — {selectedMod?.moduleTitle}</b>
              <button className="btn small secondary" onClick={() => { setShowAddFaq(false); setFaqBulkFiles([]); setFaqAddMode('single'); }}>✕</button>
            </div>
            <div className="modal-body">
              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--card)', borderRadius: 10, padding: 4 }}>
                {[['single', 'Manual Entry'], ['bulk', 'Bulk File Upload (PDF/DOC/PPT)']].map(([k, label]) => (
                  <button key={k} onClick={() => setFaqAddMode(k)} style={{
                    flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: faqAddMode === k ? 'var(--card-solid)' : 'transparent',
                    color: faqAddMode === k ? 'var(--ink)' : 'var(--muted)',
                    fontWeight: faqAddMode === k ? 700 : 500, fontSize: 12,
                    boxShadow: faqAddMode === k ? 'var(--shadow-sm)' : 'none', transition: 'all .12s',
                  }}>{label}</button>
                ))}
              </div>

              {/* Single mode */}
              {faqAddMode === 'single' && (
                <form onSubmit={createFaq}>
                  <div className="field"><label>Question *</label><input className="input" value={faqForm.question} onChange={e => setFaqForm(p => ({ ...p, question: e.target.value }))} required /></div>
                  <div className="field"><label>Answer *</label><textarea className="input" rows={4} value={faqForm.answer} onChange={e => setFaqForm(p => ({ ...p, answer: e.target.value }))} required /></div>
                  <div className="field"><label>Sort Order</label><input className="input" type="number" value={faqForm.sortOrder} onChange={e => setFaqForm(p => ({ ...p, sortOrder: e.target.value }))} /></div>
                  <button className="btn" type="submit" disabled={loading} style={{ marginTop: 10 }}>{loading ? '...' : 'Add FAQ'}</button>
                </form>
              )}

              {/* Bulk mode */}
              {faqAddMode === 'bulk' && (
                <div>
                  <div
                    onDragOver={e => { e.preventDefault(); setFaqBulkDragging(true); }}
                    onDragLeave={() => setFaqBulkDragging(false)}
                    onDrop={e => { e.preventDefault(); setFaqBulkDragging(false); setFaqBulkFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
                    onClick={() => document.getElementById('faq-bulk-input').click()}
                    style={{
                      border: `2px dashed ${faqBulkDragging ? '#6366f1' : 'rgba(255,255,255,.15)'}`,
                      borderRadius: 14, padding: '36px 24px', textAlign: 'center',
                      background: faqBulkDragging ? 'rgba(99,102,241,.12)' : 'rgba(255,255,255,.04)',
                      cursor: 'pointer', marginBottom: 14, transition: 'all .15s',
                    }}
                  >
                    <input
                      id="faq-bulk-input"
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.ppt,.pptx"
                      style={{ display: 'none' }}
                      onChange={e => { setFaqBulkFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = ''; }}
                    />
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📎</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Drop PDF, DOC, PPT files here</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Each file becomes an FAQ entry with the filename as the title and a download link as the answer</div>
                  </div>

                  {faqBulkFiles.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                        {faqBulkFiles.length} file{faqBulkFiles.length > 1 ? 's' : ''} queued
                      </div>
                      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 6, marginBottom: 14 }}>
                        {faqBulkFiles.map((f, i) => {
                          const ext = f.name.split('.').pop().toLowerCase();
                          const iconMap = { pdf: '📄', doc: '📝', docx: '📝', ppt: '📊', pptx: '📊' };
                          return (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
                              <span style={{ fontSize: 20, flexShrink: 0 }}>{iconMap[ext] || '📄'}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name.replace(/\.[^/.]+$/, '')}</div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{ext.toUpperCase()} · {(f.size / 1024).toFixed(0)} KB</div>
                              </div>
                              <button onClick={() => setFaqBulkFiles(prev => prev.filter((_, xi) => xi !== i))} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>✕</button>
                            </div>
                          );
                        })}
                      </div>
                      <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={uploadBulkFaqs} disabled={faqBulkUploading}>
                        {faqBulkUploading ? 'Uploading...' : `⬆ Upload ${faqBulkFiles.length} File${faqBulkFiles.length > 1 ? 's' : ''} as FAQs`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Classroom Modal ── */}
      {deleteClModal && (
        <DeleteClassroomModal
          classroom={deleteClModal.cl}
          onCancel={() => setDeleteClModal(null)}
          onConfirm={(name) => deleteClassroomConfirmed(deleteClModal.cl.classroomId, name)}
          error={deleteClModal.error}
        />
      )}
    </div>
  );
}
