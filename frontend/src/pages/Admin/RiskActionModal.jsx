import { useState } from 'react';
import { api } from '../../utils/api.js';

// Action types mapped from riskStatus
export function riskActionType(riskStatus, level) {
  const s = riskStatus || level || '';
  if (s === 'CRITICAL') return 'notify';
  if (s === 'HIGH') return 'followup';
  if (s === 'MEDIUM') return 'monitor';
  return 'view';
}

export function riskActionLabel(riskStatus, level) {
  const s = riskStatus || level || '';
  if (s === 'CRITICAL') return 'Notify';
  if (s === 'HIGH') return 'Follow Up';
  if (s === 'MEDIUM') return 'Monitor';
  return 'View';
}

/**
 * modal: { type: 'notify'|'followup'|'monitor', trainee: { employeeId, traineeName, batchNo } }
 * onClose: () => void
 * onNavigate: (page, params) => void — used by 'view' action
 */
export default function RiskActionModal({ modal, onClose, onNavigate }) {
  const [note, setNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  if (!modal) return null;
  const { type, trainee } = modal;

  const config = {
    notify: {
      title: 'Send Urgent Notification',
      subtitle: 'Notify trainee, coordinator and management immediately.',
      notePlaceholder: 'Describe the urgent issue and the required action…',
      submitLabel: 'Send Notification',
      submitClass: 'btn danger',
    },
    followup: {
      title: 'Log Follow-Up Action',
      subtitle: 'Record the follow-up action taken for this high-risk trainee.',
      notePlaceholder: 'Describe the follow-up action or intervention…',
      showDate: true,
      submitLabel: 'Save Follow-Up',
      submitClass: 'btn primary',
    },
    monitor: {
      title: 'Add to Watch List',
      subtitle: 'Flag this trainee for closer monitoring with a note.',
      notePlaceholder: 'Note reason for monitoring (optional)…',
      submitLabel: 'Add to Watch List',
      submitClass: 'btn',
    },
  };

  const cfg = config[type];
  if (!cfg) return null;

  async function handleSubmit() {
    setBusy(true);
    setResult(null);
    let res;
    try {
      if (type === 'notify') {
        res = await api.post('/notifications/broadcast', {
          scope: 'trainee',
          scopeId: trainee.employeeId,
          batchNo: trainee.batchNo,
          message: note.trim() || 'Urgent: trainee requires immediate attention.',
          channels: ['email', 'push'],
        }, 'admin');
      } else {
        res = await api.post('/admin/risk/action', {
          employeeId: trainee.employeeId,
          batchNo: trainee.batchNo,
          actionType: type,
          note: note.trim() || null,
          followUpDate: followUpDate || null,
        }, 'admin');
      }
    } catch {
      res = { ok: false, message: 'Network error — please try again.' };
    }
    setBusy(false);
    setResult(res);
    if (res.ok) setTimeout(onClose, 1400);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--card, #1e1e2e)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{cfg.title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{cfg.subtitle}</p>

        <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{trainee.traineeName || trainee.employeeId}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{trainee.employeeId} · Batch {trainee.batchNo}</div>
        </div>

        {!result?.ok && (
          <>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder={cfg.notePlaceholder}
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 10, color: 'rgba(255,255,255,.85)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
            />
            {cfg.showDate && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Follow-up date (optional)</label>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={e => setFollowUpDate(e.target.value)}
                  style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '6px 10px', color: 'rgba(255,255,255,.85)', fontSize: 13, outline: 'none' }}
                />
              </div>
            )}
          </>
        )}

        {result && (
          <div className={`toast ${result.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 14 }}>
            {result.ok ? '✓ ' : ''}{result.message || (result.ok ? 'Done.' : 'Something went wrong.')}
          </div>
        )}

        {!result?.ok && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className={cfg.submitClass} onClick={handleSubmit} disabled={busy || (type === 'notify' && !note.trim())}>
              {busy ? 'Sending…' : cfg.submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
