import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTrip } from '../store/tripStore'
import { Toasts } from './Bits'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Chill with me หน้าแรก">
      <svg viewBox="0 0 64 64" className="h-9 w-9" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="#1F4D3A" />
        <path d="M10 44c8-14 14-20 22-20s14 6 22 20" fill="none" stroke="#CFE3C4" strokeWidth="5" strokeLinecap="round" />
        <path d="M18 50c6-8 9-11 14-11s8 3 14 11" fill="none" stroke="#E8B53A" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="font-display text-xl text-forest">Chill with me</span>
    </Link>
  )
}

const links = [
  { to: '/recommend', label: 'ค้นหาที่เที่ยว' },
  { to: '/planner', label: 'วางแผนทริป' },
  { to: '/trips', label: 'ทริปของฉัน' },
]

export default function Layout() {
  const [open, setOpen] = useState(false)
  const count = useTrip((s) => s.days.reduce((n, d) => n + d.blocks.length, 0))
  const navCls = ({ isActive }) =>
    `rounded-full px-4 py-2 text-[15px] font-medium transition ${isActive ? 'bg-forest text-white' : 'text-forest hover:bg-mist'}`
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1">
        ข้ามไปเนื้อหา
      </a>
      <header className="sticky top-0 z-[1000] border-b border-forest/10 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="เมนูหลัก">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navCls}>
                {l.label}
                {l.to === '/planner' && count > 0 && (
                  <span className="ml-1.5 rounded-full bg-sun px-1.5 text-xs text-ink">{count}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <button className="rounded-lg p-2 text-forest md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="เปิดเมนู">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {open && (
          <nav className="flex flex-col gap-1 border-t border-forest/10 px-4 py-3 md:hidden" aria-label="เมนูหลัก (มือถือ)">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navCls} onClick={() => setOpen(false)}>
                {l.label}
                {l.to === '/planner' && count > 0 && <span className="ml-1.5 rounded-full bg-sun px-1.5 text-xs text-ink">{count}</span>}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-16 border-t border-forest/10 bg-white/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
          <p>Chill with me — แนะนำที่เที่ยวจากข้อมูลรีวิวจริง วิเคราะห์ด้วย Machine Learning</p>
          <p>ภาพประกอบการ์ดเป็นลายเส้นที่สร้างขึ้น ไม่ใช่ภาพถ่ายของสถานที่</p>
        </div>
      </footer>
      <Toasts />
    </div>
  )
}
