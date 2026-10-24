import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CardSkeletons, EmptyState, ErrorState } from '../components/States'
import { api } from '../lib/api'
import { fmtDuration, fmtThaiDate, relativeTime } from '../lib/format'
import { getOwnerKey } from '../lib/ownerKey'
import { useAuth } from '../store/authStore'
import { useToast, useTrip } from '../store/tripStore'

export default function Trips() {
  const [state, setState] = useState({ loading: true })
  const push = useToast((s) => s.push)
  const currentId = useTrip((s) => s.tripId)
  const resetDraft = useTrip((s) => s.reset)
  const user = useAuth((s) => s.user)

  const load = () => {
    setState({ loading: true })
    api.listTrips({ owner_key: getOwnerKey() }).then(setState).catch((error) => setState({ error }))
  }
  useEffect(load, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (t) => {
    if (!window.confirm(`ลบทริป “${t.name}” ออกจากฐานข้อมูล?`)) return
    try {
      await api.deleteTrip(t.id)
      if (currentId === t.id) resetDraft()
      push('ลบทริปแล้ว')
      load()
    } catch (e) {
      push(e.message, 'error')
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-gradient-sky pb-1 text-3xl font-semibold sm:text-4xl">ทริปของฉัน</h1>
          <p className="mt-1 text-muted">{user ? `ทริปในบัญชีของ ${user.name}` : 'ทริปที่บันทึกจากเบราว์เซอร์นี้'}</p>
        </div>
        <Link to="/planner" className="rounded-full btn-primary px-5 py-2.5 text-sm font-medium text-white">วางแผนทริป</Link>
      </div>
      {!user && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-leaf/60 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>เข้าสู่ระบบเพื่อเก็บทริปไว้ในบัญชีและเปิดได้ทุกเครื่อง ทริปที่บันทึกไว้ในเบราว์เซอร์นี้จะถูกย้ายเข้าบัญชีให้อัตโนมัติ</p>
          <div className="flex shrink-0 gap-2">
            <Link to="/login?redirect=/trips" className="rounded-full px-4 py-2 font-medium text-forest ring-1 ring-forest/30 hover:bg-white">เข้าสู่ระบบ</Link>
            <Link to="/register?redirect=/trips" className="btn-primary rounded-full px-4 py-2 font-medium">สมัครสมาชิก</Link>
          </div>
        </div>
      )}
      <div className="mt-8">
        {state.loading && <CardSkeletons n={3} />}
        {state.error && <ErrorState error={state.error} onRetry={load} />}
        {state.items?.length === 0 && (
          <EmptyState title="ยังไม่มีทริปที่บันทึกไว้" action={<Link to="/recommend" className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-white">หาที่เที่ยวเพื่อเริ่มทริป</Link>}>
            เพิ่มสถานที่ลงทริปจากหน้าค้นหา แล้วกดบันทึกในหน้าวางแผนทริป
          </EmptyState>
        )}
        <ul className="space-y-4">
          {state.items?.map((t) => {
            const snap = t.schedule_snapshot || {}
            const wc = snap.warning_counts || {}
            const nDays = snap.days?.length
            return (
              <li key={t.id} className="rounded-3xl card-sky p-5 ring-1 ring-forest/5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl text-ink">{t.name}</h2>
                    <p className="text-sm text-muted">
                      {fmtThaiDate(t.start_date)}{nDays ? `, ${nDays} วัน` : ''}, ออกเดินทาง {t.start_time}
                    </p>
                    {snap.available && (
                      <p className="mt-1 text-sm">
                        ระยะทาง {snap.totals.distance_km} กม., เดินทาง {fmtDuration(snap.totals.travel_min)}
                        {wc.error > 0 && <span className="ml-2 rounded-full bg-alert-soft px-2 py-0.5 text-xs text-alert">ปัญหา {wc.error}</span>}
                        {wc.warning > 0 && <span className="ml-2 rounded-full bg-sun-soft px-2 py-0.5 text-xs text-[#6b4f0e]">ควรระวัง {wc.warning}</span>}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted">แก้ไขล่าสุด {relativeTime(t.updated_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/trips/${t.id}`} className="rounded-full btn-primary px-4 py-2 text-sm font-medium text-white">ดูแผนรายวัน</Link>
                    <Link to={`/planner/${t.id}`} className="rounded-full px-4 py-2 text-sm font-medium text-forest ring-1 ring-forest/25 hover:bg-mist">แก้ไข</Link>
                    <button onClick={() => remove(t)} className="rounded-full px-4 py-2 text-sm font-medium text-alert hover:bg-alert-soft">ลบ</button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
