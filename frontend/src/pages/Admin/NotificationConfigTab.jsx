import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

function Toggle({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      width: 42, height: 24, borderRadius: 12,
      background: checked ? '#16a34a' : '#d1d5db',
      position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .2s',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </div>
  );
}

function Row({ label, hint, checked, onToggle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
      <Toggle checked={checked} onChange={onToggle} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
        {checked && children && <div style={{ marginTop: 10 }}>{children}</div>}
      </div>
    </div>
  );
}

function TimeInput({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <input type="time" className="input" style={{ width: 110, fontSize: 12 }}
        value={value} onChange={e => onChange(e.target.value)} />
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>IST</span>
    </label>
  );
}

function NumberInput({ label, value, onChange, min = 1, max = 30, suffix = '' }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <input type="number" className="input" style={{ width: 70, fontSize: 12 }}
        value={value} min={min} max={max} onChange={e => onChange(Number(e.target.value))} />
      {suffix && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{suffix}</span>}
    </label>
  );
}

function SectionTitle({ icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 4, paddingBottom: 8, borderBottom: '2px solid var(--line)' }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{title}</span>
    </div>
  );
}

export default function NotificationConfigTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [cfg, setCfg] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await api.get('/admin/notif-config', 'admin');
    setLoading(false);
    if (res.ok) setCfg(res.data);
  }

  function set(k, v) { setCfg(c => ({ ...c, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await api.post('/admin/notif-config', cfg, 'admin');
    setSaving(false);
    setMsg(res.ok ? { type: 'ok', text: '✓ Notification settings saved.' } : { type: 'bad', text: res.message || 'Save failed.' });
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  if (!cfg) return <div className="empty">Could not load notification config.</div>;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Notification Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
          Configure which events trigger emails/SMS and when scheduled digests fire.
          All times are in IST. Email must be enabled in <b>Communications</b> config for any of these to send.
        </p>
      </div>

      {msg && <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={save}>

        {/* ── Trainee Event Notifications ── */}
        <SectionTitle icon="📩" title="Trainee Event Notifications" />
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Sent immediately when the event occurs — email + SMS + WhatsApp (based on Communication Config).
        </p>

        <Row label="New trainee onboarded" checked={cfg.notifyOnboard} onToggle={v => set('notifyOnboard', v)}
          hint="Send login credentials (Employee ID + temp password) to trainee when their account is created." />
        <Row label="Password reset by admin" checked={cfg.notifyPasswordReset} onToggle={v => set('notifyPasswordReset', v)}
          hint="Notify trainee of their new temporary password when admin resets it." />
        <Row label="Trainee certified" checked={cfg.notifyCertification} onToggle={v => set('notifyCertification', v)}
          hint="Congratulations email + SMS + WhatsApp when coordinator marks trainee as certified." />
        <Row label="Enrolled in batch" checked={cfg.notifyBatchAssignment} onToggle={v => set('notifyBatchAssignment', v)}
          hint="Notify trainee when they are enrolled in a new batch (enroll-existing flow)." />
        <Row label="Module assigned / broadcast" checked={cfg.notifyModuleAssigned} onToggle={v => set('notifyModuleAssigned', v)}
          hint="Notify trainees when a module is broadcast-assigned to them individually (Specific Employees scope)." />

        {/* ── Scheduled Reminders ── */}
        <SectionTitle icon="⏰" title="Scheduled Reminders — Trainee" />

        <Row label="Deadline reminder" checked={cfg.deadlineReminderEnabled} onToggle={v => set('deadlineReminderEnabled', v)}
          hint="Remind trainees of assigned modules due soon.">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <TimeInput label="Send at" value={cfg.deadlineReminderTime} onChange={v => set('deadlineReminderTime', v)} />
            <NumberInput label="Days before due date" value={cfg.deadlineReminderDays} onChange={v => set('deadlineReminderDays', v)} suffix="day(s)" />
          </div>
        </Row>

        <Row label="Completion reminder" checked={cfg.completionReminderEnabled} onToggle={v => set('completionReminderEnabled', v)}
          hint="Nudge trainees who haven't had any content activity in N days and are still below 100% completion.">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <TimeInput label="Send at" value={cfg.completionReminderTime} onChange={v => set('completionReminderTime', v)} />
            <NumberInput label="Inactive for" value={cfg.completionReminderDays} onChange={v => set('completionReminderDays', v)} suffix="day(s)" />
          </div>
        </Row>

        {/* ── Coordinator / Admin Digests ── */}
        <SectionTitle icon="📊" title="Coordinator & Admin Digests" />
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Sent to coordinators (requires email field set on coordinator accounts in Coordinators page).
        </p>

        <Row label="Daily coverage digest" checked={cfg.dailyCoverageEnabled} onToggle={v => set('dailyCoverageEnabled', v)}
          hint="Each coordinator gets a daily summary of their active batches — avg completion, MCQ pass rate, attendance, at-risk count, pending activities.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TimeInput label="Send at" value={cfg.dailyCoverageTime} onChange={v => set('dailyCoverageTime', v)} />
            <div className="field" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Additional recipients (comma-separated — receive global company summary)</label>
              <input className="input" style={{ fontSize: 12 }}
                placeholder="manager@teammas.in, director@teammas.in"
                value={cfg.dailyCoverageRecipients || ''}
                onChange={e => set('dailyCoverageRecipients', e.target.value)} />
            </div>
          </div>
        </Row>

        <Row label="At-risk trainee alert" checked={cfg.coordinatorAlertEnabled} onToggle={v => set('coordinatorAlertEnabled', v)}
          hint="Coordinator receives a list of at-risk trainees in their batches. Set minimum risk level to control who gets flagged.">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <TimeInput label="Send at" value={cfg.coordinatorAlertTime} onChange={v => set('coordinatorAlertTime', v)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Minimum risk level</span>
              <select className="select" style={{ width: 130, fontSize: 12 }}
                value={cfg.coordinatorAlertMinRisk}
                onChange={e => set('coordinatorAlertMinRisk', e.target.value)}>
                <option value="CRITICAL">CRITICAL only</option>
                <option value="HIGH">HIGH + CRITICAL</option>
                <option value="WATCH">WATCH + HIGH + CRITICAL</option>
              </select>
            </label>
          </div>
        </Row>

        <Row label="Pending activities digest" checked={cfg.pendingActivityAlertEnabled} onToggle={v => set('pendingActivityAlertEnabled', v)}
          hint="Coordinator receives a list of overdue open pending activities in their batches.">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <TimeInput label="Send at" value={cfg.pendingActivityAlertTime} onChange={v => set('pendingActivityAlertTime', v)} />
            <NumberInput label="Overdue by" value={cfg.pendingActivityAlertDays} onChange={v => set('pendingActivityAlertDays', v)} suffix="day(s)" />
          </div>
        </Row>

        {/* Info box */}
        <div style={{ background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)', padding: '12px 16px', marginTop: 20, marginBottom: 20, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          <b style={{ color: 'var(--ink)' }}>Important:</b> Scheduled jobs start on server boot and fire daily at the configured IST time.
          Changes take effect from the <b>next</b> fire after you save.
          If email is disabled in <b>Communications</b> config, no notifications will send regardless of these settings.
          Coordinators need an <b>email address</b> set in their account (Coordinators page) to receive digests.
        </div>

        <button className="btn" type="submit" disabled={saving} style={{ minWidth: 180 }}>
          {saving ? 'Saving…' : '💾 Save Notification Settings'}
        </button>
      </form>
    </div>
  );
}
