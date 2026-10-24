import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { InterestChips, Rating, SentimentPill, useInterests } from '../components/Bits'
import PlaceArt from '../components/PlaceArt'
import PlaceCard from '../components/PlaceCard'
import { CardSkeletons, EmptyState, ErrorState } from '../components/States'
import { api } from '../lib/api'
import { addDaysISO, fmtInt, fmtThaiDate, todayISO } from '../lib/format'
import { useToast, useTrip } from '../store/tripStore'

/* ------------------------------------------------------------------ search card */

function DateBox({ id, label, value, min, onChange }) {
  const [d, ...rest] = fmtThaiDate(value).split(' ')
  return (
    <label htmlFor={id} className="relative block cursor-pointer px-5 py-3">
      <span className="sr-only">{label}</span>
      <span className="block text-[15px] text-ink">{rest.join(' ')}</span>
      <span className="block text-xs text-muted">{label}, {d}</span>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={(e) => e.currentTarget.showPicker?.()}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  )
}

function nightsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000)
}

function SearchCard() {
  const navigate = useNavigate()
  const interests = useInterests()
  const setMeta = useTrip((s) => s.setMeta)
  const setDayCount = useTrip((s) => s.setDayCount)
  const push = useToast((s) => s.push)

  const [tab, setTab] = useState('stay')
  const [provinces, setProvinces] = useState([])
  const [dest, setDest] = useState('')
  const [checkIn, setCheckIn] = useState(addDaysISO(todayISO(), 7))
  const [checkOut, setCheckOut] = useState(addDaysISO(todayISO(), 8))
  const [useInTrip, setUseInTrip] = useState(true)
  const [mode, setMode] = useState('interest')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([])
  const [geo, setGeo] = useState(null)

  useEffect(() => {
    api.provinces().then(setProvinces).catch(() => {})
  }, [])

  const nights = Math.max(1, nightsBetween(checkIn, checkOut))
  const setIn = (v) => {
    setCheckIn(v)
    if (nightsBetween(v, checkOut) < 1) setCheckOut(addDaysISO(v, 1))
  }

  const findProvince = (text) => {
    const t = text.trim().toLowerCase()
    return provinces.find((p) => p.province === text.trim() || p.province_en?.toLowerCase() === t)
  }

  const submitStay = (e) => {
    e.preventDefault()
    const p = new URLSearchParams({ lodging: '1' })
    const prov = findProvince(dest)
    if (prov) p.set('province', prov.province)
    else if (dest.trim()) p.set('q', dest.trim())
    if (useInTrip) {
      setMeta({ start_date: checkIn })
      setDayCount(Math.min(14, nights + 1))
      push(`ตั้งแผนทริปเป็น ${fmtThaiDate(checkIn, false)}, ${Math.min(14, nights + 1)} วัน`)
    }
    navigate(`/recommend?${p.toString()}`)
  }

  const submitPlace = (e) => {
    e.preventDefault()
    if (mode === 'near') {
      if (!navigator.geolocation) return navigate('/recommend?mode=location')
      setGeo('กำลังหาตำแหน่ง…')
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => navigate(`/recommend?mode=location&lat=${coords.latitude.toFixed(5)}&lng=${coords.longitude.toFixed(5)}&start=${encodeURIComponent('ตำแหน่งปัจจุบันของคุณ')}${picked.length ? `&interests=${picked.join(',')}` : ''}`),
        () => navigate('/recommend?mode=location'),
        { timeout: 10000 },
      )
      return
    }
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (picked.length) p.set('interests', picked.join(','))
    navigate(`/recommend?${p.toString()}`)
  }

  const tabCls = (k) =>
    `flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition ${tab === k ? 'border-forest font-medium text-forest' : 'border-transparent text-muted hover:text-ink'}`
  const pillCls = (on) =>
    `rounded-full px-4 py-1.5 text-sm transition ${on ? 'bg-leaf text-forest ring-1 ring-forest' : 'bg-white text-ink ring-1 ring-sand hover:ring-moss'}`

  return (
    <div className="relative mx-auto -mt-28 w-full max-w-4xl px-4 sm:-mt-32">
      <div className="mx-auto w-fit rounded-t-2xl bg-white px-4 shadow-sm sm:w-[88%]" role="tablist" aria-label="ประเภทการค้นหา">
        <div className="flex">
          <button role="tab" aria-selected={tab === 'stay'} className={tabCls('stay')} onClick={() => setTab('stay')}>
            <BedIcon /> ที่พัก
          </button>
          <button role="tab" aria-selected={tab === 'place'} className={tabCls('place')} onClick={() => setTab('place')}>
            <PinIcon /> สถานที่ท่องเที่ยว
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-[#f7f7f9] p-4 shadow-[0_8px_24px_rgba(29,36,51,0.12)] sm:p-7">
        {tab === 'stay' ? (
          <form onSubmit={submitStay} className="space-y-3">
            <label htmlFor="dest" className="sr-only">จุดหมายปลายทางหรือชื่อที่พัก</label>
            <input
              id="dest"
              list="province-list"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="ใส่จุดหมายปลายทาง (จังหวัด) หรือชื่อที่พัก"
              className="w-full rounded-lg border border-sand bg-white px-5 py-4 text-[15px] outline-none focus:border-moss"
            />
            <datalist id="province-list">
              {provinces.map((p) => <option key={p.province} value={p.province}>{p.province_en}</option>)}
            </datalist>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="grid grid-cols-2 divide-x divide-sand rounded-lg border border-sand bg-white">
                <DateBox id="ci" label="เช็กอิน" value={checkIn} min={todayISO()} onChange={setIn} />
                <DateBox id="co" label="เช็กเอาต์" value={checkOut} min={addDaysISO(checkIn, 1)} onChange={setCheckOut} />
              </div>
              <div className="rounded-lg border border-sand bg-white px-5 py-3">
                <span className="block text-[15px]">{nights} คืน</span>
                <span className="block text-xs text-muted">ทริป {Math.min(14, nights + 1)} วัน</span>
              </div>
            </div>
            <label className="flex items-center gap-2 pt-1 text-sm">
              <input type="checkbox" checked={useInTrip} onChange={(e) => setUseInTrip(e.target.checked)} className="h-4 w-4 accent-[#2067da]" />
              ใช้วันที่นี้เป็นวันเดินทางในแผนทริป
            </label>
            <p className="text-xs text-muted">ข้อมูลที่พักมาจากชุดข้อมูลของระบบ (ส่วนใหญ่อยู่ภาคเหนือและอีสาน) และยังไม่มีระบบจองหรือเช็กห้องว่าง</p>
            <div className="pt-2 text-center">
              <button className="w-full max-w-sm rounded-full bg-forest py-3 text-[15px] font-medium text-white hover:bg-forest-deep">ค้นหาที่พัก</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitPlace} className="space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="วิธีค้นหา">
              <button type="button" role="radio" aria-checked={mode === 'interest'} className={pillCls(mode === 'interest')} onClick={() => setMode('interest')}>ตามความสนใจ</button>
              <button type="button" role="radio" aria-checked={mode === 'near'} className={pillCls(mode === 'near')} onClick={() => setMode('near')}>ใกล้ตำแหน่งของฉัน</button>
            </div>
            {mode === 'interest' && (
              <>
                <label htmlFor="hero-q" className="sr-only">อยากไปเที่ยวแบบไหน</label>
                <input
                  id="hero-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="อยากไปแบบไหน เช่น น้ำตก, ทะเลหมอก, คาเฟ่วิวเขา"
                  className="w-full rounded-lg border border-sand bg-white px-5 py-4 text-[15px] outline-none focus:border-moss"
                />
              </>
            )}
            {mode === 'near' && (
              <p className="rounded-lg border border-sand bg-white px-5 py-4 text-sm text-muted">
                เราจะขอใช้ตำแหน่งปัจจุบันเพื่อแนะนำที่เที่ยวรอบตัวคุณ ถ้าไม่อนุญาตก็เลือกจุดเริ่มต้นเองได้ในหน้าถัดไป
              </p>
            )}
            {interests.length > 0 && (
              <div className="pt-1">
                <p className="mb-2 text-sm text-muted">ความสนใจ (เลือกได้หลายอย่าง)</p>
                <InterestChips interests={interests} selected={picked} onToggle={(k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
              </div>
            )}
            {geo && <p className="text-sm text-muted">{geo}</p>}
            <div className="pt-2 text-center">
              <button className="w-full max-w-sm rounded-full bg-forest py-3 text-[15px] font-medium text-white hover:bg-forest-deep">ค้นหาที่เที่ยว</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function BedIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M3 6a1 1 0 012 0v7h6V9a1 1 0 011-1h6a3 3 0 013 3v8a1 1 0 01-2 0v-2H5v2a1 1 0 01-2 0zm4.5 5a2 2 0 110-4 2 2 0 010 4z" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7zm0 9.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
    </svg>
  )
}

/* ------------------------------------------------------------------ sections */

function SectionTitle({ title, sub, right }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl text-ink">{title}</h2>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function UnderlineTabs({ items, value, onChange, label }) {
  return (
    <div className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-sand px-4 sm:mx-0 sm:px-0" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={`shrink-0 border-b-2 px-4 py-2.5 text-sm transition ${value === it.key ? 'border-forest font-medium text-forest' : 'border-transparent text-muted hover:text-ink'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function ForYou() {
  const interests = useInterests()
  const [tab, setTab] = useState('nature')
  const [state, setState] = useState({ loading: true })
  const load = () => {
    setState({ loading: true })
    api.recommend({ interests: tab, limit: 6 }).then((d) => setState({ items: d.items })).catch((error) => setState({ error }))
  }
  useEffect(load, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
      <SectionTitle
        title="แนะนำสถานที่เที่ยวสำหรับคุณ"
        sub="จัดอันดับด้วย ML จากเนื้อหารีวิว คะแนน และสัดส่วนรีวิวเชิงบวก"
        right={<Link to={`/recommend?interests=${tab}`} className="text-sm text-forest hover:underline">ดูทั้งหมดในหมวดนี้</Link>}
      />
      <UnderlineTabs label="หมวดความสนใจ" value={tab} onChange={setTab} items={interests.map((i) => ({ key: i.key, label: i.label }))} />
      <div className="mt-6">
        {state.loading && <CardSkeletons n={3} />}
        {state.error && <ErrorState error={state.error} onRetry={load} />}
        {state.items?.length === 0 && <EmptyState title="ยังไม่มีคำแนะนำในหมวดนี้" />}
        {state.items?.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((p) => <PlaceCard key={p.place_id} place={p} />)}
          </div>
        )}
      </div>
    </section>
  )
}

function CompactCard({ place, extra }) {
  return (
    <Link
      to={`/place/${encodeURIComponent(place.place_id)}`}
      className="group block w-60 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-sand transition hover:ring-moss sm:w-auto"
    >
      <PlaceArt place={place} className="h-32" />
      <div className="p-3">
        <p className="line-clamp-2 font-medium leading-snug text-ink group-hover:text-forest">{place.name}</p>
        <p className="mt-0.5 text-sm text-muted">{place.province}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Rating rating={place.rating} count={place.rating_count} />
        </div>
        {extra}
      </div>
    </Link>
  )
}

function Popular() {
  const [state, setState] = useState({ loading: true })
  const load = () => {
    setState({ loading: true })
    api.searchPlaces({ kind: 'attraction', limit: 10 }).then((d) => setState({ items: d.items })).catch((error) => setState({ error }))
  }
  useEffect(load, [])
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
      <SectionTitle title="ที่เที่ยวยอดนิยมในประเทศไทย" sub="เรียงตามจำนวนรีวิวบน Google มากที่สุด" />
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {state.loading && <div className="skeleton h-56 rounded-xl" aria-hidden="true" />}
      {state.items && (
        <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
          {state.items.map((p) => <CompactCard key={p.place_id} place={p} />)}
        </div>
      )}
    </section>
  )
}

function Stays() {
  const [provs, setProvs] = useState(null)
  const [tab, setTab] = useState(null)
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    api
      .hotelProvinces(3)
      .then((r) => {
        setProvs(r)
        setTab(r[0]?.province || null)
      })
      .catch((error) => setState({ error }))
  }, [])

  useEffect(() => {
    if (!tab) return
    setState({ loading: true })
    api
      .recommend({ only_accommodation: true, province: tab, limit: 4 })
      .then((d) => setState({ items: d.items, total: d.total }))
      .catch((error) => setState({ error }))
  }, [tab])

  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
      <SectionTitle title="ที่พักแนะนำสำหรับท่านโดยเฉพาะ" sub="จังหวัดที่มีข้อมูลที่พักมากที่สุดในระบบ จัดอันดับจากคะแนนและรีวิว" />
      {provs && (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <UnderlineTabs label="จังหวัด" value={tab} onChange={setTab} items={provs.map((p) => ({ key: p.province, label: p.province }))} />
          </div>
          {tab && (
            <Link to={`/recommend?lodging=1&province=${encodeURIComponent(tab)}`} className="hidden shrink-0 pb-2.5 text-sm text-forest hover:underline sm:block">
              ดูที่พักเพิ่มเติมใน{tab}
            </Link>
          )}
        </div>
      )}
      <div className="mt-6">
        {state.error && <ErrorState error={state.error} />}
        {state.loading && <div className="skeleton h-56 rounded-xl" aria-hidden="true" />}
        {state.items?.length === 0 && <EmptyState title="ยังไม่มีข้อมูลที่พักในจังหวัดนี้" />}
        {state.items?.length > 0 && (
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
            {state.items.map((p) => (
              <CompactCard
                key={p.place_id}
                place={p}
                extra={
                  <div className="mt-2 space-y-1">
                    <SentimentPill ml={p.ml} />
                    <p className="text-xs text-muted">{p.booking?.price_usd_min != null ? `เริ่ม $${p.booking.price_usd_min}/คืน` : 'ไม่มีข้อมูลราคา'}</p>
                  </div>
                }
              />
            ))}
          </div>
        )}
        {tab && (
          <Link to={`/recommend?lodging=1&province=${encodeURIComponent(tab)}`} className="mt-4 inline-block text-sm text-forest hover:underline sm:hidden">
            ดูที่พักเพิ่มเติมใน{tab}
          </Link>
        )}
      </div>
    </section>
  )
}

