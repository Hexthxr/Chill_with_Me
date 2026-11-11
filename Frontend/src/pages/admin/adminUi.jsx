import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { fmtInt } from '../../lib/format'

export const FIELD_LABELS = {
  name: 'ชื่อสถานที่',
  address: 'ที่อยู่',
  district: 'อำเภอ/เขต',
  province: 'จังหวัด',
  province_en: 'จังหวัด (EN)',
  lat: 'ละติจูด',
  lng: 'ลองจิจูด',
  location: 'พิกัด',
  google_maps_url: 'ลิงก์ Google Maps',
  primary_type: 'ประเภท',
  is_food: 'เป็นร้านอาหาร',
  hidden: 'ซ่อนจากผู้ใช้',
  hidden_reason: 'เหตุผลที่ซ่อน',
  image: 'รูปภาพ',
  caption: 'คำบรรยายรูป',
  credit: 'เครดิตรูป',
}

export const ACTION_LABELS = {
  edit: 'แก้ไข',
  hide: 'ซ่อน',
  unhide: 'เลิกซ่อน',
  image_add: 'เพิ่มรูป',
  image_edit: 'แก้ข้อความรูป',
  image_replace: 'เปลี่ยนรูป',
  image_remove: 'ลบรูป',
  image_order: 'จัดลำดับรูป',
  wiki_off: 'ปิดรูป Wikipedia',
  wiki_on: 'เปิดรูป Wikipedia',
}

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '–'

export function fmtValue(v) {
  if (v === true) return 'ใช่'
  if (v === false) return 'ไม่'
  if (v == null || v === '') return '(ว่าง)'
  return String(v)
}

export function AdminShell({ title, subtitle, actions, children }) {
  const tab = ({ isActive }) =>
    `rounded-full px-4 py-1.5 text-sm transition ${isActive ? 'bg-forest text-white' : 'bg-white text-forest ring-1 ring-forest/15 hover:ring-forest/40'}`
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <nav className="flex flex-wrap gap-2" aria-label="เมนูผู้ดูแลระบบ">
        <NavLink to="/admin" end className={tab}>แดชบอร์ด</NavLink>
        <NavLink to="/admin/places" className={tab}>จัดการสถานที่</NavLink>
        <NavLink to="/admin/audit" className={tab}>ประวัติการแก้ไข</NavLink>
      </nav>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-gradient-sky pb-1 text-3xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  )
}

export function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-forest/10">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">{typeof value === 'number' ? fmtInt(value) : value ?? '–'}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  )
}

/** Single-series daily bar chart (30 days). One hue, no legend (the title names it), hover tooltip per bar,
 *  4px rounded tops anchored to the baseline, 2px gap between bars, and a hidden table for screen readers. */
export function DailyBars({ title, data, unit = '' }) {
  const [hover, setHover] = useState(null)
  const W = 600, H = 140, padB = 20, padT = 8
  const n = data.length || 1
  const max = Math.max(1, ...data.map((d) => d.count))
  const step = W / n
  const bw = Math.max(2, step - 2)
  const y = (v) => H - padB - (v / max) * (H - padB - padT)
  const total = data.reduce((s, d) => s + d.count, 0)
  const shortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  const h = hover != null ? data[hover] : null
  return (
    <figure className="rounded-2xl bg-white p-4 ring-1 ring-forest/10">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{title}</span>
        <span className="text-sm text-muted">รวม 30 วัน {fmtInt(total)}{unit}</span>
      </figcaption>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label={`${title} รายวัน 30 วันล่าสุด`} onMouseLeave={() => setHover(null)}>
          <line x1="0" x2={W} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-sand" strokeWidth="1" />
          <text x="0" y={padT + 4} className="fill-muted text-[10px]">{fmtInt(max)}</text>
          {data.map((d, i) => {
            const top = y(d.count)
            const hgt = H - padB - top
            const x = i * step + 1
            const r = Math.min(4, bw / 2, hgt)
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)}>
                <rect x={i * step} y={0} width={step} height={H - padB} fill="transparent" />
                {d.count > 0 && (
                  <path
                    d={`M${x},${H - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - padB} Z`}
                    className={hover === i ? 'fill-forest-deep' : 'fill-forest'}
                  />
                )}
              </g>
            )
          })}
          {[0, Math.floor(n / 2), n - 1].map((i) => data[i] && (
            <text key={i} x={i * step + step / 2} y={H - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-muted text-[10px]">
              {shortDate(data[i].date)}
            </text>
          ))}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute -top-2 rounded-lg bg-ink px-2.5 py-1 text-xs text-white shadow"
            style={{ left: `${((hover + 0.5) / n) * 100}%`, transform: `translateX(${hover > n * 0.7 ? '-100%' : hover < n * 0.3 ? '0' : '-50%'})` }}
          >
            {shortDate(h.date)} · <b>{fmtInt(h.count)}</b>{unit}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}
