import { useEffect, useRef, useState } from 'react'
import { api, assetUrl } from '../lib/api'

const iconBtn = 'grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30'

function Lightbox({ items, start, onClose }) {
  const [i, setI] = useState(start)
  const closeBtn = useRef(null)
  const go = (delta) => setI((x) => (x + delta + items.length) % items.length)
  const image = items[i]

  useEffect(() => {
    const opener = document.activeElement
    closeBtn.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }) // re-subscribes each render so `go` always sees the current list

  return (
    <div role="dialog" aria-modal="true" aria-label="ดูรูปขนาดใหญ่" onClick={onClose} className="fade-up fixed inset-0 z-[2500] flex flex-col bg-[#06262f]/95 p-4">
      <div className="flex items-center justify-between text-sm text-white">
        <span aria-live="polite">{i + 1} / {items.length}</span>
        <button ref={closeBtn} type="button" onClick={onClose} aria-label="ปิด" className={iconBtn}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
          <button type="button" onClick={() => go(-1)} aria-label="รูปก่อนหน้า" className={`${iconBtn} shrink-0`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
        )}
        <img key={image.id} src={assetUrl(image.url)} alt={image.caption || ''} className="fade-up max-h-full min-w-0 max-w-full rounded-xl object-contain" />
        {items.length > 1 && (
          <button type="button" onClick={() => go(1)} aria-label="รูปถัดไป" className={`${iconBtn} shrink-0`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
      {(image.caption || image.author) && (
        <p className="pt-3 text-center text-sm text-white/90" onClick={(e) => e.stopPropagation()}>
          {image.caption}{image.caption && image.author ? ' · ' : ''}{image.author && `ภาพ: ${image.author}`}
        </p>
      )}
    </div>
  )
}

/** Photos added by admins for this place. Shows nothing when there is at most one: the banner already has it. */
export default function PlaceGallery({ placeId }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let alive = true
    setItems([])
    api.placePhotos(placeId).then((r) => alive && setItems(r.items)).catch(() => {})
    return () => {
      alive = false
    }
  }, [placeId])

  if (items.length < 2) return null
  return (
    <section className="rounded-3xl card-sky p-6 ring-1 ring-forest/5 sm:p-8">
      <h2 className="text-2xl text-ink">รูปภาพ <span className="font-sans text-base font-normal text-muted">({items.length})</span></h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((image, i) => (
          <li key={image.id}>
            <button type="button" onClick={() => setOpen(i)} aria-label={`ดูรูปที่ ${i + 1}${image.caption ? `: ${image.caption}` : ''}`} className="group block aspect-[4/3] w-full overflow-hidden rounded-xl bg-mist">
              <img src={assetUrl(image.thumb_url)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
            </button>
          </li>
        ))}
      </ul>
      {open != null && <Lightbox items={items} start={open} onClose={() => setOpen(null)} />}
    </section>
  )
}
