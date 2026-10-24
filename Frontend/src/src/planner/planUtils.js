// Pure helpers for the trip draft (unit-tested in planUtils.test.js).

export const DEFAULT_DURATION = { place: 90, food: 60, hotel: 30, rest: 30, custom: 60 }

export const KIND_LABEL = {
  place: 'สถานที่เที่ยว',
  food: 'มื้ออาหาร',
  hotel: 'ที่พัก',
  rest: 'เวลาพัก',
  custom: 'กิจกรรมอื่น',
}

let counter = 0
export const newId = () => `blk_${Date.now().toString(36)}_${(counter++).toString(36)}`

export function blockFromPlace(place, kind) {
  const k = kind || (place.is_accommodation ? 'hotel' : place.is_food ? 'food' : 'place')
  return {
    id: newId(),
    kind: k,
    name: place.name,
    place_id: place.place_id,
    lat: place.lat,
    lng: place.lng,
    duration_min: DEFAULT_DURATION[k],
    locked: false,
    locked_start: null,
    opening_hours: null,
    province: place.province || null,
    primary_type: place.primary_type || null,
    note: null,
  }
}

export function emptyBlock(kind, name) {
  return {
    id: newId(),
    kind,
    name: name || KIND_LABEL[kind],
    place_id: null,
    lat: null,
    lng: null,
    duration_min: DEFAULT_DURATION[kind],
    locked: false,
    locked_start: null,
    opening_hours: null,
    province: null,
    primary_type: null,
    note: null,
  }
}

export function findBlock(days, id) {
  for (let d = 0; d < days.length; d++) {
    const i = days[d].blocks.findIndex((b) => b.id === id)
    if (i >= 0) return { day: d, index: i }
  }
  return null
}

/** Move block `id` to day `toDay` at position `toIndex` (immutable). */
export function moveBlock(days, id, toDay, toIndex) {
  const from = findBlock(days, id)
  if (!from) return days
  const next = days.map((d) => ({ ...d, blocks: [...d.blocks] }))
  const [blk] = next[from.day].blocks.splice(from.index, 1)
  const target = next[toDay].blocks
  const idx = Math.max(0, Math.min(toIndex, target.length))
  target.splice(idx, 0, blk)
  return next
}

export function resizeDays(days, n) {
  if (n === days.length) return days
  if (n > days.length) return [...days, ...Array.from({ length: n - days.length }, () => ({ start_time: null, blocks: [] }))]
  // shrinking: move blocks of removed days to the new last day so nothing is lost silently
  const kept = days.slice(0, n).map((d) => ({ ...d, blocks: [...d.blocks] }))
  days.slice(n).forEach((d) => kept[n - 1].blocks.push(...d.blocks))
  return kept
}

/** Shape expected by the backend TripPlan schema. */
export function toPayload(trip) {
  return {
    name: trip.name?.trim() || 'ทริปของฉัน',
    start_date: trip.start_date,
    start_time: trip.start_time,
    day_end_time: trip.day_end_time,
    notes: trip.notes || null,
    days: trip.days.map((d) => ({
      start_time: d.start_time || null,
      blocks: d.blocks.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        place_id: b.place_id || null,
        lat: b.lat ?? null,
        lng: b.lng ?? null,
        duration_min: Number(b.duration_min) || DEFAULT_DURATION[b.kind],
        locked: !!(b.locked && b.locked_start),
        locked_start: b.locked && b.locked_start ? b.locked_start : null,
        opening_hours: b.opening_hours?.open && b.opening_hours?.close ? { open: b.opening_hours.open, close: b.opening_hours.close } : null,
        province: b.province || null,
        primary_type: b.primary_type || null,
        note: b.note || null,
      })),
    })),
  }
}
