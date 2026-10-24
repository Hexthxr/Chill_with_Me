import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { addDaysISO, todayISO } from '../lib/format'
import { blockFromPlace, findBlock, moveBlock, resizeDays } from '../planner/planUtils'

const freshTrip = () => ({
  tripId: null,
  name: 'ทริปของฉัน',
  start_date: addDaysISO(todayISO(), 7),
  start_time: '08:00',
  day_end_time: '20:00',
  notes: '',
  days: [{ start_time: null, blocks: [] }],
  activeDay: 0,
  dirty: false,
})

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__t'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return localStorage
  } catch {
    const mem = {}
    return { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] }
  }
})

export const useTrip = create(
  persist(
    (set, get) => ({
      ...freshTrip(),
      setMeta: (patch) => set({ ...patch, dirty: true }),
      setDayCount: (n) => set((s) => ({ days: resizeDays(s.days, n), activeDay: Math.min(s.activeDay, n - 1), dirty: true })),
      setActiveDay: (d) => set({ activeDay: d }),
      setDayStart: (d, t) =>
        set((s) => ({ days: s.days.map((x, i) => (i === d ? { ...x, start_time: t || null } : x)), dirty: true })),
      addBlock: (block, day) =>
        set((s) => {
          const d = day ?? s.activeDay
          return { days: s.days.map((x, i) => (i === d ? { ...x, blocks: [...x.blocks, block] } : x)), dirty: true }
        }),
      addPlace: (place, kind, day) => {
        const b = blockFromPlace(place, kind)
        get().addBlock(b, day)
        return b
      },
      hasPlace: (placeId) => get().days.some((d) => d.blocks.some((b) => b.place_id === placeId)),
      updateBlock: (id, patch) =>
        set((s) => ({
          days: s.days.map((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
          dirty: true,
        })),
      removeBlock: (id) =>
        set((s) => ({ days: s.days.map((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) })), dirty: true })),
      move: (id, toDay, toIndex) => set((s) => ({ days: moveBlock(s.days, id, toDay, toIndex), dirty: true })),
      applyOrder: (day, order) =>
        set((s) => {
          const map = Object.fromEntries(s.days[day].blocks.map((b) => [b.id, b]))
          return {
            days: s.days.map((d, i) => (i === day ? { ...d, blocks: order.map((id) => map[id]).filter(Boolean) } : d)),
            dirty: true,
          }
        }),
      locate: (id) => findBlock(get().days, id),
      loadTrip: (doc) =>
        set({
          tripId: doc.id,
          name: doc.name,
          start_date: doc.start_date,
          start_time: doc.start_time,
          day_end_time: doc.day_end_time,
          notes: doc.notes || '',
          days: doc.days.map((d) => ({ start_time: d.start_time || null, blocks: d.blocks })),
          activeDay: 0,
          dirty: false,
        }),
      markSaved: (id) => set({ tripId: id, dirty: false }),
      reset: () => set(freshTrip()),
    }),
    { name: 'chill.tripDraft', storage: safeStorage, version: 1 },
  ),
)

// Simple toast store
export const useToast = create((set) => ({
  toasts: [],
  push: (message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  },
}))
