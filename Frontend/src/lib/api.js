import { useAuth } from '../store/authStore'

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

/** Uploaded photos come back as server paths; Wikipedia photos are already full URLs. */
export const assetUrl = (path) => (path?.startsWith('/') ? `${BASE}${path}` : path)

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
    const isForm = body instanceof FormData // the browser sets the multipart header itself
    if (body && !isForm) headers['Content-Type'] = 'application/json'
    const token = useAuth.getState().token
    if (token) headers.Authorization = `Bearer ${token}`
    res = await fetch(url, {
      method,
      signal,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
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

const recentSignals = new Map()

function imageForm(file) {
  const form = new FormData()
  form.append('file', file)
  return form
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
  logActivity: (place_id, action = 'view') => {
    // skip duplicate signals fired back-to-back (React StrictMode double effects, quick re-renders)
    const k = `${action}:${place_id}`
    const now = Date.now()
    if (now - (recentSignals.get(k) || 0) < 5000) return Promise.resolve(null)
    recentSignals.set(k, now)
    return request('/api/activity', { method: 'POST', body: { place_id, action } })
  },
  activitySummary: () => request('/api/activity/summary'),
  clearActivity: () => request('/api/activity', { method: 'DELETE' }),
  personal: (params) => request('/api/recommend/personal', { params }),
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
  placePhoto: (id) => request(`/api/places/${encodeURIComponent(id)}/photo`),
  placePhotos: (id) => request(`/api/places/${encodeURIComponent(id)}/photos`),
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
  notifications: () => request('/api/notifications'),
  markNotificationsRead: (keys) => request('/api/notifications/read', { method: 'POST', body: { keys } }),
  admin: {
    stats: () => request('/api/admin/stats'),
    options: () => request('/api/admin/options'),
    places: (params, signal) => request('/api/admin/places', { params, signal }),
    place: (id) => request(`/api/admin/places/${encodeURIComponent(id)}`),
    updatePlace: (id, body) => request(`/api/admin/places/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    audit: (params) => request('/api/admin/audit', { params }),
    images: (id) => request(`/api/admin/places/${encodeURIComponent(id)}/images`),
    uploadImage: (id, file) => request(`/api/admin/places/${encodeURIComponent(id)}/images`, { method: 'POST', body: imageForm(file) }),
    orderImages: (id, ids) => request(`/api/admin/places/${encodeURIComponent(id)}/images/order`, { method: 'PUT', body: { ids } }),
    wikiPhoto: (id) => request(`/api/admin/places/${encodeURIComponent(id)}/wiki-photo`),
    setWikiPhoto: (id, disabled) => request(`/api/admin/places/${encodeURIComponent(id)}/wiki-photo`, { method: 'PATCH', body: { disabled } }),
    updateImage: (imageId, body) => request(`/api/admin/images/${imageId}`, { method: 'PATCH', body }),
    replaceImage: (imageId, file) => request(`/api/admin/images/${imageId}/file`, { method: 'PUT', body: imageForm(file) }),
    deleteImage: (imageId) => request(`/api/admin/images/${imageId}`, { method: 'DELETE' }),
  },
}
