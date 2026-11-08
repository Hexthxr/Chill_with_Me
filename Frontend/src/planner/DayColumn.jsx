import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { addDaysISO, fmtDuration, fmtThaiDate } from '../lib/format'
import { useTrip } from '../store/tripStore'
import BlockItem from './BlockItem'

export default function DayColumn({ index, day, computedDay, onOptimize, optimizing }) {
  const startDate = useTrip((s) => s.start_date)
  const tripStart = useTrip((s) => s.start_time)
  const active = useTrip((s) => s.activeDay === index)
  const setActive = useTrip((s) => s.setActiveDay)
  const setDayStart = useTrip((s) => s.setDayStart)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${index}` })
  const byId = Object.fromEntries((computedDay?.blocks || []).map((b) => [b.id, b]))
  const dayWarnings = (computedDay?.warnings || []).filter((w) => !w.block_id)
  const sum = computedDay?.summary

  return (
    <section
      aria-label={`วันที่ ${index + 1}`}
      onClick={() => !active && setActive(index)}
      className={`flex w-full shrink-0 flex-col rounded-3xl p-3 transition md:w-[340px] ${active ? 'bg-leaf/60 ring-2 ring-forest/30' : 'cursor-pointer bg-sand/60 hover:bg-sand'}`}
    >
      <header className="px-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg text-forest">
            วันที่ {index + 1}
            <span className="ml-2 font-sans text-sm text-muted">{fmtThaiDate(addDaysISO(startDate, index))}</span>
          </h3>
          {!active && <span className="text-xs text-muted">แตะเพื่อเลือก</span>}
          {active && <span className="fade-up flex items-center gap-1.5 rounded-full bg-forest px-2 py-0.5 text-xs text-white"><span className="ping relative h-1.5 w-1.5 rounded-full bg-[#ffc56b]" aria-hidden="true" />กำลังเพิ่มลงวันนี้</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <label className="flex items-center gap-1">
            เริ่ม
            <input type="time" value={day.start_time || tripStart} onChange={(e) => setDayStart(index, e.target.value === tripStart ? null : e.target.value)} className="rounded bg-white/80 px-1 py-0.5 text-ink ring-1 ring-forest/15" />
          </label>
          {sum && computedDay.end && (
            <span>
              จบ {computedDay.end}, เดินทาง {fmtDuration(sum.travel_min)} ({sum.distance_km} กม.)
            </span>
          )}
        </div>
      </header>

      <div ref={setNodeRef} className={`min-h-28 flex-1 rounded-2xl p-1 transition ${isOver ? 'bg-white/70 ring-2 ring-moss/60' : ''}`}>
        <SortableContext items={day.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {day.blocks.length === 0 ? (
            <div className={`grid h-28 place-items-center rounded-2xl border-2 border-dashed px-4 text-center text-sm transition ${isOver ? 'border-forest text-forest' : 'border-forest/20 text-muted'}`}>
              ลาก Block มาวางที่นี่ หรือเพิ่มจากแผงด้านซ้าย
            </div>
          ) : (
            day.blocks.map((b, i) => <BlockItem key={b.id} block={b} index={i} computed={byId[b.id]} />)
          )}
        </SortableContext>
      </div>

      {dayWarnings.length > 0 && (
        <ul className="mt-2 space-y-1 px-1">
          {dayWarnings.map((w, i) => (
            <li key={i} className={`rounded-lg px-2 py-1 text-xs ${w.level === 'error' ? 'bg-alert-soft text-alert' : w.level === 'warning' ? 'bg-sun-soft text-[#6b4f0e]' : 'bg-white/70 text-muted'}`}>
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {day.blocks.filter((b) => b.lat != null).length >= 3 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOptimize(index)
          }}
          disabled={optimizing}
          aria-busy={optimizing || undefined}
          className="btn-ripple mt-3 rounded-full bg-white px-3 py-2 text-xs font-medium text-forest ring-1 ring-forest/20 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-forest/50 disabled:opacity-50"
        >
          {optimizing ? 'กำลังคำนวณ…' : <><span aria-hidden="true">✨ </span>จัดลำดับให้เดินทางน้อยที่สุด</>}
        </button>
      )}
    </section>
  )
}
