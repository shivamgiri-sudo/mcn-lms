import { normalizeApiRole, refreshCsrfToken, setToken } from './api.js';

/**
 * HRMS SSO bootstrap.
 *
 * Trusted HRMS handoff values use a short-lived, single-use code:
 *   #hrms_lms_code=<code>&lms_user_type=<type>
 *
 * The fragment is removed before any network request. The code is exchanged
 * directly for a role-specific HttpOnly session cookie and is never written to
 * localStorage, sessionStorage, browser history, analytics, or referrer data.
 */
let bootstrapped = false;
let bootstrapPromise = null;

function apiBase() {
  const origin = import.meta.env.VITE_API_URL || '';
  return `${origin}/api`;
}

function cleanFragment(params) {
  params.delete('hrms_lms_code');
  params.delete('hrms_lms_token');
  params.delete('lms_user_type');
  const remainingHash = params.toString() ? `#${params.toString()}` : '';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${remainingHash}`);
}

function safeInternalPath(value, role) {
  const path = String(value || '').trim();
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('://')) return path;
  if (role === 'admin') return '/admin';
  if (role === 'coordinator') return '/coordinator';
  return '/lms';
}

export function runSsoBootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  if (bootstrapped || typeof window === 'undefined') return Promise.resolve({ ok: true, skipped: true });
  bootstrapped = true;

  bootstrapPromise = (async () => {
    try {
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
      const params = new URLSearchParams(hash);
      const code = params.get('hrms_lms_code');
      const rejectedLegacyToken = params.has('hrms_lms_token');
      const requestedType = params.get('lms_user_type') || 'trainee';
      cleanFragment(params);

      if (rejectedLegacyToken) {
        window.dispatchEvent(new CustomEvent('lms:sso-error', { detail: { message: 'Legacy token handoff is no longer accepted.' } }));
        return { ok: false, message: 'Legacy token handoff is no longer accepted.' };
      }
      if (!code) return { ok: true, skipped: true };

      const role = normalizeApiRole(requestedType);
      if (!['trainee', 'coordinator', 'admin'].includes(role)) throw new Error('Unsupported LMS SSO user type.');

      const response = await fetch(`${apiBase()}/auth/sso/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LMS-Role': role },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ code, userType: role }),
      });
      const result = await response.json().catch(() => ({ ok: false, message: 'Invalid SSO response.' }));
      if (!response.ok || !result.ok) throw new Error(result.message || 'SSO handoff failed.');

      setToken(requestedType);
      await refreshCsrfToken(requestedType);
      window.dispatchEvent(new CustomEvent('lms:sso-established', { detail: { type: requestedType } }));
      const destination = safeInternalPath(result.redirectPath, role);
      window.location.replace(destination);
      return { ok: true, destination };
    } catch (error) {
      console.warn('[ssoBootstrap] rejected handoff:', error.message);
      window.dispatchEvent(new CustomEvent('lms:sso-error', { detail: { message: error.message } }));
      return { ok: false, message: error.message };
    }
  })();

  return bootstrapPromise;
}
