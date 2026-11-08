import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { InterestChips, useInterests } from '../components/Bits'
import MapView from '../components/MapView'
import { CountUp } from '../components/Motion'
import PlaceCard from '../components/PlaceCard'
import { CardSkeletons, EmptyState, ErrorState } from '../components/States'
import { api } from '../lib/api'
import { fmtInt } from '../lib/format'

const PAGE = 18

function useProvinces() {
  const [list, setList] = useState([])
  useEffect(() => {
    api.provinces().then(setList).catch(() => {})
  }, [])
  return list
}

function StartPointPicker({ start, onChange }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [geoState, setGeoState] = useState(null)
  const ctrl = useRef()

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      ctrl.current?.abort()
      ctrl.current = new AbortController()
      api
        .searchPlaces({ q, limit: 6 }, ctrl.current.signal)
        .then((d) => setResults(d.items))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoState('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง')
      return
    }
    setGeoState('กำลังหาตำแหน่ง…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        if (lat < 5 || lat > 21 || lng < 97 || lng > 106) {
          setGeoState('ตำแหน่งปัจจุบันอยู่นอกประเทศไทย เลือกจุดเริ่มต้นจากการค้นหาหรือคลิกบนแผนที่แทน')
          return
        }
        setGeoState(null)
        onChange({ lat, lng, label: 'ตำแหน่งปัจจุบันของคุณ' })
      },
      (err) => setGeoState(err.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง ลองค้นหาจุดเริ่มต้นแทน' : 'หาตำแหน่งไม่สำเร็จ'),
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={useMyLocation} className="w-full rounded-xl btn-primary px-3 py-2 text-sm font-medium text-white">
        ใช้ตำแหน่งปัจจุบัน
      </button>
      {geoState && <p className="text-xs text-muted">{geoState}</p>}
      <div className="relative">
        <label htmlFor="start-q" className="sr-only">ค้นหาจุดเริ่มต้น</label>
        <input
          id="start-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="หรือค้นหาจุดเริ่มต้นจากชื่อสถานที่"
          className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/15 outline-none focus:ring-2 focus:ring-moss"
        />
        {results.length > 0 && (
          <ul className="absolute z-[1100] mt-1 max-h-64 w-full overflow-auto rounded-xl card-sky py-1 shadow-lg ring-1 ring-forest/5">
            {results.map((p) => (
              <li key={p.place_id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-mist"
                  onClick={() => {
                    onChange({ lat: p.lat, lng: p.lng, label: p.name })
                    setQ('')
                    setResults([])
                  }}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">{p.province}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">คลิกบนแผนที่ด้านขวาเพื่อปักจุดเริ่มต้นได้เช่นกัน</p>
      {start && (
        <p className="rounded-xl bg-sun-soft px-3 py-2 text-sm">
          จุดเริ่มต้น: <b>{start.label}</b>
        </p>
      )}
    </div>
  )
}

export default function Recommend() {
  const [sp, setSp] = useSearchParams()
  const interests = useInterests()
  const provinces = useProvinces()

  const mode = sp.get('mode') === 'location' ? 'location' : 'interest'
  const picked = useMemo(() => (sp.get('interests') || '').split(',').filter(Boolean), [sp])
  const q = sp.get('q') || ''
  const province = sp.get('province') || ''
  const minRating = sp.get('min_rating') || ''
  const radius = Number(sp.get('radius_km') || 30)
  const lodging = sp.get('lodging') === '1'
  const start = sp.get('lat') && sp.get('lng') ? { lat: Number(sp.get('lat')), lng: Number(sp.get('lng')), label: sp.get('start') || 'จุดที่เลือก' } : null

  const [qDraft, setQDraft] = useState(q)
  const [state, setState] = useState({ loading: true })
  const [page, setPage] = useState(0)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => setQDraft(q), [q])

  const update = useCallback(
    (patch) => {
      const next = new URLSearchParams(sp)
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '' || v === false) next.delete(k)
        else next.set(k, String(v))
      })
      setSp(next, { replace: true })
      setPage(0)
    },
    [sp, setSp],
  )

  const setStart = (s) => update({ lat: s.lat.toFixed(5), lng: s.lng.toFixed(5), start: s.label })

  const load = useCallback(
    (signal) => {
      if (mode === 'location' && !start) {
        setState({ needStart: true })
        return
      }
      setState((s) => ({ loading: true, items: page > 0 ? s.items : undefined }))
      api
        .recommend(
          {
            mode,
            interests: picked.join(','),
            q,
            province: mode === 'interest' ? province : '',
            min_rating: minRating,
            lat: start?.lat,
            lng: start?.lng,
            radius_km: mode === 'location' ? radius : undefined,
            only_accommodation: lodging || undefined,
            limit: PAGE,
            offset: page * PAGE,
          },
          signal,
        )
        .then((d) => setState((s) => ({ ...d, items: page > 0 ? [...(s.items || []), ...d.items] : d.items })))
        .catch((error) => error.name !== 'AbortError' && setState({ error }))
    },
    [mode, picked.join(','), q, province, minRating, start?.lat, start?.lng, radius, lodging, page], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    const c = new AbortController()
    load(c.signal)
    return () => c.abort()
  }, [load])

  const toggleInterest = (k) => update({ interests: (picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]).join(',') })

  const filters = (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-semibold text-forest">วิธีแนะนำ</p>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-mist p-1" role="radiogroup">
          {[
            ['interest', 'ตามความสนใจ'],
            ['location', 'ใกล้จุดเริ่มต้น'],
          ].map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={mode === k}
              onClick={() => update({ mode: k === 'interest' ? null : k })}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${mode === k ? 'bg-white text-forest shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'location' && (
        <div>
          <p className="mb-2 text-sm font-semibold text-forest">จุดเริ่มต้น</p>
          <StartPointPicker start={start} onChange={setStart} />
          <label className="mt-4 block text-sm font-semibold text-forest" htmlFor="radius">
            รัศมี {radius} กม.
          </label>
          <input id="radius" type="range" min={5} max={150} step={5} value={radius} onChange={(e) => update({ radius_km: e.target.value })} className="mt-1 w-full accent-forest" />
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-forest">ความสนใจ</p>
        <InterestChips interests={interests} selected={picked} onToggle={toggleInterest} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: qDraft.trim() })
        }}
      >
        <label htmlFor="rq" className="mb-2 block text-sm font-semibold text-forest">คำค้นเพิ่มเติม</label>
        <div className="flex gap-2">
          <input id="rq" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="เช่น น้ำตก, ทะเลหมอก" className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/15 outline-none focus:ring-2 focus:ring-moss" />
          <button className="btn-primary rounded-xl px-3 text-sm font-medium text-white">ค้นหา</button>
        </div>
      </form>

      {mode === 'interest' && (
        <div>
          <label htmlFor="prov" className="mb-2 block text-sm font-semibold text-forest">จังหวัด</label>
          <select id="prov" value={province} onChange={(e) => update({ province: e.target.value })} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/15">
            <option value="">ทุกจังหวัด (77)</option>
            {provinces.map((p) => (
              <option key={p.province} value={p.province}>
                {p.province} ({fmtInt(p.count)})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="minr" className="mb-2 block text-sm font-semibold text-forest">คะแนนขั้นต่ำ</label>
        <select id="minr" value={minRating} onChange={(e) => update({ min_rating: e.target.value })} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/15">
          <option value="">ไม่จำกัด</option>
          <option value="4">4.0 ขึ้นไป</option>
          <option value="4.5">4.5 ขึ้นไป</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={lodging} onChange={(e) => update({ lodging: e.target.checked ? 1 : null })} className="h-4 w-4 accent-forest" />
        แสดงเฉพาะที่พัก
      </label>
    </div>
  )

  const items = state.items || []
  const activeFilters = picked.length + [q, province, minRating, lodging].filter(Boolean).length
  const markers = items.filter((p) => p.lat != null).map((p, i) => ({ lat: p.lat, lng: p.lng, label: i + 1, title: p.name, subtitle: p.province, kind: p.is_accommodation ? 'hotel' : 'place' }))
  if (start) markers.unshift({ lat: start.lat, lng: start.lng, label: '★', start: true, title: start.label })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-gradient-sky pb-1 text-3xl font-semibold sm:text-4xl">{mode === 'location' ? 'ที่เที่ยวใกล้จุดเริ่มต้น' : 'ที่เที่ยวที่ตรงกับคุณ'}</h1>
      <p className="mt-1 text-muted">
        จัดอันดับด้วย Content-Based Filtering ร่วมกับคะแนนรีวิวและผลวิเคราะห์ความรู้สึกจากข้อความรีวิว
      </p>

      <button onClick={() => setShowFilters(!showFilters)} className="mt-5 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-forest ring-1 ring-forest/15 lg:hidden" aria-expanded={showFilters}>
        {showFilters ? 'ซ่อนตัวกรอง' : 'ตัวกรองและโหมดแนะนำ'}
        {activeFilters > 0 && <span key={activeFilters} className="pop-in ml-2 rounded-full bg-forest px-2 text-xs text-white">{activeFilters}</span>}
      </button>

      <div className="mt-6 grid gap-8 lg:grid-cols-[300px_1fr]">
        <aside className={`${showFilters ? 'fade-up block' : 'hidden'} lg:block`}>
          <div className="rounded-2xl card-sky p-5 ring-1 ring-forest/5 lg:sticky lg:top-24">{filters}</div>
        </aside>

        <section aria-live="polite">
          {mode === 'location' && (
            <MapView className="mb-6 h-72 sm:h-80" markers={markers} onMapClick={(p) => setStart({ ...p, label: `ปักหมุด ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` })} />
          )}

          {state.total != null && !state.loading && (
            <p className="mb-4 text-sm text-muted">
              พบ <CountUp value={state.total} className="font-semibold text-forest" /> แห่ง{mode === 'location' && ` ในรัศมี ${radius} กม. (ระยะเส้นตรง)`}
            </p>
          )}

          {state.needStart && (
            <EmptyState title="เลือกจุดเริ่มต้นก่อน">ใช้ตำแหน่งปัจจุบัน ค้นหาชื่อสถานที่ หรือคลิกบนแผนที่ แล้วเราจะแนะนำที่เที่ยวรอบ ๆ ให้</EmptyState>
          )}
          {state.error && <ErrorState error={state.error} onRetry={() => load()} />}
          {state.loading && !items.length && <CardSkeletons n={6} />}
          {!state.loading && !state.error && !state.needStart && items.length === 0 && (
            <EmptyState title="ไม่พบสถานที่ที่ตรงเงื่อนไข">ลองลดตัวกรอง เช่น ยกเลิกคะแนนขั้นต่ำ เปลี่ยนจังหวัด หรือขยายรัศมีค้นหา</EmptyState>
          )}
          {items.length > 0 && (
            <>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((p, i) => <PlaceCard key={p.place_id} place={p} rank={i + 1} index={i % PAGE} />)}
              </div>
              {state.total > items.length && (
                <div className="mt-8 text-center">
                  <button disabled={state.loading} aria-busy={state.loading || undefined} onClick={() => setPage(page + 1)} className="btn-ripple rounded-full bg-white px-6 py-2.5 font-medium text-forest ring-1 ring-forest/25 transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50">
                    {state.loading ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
