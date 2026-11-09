import { useEffect, useMemo, useState } from 'react'
import { api, assetUrl } from '../lib/api'
import { FAMILY_LABEL, familyOf } from '../lib/placeFamily'
import { useInView } from './Motion'

/* Generated flat-illustration scenes (not photos). The scene depends on the kind of place, and the
   place id seeds the small differences (sky, sun, hills, flip) so neighbouring cards don't look alike. */

const H = 240

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

/** Smooth rolling hill / water line, closed to the bottom of the picture. */
function hill(W, y, amp, len, phase) {
  let d = `M0,${H}`
  for (let x = 0; x <= W; x += 10) {
    const yy = y + amp * Math.sin(x / len + phase) + amp * 0.35 * Math.sin(x / (len * 0.43) + phase * 1.7)
    d += `L${x},${yy.toFixed(1)}`
  }
  return `${d}L${W},${H}Z`
}

/** Jagged mountain range, closed to the bottom. */
function range(W, y, height, spacing, r) {
  let d = `M0,${H}L0,${y}`
  let up = r() > 0.5
  for (let x = spacing * (0.3 + r() * 0.5); x < W + spacing; x += spacing * (0.7 + r() * 0.6)) {
    d += `L${x.toFixed(1)},${(up ? y - height * (0.55 + r() * 0.45) : y - height * r() * 0.2).toFixed(1)}`
    up = !up
  }
  return `${d}L${W},${y}L${W},${H}Z`
}

const Sun = ({ x, y, r = 18, color = '#ffd27a' }) => (
  <g>
    <circle className="art-glow" cx={x} cy={y} r={r * 1.7} fill={color} opacity=".28" />
    <circle cx={x} cy={y} r={r} fill={color} />
  </g>
)

const Cloud = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill="#fff" opacity=".85">
    <g className="art-cloud">
      <ellipse cx="0" cy="0" rx="22" ry="7" />
      <ellipse cx="-8" cy="-5" rx="10" ry="7" />
      <ellipse cx="7" cy="-6" rx="12" ry="9" />
    </g>
  </g>
)

const Palm = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0,0Q5,-26 -3,-52" fill="none" stroke="#8b6b4c" strokeWidth="4" strokeLinecap="round" />
    <g fill="#3f9d7a">
      <path d="M-3,-52Q-20,-68 -40,-50Q-20,-57 -3,-52Z" />
      <path d="M-3,-52Q14,-70 36,-54Q14,-59 -3,-52Z" />
    </g>
    <g fill="#2f8467">
      <path d="M-3,-52Q-24,-54 -32,-30Q-20,-46 -3,-52Z" />
      <path d="M-3,-52Q18,-54 28,-30Q14,-46 -3,-52Z" />
      <path d="M-3,-52Q-4,-70 -18,-76Q-8,-64 -3,-52Z" />
    </g>
  </g>
)

const RoundTree = ({ x, y, s = 1, color = '#3f9d7a' }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-2" y="-14" width="4" height="14" fill="#8b6b4c" />
    <circle cy="-22" r="13" fill={color} />
    <circle cx="-4" cy="-26" r="5" fill="#fff" opacity=".12" />
  </g>
)

const Pine = ({ x, y, s = 1, color = '#2f8467' }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-2" y="-8" width="4" height="8" fill="#8b6b4c" />
    <path d="M0,-44L12,-22H5L15,-6H-15L-5,-22H-12Z" fill={color} />
  </g>
)

const Birds = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`} fill="none" stroke="#17343d" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round">
    <g className="art-cloud">
      <path d="M0,0q5,-5 9,0q4,-5 9,0" />
      <path d="M24,-10q4,-4 7,0q3,-4 7,0" />
    </g>
  </g>
)

const Chedi = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <g fill="#e3a84f">
      <rect x="-36" y="-8" width="72" height="8" />
      <rect x="-29" y="-16" width="58" height="8" />
      <rect x="-22" y="-24" width="44" height="8" />
      <path d="M-20,-24C-20,-50 -10,-62 0,-66C10,-62 20,-50 20,-24Z" />
      <rect x="-5" y="-73" width="10" height="7" />
      <path d="M-4,-73L0,-112L4,-73Z" />
    </g>
    <g fill="#c4843a">
      <rect x="10" y="-8" width="26" height="8" />
      <rect x="8" y="-16" width="21" height="8" />
      <rect x="6" y="-24" width="16" height="8" />
      <path d="M6,-24C6,-44 3,-58 0,-66C10,-62 20,-50 20,-24Z" />
    </g>
  </g>
)

const Steam = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`} fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity=".9">
    <g className="art-steam">
      <path d="M-12,0c-6,-8 6,-12 0,-22" />
      <path d="M6,-4c-6,-8 6,-12 0,-22" />
    </g>
  </g>
)

