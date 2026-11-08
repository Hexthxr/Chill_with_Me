import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RoutingNotice } from '../components/Bits'
import MapView from '../components/MapView'
import { EmptyState, ErrorState, Spinner } from '../components/States'
import { api } from '../lib/api'
import { fmtDuration, fmtKm, fmtThaiDate } from '../lib/format'
import { KIND_STYLE } from '../planner/BlockItem'
import { KIND_LABEL, toPayload } from '../planner/planUtils'
import { DAY_COLORS, routeLayers } from './Planner'

export default function TripDetails() {
  const { id } = useParams()
  const [trip, setTrip] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [err, setErr] = useState(null)
  const [day, setDay] = useState('all')

  useEffect(() => {
    api
      .getTrip(id)
      .then((t) => {
        setTrip(t)
        return api.computePlan(toPayload(t)).then(setSchedule)
      })
      .catch(setErr)
  }, [id])

  if (err)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {err.status === 404 ? <EmptyState title="ไม่พบทริปนี้" action={<Link to="/trips" className="text-forest underline">กลับไปที่ทริปของฉัน</Link>} /> : <ErrorState error={err} />}
      </div>
    )
  if (!trip || !schedule) return <div className="mx-auto max-w-7xl px-4 py-16"><Spinner label="กำลังโหลดแผนทริป…" /></div>

  const only = day === 'all' ? null : day
  const { markers, routes } = routeLayers(trip, schedule, only)
  const days = only == null ? trip.days.map((d, i) => i) : [only]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-gradient-sky pb-1 text-3xl font-semibold sm:text-4xl">{trip.name}</h1>
          <p className="mt-1 text-muted">
            {fmtThaiDate(trip.start_date)} ถึง {fmtThaiDate(schedule.days[schedule.days.length - 1].date)}, {trip.days.length} วัน, ระยะทางรวม {schedule.totals.distance_km} กม., เดินทาง {fmtDuration(schedule.totals.travel_min)}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn-ripple rounded-full px-4 py-2 text-sm font-medium text-forest ring-1 ring-forest/25 transition hover:-translate-y-0.5 hover:bg-mist hover:shadow-md print:hidden">พิมพ์แผน</button>
          <Link to={`/planner/${trip.id}`} className="rounded-full btn-primary px-4 py-2 text-sm font-medium text-white print:hidden">แก้ไขในตัววางแผน</Link>
        </div>
      </div>
      <div className="mt-4"><RoutingNotice status={schedule.routing} compact /></div>

      <div className="no-scrollbar mt-6 flex gap-1 overflow-x-auto print:hidden" role="tablist">
        <button role="tab" aria-selected={day === 'all'} onClick={() => setDay('all')} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${day === 'all' ? 'chip-on bg-forest text-white' : 'text-forest hover:bg-mist'}`}>ทุกวัน</button>
        {trip.days.map((_, i) => (
          <button key={i} role="tab" aria-selected={day === i} onClick={() => setDay(i)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${day === i ? 'chip-on bg-forest text-white' : 'text-forest hover:bg-mist'}`}>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: DAY_COLORS[i % DAY_COLORS.length] }} aria-hidden="true" />
            วันที่ {i + 1}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-8">
          {days.map((di) => {
            const d = trip.days[di]
            const cd = schedule.days[di]
            const comp = Object.fromEntries(cd.blocks.map((b) => [b.id, b]))
            return (
              <section key={di}>
                <h2 className="flex items-center gap-2 text-2xl text-ink">
                  <span className="h-3 w-3 rounded-full" style={{ background: DAY_COLORS[di % DAY_COLORS.length] }} aria-hidden="true" />
                  วันที่ {di + 1}
                  <span className="font-sans text-base text-muted">{fmtThaiDate(cd.date)}</span>
                </h2>
                {d.blocks.length === 0 ? (
                  <p className="mt-2 text-muted">ยังไม่มีกิจกรรมในวันนี้</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-muted">
                      {cd.start} – {cd.end}, เดินทาง {fmtDuration(cd.summary.travel_min)} ({cd.summary.distance_km} กม.)
                    </p>
                    <ol className="relative mt-4 space-y-1 pl-6">
                      <span className="trail-line absolute bottom-4 left-[7px] top-4 w-0.5" aria-hidden="true" />
                      {d.blocks.map((b, bi) => {
                        const c = comp[b.id]
                        const st = KIND_STYLE[b.kind]
                        return (
                          <li key={b.id} className="card-in" style={{ '--i': bi }}>
                            {c?.travel && (
                              <p className="py-1 text-xs text-muted">
                                เดินทาง {fmtDuration(c.travel.duration_min)}, {fmtKm(c.travel.distance_m)}{c.travel.is_estimate ? ' (ประมาณการ)' : ''}
                              </p>
                            )}
                            <div className="card-lift relative rounded-2xl card-sky px-4 py-3 ring-1 ring-forest/5">
                              <span className={`absolute -left-[23px] top-4 h-3.5 w-3.5 rounded-full border-2 border-white ${st.stripe}`} aria-hidden="true" />
                              <p className="text-sm font-semibold text-forest">{c?.start} – {c?.end}</p>
                              <p className="font-medium">{b.place_id ? <Link className="hover:underline" to={`/place/${encodeURIComponent(b.place_id)}`}>{b.name}</Link> : b.name}</p>
                              <p className="text-xs text-muted">{KIND_LABEL[b.kind]}, {fmtDuration(b.duration_min)}{b.locked ? `, ล็อกเวลา ${b.locked_start}` : ''}</p>
                              {c?.warnings?.map((w, i) => (
                                <p key={i} className={`mt-1.5 rounded-lg px-2 py-1 text-xs ${w.level === 'error' ? 'bg-alert-soft text-alert' : w.level === 'warning' ? 'bg-sun-soft text-[#6b4f0e]' : 'bg-mist text-muted'}`}>{w.message}</p>
                              ))}
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                    {cd.warnings.filter((w) => !w.block_id).map((w, i) => (
                      <p key={i} className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${w.level === 'error' ? 'bg-alert-soft text-alert' : w.level === 'warning' ? 'bg-sun-soft text-[#6b4f0e]' : 'bg-mist text-muted'}`}>{w.message}</p>
                    ))}
                  </>
                )}
              </section>
            )
          })}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <MapView className="h-[420px] lg:h-[calc(100vh-7rem)]" markers={markers} routes={routes} />
        </div>
      </div>
    </div>
  )
}
