export function formatSeconds(s) {
  const sec = parseInt(s, 10) || 0;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function pct(val) {
  return `${Math.round(val || 0)}%`;
}

export function riskColor(severity) {
  return { CRITICAL: 'bad', HIGH: 'warn', WATCH: 'info', HEALTHY: 'ok' }[severity] || '';
}
