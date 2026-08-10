const configuredBase = String(import.meta.env.VITE_API_BASE_URL || '').trim()

// Nếu chạy trên Vercel thì tự động lấy link Render, chạy dưới máy thì lấy 127.0.0.1
const defaultApi = (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app'))
  ? 'https://clb-22.onrender.com/api'
  : 'http://127.0.0.1:3000/api'

export const API_BASE = (configuredBase || defaultApi).replace(/\/$/, '')

const TOKEN_KEY = 'frm_v2_token'

export class ApiRequestError extends Error {
  constructor(message, status = 0, code = null, details = null) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

function buildUrl(path, query) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const resolvedBase = /^https?:\/\//i.test(API_BASE) ? API_BASE : `${window.location.origin}${API_BASE.startsWith('/') ? '' : '/'}${API_BASE}`
  const url = new URL(`${resolvedBase}${cleanPath}`)
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
    })
  }
  return url.toString()
}

async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    query,
    auth = true,
    timeout = 18000,
    headers: extraHeaders = {},
  } = options

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)
  const headers = { Accept: 'application/json', ...extraHeaders }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new ApiRequestError(`Backend trả dữ liệu không phải JSON (HTTP ${response.status}).`, response.status)
    }

    if (!response.ok || payload?.success === false) {
      const message = payload?.error?.message || payload?.message || `Yêu cầu thất bại (HTTP ${response.status}).`
      if (response.status === 401) window.dispatchEvent(new CustomEvent('frm:unauthorized'))
      throw new ApiRequestError(message, response.status, payload?.error?.code || null, payload?.error?.details || null)
    }
    return { data: payload?.data ?? payload, meta: payload?.meta ?? null }
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApiRequestError('Backend phản hồi quá chậm hoặc chưa chạy.', 0, 'TIMEOUT')
    if (error instanceof ApiRequestError) throw error
    throw new ApiRequestError('Không thể kết nối Backend tại cổng 3000. Hãy kiểm tra START_ALL.cmd.', 0, 'NETWORK_ERROR')
  } finally {
    window.clearTimeout(timer)
  }
}

export const api = {
  get: (path, query, options = {}) => request(path, { ...options, method: 'GET', query }),
  post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options = {}) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, body, options = {}) => request(path, { ...options, method: 'DELETE', body }),
  health: () => request('/health', { auth: false, timeout: 5000 }),
  diagnostics: () => request('/diagnostics/integration', { auth: false, timeout: 8000 }),
}
