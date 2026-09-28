import { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { api } from '../../utils/api.js';
import { BranchSelect, ProcessSelect, LobSelect, DesignationSelect, DepartmentSelect } from '../../components/OrgSelect.jsx';

const PAGE_SIZE = 20;

const STATUS_BADGE = {
  NotEnrolled: { label: 'Not Enrolled', style: { color: 'var(--muted)' } },
  EnrolledThisBatch: { label: '✓ Already Enrolled in this batch', style: { color: 'var(--ok)', fontWeight: 700 } },
  EnrolledOtherActiveBatch: { label: '⚠ Enrolled in another active batch', style: { color: '#d97706', fontWeight: 700 } },
  EnrolledOtherBatch: { label: 'Enrolled elsewhere (inactive/completed)', style: { color: 'var(--muted)' } },
};

function downloadClientCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// Full rebuild of the old single-select "Search & Enroll Existing Trainee" box:
// debounced multi-filter search with pagination, a selection tray that
// survives search/filter/page changes, paste/CSV bulk-add, an enrollment
// details form, and a review -> confirm -> success/skip-report flow. All
// against the same enroll-existing-bulk endpoint whether one trainee or
// hundreds are picked.
export default function SearchEnrollPanel({ batchNo, batch, onEnrolled }) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ department: '', process: '', lob: '', designation: '', branch: '', status: '' });
  const [page, setPage] = useState(0);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selected, setSelected] = useState(new Map()); // employeeId -> trainee row

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteResult, setPasteResult] = useState(null);
  const fileRef = useRef(null);

  const [details, setDetails] = useState({ enrollmentDate: '', trainingStartDate: '', trainerName: '', batchCode: '', trainingMode: '', remarks: '' });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    setPage(0);
  }, [q, filters.department, filters.process, filters.lob, filters.designation, filters.branch, filters.status]);

  useEffect(() => {
    if (q.trim().length > 0 && q.trim().length < 3) { setResults([]); setTotal(0); return; }
    const t = setTimeout(async () => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ batchNo, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      if (filters.department) params.set('department', filters.department);
      if (filters.process) params.set('process', filters.process);
      if (filters.lob) params.set('lob', filters.lob);
      if (filters.designation) params.set('designation', filters.designation);
      if (filters.branch) params.set('branch', filters.branch);
      if (filters.status) params.set('status', filters.status);
      const res = await api.get(`/admin/trainees/search?${params.toString()}`, 'admin');
      setLoading(false);
      if (res.ok) { setResults(res.data || []); setTotal(res.total || 0); }
      else setError(res.message || 'Search failed.');
    }, 300);
    return () => clearTimeout(t);
  }, [q, filters, page, batchNo]);

  const selectedList = useMemo(() => [...selected.values()], [selected]);

  function toggleRow(row) {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(row.employeeId)) next.delete(row.employeeId);
      else next.set(row.employeeId, row);
      return next;
    });
  }

  function removeSelected(employeeId) {
    setSelected(prev => { const next = new Map(prev); next.delete(employeeId); return next; });
  }

  function clearSelection() { setSelected(new Map()); }

  async function validatePaste() {
    const ids = [...new Set(pasteText.split(/[\n,;\t]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
    if (!ids.length) return;
    setPasteBusy(true);
    const res = await api.post('/admin/validate-employee-ids', { employeeIds: ids }, 'admin');
    setPasteBusy(false);
    if (res.ok) {
      setPasteResult({ found: res.found, notFound: res.notFound, duplicates: ids.length - new Set(ids).size });
      setSelected(prev => {
        const next = new Map(prev);
        for (const t of res.found) next.set(t.employeeId, t);
        return next;
      });
    }
  }

  function handleCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = Papa.parse(String(ev.target.result || '').trim(), { header: false, skipEmptyLines: true });
      const ids = parsed.data.flat().map(v => String(v || '').trim().toUpperCase()).filter(v => v && v !== 'EMPLOYEEID');
      setPasteText(ids.join('\n'));
    };
    reader.readAsText(file);
  }

  async function submitEnrollment(overrides = {}) {
    setEnrolling(true); setError('');
    const payload = {
      employeeIds: selectedList.map(t => t.employeeId),
      enrollmentDate: details.enrollmentDate || undefined,
      trainingStartDate: details.trainingStartDate || undefined,
      trainerName: details.trainerName || undefined,
      batchCode: details.batchCode || undefined,
      trainingMode: details.trainingMode || undefined,
      remarks: details.remarks || undefined,
      ...overrides,
    };
    const res = await api.post(`/admin/batches/${batchNo}/trainees/enroll-existing-bulk`, payload, 'admin');
    setEnrolling(false);
    if (!res.ok) { setError(res.message || 'Enrollment failed.'); return; }
    if (res.needsConfirmation === 'overrides') {
      if (window.confirm(`${res.message}\n\nProceed?`)) return submitEnrollment({ ...overrides, confirmOverrides: true });
      return;
    }
    if (res.needsConfirmation === 'capacity') {
      if (window.confirm(`${res.message}\n\nProceed anyway?`)) return submitEnrollment({ ...overrides, confirmCapacity: true });
      return;
    }
    setSummary(res.results || []);
    setReviewOpen(false);
    clearSelection();
    onEnrolled?.();
  }

  function downloadSkipReport() {
    if (!summary) return;
    const skipped = summary.filter(r => !r.ok);
    downloadClientCsv(`enrollment-skips-${batchNo}.csv`, ['Employee ID', 'Trainee Name', 'Reason'],
      skipped.map(r => [r.employeeId, r.traineeName || '', r.reason || '']));
  }

  const alreadyInBatch = selectedList.filter(t => t.enrollmentStatus === 'EnrolledThisBatch').length;

  return (
    <div className="glass-panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">Search & Enroll Existing Trainee</div>
      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '-6px 0 12px' }}>
        Find employees already in the system and enroll one or many into {batch?.batchName || batchNo}.
      </p>

      {error && <div className="toast bad" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>}

      {summary && (
        <div className="toast ok" style={{ marginBottom: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {summary.filter(r => r.ok && !r.alreadyEnrolled).length} enrolled ·{' '}
            {summary.filter(r => r.alreadyEnrolled).length} already enrolled ·{' '}
            {summary.filter(r => !r.ok).length} skipped
          </div>
          {summary.some(r => !r.ok) && (
            <button className="btn small secondary" onClick={downloadSkipReport}>⬇ Download Skip Report</button>
          )}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setSummary(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(280px,1fr)', gap: 16 }}>
        {/* Left: search + filters + results */}
        <div style={{ minWidth: 0 }}>
          <input
            className="input"
            placeholder="Search by Employee ID, Name, Email, Mobile or Process/LOB (min 3 chars)…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <div style={{ flex: '1 1 120px' }}><DepartmentSelect value={filters.department} onChange={v => setFilters(f => ({ ...f, department: v }))} placeholder="All Departments" className="input" /></div>
            <div style={{ flex: '1 1 120px' }}><DesignationSelect value={filters.designation} onChange={v => setFilters(f => ({ ...f, designation: v }))} placeholder="All Designations" className="input" /></div>
            <div style={{ flex: '1 1 120px' }}><ProcessSelect value={filters.process} onChange={v => setFilters(f => ({ ...f, process: v }))} placeholder="All Processes" className="input" /></div>
            <div style={{ flex: '1 1 120px' }}><LobSelect value={filters.lob} onChange={v => setFilters(f => ({ ...f, lob: v }))} placeholder="All LOBs" className="input" /></div>
            <div style={{ flex: '1 1 120px' }}><BranchSelect value={filters.branch} onChange={v => setFilters(f => ({ ...f, branch: v }))} placeholder="All Locations" className="input" /></div>
            <select className="input" style={{ flex: '1 1 100px', fontSize: 12 }} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              <option value="">Active + Inactive</option>
              <option value="Active">Active only</option>
              <option value="Inactive">Inactive only</option>
            </select>
          </div>

          <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', minHeight: 120 }}>
            {loading && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>Searching…</div>}
            {!loading && q.trim().length > 0 && q.trim().length < 3 && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>Type at least 3 characters to search.</div>
            )}
            {!loading && results.length === 0 && !(q.trim().length > 0 && q.trim().length < 3) && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>No trainees match these filters.</div>
            )}
            {!loading && results.map(t => {
              const badge = STATUS_BADGE[t.enrollmentStatus] || STATUS_BADGE.NotEnrolled;
              const disabled = t.enrollmentStatus === 'EnrolledThisBatch';
              return (
                <label key={t.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.7 : 1 }}>
                  <input type="checkbox" checked={selected.has(t.employeeId)} disabled={disabled} onChange={() => toggleRow(t)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t.traineeName}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      <span style={{ fontFamily: 'monospace' }}>{t.employeeId}</span>
                      {t.designation ? ` · ${t.designation}` : ''}{t.process ? ` · ${t.process}/${t.lob || ''}` : ''}{t.branch ? ` · ${t.branch}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, whiteSpace: 'nowrap', ...badge.style }}>{badge.label}</span>
                </label>
              );
            })}
          </div>
          {total > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn small secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <button className="btn small secondary" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn small secondary" onClick={() => setPasteOpen(o => !o)}>{pasteOpen ? '▾' : '▸'} Paste Employee IDs / Upload a list</button>
            {pasteOpen && (
              <div style={{ marginTop: 8 }}>
                <textarea
                  className="input" rows={3} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                  placeholder="Paste Employee IDs (one per line, or comma-separated)…"
                  value={pasteText} onChange={e => setPasteText(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="btn small" onClick={validatePaste} disabled={pasteBusy || !pasteText.trim()}>{pasteBusy ? 'Validating…' : 'Validate & Add'}</button>
                  <button className="btn small secondary" onClick={() => fileRef.current?.click()}>Upload CSV/Excel</button>
                  <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={e => handleCsvFile(e.target.files?.[0])} />
                </div>
                {pasteResult && (
                  <div style={{ fontSize: 11.5, marginTop: 6, color: 'var(--muted)' }}>
                    ✓ {pasteResult.found.length} matched and added
                    {pasteResult.notFound.length > 0 && <span style={{ color: '#dc2626' }}> · {pasteResult.notFound.length} not found: {pasteResult.notFound.slice(0, 8).join(', ')}{pasteResult.notFound.length > 8 ? '…' : ''}</span>}
                    {pasteResult.duplicates > 0 && <span> · {pasteResult.duplicates} duplicate ID(s) ignored</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: selected tray + enrollment details */}
        <div style={{ minWidth: 0 }}>
          <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', padding: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Selected ({selectedList.length})</span>
              {selectedList.length > 0 && <button className="btn small secondary" onClick={clearSelection}>Clear</button>}
            </div>
            {alreadyInBatch > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--ok)', marginBottom: 6 }}>{alreadyInBatch} already in this batch — will be skipped.</div>
            )}
            {selectedList.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>No trainees selected yet.</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {selectedList.map(t => (
                <span key={t.employeeId} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.08)', borderRadius: 999, padding: '3px 8px 3px 10px', fontSize: 11 }}>
                  {t.traineeName || t.employeeId}
                  <button onClick={() => removeSelected(t.employeeId)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 12, lineHeight: 1 }}>✕</button>
                </span>
              ))}
            </div>
          </div>

          {!reviewOpen ? (
            <button className="btn accent" style={{ width: '100%' }} disabled={selectedList.length === 0} onClick={() => setReviewOpen(true)}>
              Add to Enrollment List →
            </button>
          ) : (
            <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', padding: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Enrollment Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>Enrollment Date
                  <input type="date" className="input" style={{ width: '100%' }} value={details.enrollmentDate} onChange={e => setDetails(d => ({ ...d, enrollmentDate: e.target.value }))} />
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>Training Start Date
                  <input type="date" className="input" style={{ width: '100%' }} value={details.trainingStartDate} onChange={e => setDetails(d => ({ ...d, trainingStartDate: e.target.value }))} />
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>Trainer / Facilitator
                  <input className="input" style={{ width: '100%' }} value={details.trainerName} onChange={e => setDetails(d => ({ ...d, trainerName: e.target.value }))} />
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>Batch Code
                  <input className="input" style={{ width: '100%' }} placeholder={batchNo} value={details.batchCode} onChange={e => setDetails(d => ({ ...d, batchCode: e.target.value }))} />
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--muted)' }}>Training Mode
                  <select className="input" style={{ width: '100%' }} value={details.trainingMode} onChange={e => setDetails(d => ({ ...d, trainingMode: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Classroom">Classroom</option>
                    <option value="Virtual">Virtual</option>
                    <option value="Hybrid">Hybrid</option>
                  </select>
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--muted)', gridColumn: '1 / -1' }}>Remarks
                  <input className="input" style={{ width: '100%' }} value={details.remarks} onChange={e => setDetails(d => ({ ...d, remarks: e.target.value }))} />
                </label>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                Ready to enroll {selectedList.length - alreadyInBatch} trainee(s) into {batchNo}{alreadyInBatch > 0 ? ` (${alreadyInBatch} already enrolled will be skipped)` : ''}.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn secondary" onClick={() => setReviewOpen(false)}>Back</button>
                <button className="btn accent" style={{ flex: 1 }} disabled={enrolling} onClick={() => submitEnrollment()}>
                  {enrolling ? 'Enrolling…' : `Enroll ${selectedList.length} Trainee(s)`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
