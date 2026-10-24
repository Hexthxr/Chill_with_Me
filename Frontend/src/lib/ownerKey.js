// Anonymous per-browser key so "my trips" can be listed without user accounts.
const KEY = 'chill.ownerKey'

export function getOwnerKey() {
  try {
    let k = localStorage.getItem(KEY)
    if (!k) {
      k = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 36)
      localStorage.setItem(KEY, k)
    }
    return k
  } catch {
    return 'anonymous'
  }
}
