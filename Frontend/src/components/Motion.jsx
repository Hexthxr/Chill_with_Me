import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/fx'
import { fmtInt } from '../lib/format'

/** True once the element has scrolled into view (stays true). */
export function useInView() {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') return setSeen(true)
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -4% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

/** Fades content up when it scrolls into view; CSS can also key child effects off `.reveal.in`. */
export function Reveal({ as: Tag = 'div', className = '', children, ...props }) {
  const [ref, seen] = useInView()
  return (
    <Tag ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`} {...props}>
      {children}
    </Tag>
  )
}

const defaultFormat = (v) => fmtInt(Math.round(v))

/** A number that counts to its value when first seen, and glides whenever the value changes. */
export function CountUp({ value, format = defaultFormat, duration = 900, className = '' }) {
  const [ref, seen] = useInView()
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  const current = useRef(0)

  useEffect(() => {
    if (!seen) return
    if (prefersReducedMotion()) {
      current.current = value
      setShown(value)
      return
    }
    from.current = current.current
    const started = performance.now()
    let raf
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - t) ** 3
      const v = t === 1 ? value : from.current + (value - from.current) * eased
      current.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // animation frames stop in a hidden tab: make sure the real number still lands
    const landing = setTimeout(() => {
      cancelAnimationFrame(raf)
      current.current = value
      setShown(value)
    }, duration + 150)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(landing)
    }
  }, [value, seen, duration])

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
