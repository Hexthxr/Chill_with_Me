import { create } from 'zustand'
import { api } from '../lib/api'

export const useNotifications = create((set, get) => ({
  items: [],
  unread: 0,
  load: async () => {
    try {
      const r = await api.notifications()
      set({ items: r.items, unread: r.unread })
      return r.items
    } catch {
      return get().items // a failed refresh keeps what is on screen
    }
  },
  markAllRead: async () => {
    const keys = get().items.filter((n) => !n.read).map((n) => n.key)
    if (!keys.length) return
    set((s) => ({ unread: 0, items: s.items.map((n) => ({ ...n, read: true })) }))
    try {
      await api.markNotificationsRead(keys)
    } catch {
      get().load()
    }
  },
  reset: () => set({ items: [], unread: 0 }),
}))

/** Headline for a reminder, shared by the bell panel and the toast. */
export const reminderTitle = (n) => (n.days_until === 0 ? `วันนี้ออกเดินทาง: ${n.trip_name}` : `พรุ่งนี้ออกเดินทาง: ${n.trip_name}`)
