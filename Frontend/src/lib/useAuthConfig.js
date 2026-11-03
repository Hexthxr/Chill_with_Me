import { useEffect, useState } from 'react'
import { api } from './api'

let cached = null
let pending = null

/** /api/auth/config, fetched once per page load. `otp_enabled` decides whether OTP screens exist. */
export function useAuthConfig() {
  const [cfg, setCfg] = useState(cached)
  useEffect(() => {
    if (cached) return
    pending = pending || api.authConfig().then((c) => (cached = c)).catch(() => (pending = null))
    pending.then((c) => c && setCfg(c))
  }, [])
  return cfg // null while loading
}
