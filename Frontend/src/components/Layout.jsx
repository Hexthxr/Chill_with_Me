import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { attachRipple, prefersReducedMotion } from '../lib/fx'
import { useAuth } from '../store/authStore'
import { useTrip } from '../store/tripStore'
import { Toasts } from './Bits'
import NotificationBell from './NotificationBell'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Chill with me หน้าแรก">
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden="true">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a9db5" />
            <stop offset="1" stopColor="#0b5568" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill="url(#logo-g)" />
        <path d="M7 24c4-3 7-3 10 0s6 3 9 0 6-3 7-1" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M7 30c4-3 7-3 10 0s6 3 9 0 6-3 7-1" fill="none" stroke="#a9dfe0" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="27" cy="13" r="4.5" fill="#ffc56b" />
      </svg>
      <span className="text-gradient-sky text-lg font-semibold tracking-wide">CHILL WITH ME</span>
    </Link>
  )
}

function FooterWave() {
  return (
    <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="block h-10 w-full sm:h-16" aria-hidden="true">
      <path d="M0 40c120 25 240 38 360 30S600 30 720 28s240 22 360 26 240-10 360-24v50H0z" className="fill-forest-deep" opacity=".25" />
      <path d="M0 52c160 18 300 22 440 12s260-30 400-28 280 26 400 24 160-12 200-18v38H0z" className="fill-forest-deep" />
    </svg>
  )
}

const links = [
  { to: '/recommend', label: 'ค้นหาที่เที่ยว' },
  { to: '/planner', label: 'วางแผนทริป', auth: true },
  { to: '/trips', label: 'ทริปของฉัน', auth: true },
  { to: '/admin', label: 'ผู้ดูแลระบบ', admin: true },
]

