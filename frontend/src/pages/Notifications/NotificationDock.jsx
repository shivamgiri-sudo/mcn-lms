import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../utils/api.js';
import './notificationDock.css';

const ROLE_TOKENS = {
  trainee: 'lms_token_trainee',
  coordinator: 'lms_token_coordinator',
  admin: 'lms_token_admin',
};

const DEFAULT_PREFERENCES = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'].map(channel => ({
  eventType: '*',
  channel,
  enabled: channel === 'IN_APP' || channel === 'EMAIL',
  digestMode: 'IMMEDIATE',
  quietStart: '22:00',
  quietEnd: '07:00',
  timezone: 'Asia/Kolkata',
}));

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function resolveRole(pathname, search) {
  const requested = new URLSearchParams(search).get('role');
  if (requested && ROLE_TOKENS[requested] && localStorage.getItem(ROLE_TOKENS[requested])) return requested;
  if (pathname.startsWith('/lms') && localStorage.getItem(ROLE_TOKENS.trainee)) return 'trainee';
  if (pathname.startsWith('/coordinator') && localStorage.getItem(ROLE_TOKENS.coordinator)) return 'coordinator';
  if (pathname.startsWith('/admin') && localStorage.getItem(ROLE_TOKENS.admin)) return 'admin';
  return Object.keys(ROLE_TOKENS).find(role => localStorage.getItem(ROLE_TOKENS[role])) || '';
}

