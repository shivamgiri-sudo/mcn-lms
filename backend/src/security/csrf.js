import { createHmac, timingSafeEqual } from 'crypto';

function secret() {
  return String(process.env.CSRF_SECRET || process.env.SESSION_SECRET || '');
}

export function deriveCsrfToken(rawSessionToken, role, version = 1) {
  return createHmac('sha256', secret())
    .update(`${String(rawSessionToken || '')}:${String(role || '')}:${Number(version || 1)}`, 'utf8')
    .digest('base64url');
}

export function csrfTokensEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