function AccountArea({ mobile = false, onNavigate }) {
  const user = useAuth((s) => s.user)
  const token = useAuth((s) => s.token)
  const loc = useLocation()
  const here = encodeURIComponent(loc.pathname + loc.search)
  const redirect = ['/login', '/register'].includes(loc.pathname) ? '' : `?redirect=${here}`
  if (token && user) {
    return (
      <Link
        to="/account"
        onClick={onNavigate}
        className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[15px] text-ink ring-1 ring-forest/15 hover:bg-mist ${mobile ? 'w-fit' : 'ml-2'}`}
      >
        <span className="btn-primary grid h-8 w-8 place-items-center rounded-full text-sm font-semibold">{user.name.trim().charAt(0)}</span>
        <span className="max-w-32 truncate">{user.name}</span>
      </Link>
    )
  }
  return (
    <div className={`flex items-center gap-2 ${mobile ? '' : 'ml-2'}`}>
      <Link to={`/login${redirect}`} onClick={onNavigate} className="rounded-full px-4 py-2 text-[15px] text-forest hover:bg-mist">
        เข้าสู่ระบบ
      </Link>
      <Link to={`/register${redirect}`} onClick={onNavigate} className="rounded-full px-5 py-1.5 text-[15px] text-forest ring-1 ring-forest/40 hover:bg-mist">
        สมัครสมาชิก
      </Link>
    </div>
  )
}

/** Reading-progress line under the header + shadow once scrolled + the back-to-top button. */
function useScrollFx(progressRef) {
  const [scrolled, setScrolled] = useState(0)
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const y = window.scrollY
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${max > 0 ? y / max : 0})`
      setScrolled(y > 500 ? 2 : y > 8 ? 1 : 0)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [progressRef])
  return scrolled
}

/** New page: start at the top (except browser back/forward) and fade in. */
function usePageEnter(mainRef) {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const prev = useRef(pathname)
  useEffect(() => {
    const before = prev.current
    prev.current = pathname
    if (before === pathname) return
    if (navType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' })
    // saving a new trip only swaps /planner for /planner/:id – same screen, so no transition
    if (before.startsWith('/planner') && pathname.startsWith('/planner')) return
    if (prefersReducedMotion()) return
    mainRef.current?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'cubic-bezier(.2,.7,.3,1)' })
  }, [pathname, navType, mainRef])
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const progress = useRef(null)
  const main = useRef(null)
  const scrolled = useScrollFx(progress)
  usePageEnter(main)
  useEffect(attachRipple, [])
  const count = useTrip((s) => s.days.reduce((n, d) => n + d.blocks.length, 0))
  const loggedIn = useAuth((s) => !!s.token)
  const isAdmin = useAuth((s) => !!s.token && s.user?.role === 'admin')
  const visible = links.filter((l) => (l.admin ? isAdmin : !l.auth || loggedIn))
  const navCls = ({ isActive }) =>
    `nav-link rounded-full px-4 py-2 text-[15px] transition ${isActive ? 'bg-leaf font-medium text-forest' : 'text-forest hover:bg-mist'}`
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1">
        ข้ามไปเนื้อหา
      </a>
      <header className={`sticky top-0 z-[1000] border-b backdrop-blur-md transition-shadow duration-300 print:hidden ${scrolled ? 'border-forest/10 bg-white/95 shadow-[0_8px_24px_-16px_rgba(11,85,104,0.5)]' : 'border-transparent bg-white/85'}`}>
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1">
          <nav className="hidden items-center gap-1 lg:flex" aria-label="เมนูหลัก">
            {visible.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={navCls}
                data-fly-target={l.to === '/planner' ? '' : undefined}
              >
                {l.label}
                {l.to === '/planner' && count > 0 && (
                  <span key={count} className="pop-in ml-1.5 rounded-full bg-sun px-1.5 text-xs text-ink">{count}</span>
                )}
              </NavLink>
            ))}
            <AccountArea />
          </nav>
          <NotificationBell />
          <button className="relative rounded-lg p-2 text-forest lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="เปิดเมนู" data-fly-target="">
            {loggedIn && count > 0 && !open && <span key={count} className="pop-in absolute right-0 top-0 min-w-4 rounded-full bg-sun px-1 text-center text-[10px] font-semibold text-ink" aria-hidden="true">{count}</span>}
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} strokeLinecap="round" />
            </svg>
          </button>
          </div>
        </div>
        {open && (
          <nav className="fade-up flex flex-col gap-1 border-t border-forest/10 px-4 py-3 lg:hidden" aria-label="เมนูหลัก (มือถือ)">
            {visible.map((l) => (
              <NavLink key={l.to} to={l.to} className={navCls} onClick={() => setOpen(false)}>
                {l.label}
                {l.to === '/planner' && count > 0 && <span className="ml-1.5 rounded-full bg-sun px-1.5 text-xs text-ink">{count}</span>}
              </NavLink>
            ))}
            <div className="mt-2 border-t border-forest/10 pt-3">
              <AccountArea mobile onNavigate={() => setOpen(false)} />
            </div>
          </nav>
        )}
        <span ref={progress} className="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-gradient-to-r from-forest via-moss to-coral" style={{ transform: 'scaleX(0)' }} aria-hidden="true" />
      </header>
      <main id="main" ref={main} className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-20 print:hidden">
        <FooterWave />
        <div className="bg-forest-deep text-white">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:grid-cols-[1.4fr_1fr] sm:px-6">
            <div>
              <p className="flex items-center gap-2 text-lg font-semibold tracking-wide">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ffc56b]" aria-hidden="true" />
                CHILL WITH ME
              </p>
              <p className="mt-2 max-w-md text-sm text-white/80">
                แนะนำที่เที่ยวทั่วไทยจากข้อมูลรีวิวจริง วิเคราะห์ด้วย Machine Learning และวางแผนทริปแบบลากวางที่คำนวณเวลาให้เอง
              </p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm sm:justify-end" aria-label="ลิงก์ท้ายหน้า">
              <Link to="/recommend" className="text-white/90 hover:text-white hover:underline">ค้นหาที่เที่ยว</Link>
              {loggedIn && <Link to="/planner" className="text-white/90 hover:text-white hover:underline">วางแผนทริป</Link>}
              {loggedIn && <Link to="/trips" className="text-white/90 hover:text-white hover:underline">ทริปของฉัน</Link>}
            </nav>
          </div>
          <div className="border-t border-white/15">
            <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-white/70 sm:px-6">รูปถ่ายมาจากผู้ดูแลระบบ หรือจาก Wikipedia และ Wikimedia Commons ตามสัญญาอนุญาตเสรี (ดูเครดิตได้ที่รูป) สถานที่ที่ไม่มีรูปจะแสดงภาพวาดที่สร้างขึ้น ไม่ใช่ภาพถ่ายจริง</p>
          </div>
        </div>
      </footer>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
        aria-label="กลับขึ้นด้านบน"
        tabIndex={scrolled === 2 ? 0 : -1}
        className={`btn-primary fixed bottom-5 right-5 z-[900] grid h-11 w-11 place-items-center rounded-full print:hidden ${scrolled === 2 ? '' : 'pointer-events-none opacity-0'}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 15l7-7 7 7" /></svg>
      </button>
      <Toasts />
    </div>
  )
}
