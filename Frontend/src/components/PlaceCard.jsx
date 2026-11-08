import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { flyToPlanner } from '../lib/fx'
import { useAuth } from '../store/authStore'
import { useToast, useTrip } from '../store/tripStore'
import { Rating, SentimentPill } from './Bits'
import PlaceArt from './PlaceArt'

export function useAddToTrip() {
  const addPlace = useTrip((s) => s.addPlace)
  const activeDay = useTrip((s) => s.activeDay)
  const push = useToast((s) => s.push)
  return (place) => {
    addPlace(place)
    push(`เพิ่ม “${place.name}” ลงวันที่ ${activeDay + 1} แล้ว`)
    api.logActivity(place.place_id, 'trip_add').catch(() => {}) // behaviour signal for personal recommendations
  }
}

/** Add-to-trip with its reward: a pin flies to the planner link and the button turns into a check. */
export function AddTripButton({ place, className = '' }) {
  const add = useAddToTrip()
  const inTrip = useTrip((s) => s.days.some((d) => d.blocks.some((b) => b.place_id === place.place_id)))
  return (
    <button
      onClick={(e) => {
        flyToPlanner(e.currentTarget)
        add(place)
      }}
      className={`inline-flex items-center gap-1.5 rounded-full text-sm font-medium transition ${inTrip ? 'btn-ripple bg-leaf text-forest hover:bg-[#bde7ec]' : 'btn-primary text-white'} ${className}`}
    >
      {inTrip ? (
        <>
          <svg viewBox="0 0 24 24" className="pop-in h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
          อยู่ในทริปแล้ว (เพิ่มซ้ำ)
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          เพิ่มลงทริป
        </>
      )}
    </button>
  )
}

export default function PlaceCard({ place, rank, index = 0 }) {
  const [open, setOpen] = useState(false)
  const loggedIn = useAuth((s) => !!s.token)
  const reasons = place.reasons || []
  const shown = open ? reasons : reasons.slice(0, 2)

  return (
    <article className="card-sky card-lift card-in group flex flex-col overflow-hidden rounded-2xl ring-1 ring-forest/5" style={{ '--i': index }}>
      <Link to={`/place/${encodeURIComponent(place.place_id)}`} className="block" aria-label={place.name}>
        <PlaceArt place={place} className="h-36" />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg leading-snug text-ink">
            <Link to={`/place/${encodeURIComponent(place.place_id)}`} className="hover:text-forest hover:underline decoration-moss/50 underline-offset-4">
              {rank != null && <span className="mr-1.5 text-moss">{rank}.</span>}
              {place.name}
            </Link>
          </h3>
        </div>
        <p className="mt-0.5 text-sm text-muted">
          {place.district ? `${place.district.replace(/^อำเภอ\s?/, 'อ.')}, ` : ''}
          {place.province}
          {place.distance_km != null && <span className="ml-2 text-forest">ห่าง {place.distance_km.toFixed(1)} กม.</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Rating rating={place.rating} count={place.rating_count} />
          <SentimentPill ml={place.ml} />
        </div>

        {reasons.length > 0 && (
          <div className="mt-3 rounded-xl bg-mist/70 px-3 py-2">
            <p className="text-xs font-semibold text-forest">ทำไมถึงแนะนำ</p>
            <ul className="mt-1 space-y-0.5 text-sm text-ink/85">
              {shown.map((r, i) => (
                <li key={i} className="fade-up flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-moss" aria-hidden="true" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            {reasons.length > 2 && (
              <button onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-forest underline underline-offset-2">
                {open ? 'ย่อ' : `ดูเหตุผลอีก ${reasons.length - 2} ข้อ`}
              </button>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-4">
          {loggedIn && (
          <AddTripButton place={place} className="px-4 py-2" />
          )}
          <Link to={`/place/${encodeURIComponent(place.place_id)}`} className="link-arrow rounded-full px-3 py-2 text-sm font-medium text-forest hover:bg-mist">
            รายละเอียด <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </Link>
        </div>
      </div>
    </article>
  )
}
