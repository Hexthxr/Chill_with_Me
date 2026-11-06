import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, Spinner } from '../../components/States'
import { api } from '../../lib/api'
import { fmtInt } from '../../lib/format'
import { ACTION_LABELS, AdminShell, FIELD_LABELS, fmtDateTime, fmtValue } from './adminUi'

const PAGE = 30

export default function AdminAudit() {
  const [page, setPage] = useState(0)
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    api.admin.audit({ limit: PAGE, offset: page * PAGE }).then((data) => setState({ data })).catch((error) => setState({ error }))
  }, [page])

  const d = state.data
  const pages = d ? Math.ceil(d.total / PAGE) : 0
  return (
    <AdminShell title="ประวัติการแก้ไข" subtitle="ทุกการแก้ไขและการซ่อนสถานที่โดยผู้ดูแลระบบ">
      {state.loading && !d && <Spinner />}
      {state.error && <ErrorState error={state.error} />}
      {d && d.items.length === 0 && <EmptyState title="ยังไม่มีประวัติการแก้ไข" />}
      {d && d.items.length > 0 && (
        <>
          <p className="mb-2 text-sm text-muted">ทั้งหมด {fmtInt(d.total)} รายการ</p>
          <ul className="divide-y divide-sand rounded-2xl bg-white ring-1 ring-forest/10">
            {d.items.map((a, i) => (
              <li key={i} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-mist px-1.5 text-xs text-forest">{ACTION_LABELS[a.action] || a.action}</span>
                  <Link to={`/admin/places/${encodeURIComponent(a.place_id)}`} className="font-medium text-forest hover:underline">{a.place_name}</Link>
                  <span className="text-muted">โดย {a.admin_name} · {fmtDateTime(a.ts)}</span>
                </div>
                <ul className="mt-1 text-ink">
                  {Object.entries(a.changes || {}).map(([k, c]) => (
                    <li key={k} className="break-words">{FIELD_LABELS[k] || k}: <span className="text-muted line-through">{fmtValue(c.old)}</span> → {fmtValue(c.new)}</li>
                  ))}
                </ul>
                {a.note && <p className="mt-0.5 text-xs italic text-muted">“{a.note}”</p>}
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-full bg-white px-4 py-1.5 text-forest ring-1 ring-forest/20 disabled:opacity-40">ก่อนหน้า</button>
              <span className="text-muted">หน้า {page + 1} / {fmtInt(pages)}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded-full bg-white px-4 py-1.5 text-forest ring-1 ring-forest/20 disabled:opacity-40">ถัดไป</button>
            </div>
          )}
        </>
      )}
    </AdminShell>
  )
}
