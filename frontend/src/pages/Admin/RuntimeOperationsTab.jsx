import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import './runtimeOperations.css';

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

const blankFlag = () => ({
  featureKey: '', displayName: '', description: '', scopeType: 'BRANCH', scopeValue: '',
  enabled: false, killSwitch: false, rolloutPercentage: 0, startsAt: '', endsAt: '', active: true,
});

export default function RuntimeOperationsTab() {
  const [data, setData] = useState({ readiness: { checks: {} }, leases: [], instances: [], flags: [], backlog: {} });
  const [form, setForm] = useState(blankFlag());
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const result = await api.get('/runtime/admin/dashboard', 'admin');
    setLoading(false);
    if (!result.ok) return setError(result.message || 'Could not load production runtime.');
    setData(result.data || {});
  }

  useEffect(() => { load(); }, []);

  function editFlag(flag) {
    setSelectedId(flag.flagId);
    setForm({
      ...blankFlag(), ...flag,
      startsAt: flag.startsAt ? new Date(flag.startsAt).toISOString().slice(0, 16) : '',
      endsAt: flag.endsAt ? new Date(flag.endsAt).toISOString().slice(0, 16) : '',
      expectedVersion: flag.versionNo,
    });
  }

  async function saveFlag(event) {
    event.preventDefault(); setBusy('save'); setMessage(''); setError('');
    const payload = {
      ...form,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      rolloutPercentage: Number(form.rolloutPercentage || 0),
    };
    const result = selectedId
      ? await api.put(`/runtime/admin/flags/${encodeURIComponent(selectedId)}`, payload, 'admin')
      : await api.post('/runtime/admin/flags', payload, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save rollout control.');
    setMessage(result.message);
    setSelectedId(''); setForm(blankFlag());
    await load();
  }

  async function toggleKill(flag) {
    const action = flag.killSwitch ? 'deactivate' : 'activate';
    if (!window.confirm(`${action} the kill switch for ${flag.displayName}?`)) return;
    setBusy(`kill-${flag.flagId}`); setError('');
    const result = await api.put(`/runtime/admin/flags/${encodeURIComponent(flag.flagId)}`, {
      ...flag,
      expectedVersion: flag.versionNo,
      killSwitch: !flag.killSwitch,
    }, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not update kill switch.');
    setMessage(result.message);
    await load();
  }

  async function releaseLease(lease) {
    const reason = window.prompt('Provide the emergency lease-release reason (minimum 20 characters):');
    if (!reason) return;
    setBusy(`lease-${lease.leaseKey}`); setError('');
    const result = await api.post(`/runtime/admin/leases/${encodeURIComponent(lease.leaseKey)}/release`, { ownerId: lease.ownerId, reason }, 'admin');
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not release runtime lease.');
    setMessage(result.message);
    await load();
  }

  const backlog = useMemo(() => {
    const sum = rows => (rows || []).reduce((total, item) => total + Number(item.count || 0), 0);
    return {
      events: sum(data.backlog?.notificationEvents),
      deliveries: sum(data.backlog?.notificationDeliveries),
      appeals: sum(data.backlog?.calibrationAppeals),
    };
  }, [data.backlog]);

  if (loading) return <div className="runtime-loading"><div className="spinner" /><p>Loading production runtime governance…</p></div>;

  return (
    <div className="runtime-ops">
      <section className={`runtime-hero ${data.readiness?.ok ? 'healthy' : 'degraded'}`}>
        <div><span>Phase 10 production controls</span><h1>Runtime & Release Operations</h1><p>Readiness, distributed worker ownership, instance telemetry and controlled feature rollout from one audited console.</p></div>
        <div className="runtime-hero-metrics"><article><span>Readiness</span><b>{data.readiness?.ok ? 'READY' : 'DEGRADED'}</b></article><article><span>Online instances</span><b>{data.instances?.filter(item => item.online).length || 0}</b></article><article><span>Active leases</span><b>{data.leases?.filter(item => item.active).length || 0}</b></article><article><span>Backlog</span><b>{backlog.events + backlog.deliveries}</b></article></div>
      </section>
      {message && <div className="toast ok">{message}</div>}
      {error && <div className="toast bad">{error}</div>}

      <section className="runtime-grid checks">
        {Object.entries(data.readiness?.checks || {}).map(([key, check]) => <article key={key}><span className={`runtime-dot ${check.ok ? 'ok' : 'bad'}`} /><div><b>{key.replaceAll(/([A-Z])/g, ' $1')}</b><p>{check.ok ? 'Healthy' : check.error || 'Readiness condition failed'}</p></div></article>)}
      </section>

      <div className="runtime-two-column">
        <section className="runtime-panel">
          <header><div><h2>Distributed worker leases</h2><p>Only the active database lease owner may execute each governed cycle.</p></div><button onClick={load}>↻</button></header>
          <div className="runtime-list">{data.leases?.map(item => <article key={item.leaseKey}><div><span className={`runtime-status ${item.active ? 'active' : 'expired'}`}>{item.active ? 'ACTIVE' : 'EXPIRED'}</span><b>{item.leaseKey}</b><small>{item.ownerId}</small></div><div><span>Generation {item.generation}</span><small>Until {formatDate(item.leaseUntil)}</small>{item.active && <button disabled={busy === `lease-${item.leaseKey}`} onClick={() => releaseLease(item)}>Emergency release</button>}</div></article>)}{!data.leases?.length && <div className="runtime-empty">No governed cycles have acquired a lease yet.</div>}</div>
        </section>
        <section className="runtime-panel">
          <header><div><h2>Runtime instances</h2><p>Web and worker heartbeats seen during the last five minutes.</p></div></header>
          <div className="runtime-instance-grid">{data.instances?.map(item => <article key={item.instanceId}><span className={`runtime-status ${item.online ? 'active' : 'expired'}`}>{item.online ? 'ONLINE' : 'STALE'}</span><b>{item.hostname} · PID {item.processId}</b><p>{item.instanceRole} · {item.status}</p><small>Seen {formatDate(item.lastSeenAt)}</small>{item.lastError && <em>{item.lastError}</em>}</article>)}</div>
        </section>
      </div>

      <section className="runtime-panel">
        <header><div><h2>Operational backlog</h2><p>Current notification and appeal work waiting for governed processing.</p></div></header>
        <div className="runtime-backlog"><article><span>Notification events</span><b>{backlog.events}</b></article><article><span>Delivery outbox</span><b>{backlog.deliveries}</b></article><article><span>Open appeals</span><b>{backlog.appeals}</b></article><article><span>Readiness duration</span><b>{data.readiness?.durationMs || 0} ms</b></article></div>
      </section>

      <div className="runtime-two-column rollout">
        <section className="runtime-panel">
          <header><div><h2>Feature rollout register</h2><p>Specific scopes override broader scopes; any matching kill switch wins.</p></div><button onClick={() => { setSelectedId(''); setForm(blankFlag()); }}>＋</button></header>
          <div className="runtime-flag-list">{data.flags?.map(flag => <button key={flag.flagId} className={selectedId === flag.flagId ? 'selected' : ''} onClick={() => editFlag(flag)}><div><span className={`runtime-status ${flag.killSwitch ? 'killed' : flag.enabled ? 'active' : 'expired'}`}>{flag.killSwitch ? 'KILLED' : flag.enabled ? 'ENABLED' : 'DISABLED'}</span><b>{flag.displayName}</b></div><p>{flag.featureKey} · {flag.scopeType} {flag.scopeValue || 'Global'}</p><small>{Number(flag.rolloutPercentage || 0).toFixed(1)}% · Version {flag.versionNo}</small><span onClick={event => { event.stopPropagation(); toggleKill(flag); }}>{flag.killSwitch ? 'Restore' : 'Kill switch'}</span></button>)}</div>
        </section>
        <form className="runtime-panel runtime-flag-form" onSubmit={saveFlag}>
          <header><div><h2>{selectedId ? 'Edit rollout control' : 'Create rollout control'}</h2><p>Use gradual percentages before full enablement.</p></div></header>
          <div className="runtime-form-grid"><label>Feature key<input required value={form.featureKey} onChange={event => setForm(item => ({ ...item, featureKey: event.target.value }))} /></label><label>Display name<input required value={form.displayName} onChange={event => setForm(item => ({ ...item, displayName: event.target.value }))} /></label></div>
          <label>Description<textarea rows="3" value={form.description || ''} onChange={event => setForm(item => ({ ...item, description: event.target.value }))} /></label>
          <div className="runtime-form-grid thirds"><label>Scope<select value={form.scopeType} onChange={event => setForm(item => ({ ...item, scopeType: event.target.value }))}><option value="GLOBAL">Global</option><option value="BRANCH">Branch</option><option value="PROCESS">Process</option><option value="LOB">LOB</option><option value="USER">User</option></select></label><label>Scope value<input disabled={form.scopeType === 'GLOBAL'} value={form.scopeValue || ''} onChange={event => setForm(item => ({ ...item, scopeValue: event.target.value }))} /></label><label>Rollout %<input type="number" min="0" max="100" step="0.01" value={form.rolloutPercentage} onChange={event => setForm(item => ({ ...item, rolloutPercentage: event.target.value }))} /></label></div>
          <div className="runtime-form-grid"><label>Start<input type="datetime-local" value={form.startsAt || ''} onChange={event => setForm(item => ({ ...item, startsAt: event.target.value }))} /></label><label>End<input type="datetime-local" value={form.endsAt || ''} onChange={event => setForm(item => ({ ...item, endsAt: event.target.value }))} /></label></div>
          <div className="runtime-checks"><label><input type="checkbox" checked={Boolean(form.enabled)} onChange={event => setForm(item => ({ ...item, enabled: event.target.checked }))} /> Enabled</label><label><input type="checkbox" checked={Boolean(form.killSwitch)} onChange={event => setForm(item => ({ ...item, killSwitch: event.target.checked }))} /> Kill switch</label><label><input type="checkbox" checked={form.active !== false} onChange={event => setForm(item => ({ ...item, active: event.target.checked }))} /> Active record</label></div>
          <button className="btn" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : selectedId ? 'Update rollout' : 'Create rollout'}</button>
        </form>
      </div>
    </div>
  );
}