const SKIES = {
  sea: [['#a8e2ea', '#fdf3de'], ['#bfeaf0', '#fff0d2'], ['#ffd9b5', '#ffeedd']],
  mountain: [['#cfe9ee', '#fdf1df'], ['#ffdcc0', '#fff4e4'], ['#d9e6f2', '#fbeedd']],
  nature: [['#c6ebe8', '#f5fbe6'], ['#d3f0ea', '#fff6dd']],
  culture: [['#ffcfa3', '#fff1dc'], ['#ffdcb8', '#fff6e6']],
  family: [['#b5e6ee', '#fbf9e5'], ['#c8edf0', '#fff3da']],
  default: [['#c6ebe8', '#fdf4e0'], ['#d6eff0', '#ffefd6']],
  lodging: [['#bcd2e6', '#fde3cc'], ['#f7c9a8', '#fdeedd']],
  cafe: [['#fbefdc', '#f6e0c3']],
  food: [['#fdf0dc', '#fadcb9']],
}

const SCENES = {
  sea(W, r, cx) {
    const sand = Math.min(230, W * 0.55)
    return (
      <>
        <Sun x={cx + 40 + r() * 70} y={46 + r() * 22} />
        <Cloud x={cx - 90} y={42} s={0.9} />
        <path d={`M${cx - 110},134Q${cx - 70},${88 + r() * 12} ${cx - 25},98T${cx + 50},134Z`} fill="#6fb89c" />
        <rect y="130" width={W} height="110" fill="#79cfd6" />
        <path className="art-wave" d={hill(W, 152, 3, 26, r() * 6)} fill="#4db6c6" />
        <path className="art-wave" style={{ animationDirection: 'alternate-reverse' }} d={hill(W, 178, 4, 34, r() * 6)} fill="#2d9cb4" />
        <g stroke="#fff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round">
          <path d={`M${cx - 30},144h26`} />
          <path d={`M${cx + 40},164h34`} />
          <path d={`M${cx - 10},198h24`} />
        </g>
        <g className="art-float">
          <path d={`M${cx + 66},138L${cx + 66},112L${cx + 84},134Z`} fill="#fff" />
          <path d={`M${cx + 58},138H${cx + 90}L${cx + 84},146H${cx + 64}Z`} fill="#e2683f" />
        </g>
        <path d={`M0,${H}L0,192Q${sand * 0.5},182 ${sand},${H}Z`} fill="#f6e4c1" />
        <Palm x={sand * 0.2} y={210} s={1.15} />
      </>
    )
  },
  mountain(W, r, cx) {
    return (
      <>
        <Sun x={cx + (r() - 0.5) * 120} y={70 + r() * 20} r={20} color="#ffc98a" />
        <Birds x={cx - 90 + r() * 40} y={46} />
        <path d={range(W, 150, 62, 62, r)} fill="#b9dbd8" strokeLinejoin="round" />
        <rect y="132" width={W} height="26" fill="#fff" opacity=".35" />
        <path d={range(W, 180, 66, 74, r)} fill="#88bfb7" />
        <rect y="166" width={W} height="20" fill="#fff" opacity=".25" />
        <path d={range(W, 212, 52, 92, r)} fill="#569a8f" />
        <path d={hill(W, 222, 5, 60, r() * 6)} fill="#2f7a6e" />
      </>
    )
  },
  nature(W, r, cx) {
    const trees = []
    for (let x = 14; x < W; x += 34 + r() * 34) {
      if (Math.abs(x - cx) < 34) continue
      const Tree = r() > 0.5 ? Pine : RoundTree
      trees.push(<Tree key={x} x={x} y={190 + r() * 10} s={0.8 + r() * 0.45} color={r() > 0.5 ? '#2f8467' : '#3f9d7a'} />)
    }
    return (
      <>
        <Sun x={cx + 70 + r() * 40} y={48} r={16} />
        <Cloud x={cx - 80} y={46} />
        <path d={hill(W, 122, 12, 70, r() * 6)} fill="#bfe3b4" />
        <path d={hill(W, 158, 10, 54, r() * 6)} fill="#8fd09b" />
        {trees}
        <path d={hill(W, 198, 6, 48, r() * 6)} fill="#5eb383" />
        <path d={`M${cx - 6},150C${cx + 26},176 ${cx - 40},196 ${cx + 8},${H}H${cx + 44}C${cx + 2},200 ${cx + 42},176 ${cx + 6},150Z`} fill="#8fdbe4" />
      </>
    )
  },
  culture(W, r, cx) {
    return (
      <>
        <Sun x={cx + 74} y={66} r={24} color="#ffb871" />
        <Birds x={cx - 120} y={52} />
        <path d={hill(W, 158, 8, 70, r() * 6)} fill="#e9c79b" />
        <Chedi x={cx - 74} y={200} s={0.6} />
        <Chedi x={cx + 72} y={200} s={0.6} />
        <Chedi x={cx} y={204} s={1.15} />
        <path d={hill(W, 204, 3, 60, r() * 6)} fill="#caa06b" />
        <RoundTree x={cx - 128} y={214} s={1.15} color="#5f9a7c" />
        <RoundTree x={cx + 130} y={214} s={1} color="#4a8a6c" />
      </>
    )
  },
  family(W, r, cx) {
    const Balloon = ({ x, y, s, a, b }) => (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <g className="art-float">
        <path d="M0,-30C20,-30 28,-14 26,-2C24,12 8,20 5,30H-5C-8,20 -24,12 -26,-2C-28,-14 -20,-30 0,-30Z" fill={a} />
        <path d="M0,-30C8,-30 11,-14 10,-2C9,12 3,20 2,30H-2C-3,20 -9,12 -10,-2C-11,-14 -8,-30 0,-30Z" fill={b} />
        <path d="M-5,30L-4,38M5,30L4,38" stroke="#8b6b4c" strokeWidth="1.2" />
        <rect x="-5" y="38" width="10" height="8" rx="1.5" fill="#8b6b4c" />
        </g>
      </g>
    )
    return (
      <>
        <Cloud x={cx - 110} y={50} />
        <Cloud x={cx + 118} y={38} s={0.8} />
        <Balloon x={cx - 26} y={84} s={1.2} a="#e2683f" b="#ffc56b" />
        <Balloon x={cx + 70} y={60 + r() * 20} s={0.75} a="#2a9db5" b="#fff" />
        <path d={hill(W, 168, 10, 60, r() * 6)} fill="#bfe3b4" />
        <path d={hill(W, 200, 8, 48, r() * 6)} fill="#85cc97" />
        <RoundTree x={cx - 120} y={206} s={1.1} />
        <RoundTree x={cx + 112} y={208} s={0.95} color="#2f8467" />
      </>
    )
  },
  lodging(W, r, cx) {
    return (
      <>
        <Sun x={cx + 96} y={52} r={15} color="#fff1c9" />
        <path d={hill(W, 150, 12, 64, r() * 6)} fill="#a9c9b8" />
        <path d={hill(W, 190, 6, 52, r() * 6)} fill="#6fae92" />
        <Palm x={cx - 92} y={200} s={1.15} />
        <g transform={`translate(${cx} 202)`}>
          <rect x="-46" y="-40" width="92" height="40" fill="#fbf1de" />
          <path d="M-60,-38L0,-78L60,-38Z" fill="#c95f3b" />
          <path d="M0,-78L60,-38H24Z" fill="#ab4d2d" />
          <rect x="-10" y="-26" width="20" height="26" rx="2" fill="#8b6b4c" />
          <rect x="-36" y="-30" width="18" height="15" rx="2" fill="#ffd27a" />
          <rect x="18" y="-30" width="18" height="15" rx="2" fill="#ffd27a" />
        </g>
        <path d={hill(W, 208, 3, 44, r() * 6)} fill="#4f9478" />
      </>
    )
  },
  cafe(W, r, cx) {
    return (
      <>
        <g transform={`translate(${cx + 56} 28)`}>
          <rect width="96" height="118" rx="48" fill="#fff" />
          <rect x="6" y="6" width="84" height="106" rx="42" fill="#bfe8ea" />
          <path d="M6,84C26,68 44,72 58,82S84,84 90,78V112H6Z" fill="#7cc08f" />
          <path d="M48,6V112M6,62H90" stroke="#fff" strokeWidth="4" />
        </g>
        <g transform={`translate(${cx - 118} 170)`}>
          <path d="M-14,0L-10,26H10L14,0Z" fill="#c95f3b" />
          <path d="M0,0C-4,-22 -22,-30 -30,-30C-28,-16 -16,-4 0,0Z" fill="#3f9d7a" />
          <path d="M0,0C4,-26 20,-38 30,-38C28,-20 16,-6 0,0Z" fill="#2f8467" />
          <path d="M0,0C-4,-22 0,-40 4,-48C10,-34 8,-14 0,0Z" fill="#5eb383" />
        </g>
        <rect y="196" width={W} height="44" fill="#b98a5e" />
        <rect y="196" width={W} height="6" fill="#a47850" />
        <g transform={`translate(${cx - 18} 196)`}>
          <ellipse cy="-2" rx="52" ry="7" fill="#fff" />
          <path d="M34,-42c20,-4 22,22 -6,24" fill="none" stroke="#fff" strokeWidth="7" />
          <path d="M-36,-52H36L30,-16C28,-8 20,-6 14,-6H-14C-20,-6 -28,-8 -30,-16Z" fill="#fff" />
          <ellipse cy="-52" rx="36" ry="7" fill="#7a4e2d" />
          <Steam x={0} y={-66} />
        </g>
      </>
    )
  },
  food(W, r, cx) {
    return (
      <>
        <rect y="176" width={W} height="64" fill="#e6ac74" />
        <rect y="176" width={W} height="5" fill="#d3965d" />
        <g transform={`translate(${cx} 158)`}>
          <Steam x={0} y={-36} />
          <path d="M34,-24L92,-74M46,-18L100,-64" stroke="#8b5a35" strokeWidth="5" strokeLinecap="round" />
          <ellipse cy="-10" rx="66" ry="17" fill="#f6d78c" />
          <path d="M-46,-10q12,-10 24,0t24,0t24,0t22,0" fill="none" stroke="#e9bb5a" strokeWidth="4" strokeLinecap="round" />
          <circle cx="-26" cy="-14" r="5" fill="#5eb383" />
          <circle cx="16" cy="-17" r="5" fill="#e2683f" />
          <circle cx="36" cy="-8" r="4" fill="#5eb383" />
          <path d="M-68,-8H68C66,26 36,42 0,42S-66,26 -68,-8Z" fill="#0e7490" />
          <path d="M-58,12q15,10 29,0t29,0t29,0t29,0" fill="none" stroke="#a9dfe0" strokeWidth="3" />
          <ellipse cy="44" rx="42" ry="5" fill="#0b5568" />
        </g>
      </>
    )
  },
  default(W, r, cx) {
    return (
      <>
        <Sun x={cx + 90} y={52} r={16} />
        <Cloud x={cx - 92} y={48} />
        <path d={hill(W, 138, 12, 64, r() * 6)} fill="#bfe3c4" />
        <path d={hill(W, 176, 9, 52, r() * 6)} fill="#8fd09b" />
        <path d={`M${cx - 130},${H}C${cx - 60},196 ${cx + 50},214 ${cx},154`} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 11" />
        <g transform={`translate(${cx} 150)`}>
          <ellipse cy="2" rx="12" ry="4" fill="#17343d" opacity=".18" />
          <path d="M0,0C-6,-12 -20,-22 -20,-38A20,20 0 1 1 20,-38C20,-22 6,-12 0,0Z" fill="#e2683f" />
          <circle cy="-38" r="8" fill="#fff" />
        </g>
        <RoundTree x={cx - 112} y={186} />
        <RoundTree x={cx + 118} y={190} s={0.9} color="#2f8467" />
      </>
    )
  },
}

