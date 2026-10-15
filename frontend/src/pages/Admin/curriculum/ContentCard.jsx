import { useState, useEffect } from 'react';
import TYPE_META from './constants.js';

export default function ContentCard({ c, onToggleLock, onDelete, onSave, onMoveUp, onMoveDown, onPublishVersion, onReplaceFile, isFirst, isLast }) {
  const meta = TYPE_META[c.contentType] || TYPE_META.link;
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState({ estimatedMins: c.estimatedMins ?? '', completionRulePct: c.completionRulePct ?? 80 });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [publishing, setPublishing] = useState(false);
  useEffect(() => {
    if (!editing) {
      setDraft({ estimatedMins: c.estimatedMins ?? '', completionRulePct: c.completionRulePct ?? 80 });
      setSaveErr('');
    }
  }, [c.estimatedMins, c.completionRulePct]);
  return (
    <div>
    <div style={{
      borderRadius: 12,
      border: `1.5px solid ${c.locked ? '#d97706' : 'var(--line)'}`,
      background: 'var(--card-solid)',
      padding: '14px 16px',
      display: 'flex', gap: 14, alignItems: 'flex-start',
      boxShadow: 'var(--shadow-sm)',
      transition: 'box-shadow .12s',
    }}>
      {/* Type icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 12, background: meta.bg, color: meta.color,
        display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0,
        border: `1px solid ${meta.color}22`,
      }}>
        {meta.icon}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{c.contentTitle}</span>
          {c.contentOrder > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: 'var(--card)', color: 'var(--muted)' }}>
              #{c.contentOrder}
            </span>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: meta.bg, color: meta.color }}>
            {meta.label}
          </span>
          <span title="Content version — bumping this asks every trainee who already acknowledged this content to re-acknowledge" style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
            V{c.contentVersion || 1}
          </span>
          {c.locked && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(217,119,6,.18)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.3)' }}>
              🔒 Locked
            </span>
          )}
          {!c.active && <span className="pill bad">Inactive</span>}
        </div>
        {!editing ? (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>⏱ {c.estimatedMins || '—'}m</span>
            <span>✅ Complete at {c.completionRulePct}%</span>
            <span>🎬 {c.playerMode}</span>
            {c.driveFileId && (
              <a href={`https://drive.google.com/file/d/${c.driveFileId}/view`} target="_blank" rel="noopener"
                style={{ color: 'var(--brand)', textDecoration: 'none' }}>☁ Drive ↗</a>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                ⏱ Mins
                <input
                  type="number" min="0"
                  value={draft.estimatedMins}
                  onChange={e => setDraft(p => ({ ...p, estimatedMins: e.target.value }))}
                  style={{ marginLeft: 6, width: 64, padding: '3px 7px', borderRadius: 7, border: '1.5px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 12 }}
                />
              </label>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                ✅ Complete %
                <input
                  type="number" min="1" max="100"
                  value={draft.completionRulePct}
                  onChange={e => {
                    const v = e.target.value === '' ? '' : Math.min(100, Math.max(1, Number(e.target.value)));
                    setDraft(p => ({ ...p, completionRulePct: isNaN(v) ? '' : v }));
                  }}
                  style={{ marginLeft: 6, width: 56, padding: '3px 7px', borderRadius: 7, border: '1.5px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 12 }}
                />
              </label>
            </div>
            {saveErr && (
              <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 4 }}>{saveErr}</div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            title="Edit duration & completion %"
            style={{
              border: '1.5px solid var(--line)', background: 'rgba(255,255,255,.07)', color: 'var(--muted)',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
            }}
          >
            ✎
          </button>
        ) : (
          <>
            <button
              onClick={async () => {
                setSaving(true);
                setSaveErr('');
                try {
                  await onSave(draft);
                  setEditing(false);
                } catch (err) {
                  setSaveErr(err.message || 'Save failed.');
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              title="Save"
              style={{
                border: '1.5px solid rgba(16,185,129,.5)', background: 'rgba(16,185,129,.15)', color: '#34d399',
                borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
              }}
            >
              {saving ? '…' : '✓'}
            </button>
            <button
              onClick={() => { setDraft({ estimatedMins: c.estimatedMins ?? '', completionRulePct: c.completionRulePct ?? 80 }); setEditing(false); }}
              title="Cancel"
              style={{
                border: '1.5px solid var(--line)', background: 'rgba(255,255,255,.07)', color: 'var(--muted)',
                borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
              }}
            >
              ✕
            </button>
          </>
        )}
        {onMoveUp && (
          <button onClick={onMoveUp} title="Move up"
            style={{
              border: '1.5px solid var(--line)', background: 'rgba(255,255,255,.07)', color: 'var(--muted)',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
              opacity: isFirst ? 0.3 : 1,
            }} disabled={isFirst}>▲</button>
        )}
        {onMoveDown && (
          <button onClick={onMoveDown} title="Move down"
            style={{
              border: '1.5px solid var(--line)', background: 'rgba(255,255,255,.07)', color: 'var(--muted)',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
              opacity: isLast ? 0.3 : 1,
            }} disabled={isLast}>▼</button>
        )}
        {(() => {
          const previewUrl = c.directMediaUrl || (c.driveFileId ? `https://drive.google.com/file/d/${c.driveFileId}/view` : c.driveUrl || '');
          return previewUrl ? (
            <a href={previewUrl} target="_blank" rel="noopener"
              title="Preview content"
              style={{
                border: '1.5px solid var(--line)', background: 'rgba(37,99,235,.15)', color: '#60a5fa',
                borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
              }}
            >▶</a>
          ) : null;
        })()}
        {onReplaceFile && (
          <button
            onClick={() => setReplacing(r => !r)}
            title="Replace the file (upload a new PDF / PPT / video / HTML) without deleting this content"
            style={{
              border: '1.5px solid rgba(37,99,235,.4)', background: 'rgba(37,99,235,.15)', color: '#60a5fa',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
            }}
          >
            ⬆ File
          </button>
        )}
        {onPublishVersion && (
          <button
            onClick={async () => {
              if (!window.confirm(`Publish a new version of "${c.contentTitle}"? Trainees who already acknowledged this content will be asked to re-acknowledge it.`)) return;
              setPublishing(true);
              try { await onPublishVersion(); } finally { setPublishing(false); }
            }}
            disabled={publishing}
            title="Publish new version — requires re-acknowledgement from trainees who already acknowledged this content"
            style={{
              border: '1.5px solid rgba(124,58,237,.4)', background: 'rgba(124,58,237,.15)', color: '#a78bfa',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
            }}
          >
            {publishing ? '…' : '⤴ Publish'}
          </button>
        )}
        <button
          onClick={onToggleLock}
          title={c.locked ? 'Remove sequential lock' : 'Set sequential lock'}
          style={{
            border: `1.5px solid ${c.locked ? '#d97706' : 'var(--line)'}`,
            background: c.locked ? 'rgba(245,158,11,.15)' : 'rgba(255,255,255,.07)',
            color: c.locked ? '#d97706' : 'var(--muted)',
            borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
            transition: 'all .12s',
          }}
        >
          {c.locked ? '🔒' : '🔓'}
        </button>
        <button
          onClick={onDelete}
          title="Delete content"
          style={{
            border: '1.5px solid rgba(220,38,38,.4)', background: 'rgba(220,38,38,.15)', color: '#f87171',
            borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13,
          }}
        >
          ✕
        </button>
      </div>
    </div>
    {replacing && onReplaceFile && <ReplaceFilePanel c={c} onReplace={onReplaceFile} onClose={() => setReplacing(false)} />}
    </div>
  );
}

// Swap the file behind this content item without deleting it. Progress, order, lock and
// assignments stay; re-acknowledgement is an explicit opt-in.
function ReplaceFilePanel({ c, onReplace, onClose }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState(c.contentTitle || '');
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div style={{ marginTop: 8, padding: '14px 16px', borderRadius: 12, border: '1.5px dashed var(--line)', background: 'var(--card)', display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>Replace file — {c.contentTitle}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
        Upload a new PDF, PPT, video, image or HTML file. The content item, its order and every trainee's progress are kept; only the file changes.
      </div>
      <input
        className="input" type="file"
        accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.mp4,.webm,.ogg,.mov,.jpg,.jpeg,.png,.gif,.webp,.html,.htm"
        onChange={e => { setFile(e.target.files?.[0] || null); setErr(''); }}
      />
      <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
        <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Also publish as a new version — trainees who already acknowledged this content will be asked to re-acknowledge it.</span>
      </label>
      {err && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn small accent" disabled={!file || busy}
          onClick={async () => {
            setBusy(true); setErr('');
            try { await onReplace(file, { title: title.trim(), publish }); onClose(); }
            catch (e) { setErr(e.message || 'Upload failed.'); }
            finally { setBusy(false); }
          }}
        >
          {busy ? 'Uploading…' : '⬆ Upload & replace'}
        </button>
        <button className="btn small secondary" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
