import { closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, RoutingNotice } from '../components/Bits'
import MapView from '../components/MapView'
import { CountUp } from '../components/Motion'
import { ErrorState, Spinner } from '../components/States'
import { api } from '../lib/api'
import { confetti } from '../lib/fx'
import { fmtDuration, fmtThaiDate } from '../lib/format'
import { getOwnerKey } from '../lib/ownerKey'
import AddPanel from '../planner/AddPanel'
import BlockItem from '../planner/BlockItem'
import DayColumn from '../planner/DayColumn'
import { findBlock, toPayload } from '../planner/planUtils'
import { useNotifications } from '../store/notificationStore'
import { useToast, useTrip } from '../store/tripStore'

export const DAY_COLORS = ['#0e7490', '#e2683f', '#3f9d7a', '#8a5a9e', '#d99a2b', '#2f6fb3', '#c94f7c']

export function routeLayers(trip, schedule, onlyDay = null) {
  const markers = []
  const routes = []
  trip.days.forEach((d, di) => {
    if (onlyDay != null && di !== onlyDay) return
    const comp = Object.fromEntries((schedule?.days?.[di]?.blocks || []).map((b) => [b.id, b]))
    let n = 0
    d.blocks.forEach((b) => {
      if (b.lat == null) return
      n += 1
      markers.push({ lat: b.lat, lng: b.lng, label: onlyDay != null ? n : `${di + 1}.${n}`, kind: b.kind, title: b.name, subtitle: comp[b.id] ? `${comp[b.id].start} – ${comp[b.id].end}` : '' })
      const t = comp[b.id]?.travel
      if (t?.geometry?.length) routes.push({ positions: t.geometry, estimate: t.is_estimate, color: DAY_COLORS[di % DAY_COLORS.length] })
    })
  })
  return { markers, routes }
}

function TripSettings() {
  const t = useTrip()
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
      <label className="col-span-2 sm:col-span-3 lg:col-span-1">
        <span className="text-xs font-medium text-muted">ชื่อทริป</span>
        <input value={t.name} maxLength={120} onChange={(e) => t.setMeta({ name: e.target.value })} className="mt-0.5 w-full rounded-xl bg-white px-3 py-2 font-display text-lg ring-1 ring-forest/15" />
      </label>
      <label>
        <span className="text-xs font-medium text-muted">วันเริ่มเดินทาง</span>
        <input type="date" value={t.start_date} onChange={(e) => e.target.value && t.setMeta({ start_date: e.target.value })} className="mt-0.5 w-full rounded-xl bg-white px-3 py-2 ring-1 ring-forest/15" />
      </label>
      <label>
        <span className="text-xs font-medium text-muted">เวลาออกเดินทาง</span>
        <input type="time" value={t.start_time} onChange={(e) => e.target.value && t.setMeta({ start_time: e.target.value })} className="mt-0.5 w-full rounded-xl bg-white px-3 py-2 ring-1 ring-forest/15" />
      </label>
      <label>
        <span className="text-xs font-medium text-muted">จำนวนวัน</span>
        <select value={t.days.length} onChange={(e) => t.setDayCount(Number(e.target.value))} className="mt-0.5 w-full rounded-xl bg-white px-3 py-2 ring-1 ring-forest/15">
          {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} วัน</option>)}
        </select>
      </label>
      <label>
        <span className="text-xs font-medium text-muted">ไม่ควรเลยเวลา</span>
        <input type="time" value={t.day_end_time} onChange={(e) => e.target.value && t.setMeta({ day_end_time: e.target.value })} className="mt-0.5 w-full rounded-xl bg-white px-3 py-2 ring-1 ring-forest/15" />
      </label>
    </div>
  )
}