function buildScene(family, seed, W) {
  const r = rng(hash(String(seed)))
  const skies = SKIES[family] || SKIES.default
  const sky = skies[Math.floor(r() * skies.length)]
  const cx = W / 2 + (W > 500 ? 0 : (r() - 0.5) * 24)
  const flip = r() > 0.5
  const body = (SCENES[family] || SCENES.default)(W, r, cx)
  return { sky, flip, body }
}

const photoRequests = new Map()

// A first-time lookup can take a while. Browsers allow about 6 connections per host, so photos may use
// only 2 of them: the rest stay free for the page's own data.
let photoSlots = 2
const photoQueue = []
function queuePhotoRequest(placeId) {
  return new Promise((resolve, reject) => {
    const run = () => {
      photoSlots -= 1
      api.placePhoto(placeId).then(resolve, reject).finally(() => {
        photoSlots += 1
        photoQueue.shift()?.()
      })
    }
    if (photoSlots > 0) run()
    else photoQueue.push(run)
  })
}

/** After an admin changes a place's photos, the next card asks the server again. */
export const forgetPlacePhoto = (placeId) => photoRequests.delete(placeId)

/** The place's real photo once the card is on screen; several cards of one place share one request. */
function usePlacePhoto(placeId, enabled) {
  const [ref, seen] = useInView()
  const [photo, setPhoto] = useState(null)
  useEffect(() => {
    setPhoto(null)
    if (!enabled || !placeId || !seen) return
    let alive = true
    if (!photoRequests.has(placeId)) {
      photoRequests.set(placeId, queuePhotoRequest(placeId).then((r) => r.photo).catch(() => {
        photoRequests.delete(placeId) // a failed request may succeed next time
        return null
      }))
    }
    photoRequests.get(placeId).then((p) => alive && setPhoto(p))
    return () => {
      alive = false
    }
  }, [placeId, enabled, seen])
  return [ref, photo]
}

