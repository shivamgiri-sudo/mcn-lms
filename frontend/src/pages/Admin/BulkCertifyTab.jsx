import { useState } from 'react';
import Papa from 'papaparse';
import { api } from '../../utils/api.js';

const CSV_TEMPLATE = 'employeeId,certificationDate\nEMP001,2026-09-15\nEMP002,15/08/2026\n';

function parseCsv(text) {
  const result = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => String(h || '').trim().toLowerCase().replace(/[\s_]/g, ''),
  });
  return result.data
    .map(r => ({
      employeeId: (r.employeeid || r.empid || r.emp_id || r.employee_id || '').trim(),
      certificationDate: (r.certificationdate || r.certdate || r.date || '').trim(),
    }))
    .filter(r => r.employeeId);
}

export default function BulkCertifyTab() {
  const [rawInput, setRawInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setRawInput(ev.target.result);
    reader.readAsText(file);
  }

  function handlePreview() {
    setMsg(''); setResult(null);
    const records = parseCsv(rawInput);
    if (!records.length) return setMsg('No valid records found. Check CSV has employeeId and certificationDate columns.');
    setPreview(records);
    setMsg(`${records.length} record(s) ready to certify.`);
  }

  async function handleExecute() {
    if (!preview?.length) return;
    if (!window.confirm(`This will mark ${preview.length} trainee(s) as Certified. Proceed?`)) return;
    setBusy(true); setMsg('');
    const res = await api.post('/admin/certifications/bulk-certify', { records: preview }, 'admin');
    setBusy(false);
    if (res.ok) {
      setResult(res);
      setMsg(`✓ ${res.message}`);
      setPreview(null);
      setRawInput('');
    } else {
      setMsg(res.message || 'Bulk certify failed.');
    }
  }

  function downloadTemplate() {
    const b = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'BulkCertifyTemplate.csv';
    a.click();
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Bulk Historical Certification</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Mark existing employees as Certified with their actual certification dates. Upload a CSV with
        <code style={{ background: 'rgba(255,255,255,.08)', padding: '1px 5px', borderRadius: 4, marginLeft: 4 }}>employeeId</code> and
        <code style={{ background: 'rgba(255,255,255,.08)', padding: '1px 5px', borderRadius: 4, marginLeft: 4 }}>certificationDate</code> columns.
        Accepted date formats: <code style={{ background: 'rgba(255,255,255,.08)', padding: '1px 5px', borderRadius: 4 }}>YYYY-MM-DD</code> or <code style={{ background: 'rgba(255,255,255,.08)', padding: '1px 5px', borderRadius: 4 }}>DD/MM/YYYY</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <label className="btn small secondary" style={{ cursor: 'pointer', fontSize: 12 }}>
          Upload CSV <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
        </label>
        <button className="btn small secondary" style={{ fontSize: 12 }} onClick={downloadTemplate}>
          ⬇ Template
        </button>
      </div>

      <textarea
        value={rawInput}
        onChange={e => setRawInput(e.target.value)}
        rows={8}
        style={{
          width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 8, padding: 12, color: 'rgba(255,255,255,.8)', fontSize: 12,
          fontFamily: 'monospace', outline: 'none', resize: 'vertical', marginBottom: 10,
        }}
        placeholder={'employeeId,certificationDate\nEMP001,2026-09-15\nEMP002,15/08/2026'}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn secondary" onClick={handlePreview} disabled={!rawInput.trim()}>
          Preview
        </button>
        {preview?.length > 0 && (
          <button className="btn" style={{ background: '#22c55e' }} onClick={handleExecute} disabled={busy}>
            {busy ? 'Certifying...' : `Certify ${preview.length} Trainees`}
          </button>
        )}
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13,
          background: msg.startsWith('✓') ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)',
          color: msg.startsWith('✓') ? '#4ade80' : '#f87171',
          border: `1px solid ${msg.startsWith('✓') ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
        }}>{msg}</div>
      )}

      {preview?.length > 0 && !result && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'rgba(255,255,255,.7)' }}>
            Preview — {preview.length} record(s)
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.06)' }}>
                  {['#', 'Employee ID', 'Certification Date'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'rgba(255,255,255,.5)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 100).map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,.05)' }}>
                    <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,.35)' }}>{i + 1}</td>
                    <td style={{ padding: '5px 10px', fontWeight: 600 }}>{r.employeeId}</td>
                    <td style={{ padding: '5px 10px', color: r.certificationDate ? 'rgba(255,255,255,.8)' : '#f87171' }}>
                      {r.certificationDate || '(no date)'}
                    </td>
                  </tr>
                ))}
                {preview.length > 100 && (
                  <tr><td colSpan={3} style={{ padding: '6px 10px', color: 'rgba(255,255,255,.4)', fontStyle: 'italic' }}>
                    …and {preview.length - 100} more
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'rgba(255,255,255,.8)' }}>Import Result</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Certified', value: result.certified, color: '#22c55e' },
              { label: 'Already Certified', value: result.alreadyCertified, color: '#60a5fa' },
              { label: 'Not Found', value: result.notFound?.length ?? 0, color: '#f59e0b' },
              { label: 'Errors', value: result.errors?.length ?? 0, color: '#f87171' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: '12px 14px', textAlign: 'center', border: '1px solid rgba(255,255,255,.08)' }}>
                <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 3 }}>{label}</div>
              </div>
            ))}
          </div>

          {result.notFound?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>Not Found ({result.notFound.length})</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', fontFamily: 'monospace' }}>{result.notFound.join(', ')}</div>
            </div>
          )}

          {result.errors?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>Errors ({result.errors.length})</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 2 }}>
                  <span style={{ fontWeight: 700 }}>{e.employeeId}</span>: {e.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
