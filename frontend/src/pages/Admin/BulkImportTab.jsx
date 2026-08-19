import { useState } from 'react';
import Papa from 'papaparse';
import { api } from '../../utils/api.js';

const CSV_TEMPLATE = 'traineeName,employeeId,lmsId,email,mobile,batchNo,branch,process,lob\nJohn Doe,JOHNDOE001,LMS000001,john@example.com,9876543210,BATCH001,Mumbai,Support,LOB1\n';

function parseCsv(text) {
  const result = Papa.parse(text.trim(), { header: true, skipEmptyLines: true, transformHeader: h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') });
  return result.data.filter(r => r.traineename || r.name || r.fullname || r.employeeid || r.empid);
}

export default function BulkImportTab() {
  const [mode, setMode] = useState('csv');
  const [rawInput, setRawInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [existingCount, setExistingCount] = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);

  async function handlePreview() {
    setMsg(''); setResult(null);
    let records;
    if (mode === 'csv') {
      records = parseCsv(rawInput);
    } else {
      try { records = JSON.parse(rawInput); } catch { return setMsg('Invalid JSON format.'); }
    }
    if (!records.length) return setMsg('No valid records found.');
    const res = await api.post('/admin/trainees/import/preview', { records, skipDuplicates }, 'admin');
    if (res.ok) { setPreview(res.data); setExistingCount(res.existingCount); }
    else setMsg(res.message || 'Preview failed.');
  }

  async function handleExecute() {
    if (!preview?.length) return;
    setBusy(true); setMsg('');
    const records = skipDuplicates ? preview.filter(r => !r._duplicate) : preview;
    if (!records.length) { setMsg('No records to import after filtering duplicates.'); setBusy(false); return; }
    const res = await api.post('/admin/trainees/import/execute', { records, skipDuplicates }, 'admin');
    if (res.ok) { setResult(res); setMsg(`✓ ${res.message}`); setPreview(null); setRawInput(''); }
    else setMsg(res.message || 'Import failed.');
    setBusy(false);
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Bulk Trainee Import</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Import up to 500 trainees at once via CSV or JSON.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`itab${mode === 'csv' ? ' active' : ''}`} onClick={() => { setMode('csv'); setPreview(null); }}>CSV Paste</button>
        <button className={`itab${mode === 'json' ? ' active' : ''}`} onClick={() => { setMode('json'); setPreview(null); }}>JSON Array</button>
        <button className="btn small secondary" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => { const b = new Blob([CSV_TEMPLATE], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'BulkImportTemplate.csv'; a.click(); }}>⬇ Template</button>
      </div>
      {mode === 'csv' && (
        <textarea value={rawInput} onChange={e => setRawInput(e.target.value)} rows={8}
          style={{ width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 12, color: 'rgba(255,255,255,.8)', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical' }}
          placeholder="traineeName,employeeId,lmsId,email,mobile,batchNo,branch,process,lob&#10;John Doe,JOHNDOE001,LMS000001,john@example.com,9876543210,B001,Mumbai,Support,LOB1" />
      )}
      {mode === 'json' && (
        <textarea value={rawInput} onChange={e => setRawInput(e.target.value)} rows={8}
          style={{ width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 12, color: 'rgba(255,255,255,.8)', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical' }}
          placeholder={JSON.stringify([{ traineeName: 'John Doe', employeeId: 'JOHNDOE001', lmsId: 'LMS000001', email: 'john@example.com', mobile: '9876543210', batchNo: 'B001', branch: 'Mumbai', process: 'Support', lob: 'LOB1' }], null, 2)} />
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
        <button className="btn" onClick={handlePreview} disabled={!rawInput.trim() || busy}>Preview</button>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
          Skip duplicates
        </label>
      </div>
      {msg && <div className={`toast ${msg.startsWith('✓') ? 'ok' : 'bad'}`} style={{ marginTop: 12 }}>{msg}</div>}
      {preview && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Preview: {preview.length} records ({existingCount} existing)</span>
            <button className="btn primary" onClick={handleExecute} disabled={busy}>{busy ? 'Importing...' : `Import ${skipDuplicates ? preview.filter(r => !r._duplicate).length : preview.length} Records`}</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 400, overflow: 'auto' }}>
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Emp ID</th><th>LMS ID</th><th>Batch</th><th>Branch</th><th>Process</th><th>LOB</th><th>Status</th></tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} style={{ opacity: r._duplicate && skipDuplicates ? 0.4 : 1 }}>
                    <td>{i + 1}</td>
                    <td>{r.traineeName || r.name || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.employeeId || 'Auto'}</td>
                    <td style={{ fontSize: 11 }}>{r.lmsId || 'Auto'}</td>
                    <td style={{ fontSize: 11 }}>{r.batchNo || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.branch || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.process || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.lob || '—'}</td>
                    <td>{r._duplicate ? <span className="pill warn" style={{ fontSize: 10 }}>Duplicate</span> : <span className="pill ok" style={{ fontSize: 10 }}>New</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {result && (
        <div style={{ marginTop: 16, background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 12, padding: 16 }}>
          <b style={{ color: '#22c55e' }}>✓ Import Complete</b>
          <div style={{ fontSize: 13, marginTop: 6, display: 'flex', gap: 16 }}>
            <span>Created: <b>{result.created}</b></span>
            <span>Skipped: <b>{result.skipped}</b></span>
            {result.errors?.length > 0 && <span style={{ color: '#ef4444' }}>Errors: <b>{result.errors.length}</b></span>}
          </div>
          {result.errors?.length > 0 && <pre style={{ fontSize: 11, marginTop: 8, maxHeight: 120, overflow: 'auto' }}>{result.errors.map(e => `${e.record}: ${e.error}`).join('\n')}</pre>}
        </div>
      )}
    </div>
  );
}
