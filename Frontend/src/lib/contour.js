// Deterministic "topographic" art for places. The dataset has no photos, so cards show generated
// contour lines tinted by place family instead – never presented as a photo of the place.

export const FAMILIES = {
  sea: { bg: '#d9ece8', line: '#2f7f86', label: 'ทะเล' },
  mountain: { bg: '#e3e8dc', line: '#4b6b4f', label: 'ภูเขา' },
  nature: { bg: '#dcebd3', line: '#3e7b4a', label: 'ธรรมชาติ' },
  cafe: { bg: '#f0e5d6', line: '#8a5a3b', label: 'คาเฟ่' },
  culture: { bg: '#f4ead0', line: '#a87518', label: 'วัฒนธรรม' },
  family: { bg: '#f3e3dc', line: '#b0573f', label: 'ครอบครัว' },
  lodging: { bg: '#e2e4ef', line: '#4a5a8a', label: 'ที่พัก' },
  food: { bg: '#f2e4cf', line: '#9a6b2f', label: 'อาหาร' },
  default: { bg: '#e7efe0', line: '#5e8c61', label: 'สถานที่' },
}

export function familyOf(place) {
  if (!place) return 'default'
  if (place.is_accommodation) return 'lodging'
  if (place.is_food) return 'food'
  return place.ml?.top_interest || 'default'
}

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed) {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

const cache = new Map()

export function contourPaths(id, w = 400, h = 240) {
  const key = `${id}|${w}|${h}`
  if (cache.has(key)) return cache.get(key)
  const r = rng(hash(String(id)))
  const peaks = 1 + Math.floor(r() * 2)
  const paths = []
  for (let p = 0; p < peaks; p++) {
    const cx = w * (0.2 + r() * 0.6)
    const cy = h * (0.25 + r() * 0.5)
    const rings = 6 + Math.floor(r() * 5)
    const phase = [r() * 6.28, r() * 6.28, r() * 6.28]
    const amp = [0.12 + r() * 0.12, 0.06 + r() * 0.08, 0.04 + r() * 0.05]
    for (let k = 1; k <= rings; k++) {
      const base = k * (Math.max(w, h) / (rings * 1.6))
      const pts = []
      const steps = 48
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2
        const rad =
          base *
          (1 + amp[0] * Math.sin(2 * t + phase[0]) + amp[1] * Math.sin(3 * t + phase[1] + k * 0.3) + amp[2] * Math.sin(5 * t + phase[2]))
        pts.push([cx + rad * Math.cos(t) * 1.25, cy + rad * Math.sin(t)])
      }
      paths.push('M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z')
    }
  }
  cache.set(key, paths)
  return paths
}
