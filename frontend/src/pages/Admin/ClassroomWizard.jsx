import { useState, useEffect, useRef } from 'react';
import { api, uploadFile } from '../../utils/api.js';

const STEPS = ['Basic Info', 'Content', 'MCQs', 'SOPs & FAQs', 'Review & Submit'];

export default function ClassroomWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Step 1 — basic info
  const [processOptions, setProcessOptions] = useState([]);
  const [lobOptions, setLobOptions] = useState([]);
  const [info, setInfo] = useState({ classroomName: '', process: '', lob: '', description: '', driveFolderId: '' });

  // Step 2 — modules/content
  const [days, setDays] = useState([]); // [{dayNo, title, desc, contents:[{...}]}]
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [driveFiles, setDriveFiles] = useState([]); // previewed from drive
  const [driveBrowsing, setDriveBrowsing] = useState(false);
  const contentFileRefs = useRef({});

  // Step 3 — MCQs per module
  // each day has .mcqs[]
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState(null);

  // Step 4 — SOPs & FAQs
  // each day has .faqs[]
  const [sopFile, setSopFile] = useState(null);
  const [sopName, setSopName] = useState('');

  // Submitted classroom
  const [created, setCreated] = useState(null); // { classroomId }

  useEffect(() => {
    api.get('/admin/process-lob', 'admin').then(r => {
      if (r.ok) {
        const procs = [...new Set(r.data.map(x => x.process).filter(Boolean))];
        setProcessOptions(procs);
      }
    });
  }, []);

  useEffect(() => {
    if (info.process) {
      api.get('/admin/process-lob', 'admin').then(r => {
        if (r.ok) {
          const lobs = r.data.filter(x => x.process === info.process).map(x => x.lob).filter(Boolean);
          setLobOptions(lobs);
        }
      });
    }
  }, [info.process]);

  // ── Helpers ──

  function addDay() {
    const next = days.length + 1;
    setDays(d => [...d, { dayNo: next, title: `Day ${next}`, desc: '', contents: [], faqs: [], mcqs: [] }]);
    setActiveDayIdx(days.length);
  }

  function removeDay(idx) {
    setDays(d => d.filter((_, i) => i !== idx).map((d2, i) => ({ ...d2, dayNo: i + 1, title: d2.title })));
    if (activeDayIdx >= idx) setActiveDayIdx(Math.max(0, activeDayIdx - 1));
  }

  function updateDay(idx, patch) {
    setDays(d => d.map((x, i) => i === idx ? { ...x, ...patch } : x));
  }

  function addContentToDay(idx, c) {
    setDays(d => d.map((x, i) => i === idx ? { ...x, contents: [...x.contents, c] } : x));
  }

  function removeContentFromDay(dayIdx, cIdx) {
    setDays(d => d.map((x, i) => i === dayIdx ? { ...x, contents: x.contents.filter((_, ci) => ci !== cIdx) } : x));
  }

  function addFaqToDay(idx, faq) {
    setDays(d => d.map((x, i) => i === idx ? { ...x, faqs: [...x.faqs, faq] } : x));
  }

  function removeFaqFromDay(dayIdx, fIdx) {
    setDays(d => d.map((x, i) => i === dayIdx ? { ...x, faqs: x.faqs.filter((_, fi) => fi !== fIdx) } : x));
  }

  function extractFolderId(raw) {
    const m = raw.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : raw.trim();
  }

  // Drive browse for current classroom folder
  async function browseDrive() {
    if (!info.driveFolderId.trim()) return setMsg('Enter a Drive Folder ID first.');
    const cleanId = extractFolderId(info.driveFolderId);
    setInfo(p => ({ ...p, driveFolderId: cleanId }));
    setDriveBrowsing(true); setMsg('');
    const res = await api.get(`/drive/folder/${cleanId}`, 'admin');
    setDriveBrowsing(false);
    if (res.ok) {
      setDriveFiles(res.data || []);
      if (!res.data?.length) setMsg('No files found in this Drive folder.');
    } else setMsg(res.message || 'Failed to list folder.');
  }

  function cleanDriveTitle(name) {
    return name.replace(/^[\d.]+[_\s-]+/, '').replace(/\.[^/.]+$/, '').trim() || name;
  }

  function addDriveFileToDay(idx, file) {
    const c = {
      contentType: file.mimeType?.includes('video') ? 'video' : file.mimeType?.includes('pdf') ? 'pdf' : file.mimeType?.includes('presentation') ? 'ppt' : 'doc',
      contentTitle: file.displayTitle || cleanDriveTitle(file.name),
      driveFileId: file.id,
      driveUrl: `https://drive.google.com/file/d/${file.id}/view`,
      playerMode: 'Auto',
      contentOrder: file.sortOrder || (days[idx]?.contents?.length || 0) + 1,
      estimatedMins: '',
      completionRulePct: 80,
      description: '',
      _source: 'drive',
    };
    addContentToDay(idx, c);
  }

  function addAllDriveFilesToDay(idx) {
    driveFiles.forEach((f, fi) => {
      const c = {
        contentType: f.mimeType?.includes('video') ? 'video' : f.mimeType?.includes('pdf') ? 'pdf' : f.mimeType?.includes('presentation') ? 'ppt' : 'doc',
        contentTitle: f.displayTitle || cleanDriveTitle(f.name),
        driveFileId: f.id,
        driveUrl: `https://drive.google.com/file/d/${f.id}/view`,
        playerMode: 'Auto',
        contentOrder: f.sortOrder || (days[idx]?.contents?.length || 0) + fi + 1,
        estimatedMins: '',
        completionRulePct: 80,
        description: '',
        _source: 'drive',
      };
      addContentToDay(idx, c);
    });
  }

  // MCQ CSV parse
  function parseCsv(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const required = ['question', 'option_a', 'option_b', 'correct'];
    if (!required.every(r => header.includes(r))) return null;
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      return {
        question: vals[header.indexOf('question')]?.trim() || '',
        optionA: vals[header.indexOf('option_a')]?.trim() || '',
        optionB: vals[header.indexOf('option_b')]?.trim() || '',
        optionC: vals[header.indexOf('option_c')]?.trim() || '',
        optionD: vals[header.indexOf('option_d')]?.trim() || '',
        correct: vals[header.indexOf('correct')]?.trim()?.toUpperCase() || 'A',
        marks: vals[header.indexOf('marks')]?.trim() || '1',
        difficulty: vals[header.indexOf('difficulty')]?.trim() || 'Medium',
      };
    }).filter(q => q.question);
  }

  function handleCsvFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      setCsvText(text);
      const parsed = parseCsv(text);
      setCsvPreview(parsed);
    };
    reader.readAsText(file);
  }

  function addCsvMcqsToDay(idx) {
    if (!csvPreview?.length) return;
    setDays(d => d.map((x, i) => i === idx ? { ...x, mcqs: [...x.mcqs, ...csvPreview] } : x));
    setCsvPreview(null); setCsvText('');
  }

  function addManualMcqToDay(idx, mcq) {
    setDays(d => d.map((x, i) => i === idx ? { ...x, mcqs: [...x.mcqs, mcq] } : x));
  }

  function removeMcqFromDay(dayIdx, mIdx) {
    setDays(d => d.map((x, i) => i === dayIdx ? { ...x, mcqs: x.mcqs.filter((_, mi) => mi !== mIdx) } : x));
  }

  function downloadCsvTemplate() {
    const content = `question,option_a,option_b,option_c,option_d,correct,marks,difficulty,explanation\nWhat does KYC stand for?,Know Your Customer,Keep Your Cash,Know Your Compliance,Key Year Check,A,1,Easy,KYC stands for Know Your Customer`;
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'MCQ_Template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Submission ──

  async function handleSubmit() {
    if (!info.classroomName) return setMsg('Classroom name is required.');
    if (days.length === 0) return setMsg('Add at least one day/module.');
    setLoading(true); setMsg('');

    // 1. Create classroom
    const clRes = await api.post('/admin/classrooms', info, 'admin');
    if (!clRes.ok) { setLoading(false); return setMsg(clRes.message || 'Failed to create classroom.'); }
    const classroomId = clRes.data?.classroomId;

    // 2. Create modules + contents + faqs + mcqs
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const modRes = await api.post(`/admin/classrooms/${classroomId}/modules`, {
        dayNo: day.dayNo,
        moduleTitle: day.title,
        moduleOrder: day.dayNo,
        description: day.desc,
      }, 'admin');
      if (!modRes.ok) continue;
      const moduleId = modRes.data?.moduleId;

      // Contents
      for (let ci = 0; ci < day.contents.length; ci++) {
        const c = day.contents[ci];
        const payload = { ...c, contentOrder: ci + 1 };
        delete payload._source;
        delete payload._file;
        if (c._file) {
          const fd = new FormData();
          fd.append('file', c._file);
          Object.entries(payload).forEach(([k, v]) => v !== undefined && v !== null && fd.append(k, String(v)));
          await uploadFile(`/admin/modules/${moduleId}/contents`, fd, 'admin');
        } else {
          await api.post(`/admin/modules/${moduleId}/contents`, payload, 'admin');
        }
      }

      // FAQs
      for (let fi = 0; fi < day.faqs.length; fi++) {
        const faq = day.faqs[fi];
        await api.post(`/admin/modules/${moduleId}/faqs`, { ...faq, sortOrder: fi + 1 }, 'admin');
      }

      // MCQs — create assessment for this module then bulk upload
      if (day.mcqs.length > 0) {
        const asmRes = await api.post('/admin/assessments', {
          classroomId,
          moduleId,
          title: `${day.title} — Assessment`,
          passMark: 60,
          maxAttempts: 3,
        }, 'admin');
        if (asmRes.ok) {
          const asmId = asmRes.data?.assessmentId;
          const csvRows = ['question,option_a,option_b,option_c,option_d,correct,marks,difficulty'];
          day.mcqs.forEach(q => {
            csvRows.push([q.question, q.optionA, q.optionB, q.optionC || '', q.optionD || '', q.correct, q.marks || '1', q.difficulty || 'Medium'].join(','));
          });
          await api.post(`/admin/assessments/${asmId}/questions/upload-csv`, { csv: csvRows.join('\n') }, 'admin');
        }
      }
    }

    // 3. Drive sync if folder ID given
    if (info.driveFolderId) {
      await api.post(`/admin/classrooms/${classroomId}/sync-drive`, { folderId: info.driveFolderId }, 'admin');
    }

    setLoading(false);
    setCreated({ classroomId, name: info.classroomName });
    setStep(5); // success
    onCreated?.();
  }

  // ── Step render ──

  const canNext = () => {
    if (step === 0) return info.classroomName.trim().length > 0;
    if (step === 1) return days.length > 0;
    return true;
  };

  if (step === 5) {
    return (
      <div className="modal-overlay">
        <div className="modal-box" style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ padding: '40px 32px' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 8 }}>Classroom Created!</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 28 }}>
              <b style={{ color: 'var(--brand)' }}>{created?.name}</b> is ready. Modules, content, MCQs and FAQs have been saved.
            </p>
            <button className="btn" onClick={onClose} style={{ minWidth: 140 }}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 820, width: '100%', maxHeight: '92vh' }}>
        {/* Header */}
        <div className="modal-head" style={{ justifyContent: 'space-between' }}>
          <div>
            <b>New Classroom Wizard</b>
            <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 12 }}>Step {step + 1} of {STEPS.length}</span>
          </div>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        {/* Step tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', overflow: 'hidden' }}>
          {STEPS.map((s, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                padding: '10px 8px',
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 700,
                cursor: i < step ? 'pointer' : 'default',
                background: i === step ? 'rgba(37,99,235,.18)' : i < step ? 'rgba(22,163,74,.15)' : 'transparent',
                color: i === step ? '#1d4ed8' : i < step ? '#16a34a' : 'var(--muted)',
                borderBottom: i === step ? '2px solid #2563eb' : '2px solid transparent',
                transition: 'all .15s',
              }}
              onClick={() => i < step && setStep(i)}
            >
              {i < step ? '✓ ' : ''}{s}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {msg && <div className="toast bad" style={{ marginBottom: 14 }}>{msg}<button style={{ marginLeft: 8, cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit' }} onClick={() => setMsg('')}>✕</button></div>}

          {/* ── Step 0: Basic Info ── */}
          {step === 0 && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>Set up the classroom basics. You can link a Google Drive folder to sync content automatically.</p>
              <div className="field"><label>Classroom Name *</label><input className="input" placeholder="e.g. MCN Banking Foundation Batch" value={info.classroomName} onChange={e => setInfo(p => ({ ...p, classroomName: e.target.value }))} /></div>
              <div className="col-2">
                <div className="field">
                  <label>Process</label>
                  <input className="input" list="proc-list" placeholder="Type or select" value={info.process} onChange={e => setInfo(p => ({ ...p, process: e.target.value }))} />
                  <datalist id="proc-list">{processOptions.map(o => <option key={o} value={o} />)}</datalist>
                </div>
                <div className="field">
                  <label>Line of Business (LOB)</label>
                  <input className="input" list="lob-list" placeholder="Type or select" value={info.lob} onChange={e => setInfo(p => ({ ...p, lob: e.target.value }))} />
                  <datalist id="lob-list">{lobOptions.map(o => <option key={o} value={o} />)}</datalist>
                </div>
              </div>
              <div className="field">
                <label>Google Drive Folder ID <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional — enables Drive sync)</span></label>
                <input className="input" placeholder="Paste folder ID or full Drive folder URL — ID is auto-extracted" value={info.driveFolderId} onChange={e => setInfo(p => ({ ...p, driveFolderId: e.target.value }))} />
              </div>
              <div className="field"><label>Description</label><textarea className="input" rows={3} placeholder="What will trainees learn in this classroom?" value={info.description} onChange={e => setInfo(p => ({ ...p, description: e.target.value }))} /></div>
            </div>
          )}

          {/* ── Step 1: Content day-wise ── */}
          {step === 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, minHeight: 420 }}>
              {/* Day list */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <b style={{ fontSize: 13 }}>Days</b>
                  <button className="btn xs" onClick={addDay}>+ Day</button>
                </div>
                {days.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Add at least one day.</p>}
                <div style={{ display: 'grid', gap: 6 }}>
                  {days.map((d, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveDayIdx(i)}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 12,
                        border: '1px solid',
                        borderColor: activeDayIdx === i ? '#2563eb' : 'var(--line)',
                        background: activeDayIdx === i ? 'rgba(37,99,235,.18)' : 'var(--card)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: activeDayIdx === i ? '#1d4ed8' : 'var(--ink)' }}>Day {d.dayNo}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{d.contents.length}c · {d.mcqs.length}q · {d.faqs.length}f</div>
                      </div>
                      <button style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }} onClick={e => { e.stopPropagation(); removeDay(i); }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Day detail */}
              <div>
                {days.length === 0 && <div className="empty" style={{ marginTop: 40 }}>Add a day to get started.</div>}
                {days.length > 0 && activeDayIdx < days.length && (
                  <DayContentEditor
                    day={days[activeDayIdx]}
                    dayIdx={activeDayIdx}
                    driveFolderId={info.driveFolderId}
                    driveFiles={driveFiles}
                    driveBrowsing={driveBrowsing}
                    onBrowseDrive={browseDrive}
                    onUpdateDay={patch => updateDay(activeDayIdx, patch)}
                    onAddContent={c => addContentToDay(activeDayIdx, c)}
                    onRemoveContent={ci => removeContentFromDay(activeDayIdx, ci)}
                    onAddDriveFile={f => addDriveFileToDay(activeDayIdx, f)}
                    onAddAllDrive={() => addAllDriveFilesToDay(activeDayIdx)}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: MCQs ── */}
          {step === 2 && (
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, minHeight: 380 }}>
              <div>
                <b style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Days</b>
                <div style={{ display: 'grid', gap: 6 }}>
                  {days.map((d, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveDayIdx(i)}
                      style={{
                        padding: '9px 12px', borderRadius: 12, border: '1px solid',
                        borderColor: activeDayIdx === i ? '#2563eb' : 'var(--line)',
                        background: activeDayIdx === i ? 'rgba(37,99,235,.18)' : 'var(--card)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: activeDayIdx === i ? '#1d4ed8' : 'var(--ink)' }}>Day {d.dayNo}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{d.mcqs.length} questions</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                {days.length === 0 && <div className="empty">No days added.</div>}
                {days.length > 0 && activeDayIdx < days.length && (
                  <McqEditor
                    day={days[activeDayIdx]}
                    dayIdx={activeDayIdx}
                    csvText={csvText}
                    csvPreview={csvPreview}
                    onCsvFile={handleCsvFile}
                    onAddCsv={() => addCsvMcqsToDay(activeDayIdx)}
                    onAddManual={q => addManualMcqToDay(activeDayIdx, q)}
                    onRemoveMcq={mi => removeMcqFromDay(activeDayIdx, mi)}
                    onDownloadTemplate={downloadCsvTemplate}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: SOPs & FAQs ── */}
          {step === 3 && (
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, minHeight: 380 }}>
              <div>
                <b style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Days</b>
                <div style={{ display: 'grid', gap: 6 }}>
                  {days.map((d, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveDayIdx(i)}
                      style={{
                        padding: '9px 12px', borderRadius: 12, border: '1px solid',
                        borderColor: activeDayIdx === i ? '#2563eb' : 'var(--line)',
                        background: activeDayIdx === i ? 'rgba(37,99,235,.18)' : 'var(--card)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: activeDayIdx === i ? '#1d4ed8' : 'var(--ink)' }}>Day {d.dayNo}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{d.faqs.length} FAQs</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                {days.length === 0 && <div className="empty">No days added.</div>}
                {days.length > 0 && activeDayIdx < days.length && (
                  <FaqEditor
                    day={days[activeDayIdx]}
                    dayIdx={activeDayIdx}
                    onAddFaq={faq => addFaqToDay(activeDayIdx, faq)}
                    onRemoveFaq={fi => removeFaqFromDay(activeDayIdx, fi)}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Step 4: Review ── */}
          {step === 4 && (
            <ReviewStep info={info} days={days} onEditContent={(dayIdx, ci, patch) => {
              setDays(d => d.map((x, i) => i === dayIdx ? {
                ...x,
                contents: x.contents.map((c, cii) => cii === ci ? { ...c, ...patch } : c)
              } : x));
            }} />
          )}
        </div>

        {/* Footer nav */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn secondary" onClick={() => step > 0 ? setStep(s => s - 1) : onClose()} disabled={loading}>
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {step === 1 && `${days.reduce((s, d) => s + d.contents.length, 0)} content items · ${days.length} days`}
            {step === 2 && `${days.reduce((s, d) => s + d.mcqs.length, 0)} total MCQs`}
          </div>
          {step < 4 ? (
            <button className="btn" onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
              Next →
            </button>
          ) : (
            <button className="btn" style={{ background: '#22c55e' }} onClick={handleSubmit} disabled={loading}>
              {loading ? 'Creating...' : '🚀 Create Classroom'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Day Content Editor sub-component ──
function DayContentEditor({ day, dayIdx, driveFolderId, driveFiles, driveBrowsing, onBrowseDrive, onUpdateDay, onAddContent, onRemoveContent, onAddDriveFile, onAddAllDrive }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ contentType: 'video', contentTitle: '', driveFileId: '', driveUrl: '', directMediaUrl: '', playerMode: 'Auto', estimatedMins: '', completionRulePct: 80, description: '' });
  const [localFile, setLocalFile] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (!form.contentTitle.trim()) return;
    const c = { ...form, _file: localFile || null };
    onAddContent(c);
    setForm({ contentType: 'video', contentTitle: '', driveFileId: '', driveUrl: '', directMediaUrl: '', playerMode: 'Auto', estimatedMins: '', completionRulePct: 80, description: '' });
    setLocalFile(null);
    setShowAddForm(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <b style={{ fontSize: 15 }}>Day {day.dayNo}</b>
          <input
            value={day.title}
            onChange={e => onUpdateDay({ title: e.target.value })}
            style={{ marginLeft: 10, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', color: 'var(--ink)', fontSize: 13 }}
            placeholder="Module title"
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {driveFolderId && (
            <button className="btn xs secondary" onClick={onBrowseDrive} disabled={driveBrowsing}>
              {driveBrowsing ? 'Loading...' : '☁ Browse Drive'}
            </button>
          )}
          <button className="btn xs" onClick={() => setShowAddForm(!showAddForm)}>+ Manual</button>
        </div>
      </div>

      {/* Drive files panel */}
      {driveFiles.length > 0 && (
        <div style={{ background: 'rgba(29,78,216,.12)', border: '1px solid rgba(96,165,250,.25)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b style={{ fontSize: 12, color: '#60a5fa' }}>☁ Drive Folder Files ({driveFiles.length})</b>
            <button className="btn xs" style={{ background: '#2563eb' }} onClick={onAddAllDrive}>+ Add All to Day {day.dayNo}</button>
          </div>
          <div style={{ display: 'grid', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {driveFiles.map((f, fi) => (
              <div key={fi} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--card-solid)', borderRadius: 8, border: '1px solid var(--line)' }}>
                <div>
                  <span style={{ fontSize: 12 }}>{f.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>{f.mimeType?.split('/').pop()}</span>
                </div>
                <button className="btn xs" onClick={() => onAddDriveFile(f)}>+ Add</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual add form */}
      {showAddForm && (
        <form onSubmit={submit} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Type</label>
              <select className="select" value={form.contentType} onChange={e => setForm(p => ({ ...p, contentType: e.target.value }))}>
                {['video', 'pdf', 'ppt', 'doc', 'link', 'html'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Est. Minutes</label>
              <input className="input" type="number" placeholder="30" value={form.estimatedMins} onChange={e => setForm(p => ({ ...p, estimatedMins: e.target.value }))} />
            </div>
            <div className="field">
              <label>Completion %</label>
              <input className="input" type="number" max="100" value={form.completionRulePct} onChange={e => setForm(p => ({ ...p, completionRulePct: e.target.value }))} />
            </div>
          </div>
          <div className="field"><label>Title *</label><input className="input" required value={form.contentTitle} onChange={e => setForm(p => ({ ...p, contentTitle: e.target.value }))} /></div>
          <div className="col-2">
            <div className="field"><label>Drive File ID</label><input className="input" placeholder="Google Drive file ID" value={form.driveFileId} onChange={e => setForm(p => ({ ...p, driveFileId: e.target.value }))} /></div>
            <div className="field"><label>Direct URL</label><input className="input" placeholder="https://..." value={form.directMediaUrl} onChange={e => setForm(p => ({ ...p, directMediaUrl: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Upload Local File</label><input type="file" onChange={e => setLocalFile(e.target.files[0])} style={{ color: 'var(--ink)' }} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn small">Add Content</button>
            <button type="button" className="btn small secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Content list */}
      {day.contents.length === 0 && !showAddForm && (
        <div className="empty">No content yet. Use "Browse Drive" or "+ Manual" to add.</div>
      )}
      <div style={{ display: 'grid', gap: 7 }}>
        {day.contents.map((c, ci) => (
          <div key={ci} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px', background: 'var(--card-solid)', borderRadius: 10, border: '1px solid var(--line)' }}>
            <div style={{ width: 28, textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>#{ci + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="content-type-badge">{c.contentType}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{c.contentTitle}</span>
                {c._source === 'drive' && <span style={{ fontSize: 10, color: '#1d4ed8' }}>☁ Drive</span>}
                {c._file && <span style={{ fontSize: 10, color: '#16a34a' }}>📁 Local</span>}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.estimatedMins || '?'}m</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Complete at {c.completionRulePct}%</span>
                <input
                  type="number"
                  placeholder="Min time (mins)"
                  title="Mandatory minimum time"
                  value={c.estimatedMins || ''}
                  onChange={e => {
                    const updated = day.contents.map((x, xi) => xi === ci ? { ...x, estimatedMins: e.target.value } : x);
                    // parent update via prop not available here — handled in review step
                  }}
                  style={{ width: 80, fontSize: 11, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', color: 'var(--ink)' }}
                />
              </div>
            </div>
            <button style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }} onClick={() => onRemoveContent(ci)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MCQ Editor ──
function McqEditor({ day, dayIdx, csvText, csvPreview, onCsvFile, onAddCsv, onAddManual, onRemoveMcq, onDownloadTemplate }) {
  const [mode, setMode] = useState('csv'); // 'csv' | 'manual'
  const [q, setQ] = useState({ question: '', optionA: '', optionB: '', optionC: '', optionD: '', correct: 'A', marks: 1, difficulty: 'Medium' });
  const dragRef = useRef();

  function submitManual(e) {
    e.preventDefault();
    if (!q.question.trim() || !q.optionA.trim() || !q.optionB.trim()) return;
    onAddManual({ ...q });
    setQ({ question: '', optionA: '', optionB: '', optionC: '', optionD: '', correct: 'A', marks: 1, difficulty: 'Medium' });
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) onCsvFile(file);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <b style={{ fontSize: 15 }}>Day {day.dayNo} — MCQs ({day.mcqs.length})</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn xs${mode === 'csv' ? '' : ' secondary'}`} onClick={() => setMode('csv')}>📤 CSV Upload</button>
          <button className={`btn xs${mode === 'manual' ? '' : ' secondary'}`} onClick={() => setMode('manual')}>✏ Manual</button>
        </div>
      </div>

      {mode === 'csv' && (
        <div>
          <div
            ref={dragRef}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            style={{ border: '2px dashed var(--line)', borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 14, transition: 'border-color .15s' }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
            <p style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>Drag &amp; drop CSV or <label style={{ color: '#1d4ed8', cursor: 'pointer' }}>browse<input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files[0] && onCsvFile(e.target.files[0])} /></label></p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Columns: question, option_a, option_b, option_c, option_d, correct, marks, difficulty</p>
          </div>
          <button className="btn small secondary" onClick={onDownloadTemplate} style={{ marginBottom: 14 }}>⬇ Download Template CSV</button>
          {csvPreview && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <b style={{ fontSize: 13, color: '#1d4ed8' }}>{csvPreview.length} questions parsed</b>
                <button className="btn small" onClick={onAddCsv}>+ Add All to Day {day.dayNo}</button>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {csvPreview.slice(0, 5).map((q2, i) => (
                  <div key={i} style={{ padding: '8px 12px', background: 'var(--card-solid)', borderRadius: 8, border: '1px solid var(--line)', fontSize: 12 }}>
                    <b>{i + 1}. {q2.question}</b>
                    <div style={{ color: 'var(--muted)', marginTop: 2 }}>A: {q2.optionA} · B: {q2.optionB} · Correct: <b style={{ color: '#4ade80' }}>{q2.correct}</b></div>
                  </div>
                ))}
                {csvPreview.length > 5 && <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>…and {csvPreview.length - 5} more</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={submitManual} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div className="field"><label>Question *</label><textarea className="input" rows={2} required value={q.question} onChange={e => setQ(p => ({ ...p, question: e.target.value }))} /></div>
          <div className="col-2">
            <div className="field"><label>Option A *</label><input className="input" required value={q.optionA} onChange={e => setQ(p => ({ ...p, optionA: e.target.value }))} /></div>
            <div className="field"><label>Option B *</label><input className="input" required value={q.optionB} onChange={e => setQ(p => ({ ...p, optionB: e.target.value }))} /></div>
            <div className="field"><label>Option C</label><input className="input" value={q.optionC} onChange={e => setQ(p => ({ ...p, optionC: e.target.value }))} /></div>
            <div className="field"><label>Option D</label><input className="input" value={q.optionD} onChange={e => setQ(p => ({ ...p, optionD: e.target.value }))} /></div>
          </div>
          <div className="col-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="field">
              <label>Correct Answer</label>
              <select className="select" value={q.correct} onChange={e => setQ(p => ({ ...p, correct: e.target.value }))}>
                {['A', 'B', 'C', 'D'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Difficulty</label>
              <select className="select" value={q.difficulty} onChange={e => setQ(p => ({ ...p, difficulty: e.target.value }))}>
                {['Easy', 'Medium', 'Hard'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label>Marks</label><input className="input" type="number" min="1" value={q.marks} onChange={e => setQ(p => ({ ...p, marks: +e.target.value }))} /></div>
          </div>
          <button type="submit" className="btn small">+ Add Question</button>
        </form>
      )}

      {/* MCQ list */}
      {day.mcqs.length > 0 && (
        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: 6 }}>
          {day.mcqs.map((q2, mi) => (
            <div key={mi} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '9px 12px', background: 'var(--card-solid)', borderRadius: 10, border: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{mi + 1}. {q2.question}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                  A: {q2.optionA} · B: {q2.optionB}
                  {q2.optionC ? ` · C: ${q2.optionC}` : ''}
                  {q2.optionD ? ` · D: ${q2.optionD}` : ''}
                  {' · '}<b style={{ color: '#16a34a' }}>✓ {q2.correct}</b>
                  {' · '}<span style={{ color: 'var(--muted)' }}>{q2.difficulty}</span>
                </div>
              </div>
              <button style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0 }} onClick={() => onRemoveMcq(mi)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FAQ Editor ──
function FaqEditor({ day, dayIdx, onAddFaq, onRemoveFaq }) {
  const [form, setForm] = useState({ question: '', answer: '' });

  function submit(e) {
    e.preventDefault();
    if (!form.question.trim() || !form.answer.trim()) return;
    onAddFaq({ ...form });
    setForm({ question: '', answer: '' });
  }

  return (
    <div>
      <b style={{ fontSize: 15, display: 'block', marginBottom: 14 }}>Day {day.dayNo} — FAQs ({day.faqs.length})</b>
      <form onSubmit={submit} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
        <div className="field"><label>Question *</label><input className="input" required value={form.question} onChange={e => setForm(p => ({ ...p, question: e.target.value }))} /></div>
        <div className="field"><label>Answer *</label><textarea className="input" rows={3} required value={form.answer} onChange={e => setForm(p => ({ ...p, answer: e.target.value }))} /></div>
        <button type="submit" className="btn small">+ Add FAQ</button>
      </form>
      {day.faqs.length === 0 && <div className="empty">No FAQs yet.</div>}
      <div style={{ display: 'grid', gap: 7 }}>
        {day.faqs.map((f, fi) => (
          <div key={fi} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 13px', background: 'var(--card-solid)', borderRadius: 10, border: '1px solid var(--line)' }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13, color: 'var(--ink)' }}>{f.question}</b>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>{f.answer}</p>
            </div>
            <button style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }} onClick={() => onRemoveFaq(fi)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Review Step ──
function ReviewStep({ info, days, onEditContent }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Classroom</div>
          <b style={{ fontSize: 15, color: 'var(--ink)' }}>{info.classroomName}</b>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{info.process}{info.lob ? ` / ${info.lob}` : ''}</p>
          {info.driveFolderId && <p style={{ fontSize: 11, color: '#1d4ed8', marginTop: 4 }}>☁ Drive: {info.driveFolderId}</p>}
        </div>
        <div style={{ padding: '14px 16px', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Summary</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              [days.length, 'Days'],
              [days.reduce((s, d) => s + d.contents.length, 0), 'Content'],
              [days.reduce((s, d) => s + d.mcqs.length, 0), 'MCQs'],
              [days.reduce((s, d) => s + d.faqs.length, 0), 'FAQs'],
            ].map(([n, l]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--brand)' }}>{n}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxHeight: 380, overflowY: 'auto', display: 'grid', gap: 14 }}>
        {days.map((day, di) => (
          <div key={di} style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1px solid var(--line)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'rgba(29,78,216,.15)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between' }}>
              <b style={{ color: '#60a5fa', fontSize: 14 }}>Day {day.dayNo} — {day.title}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{day.contents.length} content · {day.mcqs.length} MCQs · {day.faqs.length} FAQs</div>
            </div>
            {day.contents.length === 0 && <p style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)' }}>No content for this day.</p>}
            <div style={{ padding: '10px 16px', display: 'grid', gap: 8 }}>
              {day.contents.map((c, ci) => (
                <div key={ci} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 20, fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>#{ci + 1}</span>
                  <span className="content-type-badge">{c.contentType}</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>{c.contentTitle}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Min time (mins):</label>
                    <input
                      type="number"
                      min="1"
                      value={c.estimatedMins || ''}
                      onChange={e => onEditContent(di, ci, { estimatedMins: e.target.value })}
                      placeholder="—"
                      style={{ width: 64, fontSize: 12, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', color: 'var(--ink)' }}
                    />
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Complete %:</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={c.completionRulePct || 80}
                      onChange={e => onEditContent(di, ci, { completionRulePct: +e.target.value })}
                      style={{ width: 52, fontSize: 12, background: 'var(--card-solid)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', color: 'var(--ink)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
