import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const STEPS = ['Basic Info', 'Assign Coordinator', 'Assign Classroom', 'Add Trainees', 'Review & Submit'];

const TRAINEE_CSV_TEMPLATE = 'EmployeeID,Name,Email,Mobile\nEMP1001,John Doe,john@example.com,9876543210\nEMP1002,Jane Smith,,9876543211\n';

function parseCsvTrainees(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const empIdx = header.findIndex(h => h.includes('emp') || h.includes('id'));
  const nameIdx = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email') || h.includes('mail'));
  const mobileIdx = header.findIndex(h => h.includes('mobile') || h.includes('phone'));
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return {
      employeeId: (empIdx >= 0 ? cols[empIdx] : cols[0]) || '',
      traineeName: (nameIdx >= 0 ? cols[nameIdx] : cols[1]) || '',
      email: (emailIdx >= 0 ? cols[emailIdx] : cols[2]) || '',
      mobile: (mobileIdx >= 0 ? cols[mobileIdx] : cols[3]) || '',
    };
  }).filter(t => t.employeeId);
}

export default function BatchCreationWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Data
  const [processList, setProcessList] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [classrooms, setClassrooms] = useState([]);

  // Form state
  const [form, setForm] = useState({
    batchName: '', batchType: 'NHT', branch: '', process: '', lob: '',
    startDate: '', endDate: '', expectedTrainees: '', remarks: '',
    coordinatorLoginId: '',
    classroomId: '',
    classroomIds: [],
  });
  const [trainees, setTrainees] = useState([]); // [{employeeId, traineeName, email, mobile}]
  const [bulkText, setBulkText] = useState('');
  const [traineeForm, setTraineeForm] = useState({ employeeId: '', traineeName: '', email: '', mobile: '' });

  const [created, setCreated] = useState(null);
  const [traineeCsvDragging, setTraineeCsvDragging] = useState(false);
  const [traineeCsvPreview, setTraineeCsvPreview] = useState(null);

  useEffect(() => {
    api.get('/admin/process-lob', 'admin').then(r => r.ok && setProcessList(r.data));
    api.get('/admin/coordinators/all', 'admin').then(r => r.ok && setCoordinators(r.data));
    api.get('/admin/classrooms', 'admin').then(r => r.ok && setClassrooms(r.data));
  }, []);

  const uniqueProcesses = [...new Set(processList.map(p => p.process).filter(Boolean))];
  const lobsForProcess = processList.filter(p => p.process === form.process).map(p => p.lob);

  function addTraineeManual(e) {
    e.preventDefault();
    if (!traineeForm.employeeId.trim() || !traineeForm.traineeName.trim()) return;
    setTrainees(t => [...t, { ...traineeForm }]);
    setTraineeForm({ employeeId: '', traineeName: '', email: '', mobile: '' });
  }

  function addBulkTrainees() {
    const lines = bulkText.trim().split('\n').filter(Boolean);
    const parsed = lines.map(line => {
      const [employeeId, traineeName, email, mobile] = line.split(',').map(s => s.trim());
      return { employeeId, traineeName: traineeName || '', email: email || '', mobile: mobile || '' };
    }).filter(t => t.employeeId);
    setTrainees(prev => [...prev, ...parsed]);
    setBulkText('');
  }

  function removeTrainee(idx) {
    setTrainees(t => t.filter((_, i) => i !== idx));
  }

  const selectedCoord = coordinators.find(c => c.loginId === form.coordinatorLoginId);
  const selectedClassroom = classrooms.find(c => c.classroomId === form.classroomId);

  // The first classroom picked is the primary one; it drives the learner
  // dashboard exactly as a single classroom batch always has.
  function toggleClassroom(classroomId) {
    setForm(prev => {
      const chosen = prev.classroomIds.includes(classroomId)
        ? prev.classroomIds.filter(id => id !== classroomId)
        : [...prev.classroomIds, classroomId];
      return { ...prev, classroomIds: chosen, classroomId: chosen[0] || '' };
    });
  }

  const canNext = () => {
    if (step === 0) return form.process && form.lob;
    if (step === 1) return !!form.coordinatorLoginId;
    return true;
  };

  async function handleSubmit() {
    if (!form.coordinatorLoginId) return setMsg('Coordinator is required.');
    if (!form.process || !form.lob) return setMsg('Process and LOB are required.');
    setLoading(true); setMsg('');

    // 1. Create batch
    const batchRes = await api.post('/admin/batches', form, 'admin');
    if (!batchRes.ok) { setLoading(false); return setMsg(batchRes.message || 'Failed to create batch.'); }
    const batchNo = batchRes.data?.batchNo;

    // 2. Add trainees if any
    if (trainees.length > 0) {
      await api.post(`/admin/batches/${batchNo}/trainees/bulk`, { trainees }, 'admin');
    }

    setLoading(false);
    setCreated({ batchNo, batchName: batchRes.data?.batchName });
    setStep(5);
    onCreated?.();
  }

  if (step === 5) {
    return (
      <div className="modal-overlay">
        <div className="modal-box" style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ padding: '40px 32px' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 8 }}>Batch Created!</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
              <b style={{ color: 'var(--brand)' }}>{created?.batchNo}</b>
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 28 }}>
              Assigned to <b style={{ color: 'var(--brand)' }}>{selectedCoord?.name || form.coordinatorLoginId}</b>
              {form.classroomId && (
                <> · Classroom: <b style={{ color: 'var(--brand)' }}>{selectedClassroom?.classroomName}</b>
                  {form.classroomIds.length > 1 && <> +{form.classroomIds.length - 1} more</>}
                </>
              )}
              {trainees.length > 0 && <> · {trainees.length} trainee(s) added</>}
            </p>
            <button className="btn" onClick={onClose} style={{ minWidth: 140 }}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 780, width: '100%', maxHeight: '92vh' }}>
        {/* Header */}
        <div className="modal-head">
          <div>
            <b>New Batch Wizard</b>
            <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 12 }}>Step {step + 1} of {STEPS.length}</span>
          </div>
          <button className="btn small secondary" onClick={onClose}>✕</button>
        </div>

        {/* Step tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700,
              cursor: i < step ? 'pointer' : 'default',
              background: i === step ? 'rgba(37,99,235,.18)' : i < step ? 'rgba(22,163,74,.15)' : 'transparent',
              color: i === step ? '#1d4ed8' : i < step ? '#16a34a' : 'var(--muted)',
              borderBottom: i === step ? '2px solid #2563eb' : '2px solid transparent',
            }} onClick={() => i < step && setStep(i)}>
              {i < step ? '✓ ' : ''}{s}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {msg && <div className="toast bad" style={{ marginBottom: 14 }}>{msg}<button style={{ marginLeft: 8, cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit' }} onClick={() => setMsg('')}>✕</button></div>}

          {/* Step 0: Basic Info */}
          {step === 0 && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>Set the batch details. Process and LOB are required.</p>
              <div className="col-2">
                <div className="field">
                  <label>Process *</label>
                  <select className="select" value={form.process} onChange={e => setForm(p => ({ ...p, process: e.target.value, lob: '' }))}>
                    <option value="">Select process...</option>
                    {uniqueProcesses.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>LOB *</label>
                  <select className="select" value={form.lob} onChange={e => setForm(p => ({ ...p, lob: e.target.value }))} disabled={!form.process}>
                    <option value="">Select LOB...</option>
                    {lobsForProcess.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Batch Type</label>
                  <select className="select" value={form.batchType} onChange={e => setForm(p => ({ ...p, batchType: e.target.value }))}>
                    {['NHT', 'Refresher', 'Process Update', 'Other'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field"><label>Branch</label><input className="input" placeholder="Branch name" value={form.branch} onChange={e => setForm(p => ({ ...p, branch: e.target.value }))} /></div>
                <div className="field"><label>Start Date</label><input className="input" type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} /></div>
                <div className="field"><label>End Date (planned)</label><input className="input" type="date" value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} /></div>
                <div className="field"><label>Expected Trainees</label><input className="input" type="number" min="1" value={form.expectedTrainees} onChange={e => setForm(p => ({ ...p, expectedTrainees: e.target.value }))} /></div>
              </div>
              <div className="field"><label>Batch Name <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional — auto-generated if blank)</span></label><input className="input" placeholder="e.g. Banking May 2026 Batch" value={form.batchName} onChange={e => setForm(p => ({ ...p, batchName: e.target.value }))} /></div>
              <div className="field"><label>Remarks</label><textarea className="input" rows={2} value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} /></div>
            </div>
          )}

          {/* Step 1: Coordinator */}
          {step === 1 && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>Select the coordinator who will manage this batch. They will be notified and can manage trainee attendance, queries, and progress.</p>
              {coordinators.length === 0 && <div className="empty">No coordinators found. Add coordinator accounts first.</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {coordinators.map(c => (
                  <div
                    key={c.loginId}
                    onClick={() => setForm(p => ({ ...p, coordinatorLoginId: c.loginId }))}
                    style={{
                      padding: '14px 16px', borderRadius: 14, border: '1.5px solid',
                      borderColor: form.coordinatorLoginId === c.loginId ? '#2563eb' : 'var(--line)',
                      background: form.coordinatorLoginId === c.loginId ? 'rgba(37,99,235,.2)' : 'var(--card)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, transition: 'all .12s',
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: form.coordinatorLoginId === c.loginId ? '#2563eb' : '#e2e5ea', color: form.coordinatorLoginId === c.loginId ? '#fff' : '#374151', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>
                      {(c.name || c.loginId).slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <b style={{ fontSize: 14, color: 'var(--ink)' }}>{c.name || c.loginId}</b>
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.loginId}{c.branch ? ` · ${c.branch}` : ''}{c.process ? ` · ${c.process}` : ''}</p>
                    </div>
                    {form.coordinatorLoginId === c.loginId && <span style={{ color: 'var(--ok)', fontSize: 18 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Classroom */}
          {step === 2 && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>Optionally assign a classroom. All modules in the classroom will be auto-assigned to trainees when they join.</p>
              <div
                onClick={() => setForm(p => ({ ...p, classroomId: '', classroomIds: [] }))}
                style={{
                  padding: '12px 16px', borderRadius: 12, border: '1.5px solid',
                  borderColor: !form.classroomIds.length ? '#2563eb' : 'var(--line)',
                  background: !form.classroomIds.length ? 'rgba(37,99,235,.18)' : 'var(--card)',
                  cursor: 'pointer', marginBottom: 10,
                }}
              >
                <b style={{ fontSize: 13 }}>No Classroom</b>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Assign classroom later from batch settings</p>
                {!form.classroomIds.length && <span style={{ color: 'var(--ok)', fontSize: 14 }}>✓ Selected</span>}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {classrooms.map(c => (
                  <div
                    key={c.classroomId}
                    onClick={() => toggleClassroom(c.classroomId)}
                    style={{
                      padding: '12px 16px', borderRadius: 12, border: '1.5px solid',
                      borderColor: form.classroomIds.includes(c.classroomId) ? '#2563eb' : 'var(--line)',
                      background: form.classroomIds.includes(c.classroomId) ? 'rgba(37,99,235,.18)' : 'var(--card)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all .12s',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <b style={{ fontSize: 13, color: 'var(--ink)' }}>{c.classroomName}</b>
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {c.process}{c.lob ? ` / ${c.lob}` : ''} · {c._count?.modules || 0} modules
                        {c.driveFolderId && <span style={{ color: 'var(--brand)' }}> · ☁ Drive</span>}
                      </p>
                    </div>
                    {form.classroomIds.includes(c.classroomId) && <span style={{ color: 'var(--ok)', fontSize: 18 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Trainees */}
          {step === 3 && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>Add trainees now or later from the batch detail. Use CSV upload (drag & drop), paste, or add individually.</p>

              {/* Template download */}
              <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn small secondary" onClick={() => {
                  const blob = new Blob([TRAINEE_CSV_TEMPLATE], { type: 'text/csv' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Trainee_Upload_Template.csv'; a.click();
                }}>⬇ Download CSV Template</button>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Format: EmployeeID, Name, Email, Mobile</span>
              </div>

              {/* Drag & Drop CSV */}
              <div
                onDragOver={e => { e.preventDefault(); setTraineeCsvDragging(true); }}
                onDragLeave={() => setTraineeCsvDragging(false)}
                onDrop={e => {
                  e.preventDefault(); setTraineeCsvDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    const parsed = parseCsvTrainees(ev.target.result);
                    setTraineeCsvPreview(parsed);
                  };
                  reader.readAsText(file);
                }}
                onClick={() => document.getElementById('trainee-csv-input').click()}
                style={{
                  border: `2px dashed ${traineeCsvDragging ? '#2563eb' : 'rgba(255,255,255,.2)'}`,
                  borderRadius: 14, padding: '28px 24px', textAlign: 'center',
                  background: traineeCsvDragging ? 'rgba(37,99,235,.12)' : 'rgba(255,255,255,.04)',
                  cursor: 'pointer', marginBottom: 14, transition: 'all .15s',
                }}
              >
                <input
                  id="trainee-csv-input" type="file" accept=".csv" style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => { setTraineeCsvPreview(parseCsvTrainees(ev.target.result)); };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
                <div style={{ fontSize: 26, marginBottom: 6 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Drop CSV file here or click to browse</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Supports EmployeeID, Name, Email, Mobile columns</div>
              </div>

              {/* CSV Preview */}
              {traineeCsvPreview && traineeCsvPreview.length > 0 && (
                <div style={{ marginBottom: 14, background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{traineeCsvPreview.length} trainees found in CSV</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn small" onClick={() => { setTrainees(prev => [...prev, ...traineeCsvPreview]); setTraineeCsvPreview(null); }}>
                        + Add All to List
                      </button>
                      <button className="btn small secondary" onClick={() => setTraineeCsvPreview(null)}>Discard</button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 150, overflowY: 'auto', display: 'grid', gap: 4 }}>
                    {traineeCsvPreview.slice(0, 10).map((t, i) => (
                      <div key={i} style={{ fontSize: 11, padding: '4px 8px', background: 'rgba(255,255,255,.05)', borderRadius: 6, display: 'flex', gap: 10 }}>
                        <b style={{ color: 'var(--brand)' }}>{t.employeeId}</b>
                        <span style={{ color: 'var(--ink)' }}>{t.traineeName}</span>
                        {t.email && <span style={{ color: 'var(--muted)' }}>{t.email}</span>}
                        {t.mobile && <span style={{ color: 'var(--muted)' }}>{t.mobile}</span>}
                      </div>
                    ))}
                    {traineeCsvPreview.length > 10 && <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 8px' }}>...and {traineeCsvPreview.length - 10} more</div>}
                  </div>
                </div>
              )}

              {/* Manual add */}
              <form onSubmit={addTraineeManual} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
                <div className="field" style={{ flex: '1 1 140px', margin: 0 }}>
                  <label>Employee ID *</label>
                  <input className="input" placeholder="EMP1001" value={traineeForm.employeeId} onChange={e => setTraineeForm(p => ({ ...p, employeeId: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: '1 1 160px', margin: 0 }}>
                  <label>Name *</label>
                  <input className="input" placeholder="Full name" value={traineeForm.traineeName} onChange={e => setTraineeForm(p => ({ ...p, traineeName: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: '1 1 140px', margin: 0 }}>
                  <label>Email</label>
                  <input className="input" type="email" placeholder="optional" value={traineeForm.email} onChange={e => setTraineeForm(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: '1 1 110px', margin: 0 }}>
                  <label>Mobile</label>
                  <input className="input" placeholder="optional" value={traineeForm.mobile} onChange={e => setTraineeForm(p => ({ ...p, mobile: e.target.value }))} />
                </div>
                <button type="submit" className="btn small" style={{ flexShrink: 0, alignSelf: 'flex-end' }}>+ Add</button>
              </form>

              {/* Bulk paste */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>OR PASTE CSV (EmpID, Name, Email, Mobile)</label>
                <textarea className="input" rows={2} placeholder={"EMP1001, John Doe, john@co.com, 9876543210"} value={bulkText} onChange={e => setBulkText(e.target.value)} />
                <button className="btn small secondary" style={{ marginTop: 6 }} onClick={addBulkTrainees} disabled={!bulkText.trim()}>+ Parse &amp; Add</button>
              </div>

              {/* Trainee list */}
              {trainees.length > 0 && (
                <div>
                  <b style={{ fontSize: 13, color: 'var(--ink)', display: 'block', marginBottom: 8 }}>{trainees.length} trainees queued</b>
                  <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 6 }}>
                    {trainees.map((t, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--card)', borderRadius: 8, border: '1px solid var(--line)' }}>
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{t.employeeId}</span>
                          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>{t.traineeName}</span>
                          {t.email && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{t.email}</span>}
                        </div>
                        <button style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer' }} onClick={() => removeTrainee(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {trainees.length === 0 && <div className="empty">No trainees added yet. You can also add them after batch creation.</div>}
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>Review the batch configuration before submitting.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                {[
                  ['Batch Details', [
                    ['Process', form.process],
                    ['LOB', form.lob],
                    ['Batch Type', form.batchType],
                    ['Branch', form.branch || '—'],
                    ['Start Date', form.startDate || '—'],
                    ['End Date', form.endDate || '—'],
                    ['Expected Trainees', form.expectedTrainees || '—'],
                  ]],
                  ['Assignments', [
                    ['Coordinator', selectedCoord ? `${selectedCoord.name} (${selectedCoord.loginId})` : '—'],
                    ['Classroom', selectedClassroom ? selectedClassroom.classroomName : 'None assigned'],
                    ['Trainees to Add', `${trainees.length} upfront`],
                  ]],
                ].map(([title, rows]) => (
                  <div key={title} style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <b style={{ fontSize: 13, color: 'var(--brand)', display: 'block', marginBottom: 10 }}>{title}</b>
                    {rows.map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--muted)' }}>{label}</span>
                        <span style={{ color: 'var(--ink)', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {form.remarks && (
                <div className="info-box" style={{ marginBottom: 14 }}>
                  <b>Remarks:</b> {form.remarks}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn secondary" onClick={() => step > 0 ? setStep(s => s - 1) : onClose()} disabled={loading}>
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {step === 3 && `${trainees.length} trainee(s) queued`}
          </div>
          {step < 4 ? (
            <button className="btn" onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
              Next →
            </button>
          ) : (
            <button className="btn" style={{ background: '#2563eb' }} onClick={handleSubmit} disabled={loading}>
              {loading ? 'Creating...' : '🚀 Create Batch'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
