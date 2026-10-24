export const fmtInt = (n) => (n == null ? '–' : Number(n).toLocaleString('th-TH'))

export const fmtRating = (r) => (r == null ? null : Number(r).toFixed(1))

export const fmtPct = (x) => (x == null ? null : `${Math.round(x * 100)}%`)

export function fmtDuration(min) {
  if (min == null) return '–'
  const m = Math.round(min)
  if (m < 60) return `${m} นาที`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} ชม. ${r} นาที` : `${h} ชม.`
}

export const fmtKm = (m) => (m == null ? '–' : m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`)

const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export function fmtThaiDate(iso, withDay = true) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const s = `${d} ${TH_MONTHS[m - 1]} ${y + 543}`
  return withDay ? `${TH_DAYS[dt.getDay()]} ${s}` : s
}

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function todayISO() {
  const dt = new Date()
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function relativeTime(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'เมื่อสักครู่'
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`
  return `${Math.floor(diff / 86400)} วันที่แล้ว`
}
