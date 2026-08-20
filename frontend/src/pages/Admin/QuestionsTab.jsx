import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const CSV_TEMPLATE = 'question,option_a,option_b,option_c,option_d,correct,marks,difficulty,explanation\nWhat does KYC stand for?,Know Your Customer,Keep Your Cash,Know Your Compliance,Key Year Check,A,1,Easy,KYC = Know Your Customer\n';

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

export default function QuestionsTab() {
  const [assessments, setAssessments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [classrooms, setClassrooms] = useState([]);
  const [classroomModules, setClassroomModules] = useState([]);
  const [aForm, setAForm] = useState({ classroomId: '', dayNo: '', moduleId: '', assessmentName: '', passingPct: 60, attemptLimit: 3, timeLimitMins: 30, instructions: '' });
  const [bulkJson, setBulkJson] = useState('');
  const [bulkMode, setBulkMode] = useState('csv');
  const [csvFile, setCsvFile] = useState(null);
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [deleteModal, setDeleteModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [assessmentEditModal, setAssessmentEditModal] = useState(null);
  const [savingAssessmentEdit, setSavingAssessmentEdit] = useState(false);
  const [showGrants, setShowGrants] = useState(false);
  const [aSearch, setASearch] = useState({ name: '', classroomId: '' });

  useEffect(() => {
    api.get('/admin/assessments', 'admin').then(r => r.ok && setAssessments(r.data));
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
  }, []);

  useEffect(() => {
    if (aForm.classroomId) {
      api.get(`/admin/classrooms/${aForm.classroomId}/modules`, 'admin').then(r => {
        if (r.ok) setClassroomModules(r.data || []);
      });
    } else {
      setClassroomModules([]);
      setAForm(f => ({ ...f, moduleId: '' }));
    }
  }, [aForm.classroomId]);

  useEffect(() => {
    if (selected) api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data));
  }, [selected]);

  async function createAssessment(e) {
    e.preventDefault();
    const res = await api.post('/admin/assessments', aForm, 'admin');
    if (res.ok) { setShowCreate(false); setMsg('Assessment created.'); refreshAssessments(); }
    else setMsg(res.message || 'Failed.');
  }

  async function deleteAssessmentConfirmed(assessmentId) {
    const r = await api.deleteWithBody(`/admin/assessments/${assessmentId}`, { confirm: 'DELETE' }, 'admin');
    if (r.ok) {
      setDeleteModal(null);
      setSelected(null);
      setQuestions([]);
      setMsg(r.message || 'Assessment deleted.');
      api.get('/admin/assessments', 'admin').then(res => res.ok && setAssessments(res.data));
    } else {
      setDeleteModal(prev => ({ ...prev, error: r.message }));
    }
  }

  async function uploadBulk() {
    try {
      const questions = JSON.parse(bulkJson);
      const res = await api.post(`/admin/assessments/${selected.assessmentId}/questions/upload`, { questions }, 'admin');
      if (res.ok) { setMsg(res.message); setBulkJson(''); setShowBulk(false); api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data)); refreshAssessments(); }
      else setMsg(res.message || 'Failed.');
    } catch {
      setMsg('Invalid JSON format.');
    }
  }

  function refreshAssessments() {
    api.get('/admin/assessments', 'admin').then(r => r.ok && setAssessments(r.data));
  }

  async function deleteQuestion(questionId) {
    if (!window.confirm('Deactivate this question?')) return;
    await api.delete(`/admin/questions/${questionId}`, 'admin');
    api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data));
    refreshAssessments();
  }

  async function saveEditedAssessment(form) {
    setSavingAssessmentEdit(true);
    const res = await api.put(`/admin/assessments/${assessmentEditModal.assessmentId}`, form, 'admin');
    setSavingAssessmentEdit(false);
    if (res.ok) {
      setAssessmentEditModal(null);
      setMsg('Assessment updated.');
      if (selected?.assessmentId === assessmentEditModal.assessmentId) {
        setSelected(prev => ({ ...prev, ...form }));
      }
      refreshAssessments();
    } else {
      setMsg(res.message || 'Failed to update assessment.');
    }
  }

  async function saveEditedQuestion(form) {
    setSavingEdit(true);
    const res = await api.put(`/admin/questions/${editModal.questionId}`, form, 'admin');
    setSavingEdit(false);
    if (res.ok) {
      setEditModal(null);
      setMsg('Question updated.');
      api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data));
    } else {
      setMsg(res.message || 'Failed to update question.');
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'MCQ_Template.csv';
    a.click();
  }

  function handleCsvFile(file) {
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const parsedRows = parseCsvRows(text);
      if (parsedRows.length < 2) return;
      const header = parsedRows[0].map(h => h.trim().replace(/"/g, ''));
      const rows = parsedRows.slice(1, 6).map(vals => {
        const row = {};
        header.forEach((h, i) => { row[h] = vals[i] || ''; });
        return row;
      });
      setCsvPreview({ header, rows, total: parsedRows.length - 1 });
    };
    reader.readAsText(file);
  }

  async function uploadCsv() {
    if (!csvFile || !selected) return;
    const text = await csvFile.text();
    const res = await api.post(`/admin/assessments/${selected.assessmentId}/questions/upload-csv`, { csv: text }, 'admin');
    if (res.ok) {
      setMsg(`Uploaded ${res.count} questions${res.errors?.length ? `, ${res.errors.length} errors` : ''}.`);
      setCsvFile(null); setCsvPreview(null); setShowBulk(false);
      api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data));
      refreshAssessments();
    } else setMsg(res.message || 'Upload failed.');
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
        <h2 style={{fontSize:'18px',fontWeight:'800'}}>Questions & MCQ</h2>
        <button className="btn small" onClick={() => setShowCreate(!showCreate)}>+ New Assessment</button>
      </div>

      {msg && <div className="alert info" style={{marginBottom:'12px'}}>{msg}</div>}

      {showCreate && (
        <form onSubmit={createAssessment} style={{background:'var(--card)',border:'1px solid var(--line)',borderRadius:'var(--radius)',padding:'20px',marginBottom:'16px'}}>
          <h3 style={{fontWeight:'700',marginBottom:'14px'}}>Create Assessment</h3>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'12px'}}>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Assessment Name *</label>
              <input className="input" required value={aForm.assessmentName} onChange={e => setAForm(f => ({...f,assessmentName:e.target.value}))} />
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Classroom <span style={{fontWeight:400,color:'var(--muted)'}}>(optional — leave blank for a standalone assessment)</span></label>
              <select className="input" value={aForm.classroomId} onChange={e => setAForm(f => ({...f,classroomId:e.target.value,moduleId:''}))}>
                <option value="">-- No classroom (standalone) --</option>
                {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Link to Module <span style={{fontWeight:400,color:'var(--muted)'}}>(shows in learner view)</span></label>
              <select className="input" value={aForm.moduleId} onChange={e => setAForm(f => ({...f,moduleId:e.target.value}))} disabled={!aForm.classroomId}>
                <option value="">-- No module link --</option>
                {classroomModules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} · {m.moduleTitle}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Passing % *</label>
              <input className="input" type="number" min="0" max="100" required value={aForm.passingPct} onChange={e => setAForm(f => ({...f,passingPct:Number(e.target.value)}))} />
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Attempt Limit</label>
              <input className="input" type="number" min="1" value={aForm.attemptLimit} onChange={e => setAForm(f => ({...f,attemptLimit:Number(e.target.value)}))} />
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Time Limit (mins)</label>
              <input className="input" type="number" value={aForm.timeLimitMins} onChange={e => setAForm(f => ({...f,timeLimitMins:Number(e.target.value)}))} />
            </div>
          </div>
          <div style={{display:'flex',gap:'8px'}}>
            <button type="submit" className="btn small">Create</button>
            <button type="button" className="btn small secondary" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div style={{display:'grid',gridTemplateColumns:'240px 1fr',gap:'16px'}}>
        <div>
          <div style={{fontWeight:'700',fontSize:'12px',marginBottom:'8px',color:'var(--muted)'}}>ASSESSMENTS</div>
          {/* Search */}
          <div style={{display:'grid',gap:6,marginBottom:10}}>
            <input
              className="input"
              style={{fontSize:12,padding:'6px 10px'}}
              placeholder="Search by name..."
              value={aSearch.name}
              onChange={e => setASearch(p => ({...p, name: e.target.value}))}
            />
            <select
              className="select"
              style={{fontSize:12,padding:'6px 10px'}}
              value={aSearch.classroomId}
              onChange={e => setASearch(p => ({...p, classroomId: e.target.value}))}
            >
              <option value="">All classrooms</option>
              {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
            </select>
          </div>
          {(() => {
            const filteredA = assessments.filter(a => {
              const q = aSearch.name.toLowerCase();
              const cid = aSearch.classroomId;
              return (!q || a.assessmentName.toLowerCase().includes(q)) &&
                     (!cid || a.classroomId === cid);
            });
            return filteredA.length === 0
              ? <p style={{fontSize:'12px',color:'var(--muted)'}}>{assessments.length === 0 ? 'No assessments yet.' : 'No match.'}</p>
              : filteredA.map(a => (
            <div key={a.assessmentId} style={{marginBottom:'4px'}}>
              <div onClick={() => { setSelected(a); setShowBulk(false); setShowGrants(false); setMsg(''); }}
                style={{padding:'10px 12px',borderRadius:'var(--radius-sm)',cursor:'pointer',background:selected?.assessmentId===a.assessmentId?'var(--accent-soft)':'var(--card)',border:`1px solid ${selected?.assessmentId===a.assessmentId?'var(--accent)':'var(--line)'}`,fontSize:'13px',fontWeight:selected?.assessmentId===a.assessmentId?'700':'400', position:'relative'}}>
                <div style={{paddingRight:52}}>{a.assessmentName}</div>
                <div style={{fontSize:'10px',marginTop:2,color:a.moduleId?'var(--ok)':'var(--muted)'}}>
                  {a.moduleId ? '✓ Linked to module' : '⚠ Not linked'}
                </div>
                <div style={{fontSize:'10px',color:'var(--muted)',marginTop:1}}>{a._count?.questions || 0} questions</div>
                <button
                  onClick={e => { e.stopPropagation(); setAssessmentEditModal(a); setMsg(''); }}
                  style={{position:'absolute',top:8,right:30,background:'none',border:'none',color:'rgba(148,163,184,.7)',cursor:'pointer',fontSize:13,padding:'2px 4px',borderRadius:4,lineHeight:1}}
                  title="Edit assessment"
                >✏</button>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteModal({ assessment: a, step: 1, error: '' }); }}
                  style={{position:'absolute',top:8,right:8,background:'none',border:'none',color:'rgba(248,113,113,.6)',cursor:'pointer',fontSize:13,padding:'2px 4px',borderRadius:4,lineHeight:1}}
                  title="Delete assessment"
                >✕</button>
              </div>
            </div>
          ));
          })()}
        </div>

        <div>
          {!selected && <div style={{color:'var(--muted)',fontSize:'13px',padding:'20px'}}>Select an assessment to view questions.</div>}
          {selected && (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
                <div>
                  <span style={{fontWeight:'700'}}>{selected.assessmentName}</span>
                  <span style={{fontSize:'12px',color:'var(--muted)',marginLeft:'10px'}}>{questions.length} questions</span>
                  {selected.moduleId
                    ? <span style={{fontSize:'11px',color:'var(--ok)',marginLeft:8}}>✓ Linked</span>
                    : selected.classroomId
                      ? <span style={{fontSize:'11px',color:'var(--warn)',marginLeft:8}}>⚠ Not linked to any module — learners won't see this</span>
                      : <span style={{fontSize:'11px',color:'var(--muted)',marginLeft:8}}>◇ Standalone — no classroom yet. Broadcast it directly from the Broadcast tab, or attach a classroom below.</span>
                  }
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button className="btn small secondary" onClick={() => { setAssessmentEditModal(selected); setMsg(''); }}>Edit</button>
                  <button className="btn small secondary" onClick={() => { setShowGrants(g => !g); setShowBulk(false); setMsg(''); }}>
                    {showGrants ? 'Hide Grants' : 'Manage Attempts'}
                  </button>
                  <button className="btn small" onClick={() => { setShowBulk(b => !b); setShowGrants(false); setMsg(''); }}>
                    {showBulk ? 'Hide Upload' : '+ Bulk Upload'}
                  </button>
                </div>
              </div>
              {!selected.classroomId && (
                <AttachToClassroomPanel assessmentId={selected.assessmentId} classrooms={classrooms}
                  onAttached={a => { setSelected(a); api.get('/admin/assessments', 'admin').then(r => r.ok && setAssessments(r.data)); }} />
              )}
              {!selected.moduleId && selected.classroomId && (
                <LinkToModulePanel assessmentId={selected.assessmentId} classroomId={selected.classroomId} onLinked={a => { setSelected(a); api.get('/admin/assessments', 'admin').then(r => r.ok && setAssessments(r.data)); }} />
              )}

              {showBulk && (
                <div style={{marginBottom:'16px',background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'16px',padding:'20px'}}>
                  <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
                    <button className={`itab${bulkMode==='csv'?' active':''}`} onClick={() => setBulkMode('csv')}>CSV Upload</button>
                    <button className={`itab${bulkMode==='json'?' active':''}`} onClick={() => setBulkMode('json')}>JSON Paste</button>
                  </div>

                  {bulkMode === 'csv' && (
                    <div>
                      <button className="btn-dark" style={{marginBottom:'14px'}} onClick={downloadTemplate}>⬇ Download CSV Template</button>
                      <div
                        onDragOver={e => { e.preventDefault(); setCsvDragging(true); }}
                        onDragLeave={() => setCsvDragging(false)}
                        onDrop={e => { e.preventDefault(); setCsvDragging(false); handleCsvFile(e.dataTransfer.files[0]); }}
                        style={{border:`2px dashed ${csvDragging?'#2563eb':'#d1d5db'}`,borderRadius:'12px',padding:'32px',textAlign:'center',cursor:'pointer',transition:'all .15s',background:csvDragging?'rgba(37,99,235,.12)':'rgba(255,255,255,.04)'}}
                        onClick={() => document.getElementById('csv-file-input').click()}
                      >
                        <input id="csv-file-input" type="file" accept=".csv" style={{display:'none'}} onChange={e => handleCsvFile(e.target.files[0])} />
                        <div style={{fontSize:'24px',marginBottom:'8px'}}>📄</div>
                        <div style={{fontSize:'13px',color:'var(--ink)'}}>Drop CSV file here or click to browse</div>
                        <div style={{fontSize:'11px',color:'var(--muted)',marginTop:'4px'}}>Format: question, option_a, option_b, option_c, option_d, correct, marks, difficulty, explanation</div>
                      </div>
                      {csvPreview && (
                        <div style={{marginTop:'14px'}}>
                          <div style={{fontSize:'12px',color:'var(--muted)',marginBottom:'8px'}}>Preview ({csvPreview.total} questions total, showing first {csvPreview.rows.length}):</div>
                          <table className="glass-table">
                            <thead><tr><th>Question</th><th>Option A</th><th>Option B</th><th>Correct</th><th>Marks</th></tr></thead>
                            <tbody>{csvPreview.rows.map((r, i) => <tr key={i}><td style={{maxWidth:'200px'}}>{r.question}</td><td>{r.option_a}</td><td>{r.option_b}</td><td>{r.correct}</td><td>{r.marks}</td></tr>)}</tbody>
                          </table>
                          <div style={{marginTop:'12px',display:'flex',gap:'10px'}}>
                            <button className="btn-dark primary" onClick={uploadCsv}>Upload {csvPreview.total} Questions</button>
                            <button className="btn-dark" onClick={() => { setCsvFile(null); setCsvPreview(null); }}>Clear</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {bulkMode === 'json' && (
                    <div>
                      <textarea value={bulkJson} onChange={e => setBulkJson(e.target.value)} rows={10}
                        style={{width:'100%',background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'8px',padding:'12px',color:'rgba(255,255,255,.8)',fontSize:'12px',fontFamily:'monospace',outline:'none',resize:'vertical'}}
                        placeholder={JSON.stringify([{questionText:'What does KYC stand for?',optionA:'Know Your Customer',optionB:'Keep Your Cash',optionC:'Know Your Compliance',optionD:'Key Year Check',correctOption:'A',marks:1,difficulty:'Easy',explanation:'KYC = Know Your Customer.'}], null, 2)} />
                      <div style={{marginTop:'8px',display:'flex',gap:'8px'}}>
                        <button className="btn-dark primary" onClick={uploadBulk}>Upload JSON</button>
                        <button className="btn-dark" onClick={() => { setShowBulk(false); setBulkJson(''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showGrants && (
                <ManageAttemptsPanel key={selected.assessmentId} assessment={selected} />
              )}

              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--line)'}}>
                    <th style={{textAlign:'left',padding:'8px',fontSize:'11px',color:'var(--muted)',textTransform:'uppercase'}}>Question</th>
                    <th style={{textAlign:'left',padding:'8px',fontSize:'11px',color:'var(--muted)',textTransform:'uppercase'}}>Correct</th>
                    <th style={{textAlign:'left',padding:'8px',fontSize:'11px',color:'var(--muted)',textTransform:'uppercase'}}>Marks</th>
                    <th style={{textAlign:'left',padding:'8px',fontSize:'11px',color:'var(--muted)',textTransform:'uppercase'}}>Difficulty</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map(q => (
                    <tr key={q.questionId} style={{borderBottom:'1px solid var(--line)'}}>
                      <td style={{padding:'8px',fontSize:'12px',maxWidth:'300px'}}>{q.questionText}</td>
                      <td style={{padding:'8px',fontSize:'12px',fontWeight:'700'}}>{q.correctOption}</td>
                      <td style={{padding:'8px',fontSize:'12px'}}>{q.marks}</td>
                      <td style={{padding:'8px',fontSize:'12px'}}>{q.difficulty}</td>
                      <td style={{padding:'8px', display:'flex', gap:4}}>
                        <button className="btn small secondary" onClick={() => setEditModal(q)}>Edit</button>
                        <button className="btn small danger" onClick={() => deleteQuestion(q.questionId)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {questions.length === 0 && <p style={{fontSize:'12px',color:'var(--muted)',padding:'16px 8px'}}>No questions yet. Use Bulk Upload to add questions.</p>}
            </div>
          )}
        </div>
      </div>

      {deleteModal && (
        <DeleteAssessmentModal
          assessment={deleteModal.assessment}
          error={deleteModal.error}
          onCancel={() => setDeleteModal(null)}
          onConfirm={() => deleteAssessmentConfirmed(deleteModal.assessment.assessmentId)}
        />
      )}

      {editModal && (
        <EditQuestionModal
          question={editModal}
          saving={savingEdit}
          onClose={() => setEditModal(null)}
          onSave={saveEditedQuestion}
        />
      )}
      {assessmentEditModal && (
        <EditAssessmentModal
          assessment={assessmentEditModal}
          saving={savingAssessmentEdit}
          onClose={() => setAssessmentEditModal(null)}
          onSave={saveEditedAssessment}
        />
      )}
    </div>
  );
}

function EditQuestionModal({ question, saving, onClose, onSave }) {
  const [form, setForm] = useState({
    questionText: question.questionText || '',
    optionA: question.optionA || '',
    optionB: question.optionB || '',
    optionC: question.optionC || '',
    optionD: question.optionD || '',
    correctOption: question.correctOption || 'A',
    marks: question.marks || 1,
    difficulty: question.difficulty || 'Easy',
    explanation: question.explanation || '',
  });

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 600 }}>
        <div className="modal-head">
          <b>Edit Question</b>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form onSubmit={e => { e.preventDefault(); onSave(form); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field"><label>Question Text *</label><textarea className="input" rows={3} value={form.questionText} onChange={e => setForm(p => ({ ...p, questionText: e.target.value }))} required /></div>
            <div className="col-2">
              <div className="field"><label>Option A *</label><input className="input" value={form.optionA} onChange={e => setForm(p => ({ ...p, optionA: e.target.value }))} required /></div>
              <div className="field"><label>Option B *</label><input className="input" value={form.optionB} onChange={e => setForm(p => ({ ...p, optionB: e.target.value }))} required /></div>
              <div className="field"><label>Option C</label><input className="input" value={form.optionC} onChange={e => setForm(p => ({ ...p, optionC: e.target.value }))} /></div>
              <div className="field"><label>Option D</label><input className="input" value={form.optionD} onChange={e => setForm(p => ({ ...p, optionD: e.target.value }))} /></div>
            </div>
            <div className="col-2">
              <div className="field">
                <label>Correct Option *</label>
                <select className="select" value={form.correctOption} onChange={e => setForm(p => ({ ...p, correctOption: e.target.value }))}>
                  {['A', 'B', 'C', 'D'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field"><label>Marks</label><input className="input" type="number" min="0" value={form.marks} onChange={e => setForm(p => ({ ...p, marks: Number(e.target.value) }))} /></div>
              <div className="field">
                <label>Difficulty</label>
                <select className="select" value={form.difficulty} onChange={e => setForm(p => ({ ...p, difficulty: e.target.value }))}>
                  {['Easy', 'Medium', 'Hard'].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="field"><label>Explanation</label><input className="input" value={form.explanation} onChange={e => setForm(p => ({ ...p, explanation: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function DeleteAssessmentModal({ assessment, error, onCancel, onConfirm }) {
  const [step, setStep] = useState(1);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (confirm !== 'DELETE') return;
    setBusy(true);
    await onConfirm();
    setBusy(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{maxWidth:420}}>
        <div className="modal-head">
          <b style={{color:'#f87171'}}>🗑 Delete Assessment</b>
          <button className="btn small secondary" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{padding:'20px 24px'}}>
          {step === 1 && (
            <div>
              <div style={{background:'rgba(220,38,38,.12)',border:'1px solid rgba(220,38,38,.3)',borderRadius:12,padding:'14px 16px',marginBottom:18}}>
                <div style={{fontWeight:700,color:'#f87171',marginBottom:6}}>⚠ This action cannot be undone.</div>
                <div style={{fontSize:13,color:'var(--ink)',lineHeight:1.6}}>
                  Deleting <b>{assessment.assessmentName}</b> will permanently remove:
                  <ul style={{margin:'8px 0 0 16px',padding:0,fontSize:12}}>
                    <li>All {assessment._count?.questions || 0} questions</li>
                    <li>All learner attempt history and scores</li>
                    <li>The module link (learners won't see it anymore)</li>
                  </ul>
                </div>
              </div>
              <div style={{display:'flex',gap:10}}>
                <button className="btn secondary" style={{flex:1}} onClick={onCancel}>Cancel</button>
                <button style={{flex:1,background:'rgba(220,38,38,.85)',color:'#fff',border:'none',borderRadius:'var(--radius)',padding:'9px 16px',fontWeight:700,cursor:'pointer',fontSize:13}} onClick={() => setStep(2)}>
                  Proceed
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div style={{fontSize:13,color:'var(--ink)',marginBottom:14}}>
                Type <b>DELETE</b> to permanently delete <b>{assessment.assessmentName}</b>.
              </div>
              <div className="field">
                <input className="input" value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} placeholder="DELETE" />
              </div>
              {error && <div className="toast bad" style={{marginBottom:10}}>{error}</div>}
              <div style={{display:'flex',gap:10}}>
                <button className="btn secondary" style={{flex:1}} onClick={onCancel}>Cancel</button>
                <button
                  style={{flex:1,background:confirm==='DELETE'?'rgba(220,38,38,.85)':'rgba(150,150,150,.3)',color:'#fff',border:'none',borderRadius:'var(--radius)',padding:'9px 16px',fontWeight:700,cursor:'pointer',fontSize:13,transition:'background .15s'}}
                  onClick={handle}
                  disabled={busy || confirm !== 'DELETE'}
                >
                  {busy ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditAssessmentModal({ assessment, saving, onClose, onSave }) {
  const [form, setForm] = useState({
    assessmentName: assessment.assessmentName || '',
    passingPct: assessment.passingPct ?? 60,
    attemptLimit: assessment.attemptLimit ?? 3,
    timeLimitMins: assessment.timeLimitMins ?? 30,
  });

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <b>Edit Assessment</b>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form onSubmit={e => { e.preventDefault(); onSave(form); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label>Assessment Name *</label>
              <input className="input" required value={form.assessmentName} onChange={e => setForm(p => ({ ...p, assessmentName: e.target.value }))} />
            </div>
            <div className="col-2">
              <div className="field">
                <label>Passing %</label>
                <input className="input" type="number" min={0} max={100} value={form.passingPct} onChange={e => setForm(p => ({ ...p, passingPct: Number(e.target.value) }))} />
              </div>
              <div className="field">
                <label>Attempt Limit</label>
                <input className="input" type="number" min={1} value={form.attemptLimit} onChange={e => setForm(p => ({ ...p, attemptLimit: Number(e.target.value) }))} />
              </div>
              <div className="field">
                <label>Time Limit (mins)</label>
                <input className="input" type="number" min={1} value={form.timeLimitMins} onChange={e => setForm(p => ({ ...p, timeLimitMins: Number(e.target.value) }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ManageAttemptsPanel({ assessment }) {
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [traineeQuery, setTraineeQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedTrainee, setSelectedTrainee] = useState(null);
  const [extraAttempts, setExtraAttempts] = useState(1);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [panelMsg, setPanelMsg] = useState('');
  const [revoking, setRevoking] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');

  function loadGrants() {
    setLoading(true);
    api.get(`/admin/assessments/${assessment.assessmentId}/attempt-grants`, 'admin')
      .then(r => { if (r.ok) setGrants(r.data || []); setLoading(false); });
  }

  useEffect(() => { loadGrants(); }, [assessment.assessmentId]);

  useEffect(() => {
    if (!traineeQuery.trim() || traineeQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      api.get(`/admin/trainees/search?q=${encodeURIComponent(traineeQuery)}`, 'admin')
        .then(r => { setSearchResults(r.ok ? (r.data || []).slice(0, 8) : []); setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [traineeQuery]);

  async function grant() {
    if (!selectedTrainee) return;
    setSaving(true); setPanelMsg('');
    const res = await api.post(`/admin/assessments/${assessment.assessmentId}/attempt-grants`, {
      employeeId: selectedTrainee.employeeId,
      extraAttempts: Number(extraAttempts),
      reason: reason.trim() || undefined,
    }, 'admin');
    setSaving(false);
    if (res.ok) {
      setPanelMsg('Grant created.');
      setSelectedTrainee(null); setTraineeQuery(''); setExtraAttempts(1); setReason('');
      loadGrants();
    } else {
      setPanelMsg(res.message || 'Failed to create grant.');
    }
  }

  async function revoke(grantId) {
    setRevoking(grantId);
    const res = await api.post(`/admin/attempt-grants/${grantId}/revoke`, { reason: revokeReason.trim() || undefined }, 'admin');
    setRevoking(null);
    if (res.ok) { setRevokeTarget(null); setRevokeReason(''); loadGrants(); }
    else setPanelMsg(res.message || 'Failed to revoke grant.');
  }

  const activeGrants = grants.filter(g => g.active);
  const totalExtra = activeGrants.reduce((s, g) => s + (g.extraAttempts || 0), 0);

  return (
    <div style={{ marginBottom: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <b style={{ fontSize: 14 }}>Manage Attempt Grants</b>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Base limit: <b style={{ color: 'var(--ink)' }}>{assessment.attemptLimit ?? 3}</b>
          {totalExtra > 0 && <span style={{ marginLeft: 8, color: 'var(--ok)' }}>+{totalExtra} extra via active grants</span>}
        </div>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--muted)' }}>GRANT EXTRA ATTEMPTS TO A TRAINEE</div>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            className="input"
            style={{ fontSize: 12 }}
            placeholder="Search trainee by name or Employee ID..."
            value={selectedTrainee ? `${selectedTrainee.fullName} (${selectedTrainee.employeeId})` : traineeQuery}
            onChange={e => { if (selectedTrainee) setSelectedTrainee(null); setTraineeQuery(e.target.value); }}
          />
          {searching && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Searching...</div>}
          {!selectedTrainee && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, zIndex: 20, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
              {searchResults.map(t => (
                <div key={t.employeeId}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--line)' }}
                  onMouseDown={() => { setSelectedTrainee(t); setTraineeQuery(''); setSearchResults([]); }}
                >
                  <b>{t.fullName}</b> <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{t.employeeId}</span>
                  {t.batchNo && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>· {t.batchNo}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Extra Attempts (1–10)</label>
            <input className="input" style={{ fontSize: 12 }} type="number" min={1} max={10} value={extraAttempts} onChange={e => setExtraAttempts(Number(e.target.value))} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Reason <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
            <input className="input" style={{ fontSize: 12 }} placeholder="e.g. Technical issue during attempt" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <button className="btn small" onClick={grant} disabled={!selectedTrainee || saving} style={{ paddingBottom: 1 }}>
            {saving ? 'Granting...' : 'Grant'}
          </button>
        </div>
        {panelMsg && <div className={`toast ${panelMsg.toLowerCase().includes('fail') || panelMsg.toLowerCase().includes('error') ? 'bad' : 'ok'}`} style={{ marginTop: 10, fontSize: 12 }}>{panelMsg}</div>}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>Loading grants...</div>
      ) : grants.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>No attempt grants for this assessment yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Trainee</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>+Attempts</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Reason</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Granted By</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.grantId} style={{ borderBottom: '1px solid rgba(255,255,255,.04)', opacity: g.active ? 1 : 0.5 }}>
                <td style={{ padding: '8px', fontWeight: g.active ? 600 : 400 }}>{g.traineeFullName || g.employeeId}</td>
                <td style={{ padding: '8px', color: g.active ? 'var(--ok)' : 'var(--muted)', fontWeight: 700 }}>+{g.extraAttempts}</td>
                <td style={{ padding: '8px', color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.reason || '—'}</td>
                <td style={{ padding: '8px', color: 'var(--muted)' }}>{g.grantedByName || g.grantedBy}</td>
                <td style={{ padding: '8px', color: 'var(--muted)' }}>{new Date(g.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: '8px' }}>
                  {g.active
                    ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>Active</span>
                    : <span style={{ color: 'var(--muted)' }}>Revoked</span>}
                </td>
                <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                  {g.active && (
                    revokeTarget === g.grantId
                      ? <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            className="input"
                            style={{ fontSize: 11, padding: '3px 6px', width: 130 }}
                            placeholder="Reason (optional)..."
                            value={revokeReason}
                            onChange={e => setRevokeReason(e.target.value)}
                          />
                          <button className="btn small danger" onClick={() => revoke(g.grantId)} disabled={revoking === g.grantId}>
                            {revoking === g.grantId ? '...' : 'Confirm'}
                          </button>
                          <button className="btn small secondary" onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}>✕</button>
                        </span>
                      : <button className="btn small secondary" style={{ fontSize: 11 }} onClick={() => setRevokeTarget(g.grantId)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Attaches a fully standalone assessment (no classroomId at all) to a real classroom, and
// optionally a module within it, via PUT /admin/assessments/:assessmentId/attach-classroom.
// The "later if we want to add it in any classroom we should be able to" escape hatch.
function AttachToClassroomPanel({ assessmentId, classrooms, onAttached }) {
  const [show, setShow] = useState(false);
  const [classroomId, setClassroomId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [modules, setModules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (classroomId) api.get(`/admin/classrooms/${classroomId}/modules`, 'admin').then(r => r.ok && setModules(r.data || []));
    else setModules([]);
    setModuleId('');
  }, [classroomId]);

  async function attach() {
    if (!classroomId) return;
    setSaving(true); setError('');
    const res = await api.put(`/admin/assessments/${assessmentId}/attach-classroom`, { classroomId, moduleId: moduleId || undefined }, 'admin');
    setSaving(false);
    if (res.ok) onAttached(res.data);
    else setError(res.message || 'Could not attach classroom.');
  }

  if (!show) {
    return (
      <div className="toast" style={{marginBottom:12,fontSize:12,display:'flex',alignItems:'center',gap:8}}>
        <span>This assessment is standalone — broadcast it directly, or attach it to a classroom.</span>
        <button className="btn small" onClick={() => setShow(true)}>Attach to Classroom</button>
      </div>
    );
  }

  return (
    <div style={{background:'var(--card)',border:'1px solid var(--line)',borderRadius:'var(--radius)',padding:'14px',marginBottom:'14px'}}>
      <b style={{fontSize:13}}>Attach to Classroom</b>
      <div style={{display:'flex',gap:10,marginTop:10,alignItems:'flex-end',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:160}}>
          <label style={{display:'block',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>Classroom</label>
          <select className="input" value={classroomId} onChange={e => setClassroomId(e.target.value)}>
            <option value="">-- Select classroom --</option>
            {classrooms.map(c => <option key={c.classroomId} value={c.classroomId}>{c.classroomName}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:160}}>
          <label style={{display:'block',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>Module <span style={{fontWeight:400,color:'var(--muted)'}}>(optional)</span></label>
          <select className="input" value={moduleId} disabled={!classroomId} onChange={e => setModuleId(e.target.value)}>
            <option value="">-- No module link --</option>
            {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} · {m.moduleTitle}</option>)}
          </select>
        </div>
        <button className="btn small" onClick={attach} disabled={saving || !classroomId}>{saving ? 'Attaching...' : 'Attach'}</button>
        <button className="btn small secondary" onClick={() => setShow(false)}>Cancel</button>
      </div>
      {error && <div style={{fontSize:11,color:'var(--danger)',marginTop:8}}>{error}</div>}
    </div>
  );
}

function LinkToModulePanel({ assessmentId, classroomId, onLinked }) {
  const [modules, setModules] = useState([]);
  const [moduleId, setModuleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (show && classroomId) {
      api.get(`/admin/classrooms/${classroomId}/modules`, 'admin').then(r => r.ok && setModules(r.data || []));
    }
  }, [show, classroomId]);

  async function link() {
    if (!moduleId) return;
    setSaving(true);
    const res = await api.put(`/admin/assessments/${assessmentId}`, { moduleId }, 'admin');
    setSaving(false);
    if (res.ok) onLinked(res.data);
  }

  if (!show) {
    return (
      <div className="toast warn" style={{marginBottom:12,fontSize:12,display:'flex',alignItems:'center',gap:8}}>
        <span>This assessment is not linked to any module — learners cannot see it.</span>
        <button className="btn small" onClick={() => setShow(true)}>Link Now</button>
      </div>
    );
  }

  return (
    <div style={{background:'var(--card)',border:'1px solid var(--line)',borderRadius:'var(--radius)',padding:'14px',marginBottom:'14px'}}>
      <b style={{fontSize:13}}>Link to Module</b>
      <div style={{display:'flex',gap:10,marginTop:10,alignItems:'flex-end'}}>
        <div style={{flex:1}}>
          <label style={{display:'block',fontSize:'11px',fontWeight:'600',marginBottom:'4px'}}>Select Module</label>
          <select className="input" value={moduleId} onChange={e => setModuleId(e.target.value)}>
            <option value="">-- Select module --</option>
            {modules.map(m => <option key={m.moduleId} value={m.moduleId}>Day {m.dayNo} · {m.moduleTitle}</option>)}
          </select>
        </div>
        <button className="btn small" onClick={link} disabled={!moduleId || saving}>{saving ? 'Saving...' : 'Link'}</button>
        <button className="btn small secondary" onClick={() => setShow(false)}>Cancel</button>
      </div>
    </div>
  );
}
