import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, Spinner } from '../../components/States'
import { api } from '../../lib/api'
import { fmtInt, fmtRating } from '../../lib/format'
import { AdminShell, fmtDateTime } from './adminUi'

const PAGE = 25
const STATUSES = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'visible', label: 'แสดงอยู่' },
  { key: 'hidden', label: 'ซ่อนอยู่' },
  { key: 'edited', label: 'แก้ไขแล้ว' },
]

export default function AdminPlaces() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') || ''
  const province = sp.get('province') || ''
  const status = sp.get('status') || 'all'
  const page = Math.max(0, Number(sp.get('page') || 0))
  const [text, setText] = useState(q)
  const [provinces, setProvinces] = useState([])
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    api.admin.options().then((o) => setProvinces(o.provinces)).catch(() => {})
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    api.admin
      .places({ q, province, status, limit: PAGE, offset: page * PAGE }, ctrl.signal)
      .then((data) => setState({ data }))
      .catch((error) => error.name !== 'AbortError' && setState({ error }))
    return () => ctrl.abort()
  }, [q, province, status, page])

  const setParam = (k, v) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k !== 'page') next.delete('page')
    setSp(next)
  }

  const d = state.data
  const pages = d ? Math.ceil(d.total / PAGE) : 0
  return (
    <AdminShell title="จัดการสถานที่" subtitle="ค้นหา แก้ไขข้อมูล หรือซ่อนสถานที่จากผู้ใช้">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-60 flex-1 gap-2"
          onSubmit={(e) => { e.preventDefault(); setParam('q', text.trim()) }}
          role="search"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ชื่อสถานที่ หรือ place_id"
            aria-label="ค้นหาสถานที่"
            className="w-full rounded-full bg-white px-4 py-2 text-sm ring-1 ring-forest/20 focus:ring-forest/50"
          />
          <button className="btn-primary rounded-full px-4 py-2 text-sm font-medium">ค้นหา</button>
        </form>
        <select
          value={province}
          onChange={(e) => setParam('province', e.target.value)}
          aria-label="จังหวัด"
          className="rounded-full bg-white px-3 py-2 text-sm ring-1 ring-forest/20"
        >
          <option value="">ทุกจังหวัด</option>
          {provinces.map((p) => <option key={p.province} value={p.province}>{p.province}</option>)}
        </select>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="สถานะ">
        {STATUSES.map((s) => (
          <button
            key={s.key}
            aria-pressed={status === s.key}
            onClick={() => setParam('status', s.key === 'all' ? '' : s.key)}
            className={`rounded-full px-3 py-1 text-sm ${status === s.key ? 'bg-leaf font-medium text-forest' : 'text-forest hover:bg-mist'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {state.error && <ErrorState error={state.error} />}
        {state.loading && !d && <Spinner />}
        {d && d.items.length === 0 && <EmptyState title="ไม่พบสถานที่">ลองเปลี่ยนคำค้นหรือตัวกรอง</EmptyState>}
        {d && d.items.length > 0 && (
          <>
            <p className="mb-2 text-sm text-muted">พบ {fmtInt(d.total)} แห่ง{state.loading ? ' · กำลังโหลด…' : ''}</p>
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-forest/10">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-mist text-left text-muted">
                  <tr>
                    <th className="px-4 py-2 font-normal">สถานที่</th>
                    <th className="px-4 py-2 font-normal">จังหวัด</th>
                    <th className="px-4 py-2 font-normal">ประเภท</th>
                    <th className="px-4 py-2 text-right font-normal">คะแนน</th>
                    <th className="px-4 py-2 font-normal">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((p) => (
                    <tr key={p.place_id} className="border-t border-sand hover:bg-cream">
                      <td className="px-4 py-2">
                        <Link to={`/admin/places/${encodeURIComponent(p.place_id)}`} className="font-medium text-forest hover:underline">{p.name}</Link>
                        {p.is_accommodation && <span className="ml-1.5 text-xs text-muted">ที่พัก</span>}
                      </td>
                      <td className="px-4 py-2">{p.province}<span className="text-muted">{p.district ? ` · ${p.district}` : ''}</span></td>
                      <td className="px-4 py-2 text-muted">{p.primary_type || '–'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.rating != null ? `${fmtRating(p.rating)} (${fmtInt(p.rating_count)})` : <span className="text-muted">–</span>}
                      </td>
                      <td className="px-4 py-2">
                        {p.hidden
                          ? <span className="rounded bg-alert-soft px-1.5 py-0.5 text-xs text-alert">ซ่อนอยู่</span>
                          : <span className="rounded bg-leaf px-1.5 py-0.5 text-xs text-forest">แสดงอยู่</span>}
                        {p.admin_edited_at && <span className="ml-1.5 text-xs text-muted" title={fmtDateTime(p.admin_edited_at)}>แก้ไขแล้ว</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <button disabled={page === 0} onClick={() => setParam('page', String(page - 1))} className="rounded-full bg-white px-4 py-1.5 text-forest ring-1 ring-forest/20 disabled:opacity-40">ก่อนหน้า</button>
                <span className="text-muted">หน้า {page + 1} / {fmtInt(pages)}</span>
                <button disabled={page + 1 >= pages} onClick={() => setParam('page', String(page + 1))} className="rounded-full bg-white px-4 py-1.5 text-forest ring-1 ring-forest/20 disabled:opacity-40">ถัดไป</button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  )
}
