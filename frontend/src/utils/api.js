const BASE = (import.meta.env.VITE_API_URL || '') + '/api';

function getToken(type) {
  return localStorage.getItem(`lms_token_${type}`) || '';
}

export function setToken(type, token) {
  localStorage.setItem(`lms_token_${type}`, token);
}

export function clearToken(type) {
  localStorage.removeItem(`lms_token_${type}`);
}

async function request(method, url, body, type = 'trainee') {
  const token = getToken(type);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({ ok: false, message: 'Invalid server response' }));
  if (res.status === 401) {
    clearToken(type);
    window.dispatchEvent(new CustomEvent('lms:session-expired', { detail: { type } }));
  }
  return data;
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
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers, body: formData });
  return res.json().catch(() => ({ ok: false }));
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
