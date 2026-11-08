import { Children, useCallback, useEffect, useRef, useState } from 'react'

function Arrow({ dir, show, onClick }) {
  const left = dir === 'left'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!show}
      aria-label={left ? 'เลื่อนไปทางซ้าย' : 'เลื่อนไปทางขวา'}
      className={`absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white text-forest shadow-[0_6px_18px_-4px_rgba(11,85,104,0.45)] ring-1 ring-forest/10 transition hover:bg-forest hover:text-white active:scale-95 ${
        left ? 'left-1 sm:-left-4' : 'right-1 sm:-right-4'
      } ${show ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={left ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  )
}

/** Horizontal row of cards with arrow buttons; an arrow only shows when there is more to see that way. */
export default function CardRail({ label, itemClassName = 'w-56', children }) {
  const ref = useRef(null)
  const bar = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const count = Children.count(children)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const left = el.scrollLeft > 4
    const right = el.scrollLeft < max - 4
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
    if (bar.current && max > 0) {
      const part = el.clientWidth / el.scrollWidth
      bar.current.style.width = `${part * 100}%`
      bar.current.style.left = `${(el.scrollLeft / max) * (1 - part) * 100}%`
    }
  }, [])

  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [measure, count, edges.left || edges.right])

  const go = (dir) => {
    const el = ref.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' })
  }

  // fade the cut-off card under the arrow instead of slicing it with a hard edge
  const mask = `linear-gradient(to right, ${edges.left ? 'transparent, #000 40px' : '#000, #000'}, ${edges.right ? '#000 calc(100% - 40px), transparent' : '#000, #000'})`

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={measure}
        role="group"
        aria-label={label}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="no-scrollbar -mx-4 -mb-3 flex snap-x snap-mandatory scroll-pl-4 gap-4 overflow-x-auto px-4 pb-4 pt-1 sm:-mx-2 sm:scroll-pl-2 sm:px-2"
      >
        {Children.map(children, (child) => (
          <div className={`shrink-0 snap-start ${itemClassName}`}>{child}</div>
        ))}
      </div>
      <Arrow dir="left" show={edges.left} onClick={() => go(-1)} />
      <Arrow dir="right" show={edges.right} onClick={() => go(1)} />
      {(edges.left || edges.right) && (
        <div className="relative mx-auto mt-4 h-1 w-20 overflow-hidden rounded-full bg-sand" aria-hidden="true">
          <span ref={bar} className="absolute inset-y-0 rounded-full bg-forest transition-[left] duration-150" />
        </div>
      )}
    </div>
  )
}
