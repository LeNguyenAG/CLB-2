const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export function getToken() {
  return localStorage.getItem('football_access_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('football_access_token', token);
  else localStorage.removeItem('football_access_token');
}

export async function api(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function login(username, password) {
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setToken(result.data.token);
  return result.data;
}

export function logout() {
  setToken(null);
}
