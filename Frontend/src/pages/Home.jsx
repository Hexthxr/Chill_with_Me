import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { InterestChips, useInterests } from '../components/Bits'
import PlaceCard from '../components/PlaceCard'
import { CardSkeletons, EmptyState, ErrorState } from '../components/States'
import { api } from '../lib/api'
import { contourPaths } from '../lib/contour'
import { fmtInt } from '../lib/format'

function HeroContours() {
  const paths = contourPaths('chill-with-me-hero', 1200, 600)
  return (
    <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#CFE3C4" strokeOpacity={0.12 + (i % 5) * 0.05} strokeWidth={i % 4 === 0 ? 1.8 : 1} />
      ))}
    </svg>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const interests = useInterests()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([])
  const [stats, setStats] = useState(null)
  const [tab, setTab] = useState('nature')
  const [recs, setRecs] = useState({ loading: true })

  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
  }, [])

  const load = () => {
    setRecs({ loading: true })
    api
      .recommend({ interests: tab, limit: 6 })
      .then((d) => setRecs({ items: d.items }))
      .catch((error) => setRecs({ error }))
  }
  useEffect(load, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault()
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (picked.length) p.set('interests', picked.join(','))
    navigate(`/recommend?${p.toString()}`)
  }

  return (
    <>
      <section className="relative overflow-hidden bg-forest text-white">
        <HeroContours />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
          <h1 className="max-w-3xl text-4xl sm:text-6xl">ไปไหนดี ให้รีวิวจริงช่วยตอบ</h1>
          <p className="mt-5 max-w-xl text-lg text-leaf">
            เลือกสิ่งที่ชอบ แล้วเราจะจัดอันดับที่เที่ยวทั่วไทยจากรีวิวหลายหมื่นข้อความ จากนั้นลากวางเป็นแผนทริปที่คำนวณเวลาให้เอง
          </p>

          <form onSubmit={submit} className="mt-8 max-w-2xl rounded-3xl bg-cream p-3 text-ink shadow-xl shadow-forest-deep/30">
            <label htmlFor="hero-q" className="sr-only">ค้นหาที่เที่ยว</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="hero-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="อยากไปแบบไหน เช่น น้ำตก, ทะเลหมอก, คาเฟ่วิวเขา"
                className="flex-1 rounded-2xl bg-white px-4 py-3 text-base outline-none ring-1 ring-forest/15 focus:ring-2 focus:ring-moss"
              />
              <button className="rounded-2xl bg-forest px-6 py-3 font-medium text-white hover:bg-forest-deep">ค้นหาที่เที่ยว</button>
            </div>
            {interests.length > 0 && (
              <div className="px-1 pb-1 pt-3">
                <InterestChips
                  interests={interests}
                  selected={picked}
                  onToggle={(k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}
                />
              </div>
            )}
          </form>

          {stats && (
            <p className="mt-8 max-w-2xl text-sm text-leaf/90">
              ข้อมูล {fmtInt(stats.places)} สถานที่ใน {stats.provinces} จังหวัด และรีวิว {fmtInt(stats.reviews_analyzed)} ข้อความที่ผ่านการวิเคราะห์ความรู้สึกด้วย ML
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl text-forest">ที่เที่ยวที่รีวิวพูดถึงดี</h2>
            <p className="mt-1 text-muted">จัดอันดับจากเนื้อหารีวิว คะแนน และสัดส่วนรีวิวเชิงบวก</p>
          </div>
          <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
            {interests.map((it) => (
              <button
                key={it.key}
                role="tab"
                aria-selected={tab === it.key}
                onClick={() => setTab(it.key)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${tab === it.key ? 'bg-forest text-white' : 'text-forest hover:bg-mist'}`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6">
          {recs.loading && <CardSkeletons n={6} />}
          {recs.error && <ErrorState error={recs.error} onRetry={load} />}
          {recs.items && recs.items.length === 0 && <EmptyState title="ยังไม่มีคำแนะนำในหมวดนี้" />}
          {recs.items && recs.items.length > 0 && (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {recs.items.map((p) => <PlaceCard key={p.place_id} place={p} />)}
            </div>
          )}
        </div>
        <div className="mt-8 text-center">
          <Link to={`/recommend?interests=${tab}`} className="inline-block rounded-full px-5 py-2.5 font-medium text-forest ring-1 ring-forest/25 hover:bg-white">
            ดูทั้งหมดในหมวดนี้
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-6 rounded-3xl bg-white p-6 ring-1 ring-forest/10 sm:p-10 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div>
            <h2 className="text-3xl text-forest">ลากวาง เรียงวัน รู้เวลาทันที</h2>
            <p className="mt-3 max-w-lg text-muted">
              ใส่สถานที่ มื้ออาหาร โรงแรม และเวลาพักเป็น Block สลับลำดับได้ตามใจ ระบบคำนวณเวลาเดินทางและเลื่อนเวลาให้อัตโนมัติ พร้อมเตือนเมื่อแผนแน่นหรือเวลาชนกัน
            </p>
            <Link to="/planner" className="mt-6 inline-block rounded-full bg-sun px-6 py-3 font-medium text-ink hover:brightness-95">
              เริ่มวางแผนทริป
            </Link>
          </div>
          <ol className="relative space-y-3 pl-6" aria-label="ตัวอย่างลำดับในแผน">
            <li className="text-xs text-muted">ตัวอย่างหน้าตาแผน</li>
            <span className="trail-line absolute bottom-3 left-[7px] top-3 w-0.5" aria-hidden="true" />
            {[
              ['08:00', 'ดอยสุเทพ', 'สถานที่เที่ยว, 90 นาที'],
              ['', 'ขับรถประมาณ 25 นาที', ''],
              ['09:55', 'มื้อเช้าในเมือง', 'มื้ออาหาร, 60 นาที'],
            ].map(([t, a, b], i) =>
              t ? (
                <li key={i} className="relative rounded-2xl bg-mist px-4 py-3">
                  <span className="absolute -left-[22px] top-4 h-3.5 w-3.5 rounded-full border-2 border-white bg-forest" aria-hidden="true" />
                  <span className="text-sm font-semibold text-forest">{t}</span>
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
    </>
  )
}
