export function toCsv(headers, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => esc(row[h] ?? row[h.toLowerCase()] ?? '')).join(','));
  }
  return lines.join('\n');
}

export function csvRes(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

export function fmtDt(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDate(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function maskMobile(mobile) {
  if (!mobile) return '';
  const s = String(mobile).replace(/\D/g, '');
  if (s.length < 6) return s;
  return s.slice(0, 2) + '****' + s.slice(-4);
}

export function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return local.slice(0, 2) + '***@' + domain;
}
