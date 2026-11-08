import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CardRail from '../components/CardRail'
import { InterestChips, Rating, SentimentPill, useInterests } from '../components/Bits'
import PlaceArt from '../components/PlaceArt'
import PlaceCard from '../components/PlaceCard'
import { CountUp, Reveal } from '../components/Motion'
import { CardSkeletons, EmptyState, ErrorState } from '../components/States'
import { api } from '../lib/api'
import { addDaysISO, fmtInt, fmtThaiDate, todayISO } from '../lib/format'
import { useAuth } from '../store/authStore'
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

/** Measures the selected tab so one underline can slide between tabs. */
function useTabIndicator(dep) {
  const ref = useRef(null)
  const [box, setBox] = useState(null)
  useLayoutEffect(() => {
    const wrap = ref.current
    if (!wrap) return
    const measure = () => {
      const on = wrap.querySelector('[aria-selected="true"]')
      if (on) setBox((b) => (b && b.left === on.offsetLeft && b.width === on.offsetWidth ? b : { left: on.offsetLeft, width: on.offsetWidth }))
    }
    measure()
    document.fonts?.ready.then(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [dep])
  return [ref, box]
}

const TabLine = ({ box }) =>
  box && <span className="absolute bottom-0 h-0.5 rounded-full bg-forest transition-all duration-300 ease-out" style={{ left: box.left, width: box.width }} aria-hidden="true" />

const SEARCH_HINTS = ['อยากไปแบบไหน เช่น น้ำตก', 'ลองพิมพ์ ทะเลหมอก', 'ลองพิมพ์ คาเฟ่วิวเขา', 'ลองพิมพ์ ดำน้ำดูปะการัง', 'ลองพิมพ์ วัดสวยในเมืองเก่า']

function useRotatingHint(list, ms = 2800) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % list.length), ms)
    return () => clearInterval(t)
  }, [list, ms])
  return list[i]
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.800-3.800" /></svg>
)