export default function Planner() {
  const { id } = useParams()
  const navigate = useNavigate()
  const trip = useTrip()
  const push = useToast((s) => s.push)
  const [schedule, setSchedule] = useState(null)
  const [computeErr, setComputeErr] = useState(null)
  const [computing, setComputing] = useState(false)
  const [loadState, setLoadState] = useState(id ? { loading: true } : {})
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [opt, setOpt] = useState(null)
  const [optimizing, setOptimizing] = useState(null)
  const ctrl = useRef()

  // load saved trip
  useEffect(() => {
    if (!id) return
    if (trip.tripId === id && trip.dirty) {
      setLoadState({})
      return
    }
    api
      .getTrip(id)
      .then((doc) => {
        trip.loadTrip(doc)
        setLoadState({})
      })
      .catch((error) => setLoadState({ error }))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const payload = useMemo(() => toPayload(trip), [trip.name, trip.start_date, trip.start_time, trip.day_end_time, trip.days, trip.notes]) // eslint-disable-line react-hooks/exhaustive-deps
  const payloadKey = JSON.stringify({ ...payload, name: '' })

  // recompute schedule (debounced) whenever the plan changes
  useEffect(() => {
    const t = setTimeout(() => {
      ctrl.current?.abort()
      ctrl.current = new AbortController()
      setComputing(true)
      api
        .computePlan(payload, ctrl.current.signal)
        .then((s) => {
          setSchedule(s)
          setComputeErr(null)
        })
        .catch((e) => e.name !== 'AbortError' && setComputeErr(e))
        .finally(() => setComputing(false))
    }, 300)
    return () => clearTimeout(t)
  }, [payloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const containerOf = (overId) => {
    if (overId == null) return null
    if (String(overId).startsWith('day-')) return { day: Number(String(overId).slice(4)), index: Infinity }
    return findBlock(useTrip.getState().days, overId)
  }

  const onDragOver = ({ active, over }) => {
    if (!over) return
    const from = findBlock(useTrip.getState().days, active.id)
    const to = containerOf(over.id)
    if (!from || !to || from.day === to.day) return
    trip.move(active.id, to.day, to.index === Infinity ? useTrip.getState().days[to.day].blocks.length : to.index)
  }

  const onDragEnd = ({ active, over }) => {
    setDragId(null)
    if (!over) return
    const from = findBlock(useTrip.getState().days, active.id)
    const to = containerOf(over.id)
    if (!from || !to) return
    if (from.day === to.day && to.index !== Infinity && from.index !== to.index) trip.move(active.id, to.day, to.index)
  }

  const save = async (btn) => {
    const firstSave = !trip.tripId
    setSaving(true)
    try {
      const body = { ...payload, owner_key: getOwnerKey() }
      const doc = trip.tripId ? await api.updateTrip(trip.tripId, body) : await api.createTrip(body)
      trip.markSaved(doc.id)
      useNotifications.getState().load() // the trip's date may have just entered the reminder window
      push('บันทึกทริปลงฐานข้อมูลแล้ว')
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2400)
      if (firstSave) confetti(btn)
      if (id !== doc.id) navigate(`/planner/${doc.id}`, { replace: true })
    } catch (e) {
      if (e.status === 404 && trip.tripId) {
        trip.markSaved(null)
        push('ไม่พบทริปเดิมในฐานข้อมูล กดบันทึกอีกครั้งเพื่อสร้างใหม่', 'error')
      } else push(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const optimize = async (dayIndex) => {
    setOptimizing(dayIndex)
    try {
      const r = await api.optimizeDay({ plan: payload, day_index: dayIndex })
      setOpt({ ...r, dayIndex })
    } catch (e) {
      push(e.message, 'error')
    } finally {
      setOptimizing(null)
    }
  }

  const newTrip = () => {
    if (trip.dirty && !window.confirm('แผนปัจจุบันยังไม่ได้บันทึก ต้องการเริ่มทริปใหม่หรือไม่?')) return
    trip.reset()
    setSchedule(null)
    navigate('/planner')
  }

  if (loadState.loading) return <div className="mx-auto max-w-7xl px-4 py-16"><Spinner label="กำลังโหลดทริป…" /></div>
  if (loadState.error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={loadState.error} />
        <Link to="/trips" className="mt-4 inline-block text-forest underline">กลับไปที่ทริปของฉัน</Link>
      </div>
    )

  const totalBlocks = trip.days.reduce((n, d) => n + d.blocks.length, 0)
  const dragBlock = dragId ? trip.days.flatMap((d) => d.blocks).find((b) => b.id === dragId) : null
  const counts = { error: 0, warning: 0, info: 0 }
  schedule?.warnings.forEach((w) => counts[w.level]++)
  const { markers, routes } = routeLayers(trip, schedule, trip.activeDay)

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-gradient-sky pb-1 text-3xl font-semibold">วางแผนทริป</h1>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className={`relative h-2 w-2 shrink-0 rounded-full ${trip.tripId && !trip.dirty ? 'bg-[#3f9d7a]' : 'ping bg-sun'}`} aria-hidden="true" />
            {trip.tripId ? (trip.dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแล้ว') : 'แบบร่าง (เก็บไว้ในเบราว์เซอร์นี้จนกว่าจะบันทึก)'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={newTrip}>เริ่มทริปใหม่</Button>
          {trip.tripId && <Button variant="ghost" onClick={() => navigate(`/trips/${trip.tripId}`)} disabled={trip.dirty} title={trip.dirty ? 'บันทึกก่อนดูรายละเอียด' : ''}>ดูรายละเอียดทริป</Button>}
          <Button onClick={(e) => save(e.currentTarget)} loading={saving} disabled={saving || totalBlocks === 0}>{saving ? 'กำลังบันทึก…' : justSaved ? <><span className="pop-in" aria-hidden="true">✓</span> บันทึกแล้ว</> : trip.tripId ? 'บันทึกการแก้ไข' : 'บันทึกทริป'}</Button>
        </div>
      </div>

      <div className="mt-5 rounded-3xl card-sky p-4 ring-1 ring-forest/5"><TripSettings /></div>

      <div className="mt-4"><RoutingNotice status={schedule?.routing} compact /></div>
      {computeErr && <div className="mt-3"><ErrorState error={computeErr} /></div>}

      {opt && (
        <div className="fade-up mt-4 flex flex-col gap-3 rounded-2xl bg-leaf/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p className="text-sm">
            {opt.changed ? (
              <>วันที่ {opt.dayIndex + 1}: ลำดับใหม่ลดเวลาเดินทางจาก {fmtDuration(opt.travel_before_min)} เหลือ {fmtDuration(opt.travel_after_min)} (ประหยัด {fmtDuration(opt.saved_min)}){opt.is_estimate && ' — คำนวณจากค่าประมาณ'}. จุดแรก ที่พักท้ายวัน และ Block ที่ล็อกเวลาจะอยู่ที่เดิม</>
            ) : (
              opt.message || `วันที่ ${opt.dayIndex + 1}: ลำดับปัจจุบันดีที่สุดแล้ว`
            )}
          </p>
          <div className="flex gap-2">
            {opt.changed && <Button onClick={() => { trip.applyOrder(opt.dayIndex, opt.order); setOpt(null); push('ใช้ลำดับใหม่แล้ว') }}>ใช้ลำดับนี้</Button>}
            <Button variant="ghost" onClick={() => setOpt(null)}>ปิด</Button>
          </div>
        </div>
      )}

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_360px_minmax(0,1fr)]">
        <aside className="planner-add-panel min-w-0 lg:sticky lg:top-24 lg:self-start"><AddPanel /></aside>

        <div className="min-w-0 space-y-6">
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={({ active }) => setDragId(active.id)} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
            <div className="planner-day-list flex flex-col gap-4 md:flex-row md:overflow-x-auto md:pb-3">
              {trip.days.map((d, i) => (
                <DayColumn key={i} index={i} day={d} computedDay={schedule?.days?.[i]} onOptimize={optimize} optimizing={optimizing === i} />
              ))}
            </div>
            <DragOverlay>{dragBlock ? <BlockItem block={dragBlock} overlay computed={null} /> : null}</DragOverlay>
          </DndContext>
        </div>

        <aside className="min-w-0 space-y-4 lg:col-start-2 xl:sticky xl:top-24 xl:col-start-auto xl:self-start" aria-label="แผนที่และสรุปทริป">
            <div className="rounded-3xl bg-white p-4 ring-1 ring-forest/10">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl text-ink">เส้นทางวันที่ {trip.activeDay + 1} <span className="font-sans text-sm text-muted">{fmtThaiDate(schedule?.days?.[trip.activeDay]?.date)}</span></h2>
                {computing && <span className="soft-pulse text-xs font-medium text-forest">กำลังคำนวณเวลา…</span>}
              </div>
              <MapView className="h-80 sm:h-96 xl:h-[360px]" markers={markers} routes={routes} />
              <p className="mt-1 text-xs text-muted">เส้นประ = ค่าประมาณ (โหมดจำลอง), เส้นทึบ = เส้นทางจริงจากผู้ให้บริการแผนที่</p>
            </div>
            <div className="rounded-3xl card-sky p-5 ring-1 ring-forest/5">
              <h2 className="text-xl text-ink">สรุปทั้งทริป</h2>
              {schedule ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-mist p-3"><dt className="text-muted">ระยะทางรวม</dt><dd className="font-display text-xl text-forest"><CountUp value={schedule.totals.distance_km} format={(v) => `${Math.round(v * 10) / 10} กม.`} duration={600} /></dd></div>
                    <div className="rounded-xl bg-mist p-3"><dt className="text-muted">เวลาเดินทางรวม</dt><dd className="font-display text-xl text-forest"><CountUp value={schedule.totals.travel_min} format={(v) => fmtDuration(Math.round(v))} duration={600} /></dd></div>
                  </dl>
                  <p className="mt-4 text-sm font-semibold">การแจ้งเตือน</p>
                  {schedule.warnings.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">{totalBlocks ? 'แผนนี้ไม่มีปัญหาที่ตรวจพบ' : 'เพิ่ม Block เพื่อเริ่มตรวจสอบแผน'}</p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-muted">ปัญหา {counts.error}, ควรระวัง {counts.warning}, คำแนะนำ {counts.info}</p>
                      <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
                        {schedule.warnings.map((w, i) => (
                          <li key={i} className={`fade-up rounded-lg px-2.5 py-1.5 text-xs ${w.level === 'error' ? 'bg-alert-soft text-alert' : w.level === 'warning' ? 'bg-sun-soft text-[#6b4f0e]' : 'bg-mist text-muted'}`}>
                            <b>วันที่ {w.day_index + 1}:</b> {w.message}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <div className="mt-3"><Spinner label="กำลังคำนวณ…" /></div>
              )}
            </div>
        </aside>
      </div>
    </div>
  )
}
