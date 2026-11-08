import { useEffect, useRef, useState } from 'react'
import PlaceArt from './PlaceArt'

/** Two-column auth layout: sky panel (desktop) + form card. */
export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-0 px-4 py-10 sm:px-6 md:grid-cols-[1fr_1.1fr] md:py-16">
      <aside className="promo-sky relative hidden overflow-hidden rounded-l-[32px] p-10 text-white md:block">
        <div className="absolute inset-x-0 bottom-0 h-56 [mask-image:linear-gradient(to_bottom,transparent,#000_45%)]">
          <PlaceArt place={{ place_id: 'auth-seaside', ml: { top_interest: 'sea' } }} showLabel={false} usePhoto={false} live className="h-full w-full" />
        </div>
        <div className="relative">
          <p className="text-lg font-semibold tracking-wide">CHILL WITH ME</p>
          <h2 className="mt-8 text-3xl leading-snug text-white">เที่ยวไทยแบบไม่ต้องเดา</h2>
          <ul className="mt-6 space-y-3 text-white/90">
            {['เก็บแผนทริปไว้ในบัญชี เปิดได้ทุกเครื่อง', 'แนะนำที่เที่ยวตามความสนใจของคุณ', 'รหัสผ่านถูกเข้ารหัส ไม่มีใครเห็นได้'].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20" aria-hidden="true">
                  <svg viewBox="0 0 20 20" className="h-3 w-3 fill-white"><path d="M7.6 13.4L4.2 10l-1.4 1.4 4.8 4.8 10-10-1.4-1.4z" /></svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <section className="fade-up card-sky rounded-[32px] p-6 ring-1 ring-forest/5 sm:p-10 md:rounded-l-none">
        <h1 className="text-gradient-sky pb-1 text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </section>
    </div>
  )
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {children}
      {error ? <p className="mt-1 text-sm text-alert">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export const inputCls =
  'w-full rounded-xl border border-sand bg-white px-4 py-3 text-[15px] outline-none transition focus:border-moss focus:ring-4 focus:ring-leaf'

/** N separate digit boxes (default 6) with paste + auto-advance; reports the joined code. */
export function OtpInput({ value, onChange, disabled, autoFocus = true, invalid, length = 6 }) {
  const refs = useRef([])
  const last = length - 1
  const digits = Array.from({ length }, (_, i) => value[i] || '')
  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const setAt = (i, d) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').slice(0, length))
  }
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus()
      setAt(i - 1, '')
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    else if (e.key === 'ArrowRight' && i < last) refs.current[i + 1]?.focus()
  }
  const onInput = (i, e) => {
    const raw = e.target.value.replace(/\D/g, '')
    if (!raw) return setAt(i, '')
    if (raw.length > 1) {
      // paste or SMS autofill into one box
      const merged = (digits.slice(0, i).join('') + raw).slice(0, length)
      onChange(merged)
      refs.current[Math.min(merged.length, last)]?.focus()
      return
    }
    setAt(i, raw)
    if (i < last) refs.current[i + 1]?.focus()
  }
  return (
    <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label={`รหัส OTP ${length} หลัก`}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={d}
          onChange={(e) => onInput(i, e)}
          onKeyDown={(e) => onKey(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          aria-label={`หลักที่ ${i + 1}`}
          className={`h-14 w-full min-w-0 rounded-xl border bg-white text-center text-2xl font-semibold text-ink outline-none transition focus:ring-4 focus:ring-leaf sm:h-16 ${
            invalid ? 'border-alert' : d ? 'otp-filled border-moss' : 'border-sand'
          }`}
        />
      ))}
    </div>
  )
}

export function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => setLeft(seconds), [seconds])
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((x) => x - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return [left, setLeft]
}

export function fmtMMSS(s) {
  const m = Math.floor(Math.max(0, s) / 60)
  const r = Math.max(0, s) % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Password field with show/hide toggle. */
export function PasswordInput({ id, value, onChange, autoComplete = 'current-password', placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        maxLength={128}
        placeholder={placeholder}
        className={`${inputCls} pr-20`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute inset-y-0 right-2 my-auto h-9 rounded-lg px-3 text-sm text-forest hover:bg-mist"
        aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
      >
        {show ? 'ซ่อน' : 'แสดง'}
      </button>
    </div>
  )
}

/** Mirrors backend rules: >= 8 chars, has a letter and a digit. Returns a Thai message or null. */
export function passwordProblem(pw) {
  if (pw.length < 8) return 'อย่างน้อย 8 ตัวอักษร'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'ต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข'
  return null
}

export function PasswordRules({ value }) {
  const rules = [
    ['อย่างน้อย 8 ตัวอักษร', value.length >= 8],
    ['มีตัวอักษรภาษาอังกฤษ', /[A-Za-z]/.test(value)],
    ['มีตัวเลข', /\d/.test(value)],
  ]
  const passed = rules.filter(([, ok]) => ok).length
  return (
    <>
      <div className="mt-2 grid grid-cols-3 gap-1" aria-hidden="true">
        {rules.map(([label], i) => (
          <span key={label} className={`h-1 rounded-full transition-colors duration-300 ${i < passed ? (passed === 3 ? 'bg-[#3f9d7a]' : 'bg-sun') : 'bg-sand'}`} />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {rules.map(([label, ok]) => (
          <li key={label} className={`transition-colors ${ok ? 'text-forest' : 'text-muted'}`}>
            <span key={String(ok)} className={ok ? 'pop-in' : ''} aria-hidden="true">{ok ? '✓' : '○'}</span> {label}
          </li>
        ))}
      </ul>
    </>
  )
}
