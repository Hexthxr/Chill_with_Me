// Small one-shot effects that don't need React state. All of them step aside for reduced-motion users.

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Material-style ripple on every .btn-primary / .btn-ripple. Returns the cleanup function. */
export function attachRipple() {
  const onDown = (e) => {
    const btn = e.target.closest?.('.btn-primary, .btn-ripple')
    if (!btn || btn.disabled || prefersReducedMotion()) return
    const r = btn.getBoundingClientRect()
    const d = Math.max(r.width, r.height) * 2
    const dot = document.createElement('span')
    dot.className = 'ripple'
    dot.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`
    dot.addEventListener('animationend', () => dot.remove())
    btn.appendChild(dot)
  }
  document.addEventListener('pointerdown', onDown)
  return () => document.removeEventListener('pointerdown', onDown)
}

/** A map pin flies from the "add to trip" button to the planner link, which then gives a little bump. */
export function flyToPlanner(fromEl) {
  if (!fromEl || prefersReducedMotion()) return
  const target = [...document.querySelectorAll('[data-fly-target]')].find((el) => el.getClientRects().length > 0)
  if (!target) return
  const a = fromEl.getBoundingClientRect()
  const b = target.getBoundingClientRect()
  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  const pin = document.createElement('div')
  pin.className = 'fly-pin'
  pin.style.left = `${a.left + a.width / 2}px`
  pin.style.top = `${a.top + a.height / 2}px`
  pin.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="#e2683f" stroke="#fff" stroke-width="1.5" d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>'
  document.body.appendChild(pin)
  const at = (x, y, s) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${s})`
  pin.animate(
    [
      { transform: at(0, 0, 0.6), opacity: 0.4 },
      { transform: at(dx * 0.35, dy * 0.35 - 60, 1.25), opacity: 1, offset: 0.45 },
      { transform: at(dx, dy, 0.4), opacity: 0.7 },
    ],
    { duration: 780, easing: 'cubic-bezier(.45,.05,.35,1)' },
  ).onfinish = () => {
    pin.remove()
    target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' })
  }
}

/** A short burst of paper in the theme colours – kept for real milestones (a trip's first save). */
export function confetti(fromEl) {
  if (!fromEl || prefersReducedMotion()) return
  const r = fromEl.getBoundingClientRect()
  const colors = ['#0e7490', '#2a9db5', '#e2683f', '#f59e3f', '#ffc56b', '#3f9d7a']
  for (let i = 0; i < 26; i++) {
    const bit = document.createElement('span')
    bit.className = 'confetti-bit'
    bit.style.left = `${r.left + r.width / 2}px`
    bit.style.top = `${r.top + r.height / 2}px`
    bit.style.background = colors[i % colors.length]
    document.body.appendChild(bit)
    const angle = Math.random() * Math.PI * 2
    const dist = 50 + Math.random() * 110
    const x = Math.cos(angle) * dist
    const y = Math.sin(angle) * dist - 50
    const spin = Math.random() * 720 - 360
    bit.animate(
      [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${x}px,${y}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${x * 1.15}px,${y + 110}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).onfinish = () => bit.remove()
  }
}
