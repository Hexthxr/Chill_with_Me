import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDuration, fmtKm } from '../lib/format'
import { useTrip } from '../store/tripStore'
import { KIND_LABEL } from './planUtils'

export const KIND_STYLE = {
  place: { stripe: 'bg-forest', chip: 'bg-mist text-forest' },
  food: { stripe: 'bg-coral', chip: 'bg-coral-soft text-[#a8431f]' },
  hotel: { stripe: 'bg-[#8a5a9e]', chip: 'bg-[#f1e8f5] text-[#6d4480]' },
  rest: { stripe: 'bg-[#3f9d7a]', chip: 'bg-[#e0f3ea] text-[#1f7255]' },
  custom: { stripe: 'bg-moss', chip: 'bg-mist text-forest' },
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 720]

export function TravelChip({ travel }) {
  if (!travel) return null
  return (
    <div className="relative flex items-center gap-2 py-1.5 pl-5 text-xs text-muted">
      <span className="trail-line absolute bottom-0 left-[9px] top-0 w-0.5" aria-hidden="true" />
      <svg viewBox="0 0 24 24" className="relative h-4 w-4 shrink-0 fill-moss" aria-hidden="true">
        <path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1zm2.2-1h9.6l-1-3H8.2zM7.5 14a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
      <span>
        {fmtDuration(travel.duration_min)} · {fmtKm(travel.distance_m)}
        {travel.is_estimate && <span className="ml-1 rounded bg-sun-soft px-1 text-[#6b4f0e]">ประมาณการ</span>}
      </span>
    </div>
  )
}

export default function BlockItem({ block, computed, index, overlay = false }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: overlay })
  const update = useTrip((s) => s.updateBlock)
  const remove = useTrip((s) => s.removeBlock)
  const [open, setOpen] = useState(false)
  const st = KIND_STYLE[block.kind] || KIND_STYLE.custom
  const warnings = computed?.warnings || []
  const worst = warnings.some((w) => w.level === 'error') ? 'error' : warnings.some((w) => w.level === 'warning') ? 'warning' : null

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-40' : ''}>
      {!overlay && <TravelChip travel={computed?.travel} />}
      <div
        className={`relative flex overflow-hidden rounded-2xl bg-white ring-1 transition-shadow hover:shadow-md ${
          worst === 'error' ? 'ring-alert/60' : worst === 'warning' ? 'ring-sun' : 'ring-forest/10'
        } ${overlay ? 'rotate-2 scale-[1.03] cursor-grabbing shadow-2xl' : 'block-in'}`}
      >
        <span className={`w-1.5 shrink-0 ${st.stripe}`} aria-hidden="true" />
        <button
          className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted hover:bg-mist active:cursor-grabbing"
          aria-label={`ลากเพื่อย้าย ${block.name}`}
          {...attributes}
          {...listeners}
        >
          <svg viewBox="0 0 12 20" className="h-5 w-3 fill-current" aria-hidden="true">
            {[3, 9].map((x) => [4, 10, 16].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />))}
          </svg>
        </button>
        <div className="min-w-0 flex-1 py-2.5 pr-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-forest">
                {/* keyed by the time: when the schedule shifts this block, the new time glows */}
                <span key={computed ? `${computed.start}${computed.end}` : 'none'} className={computed ? 'time-flash px-0.5' : 'px-0.5'}>
                  {computed ? `${computed.start} – ${computed.end}` : '··:·· – ··:··'}
                </span>
                {block.locked && <span className="ml-1.5 rounded bg-forest px-1.5 py-px text-[11px] font-medium text-white">ล็อกเวลา</span>}
              </p>
              <p className="truncate font-medium leading-snug" title={block.name}>
                {block.place_id ? <Link to={`/place/${encodeURIComponent(block.place_id)}`} className="hover:underline">{block.name}</Link> : block.name}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className={`rounded-full px-2 py-px ${st.chip}`}>{KIND_LABEL[block.kind]}</span>
                <span className="text-muted">{fmtDuration(block.duration_min)}</span>
                {block.lat == null && block.kind !== 'rest' && <span className="text-muted">ไม่มีพิกัด (ไม่คิดเวลาเดินทาง)</span>}
              </p>
            </div>
            <button onClick={() => setOpen(!open)} aria-expanded={open} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-forest hover:bg-mist">
              {open ? 'ปิด' : 'แก้ไข'}
            </button>
          </div>

          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className={`rounded-lg px-2 py-1 text-xs ${w.level === 'error' ? 'warn-error bg-alert-soft text-alert' : w.level === 'warning' ? 'bg-sun-soft text-[#6b4f0e]' : 'bg-mist text-muted'}`}>
                  {w.message}
                </li>
              ))}
            </ul>
          )}

          {open && (
            <div className="fade-up mt-3 grid grid-cols-2 gap-3 border-t border-forest/10 pt-3 text-sm">
              <label className="col-span-2">
                <span className="text-xs text-muted">ชื่อ</span>
                <input value={block.name} maxLength={200} onChange={(e) => update(block.id, { name: e.target.value })} className="mt-0.5 w-full rounded-lg bg-cream px-2 py-1.5 ring-1 ring-forest/15" />
              </label>
              <label>
                <span className="text-xs text-muted">ระยะเวลา</span>
                <select value={block.duration_min} onChange={(e) => update(block.id, { duration_min: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg bg-cream px-2 py-1.5 ring-1 ring-forest/15">
                  {[...new Set([...DURATIONS, block.duration_min])].sort((a, b) => a - b).map((d) => (
                    <option key={d} value={d}>{fmtDuration(d)}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="text-xs text-muted">ล็อกเวลาเริ่ม</span>
                <div className="mt-0.5 flex items-center gap-2">
                  <input type="checkbox" aria-label="ล็อกเวลาเริ่ม" checked={block.locked} onChange={(e) => update(block.id, { locked: e.target.checked, locked_start: e.target.checked ? block.locked_start || computed?.start?.slice(0, 5) || '09:00' : block.locked_start })} className="h-4 w-4 accent-forest" />
                  <input type="time" disabled={!block.locked} value={block.locked_start || ''} onChange={(e) => update(block.id, { locked_start: e.target.value })} className="min-w-0 flex-1 rounded-lg bg-cream px-2 py-1 ring-1 ring-forest/15 disabled:opacity-40" />
                </div>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-muted">เวลาเปิด–ปิด (ใส่เองถ้าทราบ ชุดข้อมูลไม่มีเวลาทำการ)</span>
                <div className="mt-0.5 flex items-center gap-2">
                  <input type="time" aria-label="เวลาเปิด" value={block.opening_hours?.open || ''} onChange={(e) => update(block.id, { opening_hours: { ...block.opening_hours, open: e.target.value } })} className="min-w-0 flex-1 rounded-lg bg-cream px-2 py-1 ring-1 ring-forest/15" />
                  <span>ถึง</span>
                  <input type="time" aria-label="เวลาปิด" value={block.opening_hours?.close || ''} onChange={(e) => update(block.id, { opening_hours: { ...block.opening_hours, close: e.target.value } })} className="min-w-0 flex-1 rounded-lg bg-cream px-2 py-1 ring-1 ring-forest/15" />
                  {block.opening_hours && <button onClick={() => update(block.id, { opening_hours: null })} className="text-xs text-muted underline">ล้าง</button>}
                </div>
              </div>
              <div className="col-span-2 flex justify-end">
                <button onClick={() => remove(block.id)} className="rounded-full px-3 py-1.5 text-xs font-medium text-alert ring-1 ring-alert/30 hover:bg-alert-soft">ลบ Block นี้</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
