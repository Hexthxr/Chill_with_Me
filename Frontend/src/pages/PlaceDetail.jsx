import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Rating, SentimentPill } from '../components/Bits'
import MapView from '../components/MapView'
import PlaceArt from '../components/PlaceArt'
import { CountUp, Reveal } from '../components/Motion'
import { AddTripButton } from '../components/PlaceCard'
import { EmptyState, ErrorState, Spinner } from '../components/States'
import { api } from '../lib/api'
import { fmtInt, fmtPct, fmtRating } from '../lib/format'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/tripStore'

function AspectBars({ aspects }) {
  if (!aspects?.length) return <p className="text-sm text-muted">รีวิวยังพูดถึงประเด็นเฉพาะไม่มากพอ</p>
  return (
    <ul className="space-y-3">
      {aspects.map((a) => (
        <li key={a.key}>
          <div className="flex justify-between text-sm">
            <span className="font-medium">{a.label}</span>
            <span className="text-muted">
              บวก {fmtPct(a.positive_share)} จาก {a.mentions} รีวิวที่พูดถึง
            </span>
          </div>
          <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-alert-soft" aria-hidden="true">
            <div className="bar-grow bg-moss" style={{ width: `${a.positive_share * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function RatingDist({ dist }) {
  const total = Object.values(dist || {}).reduce((a, b) => a + b, 0)
  if (!total) return null
  return (
    <ul className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((s) => {
        const n = dist[String(s)] || 0
        return (
          <li key={s} className="flex items-center gap-2 text-sm">
            <span className="w-8 text-muted">{s} ดาว</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-sand" aria-hidden="true">
              <span className="bar-grow block h-full bg-sun" style={{ width: `${(n / total) * 100}%` }} />
            </span>
            <span className="w-10 text-right text-muted">{fmtInt(n)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ReviewItem({ r }) {
  const s = r.sentiment
  return (
    <li className="fade-up rounded-2xl card-sky p-4 ring-1 ring-forest/5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {r.rating != null && <span className="font-semibold">{fmtRating(r.rating)} ดาว</span>}
        {s && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.label === 'positive' ? 'bg-leaf text-forest' : 'bg-alert-soft text-alert'}`}>
            ML: {s.label === 'positive' ? 'เชิงบวก' : 'เชิงลบ'} ({Math.round(s.pos_prob * 100)}% บวก)
          </span>
        )}
        {r.review_time && <span className="text-muted">{new Date(r.review_time).toLocaleDateString('th-TH', { year: 'numeric', month: 'short' })}</span>}
      </div>
      <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{r.text}</p>
    </li>
  )
}

function Reviews({ placeId }) {
  const [filter, setFilter] = useState('all')
  const [data, setData] = useState({ loading: true })
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    setData((d) => ({ ...d, loading: true }))
    api
      .placeReviews(placeId, { sentiment: filter, limit: 8, offset })
      .then((d) => setData((prev) => ({ ...d, items: offset ? [...(prev.items || []), ...d.items] : d.items })))
      .catch((error) => setData({ error }))
  }, [placeId, filter, offset])
  return (
    <div>
      <div className="mb-4 flex gap-1" role="tablist">
        {[
          ['all', 'ทั้งหมด'],
          ['positive', 'เชิงบวก'],
          ['negative', 'เชิงลบ'],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => { setFilter(k); setOffset(0) }} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${filter === k ? 'chip-on bg-forest text-white' : 'text-forest hover:bg-mist'}`}>
            {l}
          </button>
        ))}
      </div>
      {data.error && <ErrorState error={data.error} />}
      {data.items?.length === 0 && !data.loading && <p className="text-muted">ไม่มีรีวิวในกลุ่มนี้</p>}
      <ul className="space-y-3">{data.items?.map((r) => <ReviewItem key={r.record_id} r={r} />)}</ul>
      {data.loading && <div className="mt-3"><Spinner /></div>}
      {data.total > (data.items?.length || 0) && !data.loading && (
        <button onClick={() => setOffset(data.items.length)} className="btn-ripple mt-4 rounded-full px-4 py-2 text-sm font-medium text-forest ring-1 ring-forest/25 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md">
          ดูรีวิวเพิ่ม ({fmtInt(data.total - data.items.length)})
        </button>
      )}
    </div>
  )
}

export default function PlaceDetail() {
  const { id } = useParams()
  const [state, setState] = useState({ loading: true })
  const [similar, setSimilar] = useState([])
  const [hotels, setHotels] = useState(null)
  const push = useToast((s) => s.push)
  const loggedIn = useAuth((s) => !!s.token)

  const load = () => {
    setState({ loading: true })
    api.place(id).then((p) => {
      setState({ p })
      if (!p.is_accommodation)
        api.hotelsNear({ lat: p.lat, lng: p.lng, radius_km: 15, limit: 6 }).then(setHotels).catch(() => setHotels({ items: [] }))
    }).catch((error) => setState({ error }))
    api.similar(id).then((d) => setSimilar(d.items)).catch(() => setSimilar([]))
  }
  useEffect(load, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  // remember what the user looks at (logged-in users only) for "because you viewed" recommendations
  useEffect(() => {
    if (loggedIn) api.logActivity(id, 'view').catch(() => {})
  }, [id, loggedIn])

  if (state.loading) return <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6"><Spinner label="กำลังโหลดข้อมูลสถานที่…" /></div>
  if (state.error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {state.error.status === 404 ? <EmptyState title="ไม่พบสถานที่นี้" action={<Link to="/recommend" className="text-forest underline">กลับไปค้นหา</Link>} /> : <ErrorState error={state.error} onRetry={load} />}
      </div>
    )
  const p = state.p
  const a = p.analysis
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      push('คัดลอกลิงก์สถานที่แล้ว')
    } catch {
      push('คัดลอกลิงก์ไม่สำเร็จ', 'error')
    }
  }

  return (
    <div>
      <div className="relative">
        <PlaceArt place={p} className="h-48 sm:h-64" showLabel={false} live showCredit w={1200} h={240} />
      </div>
      <div className="mx-auto -mt-16 max-w-7xl px-4 sm:px-6">
        <div className="fade-up relative rounded-3xl card-sky p-6 ring-1 ring-forest/5 sm:p-8">
          <p className="text-sm font-medium text-[#b94f28]">{p.primary_type || 'สถานที่'}</p>
          <h1 className="mt-1 text-3xl text-ink sm:text-4xl">{p.name}</h1>
          <p className="mt-1 text-muted">{p.address}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Rating rating={p.rating} count={p.rating_count} />
            <SentimentPill ml={p.ml} />
            {p.ml.top_interest_label && <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-forest">เด่นด้าน{p.ml.top_interest_label}</span>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {loggedIn && <AddTripButton place={p} className="px-5 py-2.5" />}
            {p.google_maps_url && (
              <a href={p.google_maps_url} target="_blank" rel="noreferrer" className="btn-ripple rounded-full px-5 py-2.5 text-sm font-medium text-forest ring-1 ring-forest/25 transition hover:-translate-y-0.5 hover:bg-mist hover:shadow-md">
                เปิดใน Google Maps
              </a>
            )}
            <button onClick={share} className="btn-ripple inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium text-forest ring-1 ring-forest/25 transition hover:-translate-y-0.5 hover:bg-mist hover:shadow-md">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1" /></svg>
              คัดลอกลิงก์
            </button>
          </div>
          {p.has_hours_on_google && (
            <p className="mt-4 text-sm text-muted">ชุดข้อมูลไม่มีเวลาเปิด–ปิด แต่ Google Maps มีข้อมูลนี้ — ตรวจสอบก่อนเดินทาง แล้วใส่เวลาเปิด–ปิดใน Trip Planner เพื่อให้ระบบเตือน</p>
          )}
          {p.booking?.price_usd_min != null && (
            <p className="mt-3 inline-block rounded-xl bg-sun-soft px-3 py-2 text-sm">
              ราคาเริ่มต้นจากชุดข้อมูล Booking.com: <b>${p.booking.price_usd_min}</b> ต่อคืน
              {p.booking.rating_10 && <> (คะแนน Booking {p.booking.rating_10}/10)</>}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          <section className="rounded-3xl card-sky p-6 ring-1 ring-forest/5 sm:p-8">
            <h2 className="text-2xl text-ink">รีวิวพูดถึงอะไรบ้าง</h2>
            {!a.available ? (
              <p className="mt-3 text-muted">สถานที่นี้ยังไม่มีข้อความรีวิวในชุดข้อมูล จึงยังวิเคราะห์ไม่ได้</p>
            ) : (
              <>
                <div className="mt-5 grid gap-6 sm:grid-cols-[200px_1fr]">
                  <div className="rounded-2xl bg-mist p-5 text-center">
                    <CountUp value={a.positive_share} format={fmtPct} duration={1200} className="block font-display text-5xl text-forest" />
                    <p className="mt-1 text-sm text-muted">รีวิวเชิงบวก จาก {fmtInt(a.n_analyzed)} ข้อความที่ ML วิเคราะห์</p>
                  </div>
                  <div>
                    {a.best_aspect_label && <p className="mb-2 text-[15px]">จุดที่คนชมมากที่สุด: <b className="text-forest">{a.best_aspect_label}</b></p>}
                    {a.concerns.length > 0 && <p className="mb-3 text-[15px]">เรื่องที่ควรรู้ก่อนไป: <b className="text-alert">{a.concerns.map((c) => c.label).join(', ')}</b></p>}
                    <Reveal><RatingDist dist={a.rating_distribution} /></Reveal>
                  </div>
                </div>
                <h3 className="mt-8 text-lg text-ink">ประเด็นสำคัญจากรีวิว</h3>
                <Reveal className="mt-3"><AspectBars aspects={a.aspects} /></Reveal>

                {(a.highlights.positive.length > 0 || a.highlights.negative.length > 0) && (
                  <>
                    <h3 className="mt-8 text-lg text-ink">รีวิวตัวแทน</h3>
                    <ul className="mt-3 space-y-3">
                      {[...a.highlights.positive, ...a.highlights.negative].map((r) => <ReviewItem key={r.record_id} r={r} />)}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-2xl text-ink">รีวิวทั้งหมด</h2>
            <Reviews placeId={p.place_id} />
          </section>
        </div>

        <aside className="space-y-8">
          <MapView className="h-64" markers={[{ lat: p.lat, lng: p.lng, label: '●', title: p.name }]} dots={(hotels?.items || []).map((h) => ({ lat: h.lat, lng: h.lng, title: h.name, color: '#8a5a9e' }))} />

          {hotels && !p.is_accommodation && (
            <section>
              <h2 className="text-xl text-ink">ที่พักในรัศมี 15 กม.</h2>
              {hotels.items.length === 0 ? (
                <p className="mt-2 text-sm text-muted">ไม่พบที่พักในชุดข้อมูลใกล้ที่นี่</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {hotels.items.map((h) => (
                    <li key={h.place_id} className="rounded-xl card-sky p-3 ring-1 ring-forest/5 transition hover:translate-x-1 hover:ring-forest/30">
                      <Link to={`/place/${encodeURIComponent(h.place_id)}`} className="font-medium hover:underline">{h.name}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                        <span>{h.distance_km} กม.</span>
                        {h.rating != null && <span>{fmtRating(h.rating)} ดาว ({fmtInt(h.rating_count)})</span>}
                        <span>{h.price ? `เริ่ม $${h.price.usd_min}/คืน` : 'ไม่มีข้อมูลราคา'}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {similar.length > 0 && (
            <section>
              <h2 className="text-xl text-ink">ที่เที่ยวที่คล้ายกัน</h2>
              <p className="text-sm text-muted">จากความคล้ายของเนื้อหารีวิวและประเภท</p>
              <ul className="mt-3 space-y-2">
                {similar.map((s) => (
                  <li key={s.place_id}>
                    <Link to={`/place/${encodeURIComponent(s.place_id)}`} className="group flex items-center gap-3 rounded-xl card-sky p-2 ring-1 ring-forest/5 transition hover:translate-x-1 hover:ring-forest/30">
                      <PlaceArt place={s} className="h-12 w-16 shrink-0 rounded-lg" showLabel={false} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{s.name}</span>
                        <span className="block text-xs text-muted">{s.province}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
