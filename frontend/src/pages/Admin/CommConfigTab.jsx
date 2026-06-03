import { useState, useEffect } from 'react';
import { api } from '../../utils/api.js';

function Section({ title, icon, children }) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
      padding: '20px 24px', boxShadow: 'var(--shadow-sm)', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: .4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, background: checked ? '#16a34a' : '#d1d5db',
          position: 'relative', transition: 'background .2s', flexShrink: 0, cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: checked ? '#16a34a' : 'var(--muted)' }}>
        {checked ? 'Enabled' : 'Disabled'}{label ? ` — ${label}` : ''}
      </span>
    </label>
  );
}

export default function CommConfigTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testMsg, setTestMsg] = useState({});
  const [testLoading, setTestLoading] = useState({});

  const [form, setForm] = useState({
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    emailFrom: '',
    smtpEnabled: false,
    msg91AuthKey: '',
    msg91SenderId: 'MCNLMS',
    msg91TemplateId: '',
    smsEnabled: false,
    msg91WhatsappToken: '',
    msg91WhatsappIntegratedNumber: '',
    whatsappEnabled: false,
  });
  const [serverState, setServerState] = useState({});
  const [testEmail, setTestEmail] = useState('');
  const [testMobile, setTestMobile] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await api.get('/admin/comm-config', 'admin');
    setLoading(false);
    if (res.ok) {
      const d = res.data;
      setServerState(d);
      setForm(f => ({
        ...f,
        smtpHost: d.smtpHost || 'smtp.gmail.com',
        smtpPort: d.smtpPort || 587,
        smtpUser: d.smtpUser || '',
        smtpPass: '',
        emailFrom: d.emailFrom || '',
        smtpEnabled: d.smtpEnabled || false,
        msg91AuthKey: '',
        msg91SenderId: d.msg91SenderId || 'MCNLMS',
        msg91TemplateId: d.msg91TemplateId || '',
        smsEnabled: d.smsEnabled || false,
        msg91WhatsappToken: '',
        msg91WhatsappIntegratedNumber: d.msg91WhatsappIntegratedNumber || '',
        whatsappEnabled: d.whatsappEnabled || false,
      }));
    }
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await api.post('/admin/comm-config', form, 'admin');
    setSaving(false);
    setMsg(res.ok ? { type: 'ok', text: 'Configuration saved successfully.' } : { type: 'bad', text: res.message || 'Save failed.' });
    if (res.ok) load();
  }

  async function runTest(key, url, body) {
    setTestLoading(s => ({ ...s, [key]: true }));
    setTestMsg(s => ({ ...s, [key]: null }));
    const res = await api.post(url, body, 'admin');
    setTestLoading(s => ({ ...s, [key]: false }));
    setTestMsg(s => ({ ...s, [key]: res.ok ? { type: 'ok', text: res.message } : { type: 'bad', text: res.message } }));
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>Communication Configuration</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
          Configure email (SMTP), SMS (MSG91), and WhatsApp (MSG91) providers. Enable each channel individually.
          Leave credential fields blank to keep existing saved values.
        </p>
      </div>

      {msg && (
        <div className={`toast ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>
      )}

      <form onSubmit={save}>
        {/* ── Email / SMTP ── */}
        <Section title="Email (SMTP)" icon="✉️">
          <div style={{ marginBottom: 16 }}>
            <Toggle checked={form.smtpEnabled} onChange={v => set('smtpEnabled', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
            <Field label="SMTP Host">
              <input className="input" value={form.smtpHost} onChange={e => set('smtpHost', e.target.value)}
                placeholder="smtp.gmail.com" />
            </Field>
            <Field label="Port">
              <input className="input" type="number" value={form.smtpPort} onChange={e => set('smtpPort', e.target.value)}
                placeholder="587" />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="SMTP Username / Email">
              <input className="input" value={form.smtpUser} onChange={e => set('smtpUser', e.target.value)}
                placeholder="yourapp@gmail.com" autoComplete="off" />
            </Field>
            <Field label={serverState.smtpPassSet ? 'SMTP Password (leave blank to keep)' : 'SMTP Password'}>
              <input className="input" type="password" value={form.smtpPass} onChange={e => set('smtpPass', e.target.value)}
                placeholder={serverState.smtpPassSet ? '●●●●●●●● (saved)' : 'App password or SMTP password'}
                autoComplete="new-password" />
            </Field>
          </div>
          <Field label="From Address" hint="Displayed as the sender. e.g. MCN LMS <noreply@teammas.in>">
            <input className="input" value={form.emailFrom} onChange={e => set('emailFrom', e.target.value)}
              placeholder="MCN LMS <noreply@teammas.in>" />
          </Field>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <Field label="Send Test Email To">
                <input className="input" type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
                  placeholder="test@example.com" />
              </Field>
            </div>
            <div style={{ paddingBottom: 14 }}>
              <button type="button" className="btn small secondary"
                onClick={() => runTest('email', '/admin/comm-config/test-email', { testEmail })}
                disabled={testLoading.email || !testEmail}>
                {testLoading.email ? 'Sending…' : 'Send Test'}
              </button>
            </div>
          </div>
          {testMsg.email && <div className={`toast ${testMsg.email.type}`} style={{ marginTop: 4 }}>{testMsg.email.text}</div>}
        </Section>

        {/* ── SMS (MSG91) ── */}
        <Section title="SMS — MSG91" icon="📱">
          <div style={{ marginBottom: 16 }}>
            <Toggle checked={form.smsEnabled} onChange={v => set('smsEnabled', v)} />
          </div>
          <Field label={serverState.msg91AuthKeySet ? 'MSG91 Auth Key (leave blank to keep)' : 'MSG91 Auth Key'}
            hint="Get from MSG91 dashboard → Credentials → Auth Key">
            <input className="input" type="password" value={form.msg91AuthKey} onChange={e => set('msg91AuthKey', e.target.value)}
              placeholder={serverState.msg91AuthKeySet ? '●●●●●●●● (saved)' : 'Paste MSG91 auth key'}
              autoComplete="new-password" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Sender ID" hint="6-char DLT registered sender ID">
              <input className="input" value={form.msg91SenderId} onChange={e => set('msg91SenderId', e.target.value.toUpperCase())}
                placeholder="MCNLMS" maxLength={6} />
            </Field>
            <Field label="Default Template ID" hint="DLT approved template ID for event SMS">
              <input className="input" value={form.msg91TemplateId} onChange={e => set('msg91TemplateId', e.target.value)}
                placeholder="1207xxxxxxxxxxxxxxxx" />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <Field label="Send Test SMS To">
                <input className="input" type="tel" value={testMobile} onChange={e => setTestMobile(e.target.value)}
                  placeholder="9876543210" />
              </Field>
            </div>
            <div style={{ paddingBottom: 14 }}>
              <button type="button" className="btn small secondary"
                onClick={() => runTest('sms', '/admin/comm-config/test-sms', { testMobile })}
                disabled={testLoading.sms || !testMobile}>
                {testLoading.sms ? 'Sending…' : 'Send Test SMS'}
              </button>
            </div>
          </div>
          {testMsg.sms && <div className={`toast ${testMsg.sms.type}`} style={{ marginTop: 4 }}>{testMsg.sms.text}</div>}
        </Section>

        {/* ── WhatsApp (MSG91) ── */}
        <Section title="WhatsApp — MSG91" icon="💬">
          <div style={{ marginBottom: 16 }}>
            <Toggle checked={form.whatsappEnabled} onChange={v => set('whatsappEnabled', v)} />
          </div>
          <Field label={serverState.msg91WhatsappTokenSet ? 'MSG91 WhatsApp Auth Key (leave blank to keep)' : 'MSG91 WhatsApp Auth Key'}
            hint="From MSG91 dashboard → WhatsApp → API Credentials">
            <input className="input" type="password" value={form.msg91WhatsappToken} onChange={e => set('msg91WhatsappToken', e.target.value)}
              placeholder={serverState.msg91WhatsappTokenSet ? '●●●●●●●● (saved)' : 'Paste WhatsApp auth key'}
              autoComplete="new-password" />
          </Field>
          <Field label="Integrated Number (with country code)" hint="The WhatsApp business number registered in MSG91. e.g. 919876543210">
            <input className="input" value={form.msg91WhatsappIntegratedNumber} onChange={e => set('msg91WhatsappIntegratedNumber', e.target.value)}
              placeholder="919876543210" />
          </Field>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <Field label="Send Test WhatsApp To">
                <input className="input" type="tel" value={testMobile} onChange={e => setTestMobile(e.target.value)}
                  placeholder="9876543210" />
              </Field>
            </div>
            <div style={{ paddingBottom: 14 }}>
              <button type="button" className="btn small secondary"
                onClick={() => runTest('whatsapp', '/admin/comm-config/test-whatsapp', { testMobile })}
                disabled={testLoading.whatsapp || !testMobile}>
                {testLoading.whatsapp ? 'Sending…' : 'Send Test WA'}
              </button>
            </div>
          </div>
          {testMsg.whatsapp && <div className={`toast ${testMsg.whatsapp.type}`} style={{ marginTop: 4 }}>{testMsg.whatsapp.text}</div>}
        </Section>

        {/* Events reference */}
        <div style={{
          background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)',
          padding: '14px 18px', marginBottom: 20, fontSize: 12, color: 'var(--muted)',
        }}>
          <b style={{ color: 'var(--ink)' }}>Active Event Triggers:</b>
          {' '}Certification → Email + SMS + WhatsApp · Password Reset → Email + SMS · Batch Enrollment → Email + SMS.
          Enable each channel above to activate its notifications.
        </div>

        <button className="btn" type="submit" disabled={saving} style={{ minWidth: 160 }}>
          {saving ? 'Saving…' : '💾 Save Configuration'}
        </button>
      </form>
    </div>
  );
}
