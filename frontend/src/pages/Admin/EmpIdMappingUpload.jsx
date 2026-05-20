import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

function parseCsv(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return { mobile: obj.mobile || obj['mobile_number'] || '', permanentEmpId: obj.permanentempid || obj.permanent_emp_id || obj.empid || '' };
  }).filter(r => r.mobile && r.permanentEmpId);
}

export default function EmpIdMappingUpload() {
  const [tempTrainees, setTempTrainees] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [results, setResults] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { loadTempTrainees(); }, []);

  async function loadTempTrainees() {
    setLoadingList(true);
    const r = await api.get('/admin/emp-mapping/temp-trainees', 'admin');
    if (r.ok) setTempTrainees(r.data);
    setLoadingList(false);
  }

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseCsv(ev.target.result);
      setPreview(rows.slice(0, 10));
    };
    reader.readAsText(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const text = await file.text();
    const mappings = parseCsv(text);
    if (mappings.length === 0) {
      setMsg({ type: 'bad', text: 'No valid rows found. CSV needs columns: mobile, permanentEmpId' });
      setUploading(false);
      return;
    }
    const res = await api.post('/admin/emp-mapping/bulk', { mappings }, 'admin');
    setUploading(false);
    if (res.ok) {
      setResults(res.data.results);
      setMsg({ type: 'ok', text: `Mapped: ${res.data.mapped} · Errors: ${res.data.errors}` });
      loadTempTrainees();
    } else {
      setMsg({ type: 'bad', text: res.message || 'Upload failed.' });
    }
  }

  function downloadResults() {
    if (!results) return;
    const rows = [['mobile', 'permanentEmpId', 'status', 'oldEmpId', 'error']];
    results.forEach(r => rows.push([r.mobile, r.permanentEmpId, r.ok ? 'MAPPED' : 'ERROR', r.oldEmpId || '', r.error || '']));
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `emp-id-mapping-results-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Map Permanent Employee IDs</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Upload a CSV with columns <b>mobile</b> and <b>permanentEmpId</b> to bulk-assign permanent HRMS codes.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginLeft: 10, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)', padding: '22px 24px', marginBottom: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 14 }}>Upload CSV</div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          CSV must have two columns: <b>mobile</b> (10-digit) and <b>permanentEmpId</b> (new HRMS code).
        </p>
        <input type="file" accept=".csv" onChange={handleFile} style={{ marginBottom: 12 }} />
        {preview.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>PREVIEW (first {preview.length} rows)</div>
            <div className="table-wrap" style={{ maxHeight: 160, overflowY: 'auto' }}>
              <table><thead><tr><th>Mobile</th><th>Permanent Emp ID</th></tr></thead>
                <tbody>{preview.map((r, i) => <tr key={i}><td>{r.mobile}</td><td>{r.permanentEmpId}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
        <button className="btn" onClick={handleUpload} disabled={!file || uploading} style={{ marginRight: 10 }}>
          {uploading ? 'Processing…' : '⬆ Run Mapping'}
        </button>
      </div>

      {results && (
        <div style={{ background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)', padding: '22px 24px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Results</div>
            <button className="btn small secondary" onClick={downloadResults}>⬇ Download CSV</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table><thead><tr><th>Mobile</th><th>Permanent ID</th><th>Status</th><th>Old ID</th><th>Error</th></tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.mobile}</td>
                    <td>{r.permanentEmpId}</td>
                    <td><span className={`pill ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? 'MAPPED' : 'ERROR'}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.oldEmpId || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--bad)' }}>{r.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)', padding: '22px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
            Trainees with Temp IDs ({tempTrainees.length})
          </div>
          <button className="btn small secondary" onClick={loadTempTrainees} disabled={loadingList}>↺ Refresh</button>
        </div>
        {tempTrainees.length === 0 && <div className="empty">No trainees with temporary IDs.</div>}
        {tempTrainees.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Temp ID</th><th>Name</th><th>Mobile</th><th>Batch</th><th>Branch</th><th>Process</th></tr></thead>
              <tbody>
                {tempTrainees.map(t => (
                  <tr key={t.employeeId}>
                    <td><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#d97706', fontWeight: 700 }}>{t.employeeId}</span></td>
                    <td>{t.traineeName}</td>
                    <td>{t.mobile || '—'}</td>
                    <td>{t.batchNo}</td>
                    <td>{t.branch || '—'}</td>
                    <td>{t.process || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
