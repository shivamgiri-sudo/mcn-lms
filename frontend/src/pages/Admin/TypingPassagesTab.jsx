import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

const DIFFICULTY_COLOR = { EASY: 'ok', MEDIUM: 'warn', HARD: 'bad' };

const SAMPLE_JSON = JSON.stringify([
  {
    "title": "Passport MRZ Line 1",
    "body": "P<GBRSMITH<<JOHN<EDWARD<<<<<<<<<<<<<<<<<<<<",
    "mode": "PASSAGE",
    "difficulty": "HARD",
    "tags": ["mrz", "passport"]
  },
  {
    "title": "Standard English Warmup",
    "body": "The quick brown fox jumps over the lazy dog.",
    "mode": "PASSAGE",
    "difficulty": "EASY",
    "tags": ["warmup"]
  }
], null, 2);

export default function TypingPassagesTab() {
  const [passages, setPassages] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importJson, setImportJson] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [filterDiff, setFilterDiff] = useState('all');
  const [showImport, setShowImport] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get('/typing/admin/passages', 'admin');
    if (res.ok) setPassages(res.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(id) {
    const res = await api.patch(`/typing/admin/passages/${id}/toggle`, {}, 'admin');
    if (res.ok) {
      setPassages(prev => prev.map(p => p.id === id ? res.data : p));
    }
  }

  async function handleImport() {
    setImportError('');
    setImportResult(null);
    let parsed;
    try {
      parsed = JSON.parse(importJson);
      if (!Array.isArray(parsed)) throw new Error('Root must be a JSON array [ ... ]');
    } catch (e) {
      setImportError('Invalid JSON: ' + e.message);
      return;
    }
    setImporting(true);
    const res = await api.post('/typing/admin/passages', { passages: parsed }, 'admin');
    setImporting(false);
    if (res.ok) {
      setImportResult(res.data);
      setImportJson('');
      load();
    } else {
      setImportError(res.error || 'Import failed');
    }
  }

  const filtered = (passages || []).filter(p => {
    if (filterMode !== 'all' && p.mode !== filterMode) return false;
    if (filterDiff !== 'all' && p.difficulty !== filterDiff) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.body.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const active = filtered.filter(p => p.isActive).length;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Typing Passages</h2>
          {passages && <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: 13 }}>{active} active · {passages.length} total</p>}
        </div>
        <button className="btn small accent" onClick={() => setShowImport(v => !v)}>
          {showImport ? 'Hide Import' : '+ Import Passages'}
        </button>
      </div>

      {/* Import panel */}
      {showImport && (
        <div className="card" style={{ marginBottom: 20, padding: '18px 20px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 800 }}>Import Passages (JSON)</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>
            Paste a JSON array. Each item: <code>title</code> (required), <code>body</code> (required), <code>mode</code> (PASSAGE|TIMED_DRILL), <code>difficulty</code> (EASY|MEDIUM|HARD), <code>durationSeconds</code> (for TIMED_DRILL), <code>tags</code> (array), <code>isActive</code> (bool). Include <code>id</code> to update an existing passage.
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <button className="btn small secondary" style={{ fontSize: 11 }} onClick={() => setImportJson(SAMPLE_JSON)}>
              Load sample
            </button>
            <button className="btn small secondary" style={{ fontSize: 11 }} onClick={() => setImportJson('')}>
              Clear
            </button>
          </div>
          <textarea
            value={importJson}
            onChange={e => { setImportJson(e.target.value); setImportError(''); setImportResult(null); }}
            placeholder="Paste JSON array here…"
            rows={12}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', resize: 'vertical', boxSizing: 'border-box' }}
          />
          {importError && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: 'var(--bad-soft)', borderLeft: '3px solid var(--bad)', fontSize: 12, color: 'var(--bad)' }}>{importError}</div>
          )}
          {importResult && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: 'var(--ok-soft)', borderLeft: '3px solid var(--ok)', fontSize: 12 }}>
              ✅ Imported {importResult.created} passage{importResult.created !== 1 ? 's' : ''}{importResult.skipped > 0 ? `, ${importResult.skipped} skipped (missing title/body)` : ''}.
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn accent" onClick={handleImport} disabled={importing || !importJson.trim()}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title or body…"
          style={{ flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13 }}
        />
        <select value={filterMode} onChange={e => setFilterMode(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13 }}>
          <option value="all">All modes</option>
          <option value="PASSAGE">Passage</option>
          <option value="TIMED_DRILL">Timed Drill</option>
        </select>
        <select value={filterDiff} onChange={e => setFilterDiff(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13 }}>
          <option value="all">All difficulty</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ display: 'grid', gap: 8 }}>{[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />)}</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No passages found.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filtered.map(p => (
            <div key={p.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: p.isActive ? 1 : 0.55 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</span>
                  <span className={`pill ${DIFFICULTY_COLOR[p.difficulty] || ''}`} style={{ fontSize: 10 }}>{p.difficulty}</span>
                  <span className="pill" style={{ fontSize: 10 }}>{p.mode === 'TIMED_DRILL' ? `⏱ ${p.durationSeconds}s` : 'Passage'}</span>
                  {(Array.isArray(p.tags) ? p.tags : []).map(t => <span key={t} className="pill info" style={{ fontSize: 10 }}>{t}</span>)}
                  {!p.isActive && <span className="pill bad" style={{ fontSize: 10 }}>Inactive</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {p.body.slice(0, 120)}{p.body.length > 120 ? '…' : ''}
                </div>
              </div>
              <button
                className={`btn small ${p.isActive ? 'secondary' : 'accent'}`}
                style={{ flexShrink: 0, fontSize: 12 }}
                onClick={() => toggleActive(p.id)}
              >
                {p.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
