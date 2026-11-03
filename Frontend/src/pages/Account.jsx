import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Field, inputCls, PasswordInput, passwordProblem, PasswordRules } from '../components/AuthShell'
import { InterestChips, useInterests } from '../components/Bits'
import { api } from '../lib/api'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/tripStore'

export default function Account() {
  const { token, user, setUser, clear } = useAuth()
  const interests = useInterests()
  const navigate = useNavigate()
  const push = useToast((s) => s.push)
  const [name, setName] = useState(user?.name || '')
  const [picked, setPicked] = useState(user?.interests || [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // refresh profile from the server (session may have been revoked)
  useEffect(() => {
    if (!token) return
    api.me().then((u) => { setUser(u); setName(u.name); setPicked(u.interests) }).catch(() => {})
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return <Navigate to="/login?redirect=/account" replace />

  const save = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setErr({ message: 'กรุณากรอกชื่อ' })
    setBusy(true)
    setErr(null)
    try {
      setUser(await api.updateMe({ name: name.trim(), interests: picked }))
      push('บันทึกข้อมูลแล้ว')
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    try {
      await api.logout()
    } catch {
      /* already invalid */
    }
    clear()
    push('ออกจากระบบแล้ว')
    navigate('/')
  }

  const initial = (user?.name || '?').trim().charAt(0)
  const dirty = name.trim() !== (user?.name || '') || JSON.stringify(picked) !== JSON.stringify(user?.interests || [])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="promo-sky relative overflow-hidden rounded-[32px] p-6 text-white sm:p-8">
        <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-20 w-full opacity-20" aria-hidden="true">
          <path d="M0 70c50-25 100-25 150 0s100 25 150 0 70-20 100-10v60H0z" fill="#fff" />
        </svg>
        <div className="relative flex items-center gap-4">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-white/20 text-2xl font-semibold ring-2 ring-white/40">{initial}</span>
          <div>
            <h1 className="text-2xl text-white">{user?.name}</h1>
            <p className="text-white/85">{user?.phone}</p>
          </div>
        </div>
      </div>

      <form onSubmit={save} className="card-sky mt-6 space-y-6 rounded-[28px] p-6 ring-1 ring-forest/5 sm:p-8">
        <h2 className="text-xl text-ink">ข้อมูลบัญชี</h2>
        <Field label="ชื่อ" htmlFor="acc-name">
          <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} />
        </Field>
        <Field label="เบอร์โทรศัพท์" htmlFor="acc-phone" hint="ยืนยันด้วย OTP แล้ว (เปลี่ยนเบอร์ยังไม่รองรับ)">
          <input id="acc-phone" value={user?.phone || ''} disabled className={`${inputCls} bg-mist text-muted`} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">ความสนใจ</p>
          <InterestChips interests={interests} selected={picked} onToggle={(k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
        </div>
        {err && <p role="alert" className="rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">{err.message}</p>}
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || !dirty} className="btn-primary rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-50">
            {busy ? 'กำลังบันทึก…' : 'บันทึกการเปลี่ยนแปลง'}
          </button>
          <Link to="/trips" className="rounded-full px-5 py-2.5 text-sm font-medium text-forest ring-1 ring-forest/25 hover:bg-mist">ทริปของฉัน</Link>
        </div>
      </form>

      <PasswordSection hasPassword={!!user?.has_password} onSaved={() => setUser({ ...user, has_password: true })} />

      <HistorySection />

      <div className="mt-6 text-center">
        <button onClick={logout} className="rounded-full px-5 py-2 text-sm font-medium text-alert hover:bg-alert-soft">ออกจากระบบ</button>
      </div>
    </div>
  )
}

function HistorySection() {
  const push = useToast((s) => s.push)
  const [sum, setSum] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.activitySummary().then(setSum).catch(() => setSum(null))
  useEffect(() => {
    load()
  }, [])
  const clearAll = async () => {
    setBusy(true)
    try {
      await api.clearActivity()
      push('ล้างประวัติการดูแล้ว คำแนะนำจะเริ่มเรียนรู้ใหม่')
      await load()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section id="history" className="card-sky mt-6 rounded-3xl p-6 ring-1 ring-forest/5">
      <h2 className="text-lg text-ink">ประวัติการดูสถานที่</h2>
      <p className="mt-1 text-sm text-muted">
        ระบบจำสถานที่ที่คุณเปิดดูและเพิ่มลงทริป เพื่อแนะนำที่คล้ายกันในหน้าแรก (เก็บไว้สูงสุด {sum?.retention_days ?? 180} วัน)
      </p>
      <p className="mt-3 text-sm">
        {sum == null ? 'กำลังโหลด…' : sum.places === 0 ? 'ยังไม่มีประวัติ' : <>เคยดู/เพิ่ม <b className="text-forest">{sum.places}</b> สถานที่ ({sum.events} ครั้ง)</>}
      </p>
      <button
        onClick={clearAll}
        disabled={busy || !sum?.places}
        className="mt-4 rounded-full px-5 py-2 text-sm font-medium text-alert ring-1 ring-alert/30 hover:bg-alert-soft disabled:opacity-40"
      >
        {busy ? 'กำลังล้าง…' : 'ล้างประวัติการดู'}
      </button>
    </section>
  )
}

function PasswordSection({ hasPassword, onSaved }) {
  const push = useToast((s) => s.push)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    const p = passwordProblem(next)
    if (p) return setErr({ message: `รหัสผ่านใหม่${p}` })
    if (next !== confirm) return setErr({ message: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' })
    setBusy(true)
    try {
      await api.changePassword({ current_password: hasPassword ? current : null, new_password: next })
      push(hasPassword ? 'เปลี่ยนรหัสผ่านแล้ว' : 'ตั้งรหัสผ่านแล้ว')
      setCurrent('')
      setNext('')
      setConfirm('')
      onSaved()
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card-sky mt-6 space-y-5 rounded-[28px] p-6 ring-1 ring-forest/5 sm:p-8" noValidate>
      <h2 className="text-xl text-ink">{hasPassword ? 'เปลี่ยนรหัสผ่าน' : 'ตั้งรหัสผ่าน'}</h2>
      {hasPassword && (
        <Field label="รหัสผ่านปัจจุบัน" htmlFor="cp">
          <PasswordInput id="cp" value={current} onChange={setCurrent} />
        </Field>
      )}
      <Field label="รหัสผ่านใหม่" htmlFor="np">
        <PasswordInput id="np" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordRules value={next} />
      </Field>
      <Field label="ยืนยันรหัสผ่านใหม่" htmlFor="np2">
        <PasswordInput id="np2" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </Field>
      {err && <p role="alert" className="rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">{err.message}</p>}
      <button disabled={busy || !next} className="btn-primary rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-50">
        {busy ? 'กำลังบันทึก…' : hasPassword ? 'เปลี่ยนรหัสผ่าน' : 'ตั้งรหัสผ่าน'}
      </button>
    </form>
  )
}
