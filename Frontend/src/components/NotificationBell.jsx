import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { fmtThaiDate } from '../lib/format'
import { useAuth } from '../store/authStore'
import { reminderTitle, useNotifications } from '../store/notificationStore'
import { useToast } from '../store/tripStore'

const REFRESH_MS = 10 * 60 * 1000
const TOASTED_KEY = 'chill-reminders-toasted'

/** Toast each unread reminder once per browser session, so it isn't missed but doesn't nag on every page. */
function toastNewReminders(items, push) {
  let seen = []
  try {
    seen = JSON.parse(sessionStorage.getItem(TOASTED_KEY)) || []
  } catch {
    /* storage unavailable: worst case the toast repeats */
  }
  const fresh = items.filter((n) => !n.read && !seen.includes(n.key))
  fresh.forEach((n) => push(reminderTitle(n)))
  if (!fresh.length) return
  try {
    sessionStorage.setItem(TOASTED_KEY, JSON.stringify([...seen, ...fresh.map((n) => n.key)]))
  } catch {
    /* see above */
  }
}

function Reminder({ n, isNew, onOpen }) {
  const meta = [
    fmtThaiDate(n.start_date, false),
    n.start_time && `ออก ${n.start_time} น.`,
    n.day_count > 1 && `${n.day_count} วัน`,
  ].filter(Boolean).join(' · ')
  return (
    <li>
      <Link to={`/trips/${n.trip_id}`} onClick={onOpen} className="flex gap-3 rounded-2xl px-3 py-3 transition hover:bg-mist">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${n.days_until === 0 ? 'bg-coral-soft text-[#a8431f]' : 'bg-leaf text-forest'}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="5" width="16" height="15" rx="2.5" />
            <path d="M4 10h16M9 3v4M15 3v4" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug text-ink">{reminderTitle(n)}</span>
          <span className="mt-0.5 block text-sm text-muted">{meta}</span>
          {n.first_stop && <span className="block truncate text-sm text-muted">จุดแรก: {n.first_stop}</span>}
        </span>
        {isNew && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-coral" title="รายการใหม่" />}
      </Link>
    </li>
  )
}

export default function NotificationBell() {
  const token = useAuth((s) => s.token)
  const { items, unread, load, markAllRead, reset } = useNotifications()
  const push = useToast((s) => s.push)
  const [open, setOpen] = useState(false)
  const [newKeys, setNewKeys] = useState([])
  const box = useRef(null)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!token) return
    const refresh = () => load().then((list) => toastNewReminders(list, push))
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    // a tab left open overnight should catch up as soon as the user comes back
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
      reset()
    }
  }, [token, load, push, reset])

  // leaving the page closes the panel
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!token) return null

  const toggle = () => {
    if (!open) {
      // remember what was new first: opening marks everything read, but the dots should show this time
      setNewKeys(items.filter((n) => !n.read).map((n) => n.key))
      markAllRead()
    }
    setOpen(!open)
  }

  return (
    <div ref={box} className="lg:relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `การแจ้งเตือน ยังไม่ได้อ่าน ${unread} รายการ` : 'การแจ้งเตือน'}
        className="relative grid h-10 w-10 place-items-center rounded-full text-forest transition hover:bg-mist"
      >
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${unread ? 'bell-ring' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 0112 0c0 5.500 2 7 2 7H4s2-1.500 2-7zM10 20a2.200 2.200 0 004 0" />
        </svg>
        {unread > 0 && (
          <span key={unread} className="pop-in absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-[#c9472a] px-1 text-center text-[11px] font-semibold leading-[18px] text-white" aria-hidden="true">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="card-sky fade-up absolute inset-x-4 top-full z-10 mt-1 overflow-hidden rounded-3xl ring-1 ring-forest/10 lg:inset-x-auto lg:right-0 lg:w-96">
          <div className="border-b border-sand px-5 py-3">
            <h2 className="text-lg text-ink">การแจ้งเตือน</h2>
          </div>
          {items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              ยังไม่มีการแจ้งเตือน<br />เราจะเตือนล่วงหน้า 1 วันก่อนวันเริ่มทริปที่คุณบันทึกไว้
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto p-2">
              {items.map((n) => <Reminder key={n.key} n={n} isNew={newKeys.includes(n.key)} onOpen={() => setOpen(false)} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
