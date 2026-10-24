import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const storage = createJSONStorage(() => {
  try {
    localStorage.setItem('__a', '1')
    localStorage.removeItem('__a')
    return localStorage
  } catch {
    const mem = {}
    return { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] }
  }
})

/** Session token + user profile (token is an opaque server session id, revoked on logout). */
export const useAuth = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'chill.auth', storage, version: 1 },
  ),
)
