export function Spinner({ label = 'กำลังโหลด…' }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-leaf border-t-forest" />
      <span>{label}</span>
    </div>
  )
}

export function CardSkeletons({ n = 6 }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl bg-white">
          <div className="skeleton h-36" />
          <div className="space-y-2 p-4">
            <div className="skeleton h-5 w-3/4 rounded" />
            <div className="skeleton h-4 w-1/2 rounded" />
            <div className="skeleton h-4 w-full rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-moss/40 bg-white/60 px-6 py-12 text-center">
      <svg viewBox="0 0 120 60" className="mx-auto mb-4 h-14 w-28 text-moss" aria-hidden="true">
        <path d="M5 50 Q30 10 60 30 T115 20" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" />
        <circle cx="5" cy="50" r="4" fill="currentColor" />
        <circle cx="115" cy="20" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <h3 className="text-lg text-forest">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-md text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="rounded-2xl border border-alert/30 bg-alert-soft px-5 py-4 text-ink">
      <p className="font-semibold text-alert">โหลดข้อมูลไม่สำเร็จ</p>
      <p className="mt-1 text-sm">{error?.message || String(error)}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-alert ring-1 ring-alert/30 hover:bg-alert/5">
          ลองอีกครั้ง
        </button>
      )}
    </div>
  )
}
