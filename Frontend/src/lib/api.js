import { useAuth } from '../store/authStore'

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(path, { method = 'GET', body, params, signal } = {}) {
  let url = `${BASE}${path}`
  if (params) {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    })
    const s = qs.toString()
    if (s) url += `?${s}`
  }
  let res
  try {
    const headers = {}
    if (body) headers['Content-Type'] = 'application/json'
    const token = useAuth.getState().token
    if (token) headers.Authorization = `Bearer ${token}`
    res = await fetch(url, {
      method,
      signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError(0, 'network', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า Backend ทำงานอยู่ที่พอร์ต 8000')
  }
  if (res.status === 204) return null
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON */
  }
  if (res.status === 401 && useAuth.getState().token) useAuth.getState().clear() // session expired / revoked
  if (!res.ok) {
    const err = data?.error || {}
    throw new ApiError(res.status, err.code || 'http_error', err.message || `คำขอล้มเหลว (${res.status})`, err.details)
  }
  return data
}

export const api = {
  authConfig: () => request('/api/auth/config'),
  registerStart: (body) => request('/api/auth/register/start', { method: 'POST', body }),
  loginStart: (body) => request('/api/auth/login/start', { method: 'POST', body }),
  loginPassword: (body) => request('/api/auth/login', { method: 'POST', body }),
  resetStart: (body) => request('/api/auth/password/reset/start', { method: 'POST', body }),
  changePassword: (body) => request('/api/auth/password', { method: 'POST', body }),
  resendOtp: (request_id) => request('/api/auth/resend', { method: 'POST', body: { request_id } }),
  verifyOtp: (body) => request('/api/auth/verify', { method: 'POST', body }),
  me: () => request('/api/auth/me'),
  updateMe: (body) => request('/api/auth/me', { method: 'PATCH', body }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  health: () => request('/api/health'),
  stats: () => request('/api/meta/stats'),
  provinces: () => request('/api/meta/provinces'),
  interests: () => request('/api/meta/interests'),
  mlInfo: () => request('/api/meta/ml'),
  routingStatus: () => request('/api/routing/status'),
  recommend: (params, signal) => request('/api/recommend', { params, signal }),
  searchPlaces: (params, signal) => request('/api/places', { params, signal }),
  place: (id) => request(`/api/places/${encodeURIComponent(id)}`),
  placeReviews: (id, params) => request(`/api/places/${encodeURIComponent(id)}/reviews`, { params }),
  similar: (id) => request(`/api/places/${encodeURIComponent(id)}/similar`),
  hotelsNear: (params) => request('/api/hotels/near', { params }),
  hotelsAlongRoute: (body) => request('/api/hotels/along-route', { method: 'POST', body }),
  hotelCoverage: () => request('/api/hotels/coverage'),
  hotelProvinces: (limit = 6) => request('/api/hotels/provinces', { params: { limit } }),
  computePlan: (plan, signal) => request('/api/planner/compute', { method: 'POST', body: plan, signal }),
  optimizeDay: (body) => request('/api/planner/optimize', { method: 'POST', body }),
  listTrips: (params) => request('/api/trips', { params }),
  getTrip: (id) => request(`/api/trips/${id}`),
  createTrip: (body) => request('/api/trips', { method: 'POST', body }),
  updateTrip: (id, body) => request(`/api/trips/${id}`, { method: 'PUT', body }),
  deleteTrip: (id) => request(`/api/trips/${id}`, { method: 'DELETE' }),
}
