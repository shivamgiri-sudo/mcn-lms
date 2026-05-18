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
    if (res.ok) { setShowCreate(false); setMsg('Assessment created.'); api.get('/admin/assessments', 'admin').then(r => r.ok && setAssessments(r.data)); }
    else setMsg(res.message || 'Failed.');
  }

  async function uploadBulk() {
    try {
      const questions = JSON.parse(bulkJson);
      const res = await api.post(`/admin/assessments/${selected.assessmentId}/questions/upload`, { questions }, 'admin');
      if (res.ok) { setMsg(res.message); setBulkJson(''); setShowBulk(false); api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data)); }
      else setMsg(res.message || 'Failed.');
    } catch {
      setMsg('Invalid JSON format.');
    }
  }

  async function deleteQuestion(questionId) {
    if (!window.confirm('Deactivate this question?')) return;
    await api.delete(`/admin/questions/${questionId}`, 'admin');
    api.get(`/admin/assessments/${selected.assessmentId}/questions`, 'admin').then(r => r.ok && setQuestions(r.data));
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
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',marginBottom:'4px'}}>Classroom *</label>
              <select className="input" required value={aForm.classroomId} onChange={e => setAForm(f => ({...f,classroomId:e.target.value,moduleId:''}))}>
                <option value="">-- Select Classroom --</option>
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
          {assessments.length === 0 && <p style={{fontSize:'12px',color:'var(--muted)'}}>No assessments yet.</p>}
          {assessments.map(a => (
            <div key={a.assessmentId} onClick={() => { setSelected(a); setShowBulk(false); setMsg(''); }}
              style={{padding:'10px 12px',borderRadius:'var(--radius-sm)',cursor:'pointer',marginBottom:'4px',background:selected?.assessmentId===a.assessmentId?'var(--accent-soft)':'var(--card)',border:`1px solid ${selected?.assessmentId===a.assessmentId?'var(--accent)':'var(--line)'}`,fontSize:'13px',fontWeight:selected?.assessmentId===a.assessmentId?'700':'400'}}>
              <div>{a.assessmentName}</div>
              {a.moduleId
                ? <div style={{fontSize:'10px',color:'var(--ok)',marginTop:2}}>✓ Linked to module</div>
                : <div style={{fontSize:'10px',color:'var(--muted)',marginTop:2}}>Not linked to module</div>
              }
            </div>
          ))}
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
                    : <span style={{fontSize:'11px',color:'var(--warn)',marginLeft:8}}>⚠ Not linked to any module — learners won't see this</span>
                  }
                </div>
                <button className="btn small" onClick={() => { setShowBulk(!showBulk); setMsg(''); }}>
                  {showBulk ? 'Hide Upload' : '+ Bulk Upload'}
                </button>
              </div>
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
                      <td style={{padding:'8px'}}><button className="btn small danger" onClick={() => deleteQuestion(q.questionId)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {questions.length === 0 && <p style={{fontSize:'12px',color:'var(--muted)',padding:'16px 8px'}}>No questions yet. Use Bulk Upload to add questions.</p>}
            </div>
          )}
        </div>
      </div>
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
