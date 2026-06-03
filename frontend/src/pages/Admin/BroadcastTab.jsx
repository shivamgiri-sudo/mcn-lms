import { useState, useEffect, useRef } from 'react';
import { api } from '../../utils/api.js';

const SCOPE_OPTIONS = [
  { value: 'company',    label: 'Entire Company',    desc: 'All active trainees' },
  { value: 'branch',     label: 'Branch',             desc: 'Trainees in a branch' },
  { value: 'process',    label: 'Process',            desc: 'Trainees in a process' },
  { value: 'batch',      label: 'Batch',              desc: 'Trainees in a batch' },
  { value: 'individual', label: 'Individual Trainee', desc: 'One trainee by Emp ID' },
];

const EMPTY_MCQ = () => ({ question: '', optionA: '', optionB: '', optionC: '', optionD: '', correct: 'A', marks: 1 });

export default function BroadcastTab() {
  const [classrooms, setClassrooms] = useState([]);
  const [modules, setModules] = useState([]);
  const [contents, setContents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [branches, setBranches] = useState([]);
  const [processes, setProcesses] = useState([]);

  const [form, setForm] = useState({
    broadcastTitle: '',
    scope: 'company',
    scopeValue: '',
    classroomId: '',
    moduleId: '',
    moduleName: '',
    selectedContentIds: [],   // optional: specific content items from the module
    assignmentType: 'Mandatory',
    message: '',
    dueDate: '',
  });

  // Direct upload state
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadMode, setUploadMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Optional MCQ state
  const [mcqEnabled, setMcqEnabled] = useState(false);
  const [mcqName, setMcqName] = useState('');
  const [mcqPassPct, setMcqPassPct] = useState(60);
  const [mcqAttempts, setMcqAttempts] = useState(3);
  const [mcqTimeMins, setMcqTimeMins] = useState(30);
  const [questions, setQuestions] = useState([EMPTY_MCQ()]);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
    api.get('/admin/batches', 'admin').then(r => r.ok && setBatches(r.data));
    api.get('/admin/broadcast-targets', 'admin').then(r => {
      if (r.ok) { setBranches(r.data.branches || []); setProcesses(r.data.processes || []); }
    });
  }, []);

  useEffect(() => {
    if (!form.classroomId) { setModules([]); setContents([]); setF('moduleId', ''); setF('moduleName', ''); return; }
    api.get(`/admin/classrooms/${form.classroomId}/modules`, 'admin').then(r => r.ok && setModules(r.data));
  }, [form.classroomId]);

  useEffect(() => {
    if (!form.moduleId) { setContents([]); setF('selectedContentIds', []); return; }
    api.get(`/admin/modules/${form.moduleId}/contents`, 'admin').then(r => r.ok && setContents(r.data));
  }, [form.moduleId]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function changeScope(scopeVal) { setForm(f => ({ ...f, scope: scopeVal, scopeValue: '' })); }

  function toggleContent(contentId) {
    setF('selectedContentIds', form.selectedContentIds.includes(contentId)
      ? form.selectedContentIds.filter(id => id !== contentId)
      : [...form.selectedContentIds, contentId]);
  }

  function addQuestion() { setQuestions(qs => [...qs, EMPTY_MCQ()]); }
  function removeQuestion(i) { setQuestions(qs => qs.filter((_, idx) => idx !== i)); }
  function setQ(i, k, v) { setQuestions(qs => qs.map((q, idx) => idx === i ? { ...q, [k]: v } : q)); }

  async function handleUpload() {
    if (!uploadFile || !uploadTitle.trim()) return setMsg({ type: 'bad', text: 'File and title are required for upload.' });
    if (!form.moduleId) return setMsg({ type: 'bad', text: 'Select a module before uploading content.' });
    setUploading(true);
    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('contentTitle', uploadTitle.trim());
    fd.append('contentOrder', String(contents.length + 1));
    const token = localStorage.getItem('lms_token_admin') || '';
    // Use the admin content creation endpoint which persists to DB
    const res = await fetch(`/api/admin/modules/${form.moduleId}/contents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(r => r.json()).catch(() => ({ ok: false, message: 'Upload failed' }));
    setUploading(false);
    if (!res.ok) return setMsg({ type: 'bad', text: res.message || 'Upload failed.' });
    api.get(`/admin/modules/${form.moduleId}/contents`, 'admin').then(r => r.ok && setContents(r.data));
    setUploadFile(null); setUploadTitle(''); setUploadMode(false);
    setMsg({ type: 'ok', text: `"${uploadTitle}" uploaded and added to the module.` });
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.moduleId) return setMsg({ type: 'bad', text: 'Select a module.' });
    if (form.scope !== 'company' && !form.scopeValue.trim()) return setMsg({ type: 'bad', text: 'Select a target for the chosen scope.' });

    setLoading(true); setMsg(null);

    // 1. Broadcast the module assignment
    const res = await api.post('/admin/broadcast-module', {
      broadcastTitle: form.broadcastTitle.trim() || null,
      moduleId: form.moduleId,
      moduleName: form.moduleName,
      scope: form.scope,
      scopeValue: form.scope === 'company' ? 'ALL' : form.scopeValue.trim(),
      assignmentType: form.assignmentType,
      message: form.message || null,
      dueDate: form.dueDate || null,
      contentIds: form.selectedContentIds.length > 0 ? form.selectedContentIds : null,
    }, 'admin');

    if (!res.ok) {
      setLoading(false);
      return setMsg({ type: 'bad', text: res.message || 'Broadcast failed.' });
    }

    // 2. Optionally create MCQ assessment for this module
    if (mcqEnabled && mcqName.trim() && questions.some(q => q.question.trim())) {
      const validQs = questions.filter(q => q.question.trim() && q.optionA.trim() && q.optionB.trim());
      if (validQs.length > 0) {
        const aRes = await api.post('/admin/assessments', {
          classroomId: form.classroomId,
          moduleId: form.moduleId,
          assessmentName: mcqName.trim(),
          passingPct: mcqPassPct,
          attemptLimit: mcqAttempts,
          timeLimitMins: mcqTimeMins,
          instructions: `Broadcast MCQ for: ${form.broadcastTitle || form.moduleName}`,
        }, 'admin');

        if (aRes.ok && aRes.data?.assessmentId) {
          const uploadPayload = validQs.map(q => ({
            question: q.question,
            option_a: q.optionA,
            option_b: q.optionB,
            option_c: q.optionC || '',
            option_d: q.optionD || '',
            correct: q.correct,
            marks: q.marks || 1,
            difficulty: 'Medium',
            explanation: '',
          }));
          await api.post(`/admin/assessments/${aRes.data.assessmentId}/questions/upload`, { questions: uploadPayload }, 'admin');
        }
      }
    }

    setLoading(false);
    const scopeLabel = SCOPE_OPTIONS.find(s => s.value === form.scope)?.label;
    setMsg({ type: 'ok', text: `Module "${form.moduleName}" broadcast to ${scopeLabel}${mcqEnabled ? ' + MCQ created' : ''}.` });
    setForm(f => ({ ...f, broadcastTitle: '', scopeValue: '', message: '', dueDate: '', selectedContentIds: [] }));
    setQuestions([EMPTY_MCQ()]); setMcqEnabled(false); setMcqName('');
  }

  const stepNum = (n) => form.scope === 'company' ? n - 1 : n;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Broadcast / Refresher Assignment</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Assign a module to any group. Optionally select specific content items, upload new content, or attach an MCQ.
          Assignments appear immediately in the trainee's <b>Assigned</b> tab.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        <div style={{ background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)', padding: '24px 26px', boxShadow: 'var(--shadow-sm)' }}>
          <form onSubmit={submit}>

            {/* Title */}
            <div className="field" style={{ marginBottom: 20 }}>
              <label>Broadcast Title <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <input className="input" placeholder="e.g. Week 3 Refresher — Banking" value={form.broadcastTitle}
                onChange={e => setF('broadcastTitle', e.target.value)} maxLength={120} />
            </div>

            {/* Step 1: Scope */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Step 1 — Target Audience</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {SCOPE_OPTIONS.map(opt => (
                  <div key={opt.value} onClick={() => changeScope(opt.value)} style={{
                    border: `2px solid ${form.scope === opt.value ? 'var(--brand)' : 'var(--line)'}`,
                    borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                    background: form.scope === opt.value ? 'rgba(29,78,216,.08)' : 'var(--card)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: form.scope === opt.value ? 'var(--brand)' : 'var(--ink)' }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{opt.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 2: Scope value */}
            {form.scope !== 'company' && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Step 2 — Pick Specific Target</div>
                {form.scope === 'branch' && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Branch</label>
                    {branches.length > 0
                      ? <select className="select" value={form.scopeValue} onChange={e => setF('scopeValue', e.target.value)} required>
                          <option value="">Select branch…</option>
                          {branches.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      : <input className="input" placeholder="Branch name" value={form.scopeValue} onChange={e => setF('scopeValue', e.target.value)} required />}
                  </div>
                )}
                {form.scope === 'process' && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Process</label>
                    {processes.length > 0
                      ? <select className="select" value={form.scopeValue} onChange={e => setF('scopeValue', e.target.value)} required>
                          <option value="">Select process…</option>
                          {processes.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      : <input className="input" placeholder="Process name" value={form.scopeValue} onChange={e => setF('scopeValue', e.target.value)} required />}
                  </div>
                )}
                {form.scope === 'batch' && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Batch</label>
                    <select className="select" value={form.scopeValue} onChange={e => setF('scopeValue', e.target.value)} required>
                      <option value="">Select batch…</option>
                      {batches.map(b => <option key={b.batchNo} value={b.batchNo}>{b.batchNo}{b.batchName ? ` — ${b.batchName}` : ''}</option>)}
                    </select>
                  </div>
                )}
                {form.scope === 'individual' && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Employee ID</label>
                    <input className="input" placeholder="e.g. EMP1001" value={form.scopeValue} onChange={e => setF('scopeValue', e.target.value)} required />
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Module */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Step {stepNum(3)} — Select Module</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Classroom</label>
                  <select className="select" value={form.classroomId} onChange={e => setF('classroomId', e.target.value)} required>
                    <option value="">Select classroom…</option>
                    {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Module</label>
                  <select className="select" value={form.moduleId} disabled={!form.classroomId}
                    onChange={e => { const m = modules.find(m => m.moduleId === e.target.value); setF('moduleId', e.target.value); setF('moduleName', m?.moduleTitle || ''); }} required>
                    <option value="">{form.classroomId ? 'Select module…' : 'Select classroom first'}</option>
                    {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} — {m.moduleTitle}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Content picker */}
            {form.moduleId && contents.length > 0 && (
              <div style={{ marginBottom: 20, background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)', padding: '14px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 10 }}>
                  Content from Module <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional — leave blank to assign all)</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {contents.map(c => (
                    <label key={c.contentId} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={form.selectedContentIds.includes(c.contentId)}
                        onChange={() => toggleContent(c.contentId)}
                        style={{ width: 15, height: 15, accentColor: 'var(--brand)' }} />
                      <span style={{ flex: 1 }}>{c.contentTitle}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--card-solid)', borderRadius: 4, padding: '2px 6px' }}>{c.contentType}</span>
                    </label>
                  ))}
                </div>
                {form.selectedContentIds.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--brand)', marginTop: 8 }}>
                    {form.selectedContentIds.length} of {contents.length} content item(s) selected
                  </div>
                )}
              </div>
            )}

            {/* Direct upload */}
            {form.moduleId && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .4 }}>
                    Upload New Content to this Module
                  </div>
                  <button type="button" className="btn small secondary" style={{ fontSize: 11 }}
                    onClick={() => setUploadMode(v => !v)}>
                    {uploadMode ? 'Cancel' : '+ Upload Content'}
                  </button>
                </div>
                {uploadMode && (
                  <div style={{ background: 'var(--card)', borderRadius: 10, border: '1px dashed var(--line)', padding: 16 }}>
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 12 }}>Content Title</label>
                      <input className="input" placeholder="e.g. Refresher Deck Week 3" value={uploadTitle}
                        onChange={e => setUploadTitle(e.target.value)} />
                    </div>
                    <div
                      onClick={() => fileRef.current?.click()}
                      style={{
                        border: '2px dashed var(--line)', borderRadius: 8, padding: '20px 16px',
                        textAlign: 'center', cursor: 'pointer', fontSize: 13, color: 'var(--muted)',
                        background: uploadFile ? 'rgba(22,163,74,.06)' : 'var(--card)',
                      }}>
                      {uploadFile
                        ? <span style={{ color: 'var(--ok)', fontWeight: 700 }}>📎 {uploadFile.name}</span>
                        : <span>Click to select file (PDF, video, PPT, DOC, image)</span>}
                    </div>
                    <input ref={fileRef} type="file"
                      accept=".pdf,.mp4,.webm,.pptx,.ppt,.docx,.doc,.jpg,.jpeg,.png,.gif"
                      style={{ display: 'none' }}
                      onChange={e => setUploadFile(e.target.files[0] || null)} />
                    <button type="button" className="btn small" style={{ marginTop: 10 }}
                      onClick={handleUpload} disabled={uploading || !uploadFile}>
                      {uploading ? 'Uploading…' : '⬆ Upload'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Assignment details */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Step {stepNum(4)} — Assignment Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Assignment Type</label>
                  <select className="select" value={form.assignmentType} onChange={e => setF('assignmentType', e.target.value)}>
                    <option value="Mandatory">Mandatory</option>
                    <option value="Optional">Optional</option>
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Due Date (optional)</label>
                  <input className="input" type="date" value={form.dueDate} onChange={e => setF('dueDate', e.target.value)} />
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Message to trainees (optional)</label>
                <input className="input" placeholder="e.g. Please complete before certification" value={form.message}
                  onChange={e => setF('message', e.target.value)} />
              </div>
            </div>

            {/* Optional MCQ */}
            <div style={{ marginBottom: 24, border: `2px solid ${mcqEnabled ? 'var(--brand)' : 'var(--line)'}`, borderRadius: 12, overflow: 'hidden' }}>
              <div
                onClick={() => setMcqEnabled(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer',
                  background: mcqEnabled ? 'rgba(29,78,216,.06)' : 'var(--card)',
                }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, border: `2px solid ${mcqEnabled ? 'var(--brand)' : 'var(--line)'}`,
                  background: mcqEnabled ? 'var(--brand)' : 'transparent',
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  {mcqEnabled && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Attach MCQ Assessment (optional)</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Create a new MCQ for this broadcast. Uses the same format as existing assessments.</div>
                </div>
              </div>

              {mcqEnabled && (
                <div style={{ padding: '16px 18px', borderTop: '1px solid var(--line)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Assessment Name</label>
                      <input className="input" placeholder="e.g. Week 3 MCQ" value={mcqName} onChange={e => setMcqName(e.target.value)} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Pass %</label>
                      <input className="input" type="number" min={1} max={100} value={mcqPassPct} onChange={e => setMcqPassPct(Number(e.target.value))} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Attempts</label>
                      <input className="input" type="number" min={1} max={10} value={mcqAttempts} onChange={e => setMcqAttempts(Number(e.target.value))} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Time (mins)</label>
                      <input className="input" type="number" min={1} value={mcqTimeMins} onChange={e => setMcqTimeMins(Number(e.target.value))} />
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>Questions</div>
                  {questions.map((q, i) => (
                    <div key={i} style={{ background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)', padding: '12px 14px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)' }}>Q{i + 1}</span>
                        {questions.length > 1 && (
                          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13 }}
                            onClick={() => removeQuestion(i)}>✕</button>
                        )}
                      </div>
                      <input className="input" style={{ marginBottom: 8 }} placeholder="Question text"
                        value={q.question} onChange={e => setQ(i, 'question', e.target.value)} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        {['A', 'B', 'C', 'D'].map(opt => (
                          <div key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', width: 14 }}>{opt}</span>
                            <input className="input" placeholder={`Option ${opt}${opt === 'C' || opt === 'D' ? ' (optional)' : ''}`}
                              value={q[`option${opt}`]} onChange={e => setQ(i, `option${opt}`, e.target.value)}
                              style={{ flex: 1 }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div className="field" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Correct:</label>
                          <select className="select" style={{ width: 70 }} value={q.correct} onChange={e => setQ(i, 'correct', e.target.value)}>
                            {['A', 'B', 'C', 'D'].map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Marks:</label>
                          <input className="input" type="number" style={{ width: 60 }} min={1} value={q.marks}
                            onChange={e => setQ(i, 'marks', Number(e.target.value))} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn small secondary" onClick={addQuestion}>+ Add Question</button>
                </div>
              )}
            </div>

            <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Broadcasting…' : `📢 Broadcast to ${SCOPE_OPTIONS.find(s => s.value === form.scope)?.label}`}
            </button>
          </form>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 12 }}>Scope Guide</div>
            {[['📢','Entire Company','Every active trainee'],['🌿','Branch','Trainees in that branch'],['⚙️','Process','Trainees in that process'],['🏢','Batch','All trainees in batch'],['👤','Individual','One trainee by ID']].map(([icon, title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(29,78,216,.06)', borderRadius: 12, border: '1px solid rgba(29,78,216,.15)', padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 6 }}>What trainees see</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
              The assigned module appears immediately in the <b style={{ color: 'var(--ink)' }}>Assigned</b> tab after next page load.
              If you selected specific content items, those are noted. MCQ appears in their Assessments if module is linked.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