function PlannerPromo() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
      <div className="grid gap-8 rounded-2xl bg-mist p-6 sm:p-10 md:grid-cols-[1.1fr_1fr] md:items-center">
        <div>
          <h2 className="text-2xl text-ink">วางแผนทริปแบบลากวาง รู้เวลาทันที</h2>
          <p className="mt-3 max-w-lg text-muted">
            ใส่สถานที่ มื้ออาหาร โรงแรม และเวลาพักเป็น Block สลับลำดับได้ตามใจ ระบบคำนวณเวลาเดินทาง เลื่อนเวลาให้อัตโนมัติ และเตือนเมื่อแผนแน่นหรือเวลาชนกัน
          </p>
          <Link to="/planner" className="mt-6 inline-block rounded-full bg-forest px-6 py-3 text-[15px] font-medium text-white hover:bg-forest-deep">
            เริ่มวางแผนทริป
          </Link>
        </div>
        <ol className="relative space-y-2 pl-6" aria-label="ตัวอย่างหน้าตาแผน">
          <li className="text-xs text-muted">ตัวอย่างหน้าตาแผน</li>
          <span className="trail-line absolute bottom-3 left-[7px] top-8 w-0.5" aria-hidden="true" />
          {[
            ['08:00 – 09:30', 'ดอยสุเทพ', 'สถานที่เที่ยว, 90 นาที'],
            [null, 'ขับรถประมาณ 25 นาที'],
            ['09:55 – 10:55', 'มื้อเช้าในเมือง', 'มื้ออาหาร, 60 นาที'],
          ].map(([t, a, b], i) =>
            t ? (
              <li key={i} className="relative rounded-xl bg-white px-4 py-3 ring-1 ring-sand">
                <span className="absolute -left-[22px] top-4 h-3.5 w-3.5 rounded-full border-2 border-white bg-forest" aria-hidden="true" />
                <span className="text-sm font-medium text-forest">{t}</span>
                <p className="font-medium">{a}</p>
                <p className="text-sm text-muted">{b}</p>
              </li>
            ) : (
              <li key={i} className="text-sm text-moss">{a}</li>
            ),
          )}
        </ol>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ page */

export default function Home() {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
  }, [])

  return (
    <div className="bg-white pb-4">
      <section
        className="relative h-64 overflow-hidden rounded-bl-[56px] bg-[#1a8bb5] bg-cover bg-center sm:h-72"
        style={{ backgroundImage: 'url(/hero-sea.jpg)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 to-transparent" aria-hidden="true" />
        <h1 className="relative pt-7 text-center text-2xl text-white drop-shadow sm:pt-8 sm:text-3xl">มาท่องเที่ยวด้วยกันเถอะ</h1>
      </section>

      <SearchCard />

      {stats && (
        <p className="mx-auto mt-6 max-w-4xl px-4 text-center text-sm text-muted">
          ข้อมูล {fmtInt(stats.places)} สถานที่ใน {stats.provinces} จังหวัด, รีวิว {fmtInt(stats.reviews_analyzed)} ข้อความผ่านการวิเคราะห์ด้วย ML
        </p>
      )}

      <ForYou />
      <Popular />
      <Stays />
      <PlannerPromo />
    </div>
  )
}
