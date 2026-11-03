import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { useTrip } from '../store/tripStore'
import { Toasts } from './Bits'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Chill with me หน้าแรก">
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden="true">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#1550b8" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill="url(#logo-g)" />
        <path d="M7 24c4-3 7-3 10 0s6 3 9 0 6-3 7-1" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M7 30c4-3 7-3 10 0s6 3 9 0 6-3 7-1" fill="none" stroke="#bfe3ff" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="27" cy="13" r="4" fill="#fff" />
      </svg>
      <span className="text-gradient-sky text-lg font-semibold tracking-wide">CHILL WITH ME</span>
    </Link>
  )
}

function FooterWave() {
  return (
    <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="block h-10 w-full sm:h-16" aria-hidden="true">
      <path d="M0 40c120 25 240 38 360 30S600 30 720 28s240 22 360 26 240-10 360-24v50H0z" fill="#2067da" opacity=".25" />
      <path d="M0 52c160 18 300 22 440 12s260-30 400-28 280 26 400 24 160-12 200-18v38H0z" fill="#2067da" />
    </svg>
  )
}

const links = [
  { to: '/recommend', label: 'ค้นหาที่เที่ยว' },
  { to: '/planner', label: 'วางแผนทริป', auth: true },
  { to: '/trips', label: 'ทริปของฉัน', auth: true },
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

export default function Layout() {
  const [open, setOpen] = useState(false)
  const count = useTrip((s) => s.days.reduce((n, d) => n + d.blocks.length, 0))
  const loggedIn = useAuth((s) => !!s.token)
  const visible = links.filter((l) => !l.auth || loggedIn)
  const navCls = ({ isActive }) =>
    `rounded-full px-4 py-2 text-[15px] transition ${isActive ? 'bg-leaf font-medium text-forest' : 'text-forest hover:bg-mist'}`
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1">
        ข้ามไปเนื้อหา
      </a>
      <header className="sticky top-0 z-[1000] border-b border-forest/10 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="เมนูหลัก">
            {visible.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={navCls}
              >
                {l.label}
                {l.to === '/planner' && count > 0 && (
                  <span className="ml-1.5 rounded-full bg-sun px-1.5 text-xs text-ink">{count}</span>
                )}
              </NavLink>
            ))}
            <AccountArea />
          </nav>
          <button className="rounded-lg p-2 text-forest lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="เปิดเมนู">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {open && (
          <nav className="flex flex-col gap-1 border-t border-forest/10 px-4 py-3 lg:hidden" aria-label="เมนูหลัก (มือถือ)">
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
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-20">
        <FooterWave />
        <div className="bg-forest text-white">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:grid-cols-[1.4fr_1fr] sm:px-6">
            <div>
              <p className="text-lg font-semibold tracking-wide">CHILL WITH ME</p>
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
            <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-white/70 sm:px-6">ภาพประกอบการ์ดเป็นลายเส้นที่สร้างขึ้น ไม่ใช่ภาพถ่ายของสถานที่</p>
          </div>
        </div>
      </footer>
      <Toasts />
    </div>
  )
}
