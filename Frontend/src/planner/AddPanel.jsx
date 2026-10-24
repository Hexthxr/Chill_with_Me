import { useEffect, useRef, useState } from 'react'
import { Rating, SentimentPill } from '../components/Bits'
import { Spinner } from '../components/States'
import { api } from '../lib/api'
import { fmtRating } from '../lib/format'
import { useToast, useTrip } from '../store/tripStore'
import { DEFAULT_DURATION, emptyBlock, KIND_LABEL } from './planUtils'

const TABS = [
  ['search', 'ค้นหา'],
  ['near', 'ใกล้จุดล่าสุด'],
  ['hotel', 'ที่พัก'],
  ['special', 'อาหาร/พัก'],
]

function useActiveDayPoints() {
  const days = useTrip((s) => s.days)
  const activeDay = useTrip((s) => s.activeDay)
  const pts = days[activeDay]?.blocks.filter((b) => b.lat != null).map((b) => [b.lat, b.lng]) || []
  if (pts.length) return pts
  // fall back to the last located block of any earlier day
  for (let d = activeDay - 1; d >= 0; d--) {
    const loc = days[d].blocks.filter((b) => b.lat != null)
    if (loc.length) return [[loc[loc.length - 1].lat, loc[loc.length - 1].lng]]
  }
  return []
}

function ResultRow({ place, onAdd, extra }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-xl card-sky p-3 ring-1 ring-forest/5">
      <div className="min-w-0">
        <p className="font-medium leading-snug">{place.name}</p>
        <p className="text-xs text-muted">{place.primary_type ? `${place.primary_type}, ` : ''}{place.province}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Rating rating={place.rating} count={place.rating_count} className="text-xs" />
          <SentimentPill ml={place.ml} />
        </div>
        {extra}
      </div>
      <button onClick={() => onAdd(place)} className="shrink-0 rounded-full btn-primary px-3 py-1.5 text-xs font-medium text-white" aria-label={`เพิ่ม ${place.name}`}>
        เพิ่ม
      </button>
    </li>
  )
}

function SearchTab({ onAdd }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('attraction')
  const [state, setState] = useState({})
  const ctrl = useRef()
  useEffect(() => {
    if (q.trim().length < 2) {
      setState({})
      return
    }
    const t = setTimeout(() => {
      ctrl.current?.abort()
      ctrl.current = new AbortController()
      setState({ loading: true })
      api
        .searchPlaces({ q, kind, limit: 12 }, ctrl.current.signal)
        .then((d) => setState(d))
        .catch((error) => error.name !== 'AbortError' && setState({ error }))
    }, 300)
    return () => clearTimeout(t)
  }, [q, kind])
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อสถานที่ อย่างน้อย 2 ตัวอักษร" aria-label="ค้นหาสถานที่" className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/15 outline-none focus:ring-2 focus:ring-moss" />
      <div className="flex gap-1 text-xs">
        {[['attraction', 'ที่เที่ยว'], ['food', 'ร้านอาหาร/คาเฟ่'], ['accommodation', 'ที่พัก']].map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`rounded-full px-3 py-1 ${kind === k ? 'bg-forest text-white' : 'bg-white text-forest ring-1 ring-forest/15'}`}>{l}</button>
        ))}
      </div>
      {state.loading && <Spinner />}
      {state.error && <p className="text-sm text-alert">{state.error.message}</p>}
      {state.items?.length === 0 && <p className="text-sm text-muted">ไม่พบ “{q}” ลองคำอื่นหรือเปลี่ยนประเภท</p>}
      <ul className="space-y-2">{state.items?.map((p) => <ResultRow key={p.place_id} place={p} onAdd={onAdd} />)}</ul>
    </div>
  )
}

function NearTab({ onAdd }) {
  const pts = useActiveDayPoints()
  const last = pts[pts.length - 1]
  const [state, setState] = useState({})
  useEffect(() => {
    if (!last) return
    setState({ loading: true })
    api
      .recommend({ mode: 'location', lat: last[0], lng: last[1], radius_km: 20, limit: 10 })
      .then(setState)
      .catch((error) => setState({ error }))
  }, [last?.[0], last?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!last) return <p className="text-sm text-muted">เพิ่มสถานที่ที่มีพิกัดลงวันนี้ก่อน แล้วเราจะแนะนำที่เที่ยวรอบจุดล่าสุดด้วย ML</p>
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">แนะนำในรัศมี 20 กม. จากจุดล่าสุดของวันนี้ (ระยะเส้นตรง)</p>
      {state.loading && <Spinner />}
      {state.error && <p className="text-sm text-alert">{state.error.message}</p>}
      <ul className="space-y-2">
        {state.items?.map((p) => (
          <ResultRow key={p.place_id} place={p} onAdd={onAdd} extra={<p className="mt-1 text-xs text-forest">{p.distance_km} กม. — {p.reasons?.[0]}</p>} />
        ))}
      </ul>
    </div>
  )
}

