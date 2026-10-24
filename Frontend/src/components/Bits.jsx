import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fmtInt, fmtPct, fmtRating } from '../lib/format'
import { useToast } from '../store/tripStore'

export function Rating({ rating, count, className = '' }) {
  if (rating == null) return <span className={`text-sm text-muted ${className}`}>ยังไม่มีคะแนน</span>
  return (
    <span className={`inline-flex items-baseline gap-1 text-sm ${className}`}>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 self-center fill-sun" aria-hidden="true">
        <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9z" />
      </svg>
      <b className="font-semibold">{fmtRating(rating)}</b>
      <span className="text-muted">({fmtInt(count)})</span>
    </span>
  )
}

/** ML sentiment summary – only when the model actually analysed reviews. */
export function SentimentPill({ ml, className = '' }) {
  if (!ml || !ml.n_analyzed) return null
  const pct = ml.positive_share
  const tone = pct >= 0.85 ? 'bg-leaf text-forest' : pct >= 0.6 ? 'bg-sun-soft text-[#7a5a10]' : 'bg-alert-soft text-alert'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone} ${className}`} title={`โมเดล ML วิเคราะห์ ${ml.n_analyzed} รีวิว`}>
      รีวิวเชิงบวก {fmtPct(pct)}
      <span className="opacity-70">/ {fmtInt(ml.n_analyzed)} รีวิว</span>
    </span>
  )
}

export function InterestChips({ interests, selected, onToggle, size = 'md' }) {
  const pad = size === 'lg' ? 'px-4 py-2 text-base' : 'px-3 py-1.5 text-sm'
  return (
    <div className="flex flex-wrap gap-2">
      {interests.map((it) => {
        const on = selected.includes(it.key)
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(it.key)}
            className={`rounded-full ${pad} font-medium transition-colors ${
              on ? 'bg-forest text-white' : 'bg-white text-forest ring-1 ring-forest/20 hover:ring-forest/50'
            }`}
          >
            <span aria-hidden="true" className="mr-1">{it.emoji}</span>
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function useInterests() {
  const [items, setItems] = useState([])
  useEffect(() => {
    api.interests().then(setItems).catch(() => setItems([]))
  }, [])
  return items
}

let routingCache = null
export function useRoutingStatus() {
  const [s, setS] = useState(routingCache)
  useEffect(() => {
    if (routingCache) return
    api.routingStatus().then((r) => { routingCache = r; setS(r) }).catch(() => {})
  }, [])
  return s
}

export function RoutingNotice({ status, compact = false }) {
  if (!status) return null
  if (!status.is_mock)
    return <p className="text-xs text-muted">เวลาเดินทางจาก {status.provider} (ข้อมูลเส้นทางจริง)</p>
  return (
    <div className={`rounded-xl bg-sun-soft text-[#6b4f0e] ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}>
      <b>โหมดจำลอง:</b> ยังไม่ได้ตั้งค่า Map/Route API — ระยะทางและเวลาเดินทางเป็น<b>ค่าประมาณ</b>จากระยะเส้นตรง ไม่ใช่ข้อมูลถนนจริง
    </div>
  )
}

export function Toasts() {
  const toasts = useToast((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-full px-5 py-2.5 text-sm shadow-lg ${t.tone === 'error' ? 'bg-alert text-white' : 'bg-forest-deep text-white'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const v = {
    primary: 'btn-primary disabled:opacity-50',
    ghost: 'bg-white text-forest ring-1 ring-forest/20 hover:ring-forest/50 disabled:opacity-50',
    sun: 'bg-sun text-ink hover:brightness-95 disabled:opacity-50',
    danger: 'bg-white text-alert ring-1 ring-alert/30 hover:bg-alert-soft',
  }[variant]
  return <button className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${v} ${className}`} {...props} />
}