export default function NotificationDock() {
  const location = useLocation();
  const role = useMemo(() => resolveRole(location.pathname, location.search), [location.pathname, location.search]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('inbox');
  const [inbox, setInbox] = useState([]);
  const [unread, setUnread] = useState(0);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [tokens, setTokens] = useState([]);
  const [health, setHealth] = useState({ deliveries: [], events: [] });
  const [failed, setFailed] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function loadInbox() {
    if (!role) return;
    const result = await api.get('/notifications/self/inbox?limit=100', role);
    if (result.ok) {
      setInbox(result.data || []);
      setUnread(Number(result.unreadCount || 0));
    }
  }

  async function loadPreferences() {
    const result = await api.get('/notifications/self/preferences', role);
    if (!result.ok) return;
    const saved = result.data || [];
    setPreferences(DEFAULT_PREFERENCES.map(defaultItem => {
      const match = saved.find(item => item.eventType === '*' && item.channel === defaultItem.channel);
      return match ? { ...defaultItem, ...match, enabled: Boolean(match.enabled) } : defaultItem;
    }));
  }

  async function loadTokens() {
    const result = await api.get('/calendar/self/tokens', role);
    if (result.ok) setTokens(result.data || []);
  }

  async function loadHealth() {
    if (role === 'trainee') return;
    const [healthResult, failedResult] = await Promise.all([
      api.get('/notifications/scope/health', role),
      api.get('/notifications/scope/outbox?status=FAILED&limit=100', role),
    ]);
    if (healthResult.ok) setHealth(healthResult.data || { deliveries: [], events: [] });
    if (failedResult.ok) setFailed(failedResult.data || []);
  }

  useEffect(() => {
    if (!role) return undefined;
    loadInbox();
    const timer = setInterval(loadInbox, 60_000);
    return () => clearInterval(timer);
  }, [role]);

  useEffect(() => {
    if (!open || !role) return;
    setError('');
    if (tab === 'inbox') loadInbox();
    if (tab === 'preferences') loadPreferences();
    if (tab === 'calendar') loadTokens();
    if (tab === 'delivery') loadHealth();
  }, [open, tab, role]);

  if (!role || location.pathname === '/reset-password') return null;

  async function markRead(item) {
    if (!item.readAt) await api.put(`/notifications/self/inbox/${encodeURIComponent(item.inboxId)}/read`, {}, role);
    if (item.actionUrl) window.location.href = item.actionUrl;
    await loadInbox();
  }

  async function archive(item) {
    await api.put(`/notifications/self/inbox/${encodeURIComponent(item.inboxId)}/archive`, {}, role);
    await loadInbox();
  }

  async function savePreferences() {
    setBusy('preferences'); setError(''); setMessage('');
    const result = await api.put('/notifications/self/preferences', { preferences }, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not save notification preferences.');
    setMessage('Notification preferences saved. Mandatory operational notices remain enabled.');
  }

  async function createFeed() {
    setBusy('calendar'); setError(''); setMessage('');
    const result = await api.post('/calendar/self/tokens', { label: 'MCN LMS Calendar', timezone: 'Asia/Kolkata' }, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not create calendar feed.');
    const fullUrl = `${window.location.origin}${result.data.feedUrl}`;
    try { await navigator.clipboard.writeText(fullUrl); } catch {}
    setMessage(`Calendar feed created and copied. Save it now: ${fullUrl}`);
    await loadTokens();
  }

  async function revokeFeed(item) {
    if (!window.confirm(`Revoke calendar feed “${item.label}”? Existing subscriptions will stop immediately.`)) return;
    setBusy(item.tokenId); setError('');
    const result = await api.delete(`/calendar/self/tokens/${encodeURIComponent(item.tokenId)}`, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not revoke feed.');
    setMessage('Calendar feed revoked.');
    await loadTokens();
  }

  async function retryDelivery(item) {
    setBusy(item.outboxId); setError(''); setMessage('');
    const result = await api.post(`/notifications/scope/outbox/${encodeURIComponent(item.outboxId)}/retry`, {}, role);
    setBusy('');
    if (!result.ok) return setError(result.message || 'Could not reset delivery.');
    setMessage('Delivery reset for the next worker cycle.');
    await loadHealth();
  }

  const deliverySummary = Object.fromEntries((health.deliveries || []).map(item => [`${item.channel}:${item.status}`, Number(item.count || 0)]));

  return (
    <>
      <button className="notify-fab" onClick={() => setOpen(value => !value)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <span>🔔</span>{unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
      </button>
      {open && <div className="notify-backdrop" onClick={() => setOpen(false)}>
        <aside className="notify-panel" onClick={event => event.stopPropagation()}>
          <header><div><span>MCN LMS</span><h2>Notifications & Calendar</h2></div><button onClick={() => setOpen(false)}>✕</button></header>
          <nav><button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>Inbox {unread > 0 && `(${unread})`}</button><button className={tab === 'preferences' ? 'active' : ''} onClick={() => setTab('preferences')}>Preferences</button><button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>Calendar feed</button>{role !== 'trainee' && <button className={tab === 'delivery' ? 'active' : ''} onClick={() => setTab('delivery')}>Delivery health</button>}</nav>
          {message && <div className="notify-message ok">{message}</div>}
          {error && <div className="notify-message bad">{error}</div>}

          {tab === 'inbox' && <section className="notify-list">{inbox.map(item => <article key={item.inboxId} className={item.readAt ? 'read' : ''}><button className="notify-open" onClick={() => markRead(item)}><div><span className={`notify-priority ${String(item.priority).toLowerCase()}`}>{item.priority}</span><b>{item.title}</b></div><p>{item.bodyText}</p><small>{formatDate(item.createdAt)}</small></button><button className="notify-archive" onClick={() => archive(item)}>Archive</button></article>)}{!inbox.length && <div className="notify-empty"><b>You are all caught up</b><p>Operational reminders and learning updates will appear here.</p></div>}</section>}

          {tab === 'preferences' && <section className="notify-settings"><p>Choose optional channels. Mandatory security, cancellation and compliance notices cannot be disabled.</p>{preferences.map((item, index) => <article key={item.channel}><div><b>{item.channel.replace('_', ' ')}</b><span>{item.channel === 'IN_APP' ? 'Portal notification' : 'External delivery'}</span></div><label><input type="checkbox" checked={Boolean(item.enabled)} onChange={event => setPreferences(values => values.map((value, i) => i === index ? { ...value, enabled: event.target.checked } : value))} /> Enabled</label><select value={item.digestMode} onChange={event => setPreferences(values => values.map((value, i) => i === index ? { ...value, digestMode: event.target.value } : value))}><option>IMMEDIATE</option><option>DAILY</option><option>WEEKLY</option><option>OFF</option></select></article>)}<button className="btn" disabled={busy === 'preferences'} onClick={savePreferences}>{busy === 'preferences' ? 'Saving…' : 'Save preferences'}</button></section>}

          {tab === 'calendar' && <section className="notify-settings"><div className="notify-callout"><b>Subscribe in Google, Outlook or Apple Calendar</b><p>The feed includes your live training, coaching and certification dates. The secret URL is shown only when created.</p><button className="btn" onClick={createFeed} disabled={busy === 'calendar'}>{busy === 'calendar' ? 'Creating…' : 'Create and copy feed URL'}</button></div>{tokens.map(item => <article key={item.tokenId}><div><b>{item.label}</b><span>{item.feedScope} · Prefix {item.tokenPrefix}…</span><small>Last used {formatDate(item.lastUsedAt)}</small></div><button className="btn small secondary" disabled={busy === item.tokenId || item.revokedAt} onClick={() => revokeFeed(item)}>{item.revokedAt ? 'Revoked' : 'Revoke'}</button></article>)}{!tokens.length && <div className="notify-empty"><b>No calendar feed</b><p>Create one to keep LMS dates synchronized with your calendar app.</p></div>}</section>}

          {tab === 'delivery' && role !== 'trainee' && <section className="notify-delivery"><div className="notify-health-grid"><div><span>Pending</span><b>{Object.entries(deliverySummary).filter(([key]) => key.endsWith(':PENDING')).reduce((sum, [, value]) => sum + value, 0)}</b></div><div><span>Retry</span><b>{Object.entries(deliverySummary).filter(([key]) => key.endsWith(':RETRY')).reduce((sum, [, value]) => sum + value, 0)}</b></div><div><span>Failed</span><b>{failed.length}</b></div><div><span>Sent</span><b>{Object.entries(deliverySummary).filter(([key]) => key.endsWith(':SENT')).reduce((sum, [, value]) => sum + value, 0)}</b></div></div><div className="notify-list">{failed.map(item => <article key={item.outboxId}><div className="notify-failure"><b>{item.eventType} · {item.channel}</b><span>{item.recipientId}</span><p>{item.lastError || 'Delivery failed without a provider message.'}</p><small>{item.attemptCount}/{item.maxAttempts} attempts</small></div><button className="btn small" disabled={busy === item.outboxId} onClick={() => retryDelivery(item)}>Retry</button></article>)}{!failed.length && <div className="notify-empty"><b>No failed deliveries</b><p>The durable outbox has no dead-letter items in your scope.</p></div>}</div></section>}
        </aside>
      </div>}
    </>
  );
}