function SearchCard() {
  const navigate = useNavigate()
  const interests = useInterests()
  const setMeta = useTrip((s) => s.setMeta)
  const setDayCount = useTrip((s) => s.setDayCount)
  const push = useToast((s) => s.push)
  const loggedIn = useAuth((s) => !!s.token)

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
  const [tabsRef, tabBox] = useTabIndicator(tab)
  const hint = useRotatingHint(SEARCH_HINTS)

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
    if (loggedIn && useInTrip) {
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
    `flex items-center gap-2 px-4 py-3 text-sm transition ${tab === k ? 'font-medium text-forest' : 'text-muted hover:text-ink'}`
  const pillCls = (on) =>
    `rounded-full px-4 py-1.5 text-sm transition ${on ? 'chip-on bg-leaf text-forest ring-1 ring-forest' : 'bg-white text-ink ring-1 ring-sand hover:-translate-y-0.5 hover:ring-moss'}`

  return (
    <div className="relative mx-auto -mt-28 w-full max-w-4xl px-4 sm:-mt-32">
      <div className="mx-auto w-fit rounded-t-2xl bg-white/95 px-4 shadow-[0_-4px_16px_rgba(11,85,104,0.12)] backdrop-blur sm:w-[88%]" role="tablist" aria-label="ประเภทการค้นหา">
        <div ref={tabsRef} className="relative flex">
          <TabLine box={tabBox} />
          <button role="tab" aria-selected={tab === 'stay'} className={tabCls('stay')} onClick={() => setTab('stay')}>
            <BedIcon /> ที่พัก
          </button>
          <button role="tab" aria-selected={tab === 'place'} className={tabCls('place')} onClick={() => setTab('place')}>
            <PinIcon /> สถานที่ท่องเที่ยว
          </button>
        </div>
      </div>

      <div className="rounded-3xl bg-gradient-to-b from-white to-[#fdfbf6] p-4 shadow-[0_18px_40px_-14px_rgba(11,85,104,0.35)] ring-1 ring-forest/10 sm:p-7">
        {tab === 'stay' ? (
          <form key="stay" onSubmit={submitStay} className="fade-up space-y-3">
            <label htmlFor="dest" className="sr-only">จุดหมายปลายทางหรือชื่อที่พัก</label>
            <input
              id="dest"
              list="province-list"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="ใส่จุดหมายปลายทาง (จังหวัด) หรือชื่อที่พัก"
              className="w-full rounded-xl border border-sand bg-white px-5 py-4 text-[15px] outline-none focus:border-moss"
            />
            <datalist id="province-list">
              {provinces.map((p) => <option key={p.province} value={p.province}>{p.province_en}</option>)}
            </datalist>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="grid grid-cols-2 divide-x divide-sand rounded-xl border border-sand bg-white">
                <DateBox id="ci" label="เช็กอิน" value={checkIn} min={todayISO()} onChange={setIn} />
                <DateBox id="co" label="เช็กเอาต์" value={checkOut} min={addDaysISO(checkIn, 1)} onChange={setCheckOut} />
              </div>
              <div className="rounded-xl border border-sand bg-white px-5 py-3">
                <span className="block text-[15px]">{nights} คืน</span>
                <span className="block text-xs text-muted">ทริป {Math.min(14, nights + 1)} วัน</span>
              </div>
            </div>
            {loggedIn && (
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input type="checkbox" checked={useInTrip} onChange={(e) => setUseInTrip(e.target.checked)} className="h-4 w-4 accent-forest" />
                ใช้วันที่นี้เป็นวันเดินทางในแผนทริป
              </label>
            )}
            <p className="text-xs text-muted">ข้อมูลที่พักมาจากชุดข้อมูลของระบบ (ส่วนใหญ่อยู่ภาคเหนือและอีสาน) และยังไม่มีระบบจองหรือเช็กห้องว่าง</p>
            <div className="pt-2 text-center">
              <button className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full btn-primary py-3 text-[15px] font-medium text-white"><SearchIcon /> ค้นหาที่พัก</button>
            </div>
          </form>
        ) : (
          <form key="place" onSubmit={submitPlace} className="fade-up space-y-3">
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
                  placeholder={hint}
                  className="w-full rounded-xl border border-sand bg-white px-5 py-4 text-[15px] outline-none focus:border-moss"
                />
              </>
            )}
            {mode === 'near' && (
              <p className="rounded-xl border border-sand bg-white px-5 py-4 text-sm text-muted">
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
              <button className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full btn-primary py-3 text-[15px] font-medium text-white"><SearchIcon /> ค้นหาที่เที่ยว</button>
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

function SectionTitle({ eyebrow, title, sub, right }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-sm font-semibold text-[#b94f28]">{eyebrow}</p>}
        <h2 className="text-2xl text-ink sm:text-3xl">{title}</h2>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function UnderlineTabs({ items, value, onChange, label }) {
  const [ref, box] = useTabIndicator(`${value}|${items.length}`)
  return (
    <div ref={ref} className="no-scrollbar relative -mx-4 flex overflow-x-auto border-b border-sand px-4 sm:mx-0 sm:px-0" role="tablist" aria-label={label}>
      <TabLine box={box} />
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={`shrink-0 px-4 py-2.5 text-sm transition ${value === it.key ? 'font-medium text-forest' : 'text-muted hover:text-ink'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function ForYou() {
  const interests = useInterests()
  const user = null // members see <PersonalFeed/> instead
  const mine = null
  const [tab, setTab] = useState('nature')
  const [state, setState] = useState({ loading: true })
  const query = tab
  const load = () => {
    setState({ loading: true })
    api.recommend({ interests: query, limit: 6 }).then((d) => setState({ items: d.items })).catch((error) => setState({ error }))
  }
  useEffect(load, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  const labels = Object.fromEntries(interests.map((i) => [i.key, i.label]))
  const tabs = [...(mine ? [{ key: 'mine', label: 'ตามที่คุณสนใจ' }] : []), ...interests.map((i) => ({ key: i.key, label: i.label }))]
  return (
    <section className="mx-auto mt-14 max-w-6xl rounded-[32px] px-4 py-10 sm:px-8 band-sky">
      <SectionTitle
        eyebrow="คัดด้วย Machine Learning"
        title={user ? `แนะนำสำหรับคุณ${user.name}` : 'แนะนำสถานที่เที่ยวสำหรับคุณ'}
        sub={
          tab === 'mine' && mine
            ? `จัดอันดับด้วย ML ตามความสนใจของคุณ: ${mine.map((k) => labels[k] || k).join(', ')}`
            : 'จัดอันดับด้วย ML จากเนื้อหารีวิว คะแนน และสัดส่วนรีวิวเชิงบวก'
        }
        right={<Link to={`/recommend?interests=${query}`} className="link-arrow text-sm font-medium text-forest">ดูทั้งหมดในหมวดนี้ <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>}
      />
      {!user && (
        <p className="-mt-2 mb-4 text-sm text-muted">
          <Link to="/register" className="font-medium text-forest hover:underline">สมัครสมาชิก</Link> แล้วบอกความสนใจ เพื่อให้หน้านี้แนะนำตรงกับคุณมากขึ้น
        </p>
      )}
      <UnderlineTabs label="หมวดความสนใจ" value={tab} onChange={setTab} items={tabs} />
      <div className="mt-6">
        {state.loading && <CardSkeletons n={3} />}
        {state.error && <ErrorState error={state.error} onRetry={load} />}
        {state.items?.length === 0 && <EmptyState title="ยังไม่มีคำแนะนำในหมวดนี้" />}
        {state.items?.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((p, i) => <PlaceCard key={p.place_id} place={p} index={i} />)}
          </div>
        )}
      </div>
    </section>
  )
}

const FIVE_UP = 'w-56 lg:w-[calc(20%-0.8rem)]'

function Row({ title, sub, items, extra }) {
  return (
    <div className="mt-8 first:mt-0">
      <h3 className="text-lg text-ink">{title}</h3>
      {sub && <p className="text-sm text-muted">{sub}</p>}
      <div className="mt-3">
        <CardRail label={title} itemClassName={FIVE_UP}>
          {items.map((p) => <CompactCard key={p.place_id} place={p} extra={extra?.(p)} />)}
        </CardRail>
      </div>
    </div>
  )
}

/** Netflix-style feed built from the member's viewing / trip history (+ interests). */
function PersonalFeed() {
  const user = useAuth((s) => s.user)
  const [state, setState] = useState({ loading: true })
  const load = () => {
    setState({ loading: true })
    api.personal({ limit: 9, because_rows: 2 }).then((data) => setState({ data })).catch((error) => setState({ error }))
  }
  useEffect(load, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = state.data
  const sub = !d
    ? ''
    : d.basis === 'popular'
      ? 'ยังไม่มีประวัติการดู ระบบจึงแสดงสถานที่ยอดนิยมก่อน ลองเปิดดูสถานที่ที่ชอบแล้วคำแนะนำจะเปลี่ยนตามคุณ'
      : d.basis === 'interests'
        ? 'จากความสนใจในบัญชีของคุณ เมื่อคุณเปิดดูสถานที่มากขึ้น คำแนะนำจะเรียนรู้จากสิ่งที่คุณดูด้วย'
        : `เรียนรู้จากสถานที่ ${fmtInt(d.history_places)} แห่งที่คุณเคยดูหรือเพิ่มลงทริป${d.basis === 'history+interests' ? ' ร่วมกับความสนใจของคุณ' : ''}`
  return (
    <section className="mx-auto mt-14 max-w-6xl rounded-[32px] px-4 py-10 sm:px-8 band-sky">
      <SectionTitle
        eyebrow="เรียนรู้จากสิ่งที่คุณดู"
        title={`แนะนำสำหรับคุณ${user?.name || ''}`}
        sub={sub}
        right={<Link to="/account#history" className="text-sm text-forest hover:underline">จัดการประวัติการดู</Link>}
      />
      {state.loading && <CardSkeletons n={3} />}
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {d && (
        <>
          {d.recent.length > 0 && <Row title="ดูล่าสุด" items={d.recent} />}
          {d.because.map((b) => (
            <Row
              key={b.seed.place_id}
              title={`เพราะคุณดู “${b.seed.name}”`}
              sub="สถานที่ที่เนื้อหารีวิวและประเภทใกล้เคียงกัน"
              items={b.items}
            />
          ))}
          <div className="mt-8">
            <h3 className="text-lg text-ink">{d.basis === 'popular' ? 'ยอดนิยมตอนนี้' : 'คัดมาให้คุณ'}</h3>
            {d.for_you.length === 0 ? (
              <EmptyState title="ยังไม่มีคำแนะนำ" />
            ) : (
              <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {d.for_you.map((p, i) => <PlaceCard key={p.place_id} place={p} index={i} />)}
              </div>
            )}
            <p className="mt-4 text-xs text-muted">{d.explain}</p>
          </div>
        </>
      )}
    </section>
  )
}

function CompactCard({ place, extra }) {
  return (
    <Link
      to={`/place/${encodeURIComponent(place.place_id)}`}
      className="card-sky card-lift group flex h-full flex-col overflow-hidden rounded-2xl ring-1 ring-forest/5 hover:ring-moss/40"
    >
      <PlaceArt place={place} className="h-32" />
      <div className="p-3">
        <p className="line-clamp-2 font-medium leading-snug text-ink transition-colors group-hover:text-forest">{place.name}</p>
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
      <SectionTitle eyebrow="ยอดนิยมตลอดกาล" title="ที่เที่ยวยอดนิยมในประเทศไทย" sub="เรียงตามจำนวนรีวิวบน Google มากที่สุด" />
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {state.loading && <div className="skeleton h-56 rounded-xl" aria-hidden="true" />}
      {state.items && (
        <CardRail label="ที่เที่ยวยอดนิยม" itemClassName={FIVE_UP}>
          {state.items.map((p) => <CompactCard key={p.place_id} place={p} />)}
        </CardRail>
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
      <SectionTitle eyebrow="พักที่ไหนดี" title="ที่พักแนะนำสำหรับท่านโดยเฉพาะ" sub="จังหวัดที่มีข้อมูลที่พักมากที่สุดในระบบ จัดอันดับจากคะแนนและรีวิว" />
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
          <CardRail label={`ที่พักแนะนำใน${tab}`} itemClassName="w-60 sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)]">
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
          </CardRail>
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
  const loggedIn = useAuth((s) => !!s.token)
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
      <div className="promo-sky relative grid gap-8 overflow-hidden rounded-[32px] p-6 text-white shadow-[0_24px_48px_-20px_rgba(11,85,104,0.6)] sm:p-10 md:grid-cols-[1.1fr_1fr] md:items-center">
        <span className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[#ffc56b]/30" aria-hidden="true" />
        <span className="pointer-events-none absolute right-4 top-4 h-20 w-20 rounded-full bg-[#ffc56b]/50" aria-hidden="true" />
        <svg viewBox="0 0 600 200" className="pointer-events-none absolute -bottom-6 left-0 h-40 w-full opacity-20" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 120c60-30 120-30 180 0s120 30 180 0 120-30 180 0 60 20 60 20v80H0z" fill="#fff" />
          <path d="M0 150c60-25 120-25 180 0s120 25 180 0 120-25 180 0 60 15 60 15v55H0z" fill="#fff" />
        </svg>
        <div className="relative">
          <h2 className="text-2xl text-white sm:text-3xl">วางแผนทริปแบบลากวาง รู้เวลาทันที</h2>
          <p className="mt-3 max-w-lg text-white/85">
            ใส่สถานที่ มื้ออาหาร โรงแรม และเวลาพักเป็น Block สลับลำดับได้ตามใจ ระบบคำนวณเวลาเดินทาง เลื่อนเวลาให้อัตโนมัติ และเตือนเมื่อแผนแน่นหรือเวลาชนกัน
          </p>
          <Link
            to={loggedIn ? '/planner' : '/register?redirect=/planner'}
            className="btn-ripple link-arrow mt-6 rounded-full bg-white px-6 py-3 text-[15px] font-medium text-forest shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            {loggedIn ? 'เริ่มวางแผนทริป' : 'สมัครสมาชิกเพื่อเริ่มวางแผน'} <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </Link>
        </div>
        <ol className="relative space-y-2 pl-6" aria-label="ตัวอย่างหน้าตาแผน">
          <li className="text-xs text-white/75">ตัวอย่างหน้าตาแผน</li>
          <span className="absolute bottom-3 left-[7px] top-8 w-0.5 bg-[linear-gradient(#fff_50%,transparent_0)] bg-[length:2px_10px] opacity-70" aria-hidden="true" />
          {[
            ['08:00 – 09:30', 'ดอยสุเทพ', 'สถานที่เที่ยว, 90 นาที'],
            [null, 'ขับรถประมาณ 25 นาที'],
            ['09:55 – 10:55', 'มื้อเช้าในเมือง', 'มื้ออาหาร, 60 นาที'],
          ].map(([t, a, b], i) =>
            t ? (
              <li key={i} style={{ '--i': i }} className="demo-step relative rounded-2xl bg-white/95 px-4 py-3 text-ink shadow-md shadow-black/10">
                <span className="absolute -left-[22px] top-4 h-3.5 w-3.5 rounded-full border-2 border-forest bg-white" aria-hidden="true" />
                <span className="text-sm font-medium text-forest">{t}</span>
                <p className="font-medium">{a}</p>
                <p className="text-sm text-muted">{b}</p>
              </li>
            ) : (
              <li key={i} style={{ '--i': i }} className="demo-step text-sm text-white/85">{a}</li>
            ),
          )}
        </ol>
      </div>
    </section>
  )
}

function InterestTiles() {
  const interests = useInterests()
  if (!interests.length) return null
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
      <SectionTitle eyebrow="เริ่มจากสิ่งที่ชอบ" title="วันนี้อยากเที่ยวแบบไหน" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {interests.map((it, i) => (
          <li key={it.key} className="card-in" style={{ '--i': i }}>
            <Link to={`/recommend?interests=${it.key}`} className="card-lift group relative block h-32 overflow-hidden rounded-2xl ring-1 ring-forest/5 sm:h-40">
              <PlaceArt place={{ place_id: `interest-${it.key}`, ml: { top_interest: it.key } }} showLabel={false} usePhoto={false} className="h-full w-full" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[#06394a]/85 to-transparent px-3 pb-2.5 pt-8 font-medium text-white">
                {it.label}
                <span className="link-arrow"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const STEPS = [
  ['บอกสิ่งที่ชอบ', 'เลือกความสนใจ จังหวัด หรือใช้ตำแหน่งของคุณเป็นจุดเริ่มต้น'],
  ['ดูเหตุผลจากรีวิวจริง', 'ทุกคำแนะนำบอกเหตุผล พร้อมผลวิเคราะห์ความรู้สึกจากข้อความรีวิว'],
  ['ลากวางแผน รู้เวลาทันที', 'เรียงสถานที่เป็นวัน ๆ ระบบคำนวณเวลาเดินทางและเตือนเมื่อแผนแน่นเกินไป'],
]

function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
      <SectionTitle eyebrow="ใช้งานง่ายใน 3 ขั้นตอน" title="จากไอเดียสู่ทริปจริง" />
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="card-sky card-lift rounded-2xl p-6 ring-1 ring-forest/5">
            <span className="btn-primary grid h-10 w-10 place-items-center rounded-full font-semibold" aria-hidden="true">{i + 1}</span>
            <h3 className="mt-4 text-lg text-ink">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ------------------------------------------------------------------ page */

export default function Home() {
  const loggedIn = useAuth((s) => !!s.token)
  const [stats, setStats] = useState(null)
  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
  }, [])

  return (
    <div className="pb-4">
      <section
        className="relative h-80 overflow-hidden bg-[#1a8bb5] sm:h-96"
      >
        <div className="kenburns absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(/hero-sea.jpg)' }} aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#06394a]/50 via-[#06394a]/10 to-transparent" aria-hidden="true" />
        <div className="relative px-4 pt-8 text-center text-white sm:pt-12">
          <h1 className="hero-in text-3xl font-semibold drop-shadow-md sm:text-5xl sm:leading-tight">มาท่องเที่ยวด้วยกันเถอะ</h1>
          <p className="hero-in mx-auto mt-2 max-w-xl text-[15px] text-white/95 drop-shadow sm:text-lg" style={{ '--d': '.15s' }}>ค้นหาที่เที่ยวทั่วไทยจากรีวิวจริง แล้ววางแผนทริปในแบบของคุณ</p>
        </div>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-10 w-full sm:h-16" aria-hidden="true">
          <path d="M0 40c120 25 240 38 360 30S600 30 720 28s240 22 360 26 240-10 360-24v50H0z" className="fill-cream" opacity=".45" />
          <path d="M0 52c160 18 300 22 440 12s260-30 400-28 280 26 400 24 160-12 200-18v38H0z" className="fill-cream" />
        </svg>
      </section>

      <SearchCard />

      {stats && (
        <ul className="mx-auto mt-8 grid max-w-3xl grid-cols-3 divide-x divide-sand px-4" aria-label="ข้อมูลในระบบ">
          {[
            [stats.places, 'สถานที่'],
            [stats.provinces, 'จังหวัด'],
            [stats.reviews_analyzed, 'รีวิวที่ ML วิเคราะห์'],
          ].map(([n, l]) => (
            <li key={l} className="px-2 text-center">
              <CountUp value={n} duration={1400} className="block font-display text-2xl font-semibold text-forest sm:text-3xl" />
              <span className="text-xs text-muted sm:text-sm">{l}</span>
            </li>
          ))}
        </ul>
      )}

      <InterestTiles />
      <Reveal>{loggedIn ? <PersonalFeed /> : <ForYou />}</Reveal>
      <Reveal><Popular /></Reveal>
      <Reveal><Stays /></Reveal>
      {!loggedIn && <Reveal><HowItWorks /></Reveal>}
      <Reveal><PlannerPromo /></Reveal>
    </div>
  )
}
