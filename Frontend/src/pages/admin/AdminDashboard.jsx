import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, Spinner } from '../../components/States'
import { api } from '../../lib/api'
import { fmtInt, fmtPct } from '../../lib/format'
import { ACTION_LABELS, AdminShell, DailyBars, fmtDateTime, StatTile } from './adminUi'

export default function AdminDashboard() {
  const [state, setState] = useState({ loading: true })
  const load = () => {
    setState({ loading: true })
    api.admin.stats().then((data) => setState({ data })).catch((error) => setState({ error }))
  }
  useEffect(load, [])

  const s = state.data
  return (
    <AdminShell
      title="แดชบอร์ด"
      subtitle="ภาพรวมผู้ใช้ ทริป และข้อมูลสถานที่"
      actions={<button onClick={load} className="rounded-full bg-white px-4 py-2 text-sm text-forest ring-1 ring-forest/20 hover:ring-forest/50">รีเฟรช</button>}
    >
      {state.loading && <Spinner />}
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {s && (
        <div className="space-y-8">
          <section aria-label="ตัวเลขหลัก" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="ผู้ใช้ทั้งหมด" value={s.users.total} sub={`ใหม่ 7 วัน ${fmtInt(s.users.new_7d)} · แอดมิน ${fmtInt(s.users.admins)}`} />
            <StatTile label="ผู้ใช้ที่ใช้งาน 7 วัน" value={s.users.active_7d} sub="เปิดดูหรือเพิ่มสถานที่ลงทริป" />
            <StatTile label="ทริปทั้งหมด" value={s.trips.total} sub={`สร้างใหม่ 7 วัน ${fmtInt(s.trips.new_7d)}`} />
            <StatTile label="การเปิดดูสถานที่ 7 วัน" value={s.activity.views_7d} sub={`เพิ่มลงทริป ${fmtInt(s.activity.trip_adds_7d)} ครั้ง`} />
          </section>

          <section aria-label="กราฟรายวัน" className="grid gap-4 lg:grid-cols-3">
            <DailyBars title="ผู้ใช้สมัครใหม่" data={s.users.signups_daily} unit=" คน" />
            <DailyBars title="ทริปที่สร้าง" data={s.trips.created_daily} unit=" ทริป" />
            <DailyBars title="การเปิดดูสถานที่" data={s.activity.views_daily} unit=" ครั้ง" />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl bg-white p-4 ring-1 ring-forest/10">
              <h2 className="font-medium text-ink">สถานที่ยอดนิยม 30 วัน</h2>
              {s.activity.top_places_30d.length === 0 ? (
                <p className="mt-3 text-sm text-muted">ยังไม่มีการเปิดดูสถานที่</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr><th className="py-1 font-normal">สถานที่</th><th className="py-1 text-right font-normal">เปิดดู</th><th className="py-1 text-right font-normal">ลงทริป</th></tr>
                  </thead>
                  <tbody>
                    {s.activity.top_places_30d.map((p) => (
                      <tr key={p.place_id} className="border-t border-sand">
                        <td className="py-1.5 pr-2">
                          <Link to={`/admin/places/${encodeURIComponent(p.place_id)}`} className="text-forest hover:underline">{p.name || p.place_id}</Link>
                          <span className="ml-1 text-muted">{p.province}</span>
                          {p.hidden && <span className="ml-1.5 rounded bg-alert-soft px-1.5 text-xs text-alert">ซ่อนอยู่</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{fmtInt(p.views)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtInt(p.trip_adds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-2xl bg-white p-4 ring-1 ring-forest/10">
              <h2 className="font-medium text-ink">จังหวัดที่อยู่ในทริปมากที่สุด</h2>
              {s.trips.top_provinces.length === 0 ? (
                <p className="mt-3 text-sm text-muted">ยังไม่มีทริป</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr><th className="py-1 font-normal">จังหวัด</th><th className="py-1 text-right font-normal">ทริป</th><th className="py-1 text-right font-normal">สถานที่ในทริป</th></tr>
                  </thead>
                  <tbody>
                    {s.trips.top_provinces.map((p) => (
                      <tr key={p.province} className="border-t border-sand">
                        <td className="py-1.5">{p.province}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtInt(p.trips)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtInt(p.places)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <section aria-label="ข้อมูลและโมเดล" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="สถานที่ทั้งหมด" value={s.places.total} sub={`ที่พัก ${fmtInt(s.places.accommodation)} · ไม่มีคะแนน ${fmtInt(s.places.without_rating)}`} />
            <StatTile label="ซ่อน / แก้ไขโดยแอดมิน" value={`${fmtInt(s.places.hidden)} / ${fmtInt(s.places.edited)}`} sub={<Link to="/admin/places?status=hidden" className="text-forest hover:underline">ดูรายการที่ซ่อน</Link>} />
            <StatTile label="รีวิวที่ ML วิเคราะห์" value={s.reviews.analyzed} sub={`จาก ${fmtInt(s.reviews.total)} · เชิงลบ ${fmtInt(s.reviews.negative)}`} />
            <StatTile
              label="โมเดล Sentiment"
              value={s.ml.ready ? `F1 ${s.ml.f1_macro?.toFixed(3) ?? '–'}` : 'ไม่พร้อม'}
              sub={s.ml.ready ? `Accuracy ${fmtPct(s.ml.accuracy) ?? '–'}${s.ml.trained_at ? ` · train ${fmtDateTime(s.ml.trained_at)}` : ''}` : s.ml.error}
            />
          </section>

          <section className="rounded-2xl bg-white p-4 ring-1 ring-forest/10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium text-ink">แก้ไขล่าสุด</h2>
              <Link to="/admin/audit" className="text-sm text-forest hover:underline">ดูทั้งหมด</Link>
            </div>
            {s.recent_edits.length === 0 ? (
              <p className="mt-3 text-sm text-muted">ยังไม่มีการแก้ไขข้อมูลสถานที่</p>
            ) : (
              <ul className="mt-2 divide-y divide-sand text-sm">
                {s.recent_edits.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 py-2">
                    <span className="rounded bg-mist px-1.5 text-xs text-forest">{ACTION_LABELS[a.action] || a.action}</span>
                    <Link to={`/admin/places/${encodeURIComponent(a.place_id)}`} className="text-forest hover:underline">{a.place_name}</Link>
                    <span className="text-muted">โดย {a.admin_name} · {fmtDateTime(a.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AdminShell>
  )
}