function HotelTab({ onAdd }) {
  const pts = useActiveDayPoints()
  const [budget, setBudget] = useState('')
  const [radius, setRadius] = useState(5)
  const [state, setState] = useState({})
  const [coverage, setCoverage] = useState(null)
  useEffect(() => {
    api.hotelCoverage().then(setCoverage).catch(() => {})
  }, [])
  const key = JSON.stringify(pts)
  useEffect(() => {
    if (!pts.length) return
    setState({ loading: true })
    api
      .hotelsAlongRoute({ points: pts, radius_km: radius, max_price_usd: budget ? Number(budget) : null, include_unpriced: !budget, limit: 12 })
      .then(setState)
      .catch((error) => setState({ error }))
  }, [key, budget, radius]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!pts.length) return <p className="text-sm text-muted">เพิ่มสถานที่ลงวันนี้ก่อน เพื่อค้นหาที่พักใกล้เส้นทาง</p>
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label>
          <span className="text-xs text-muted">ห่างจากเส้นทางไม่เกิน</span>
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-0.5 w-full rounded-lg bg-white px-2 py-1.5 ring-1 ring-forest/15">
            {[2, 5, 10, 20].map((r) => <option key={r} value={r}>{r} กม.</option>)}
          </select>
        </label>
        <label>
          <span className="text-xs text-muted">งบต่อคืน (USD)</span>
          <input type="number" min="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="ไม่จำกัด" className="mt-0.5 w-full rounded-lg bg-white px-2 py-1.5 ring-1 ring-forest/15" />
        </label>
      </div>
      {coverage && (
        <p className="rounded-lg bg-sun-soft px-3 py-2 text-xs text-[#6b4f0e]">
          {coverage.note} — เมื่อกรองงบประมาณ จะแสดงเฉพาะที่พักที่มีราคาในชุดข้อมูลเท่านั้น
        </p>
      )}
      {state.loading && <Spinner />}
      {state.error && <p className="text-sm text-alert">{state.error.message}</p>}
      {state.items?.length === 0 && <p className="text-sm text-muted">ไม่พบที่พักตามเงื่อนไข ลองขยายระยะหรือยกเลิกงบประมาณ</p>}
      <ul className="space-y-2">
        {state.items?.map((h) => (
          <ResultRow
            key={h.place_id}
            place={{ ...h, is_accommodation: true, ml: { positive_share: h.sentiment.positive_share, n_analyzed: h.sentiment.n_analyzed } }}
            onAdd={(p) => onAdd(p, 'hotel')}
            extra={
              <p className="mt-1 text-xs text-muted">
                ห่างเส้นทาง {h.distance_km} กม., {h.price ? <b className="text-forest">เริ่ม ${h.price.usd_min}/คืน</b> : 'ไม่มีข้อมูลราคา'}
                {h.price?.booking_rating_10 && ` (Booking ${fmtRating(h.price.booking_rating_10)}/10)`}
              </p>
            }
          />
        ))}
      </ul>
    </div>
  )
}

function SpecialTab() {
  const addBlock = useTrip((s) => s.addBlock)
  const activeDay = useTrip((s) => s.activeDay)
  const push = useToast((s) => s.push)
  const [name, setName] = useState('')
  const add = (kind, label) => {
    addBlock(emptyBlock(kind, name.trim() || label))
    push(`เพิ่ม ${name.trim() || label} ลงวันที่ ${activeDay + 1}`)
    setName('')
  }
  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ Block (ไม่บังคับ)" aria-label="ชื่อ Block" className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/15" />
      <div className="grid grid-cols-2 gap-2">
        {[
          ['food', 'มื้อเช้า'],
          ['food', 'มื้อกลางวัน'],
          ['food', 'มื้อเย็น'],
          ['rest', 'พักผ่อน'],
          ['custom', 'กิจกรรมอื่น'],
          ['hotel', 'เช็กอินที่พัก'],
        ].map(([k, l]) => (
          <button key={l} onClick={() => add(k, l)} className="rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-forest/15 hover:ring-forest/40">
            <span className="block font-medium">{l}</span>
            <span className="text-xs text-muted">{KIND_LABEL[k]}, {DEFAULT_DURATION[k]} นาที</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">Block ที่ไม่มีพิกัดจะไม่ถูกนำไปคิดเวลาเดินทาง ถ้าต้องการร้านอาหารจริง ให้ค้นหาในแท็บ “ค้นหา” แล้วเลือกประเภทร้านอาหาร/คาเฟ่</p>
    </div>
  )
}

export default function AddPanel() {
  const [tab, setTab] = useState('search')
  const addPlace = useTrip((s) => s.addPlace)
  const activeDay = useTrip((s) => s.activeDay)
  const push = useToast((s) => s.push)
  const onAdd = (place, kind) => {
    addPlace(place, kind)
    push(`เพิ่ม “${place.name}” ลงวันที่ ${activeDay + 1}`)
  }
  return (
    <div className="rounded-3xl bg-white/70 p-4 ring-1 ring-forest/5">
      <h2 className="text-lg text-ink">เพิ่มลงวันที่ {activeDay + 1}</h2>
      <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-forest text-white' : 'text-forest hover:bg-mist'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'search' && <SearchTab onAdd={onAdd} />}
        {tab === 'near' && <NearTab onAdd={onAdd} />}
        {tab === 'hotel' && <HotelTab onAdd={onAdd} />}
        {tab === 'special' && <SpecialTab />}
      </div>
    </div>
  )
}
