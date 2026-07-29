const API_ORIGIN = import.meta.env.VITE_API_URL || '';
const BASE = `${API_ORIGIN}/api`;
const DEFAULT_TIMEOUT_MS = 30000;
const SESSION_MARKER = 'cookie-session-v2';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ROLE_COOKIE = {
  trainee: 'lms_trainee_csrf',
  coordinator: 'lms_coordinator_csrf',
  admin: 'lms_admin_csrf',
};

export function normalizeApiRole(type = 'trainee') {
  const role = String(type || 'trainee').toLowerCase();
  return role === 'management' ? 'coordinator' : role;
}

function markerKey(type) {
  return `lms_token_${String(type || 'trainee').toLowerCase()}`;
}

function announceTokenChange(type, active) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lms:token-changed', { detail: { type, active, cookieSession: true } }));
  }
}

// Compatibility name retained for existing portal wrappers. The value is a
// non-secret presence marker only; session credentials remain HttpOnly cookies.
export function setToken(type, _ignoredCredential = '') {
  localStorage.setItem(markerKey(type), SESSION_MARKER);
  announceTokenChange(type, true);
}

export function clearToken(type) {
  localStorage.removeItem(markerKey(type));
  announceTokenChange(type, false);
}

export function hasSessionMarker(type) {
  return localStorage.getItem(markerKey(type)) === SESSION_MARKER;
}

function cookieValue(name) {
  if (typeof document === 'undefined') return '';
  for (const item of String(document.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 1) continue;
    const key = item.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(index + 1).trim());
    } catch {
      return item.slice(index + 1).trim();
    }
  }
  return '';
}

function roleHeaders(type, method) {
  const role = normalizeApiRole(type);
  const headers = { 'X-LMS-Role': role };
  if (!SAFE_METHODS.has(String(method || 'GET').toUpperCase())) {
    const csrf = cookieValue(ROLE_COOKIE[role]);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

function networkMessage(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Please check your network and try again.';
  }
  if (err?.name === 'AbortError') {
    return 'The server is taking too long to respond. Please refresh or try again.';
  }
  return 'Unable to connect to LMS server. Please confirm backend is running and API URL is correct.';
}

function resolveRequestUrl(url) {
  const value = String(url || '');
  if (/^https?:\/\//i.test(value) || value.startsWith('blob:')) return value;
  if (value.startsWith('/api/')) return `${API_ORIGIN}${value}`;
  if (value.startsWith('/')) return `${BASE}${value}`;
  return `${BASE}/${value}`;
}

function handleSessionFailure(status, data, type) {
  if (status === 401) {
    clearToken(type);
    window.dispatchEvent(new CustomEvent('lms:session-expired', { detail: { type } }));
  } else if (status === 403 && data?.code === 'CSRF_REJECTED') {
    window.dispatchEvent(new CustomEvent('lms:csrf-rejected', { detail: { type } }));
  }
}

async function request(method, url, body, type = 'trainee') {
  const headers = { 'Content-Type': 'application/json', ...roleHeaders(type, method) };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(resolveRequestUrl(url), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({ ok: false, message: 'Invalid server response' }));
    handleSessionFailure(res.status, data, type);

    if (!res.ok && data.ok !== false) {
      return { ok: false, status: res.status, message: data.message || `Request failed (${res.status})` };
    }

    return data;
  } catch (err) {
    return {
      ok: false,
      networkError: true,
      message: networkMessage(err),
      details: err?.message || String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: (url, type) => request('GET', url, undefined, type),
  post: (url, body, type) => request('POST', url, body, type),
  put: (url, body, type) => request('PUT', url, body, type),
  patch: (url, body, type) => request('PATCH', url, body, type),
  delete: (url, type) => request('DELETE', url, undefined, type),
};

export async function fetchAuthenticatedBlobUrl(url, type = 'trainee') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(resolveRequestUrl(url), {
      headers: { ...roleHeaders(type, 'GET'), 'X-Request-Id': crypto.randomUUID?.() || String(Date.now()) },
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'include',
    });

    if (res.status === 401) {
      clearToken(type);
      window.dispatchEvent(new CustomEvent('lms:session-expired', { detail: { type } }));
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, message: error.message || `Unable to open content (${res.status})` };
    }

    const blob = await res.blob();
    return { ok: true, url: URL.createObjectURL(blob), blob };
  } catch (err) {
    return { ok: false, networkError: true, message: networkMessage(err), details: err?.message || String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadFile(url, formData, type = 'admin') {
  try {
    const res = await fetch(resolveRequestUrl(url), {
      method: 'POST',
      headers: roleHeaders(type, 'POST'),
      body: formData,
      credentials: 'include',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({ ok: false, message: 'Invalid server response' }));
    handleSessionFailure(res.status, data, type);
    return data;
  } catch (err) {
    return { ok: false, networkError: true, message: networkMessage(err), details: err?.message || String(err) };
  }
}

export async function downloadCsv(url, filename, type = 'admin') {
  const res = await fetch(resolveRequestUrl(url), {
    headers: roleHeaders(type, 'GET'),
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    handleSessionFailure(res.status, err, type);
    throw new Error(err.message || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