function creditText(p) {
  if (p.source === 'admin') return p.author ? `ภาพ: ${p.author}` : ''
  return `ภาพ: ${p.author || 'ไม่ระบุผู้ถ่าย'} / ${p.license} ผ่าน Wikimedia Commons`
}

/** The illustration is the base layer; a real photo fades in over it when one exists and loads. */
export default function PlaceArt({ place, className = '', showLabel = true, live = false, usePhoto = true, showCredit = false, w = 400, h = H }) {
  const family = familyOf(place)
  const seed = place?.place_id || place?.name || 'x'
  const W = Math.round((H * w) / h)
  const scene = useMemo(() => buildScene(family, seed, W), [family, seed, W])
  const [ref, photo] = usePlacePhoto(place?.place_id, usePhoto)
  const [loadedUrl, setLoadedUrl] = useState(null)
  // banners are wide, so they get the large file; cards and thumbnails the small one
  const src = photo && assetUrl(w > 600 ? photo.url : photo.thumb_url || photo.url)
  const credit = photo ? creditText(photo) : ''
  const creditLink = photo?.source_url || photo?.article_url
  const shown = photo && loadedUrl === src
  return (
    <div ref={ref} className={`relative overflow-hidden ${live ? 'art-live' : ''} ${className}`} style={{ background: `linear-gradient(180deg, ${scene.sky[0]}, ${scene.sky[1]})` }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-105" aria-hidden="true">
        <g transform={scene.flip ? `translate(${W} 0) scale(-1 1)` : undefined}>{scene.body}</g>
      </svg>
      {photo && (
        <img
          src={src}
          alt={showCredit ? (place?.name || '') : ''}
          title={credit || undefined}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(src)}
          className={`absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105 ${shown ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {showCredit && shown && credit && (creditLink ? (
        <a
          href={creditLink}
          target="_blank"
          rel="noreferrer"
          className="absolute right-2 top-2 max-w-[80%] truncate rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-white hover:bg-black/70"
        >
          {credit}
        </a>
      ) : (
        <span className="absolute right-2 top-2 max-w-[80%] truncate rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-white">{credit}</span>
      ))}
      {showLabel && (
        <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-medium text-forest-deep shadow-sm">
          {place?.primary_type || FAMILY_LABEL[family]}
        </span>
      )}
    </div>
  )
}
