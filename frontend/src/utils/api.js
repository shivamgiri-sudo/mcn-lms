const BASE = (import.meta.env.VITE_API_URL || '') + '/api';
const DEFAULT_TIMEOUT_MS = 30000;

function getToken(type) {
  return localStorage.getItem(`lms_token_${type}`) || '';
}

function announceTokenChange(type, active) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lms:token-changed', { detail: { type, active } }));
  }
}

export function setToken(type, token) {
  localStorage.setItem(`lms_token_${type}`, token);
  announceTokenChange(type, Boolean(token));
}

export function clearToken(type) {
  localStorage.removeItem(`lms_token_${type}`);
  announceTokenChange(type, false);
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

async function request(method, url, body, type = 'trainee') {
  const token = getToken(type);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({ ok: false, message: 'Invalid server response' }));

    if (res.status === 401) {
      clearToken(type);
      window.dispatchEvent(new CustomEvent('lms:session-expired', { detail: { type } }));
    }

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

export async function uploadFile(url, formData, type = 'admin') {
  const token = getToken(type);
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(`${BASE}${url}`, { method: 'POST', headers, body: formData });
    return res.json().catch(() => ({ ok: false, message: 'Invalid server response' }));
  } catch (err) {
    return { ok: false, networkError: true, message: networkMessage(err), details: err?.message || String(err) };
  }
}

export async function downloadCsv(url, filename, type = 'admin') {
  const token = getToken(type);
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
