import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthShell, Field, inputCls, PasswordInput, passwordProblem, PasswordRules } from '../components/AuthShell'
import { InterestChips, useInterests } from '../components/Bits'
import OtpStep from '../components/OtpStep'
import { api } from '../lib/api'
import { getOwnerKey } from '../lib/ownerKey'
import { useAuthConfig } from '../lib/useAuthConfig'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/tripStore'

export const isThaiMobile = (v) => /^0[689]\d{8}$/.test(v.replace(/\D/g, ''))

export default function Register() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const interests = useInterests()
  const setSession = useAuth((s) => s.setSession)
  const push = useToast((s) => s.push)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState(sp.get('phone') || '')
  const [picked, setPicked] = useState([])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [otp, setOtp] = useState(null)
  const otpOn = !!useAuthConfig()?.otp_enabled

  const nameErr = touched && !name.trim() ? 'กรุณากรอกชื่อ' : null
  const phoneErr = touched && !isThaiMobile(phone) ? 'กรอกเบอร์มือถือ 10 หลัก เช่น 0812345678' : null
  const pwErr = touched && passwordProblem(password) ? `รหัสผ่าน${passwordProblem(password)}` : null
  const confirmErr = touched && confirm !== password ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : null
  const redirect = sp.get('redirect') || '/'

  const start = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (!name.trim() || !isThaiMobile(phone) || passwordProblem(password) || confirm !== password) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.registerStart({ name: name.trim(), phone, password, interests: picked, owner_key: getOwnerKey() })
      if (r.token) done(r) // OTP off: account is created right away
      else setOtp(r)
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  const done = (r) => {
    setSession(r.token, r.user)
    push(r.attached_trips ? `สร้างบัญชีแล้ว และย้ายทริป ${r.attached_trips} ทริปเข้าบัญชี` : `ยินดีต้อนรับ ${r.user.name}`)
    navigate(redirect, { replace: true })
  }

  return (
    <AuthShell
      title={otp ? 'ยืนยันเบอร์มือถือ' : 'สมัครสมาชิก'}
      subtitle={
        !otpOn
          ? 'บอกเราหน่อยว่าคุณเป็นใครและชอบเที่ยวแบบไหน'
          : otp
            ? 'ขั้นตอนที่ 2 จาก 2 — บัญชีจะถูกสร้างหลังยืนยันรหัส OTP'
            : 'ขั้นตอนที่ 1 จาก 2 — บอกเราหน่อยว่าคุณเป็นใครและชอบเที่ยวแบบไหน'
      }
    >
      {otpOn && <ol className="mb-8 flex items-center gap-3 text-sm" aria-label="ขั้นตอน">
        {['ข้อมูลของคุณ', 'ยืนยัน OTP'].map((l, i) => {
          const active = (otp ? 1 : 0) === i
          const doneStep = otp && i === 0
          return (
            <li key={l} className="flex flex-1 items-center gap-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${active ? 'btn-primary' : doneStep ? 'bg-leaf text-forest' : 'bg-sand text-muted'}`}>
                {doneStep ? '✓' : i + 1}
              </span>
              <span className={active ? 'font-medium text-ink' : 'text-muted'}>{l}</span>
              {i === 0 && <span className="h-px flex-1 bg-sand" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>}

      {otp ? (
        <OtpStep key={otp.request_id} otp={otp} onOtpChange={setOtp} onVerified={done} onBack={() => setOtp(null)} />
      ) : (
        <form onSubmit={start} className="space-y-5" noValidate>
          <Field label="ชื่อ" htmlFor="name" error={nameErr}>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder="ชื่อที่ให้เราเรียก" className={inputCls} />
          </Field>
          <Field label="เบอร์โทรศัพท์มือถือ" htmlFor="phone" error={phoneErr} hint={otpOn ? 'เราจะส่งรหัส OTP ไปยังเบอร์นี้เพื่อยืนยันตัวตน' : 'ใช้เบอร์นี้คู่กับรหัสผ่านเพื่อเข้าสู่ระบบ'}>
            <input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={15} autoComplete="tel" placeholder="08x-xxx-xxxx" className={inputCls} />
          </Field>
          <Field label="รหัสผ่าน" htmlFor="password" error={pwErr}>
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข" />
            {!pwErr && <PasswordRules value={password} />}
          </Field>
          <Field label="ยืนยันรหัสผ่าน" htmlFor="password2" error={confirmErr}>
            <PasswordInput id="password2" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="กรอกรหัสผ่านอีกครั้ง" />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">ความสนใจ <span className="font-normal text-muted">(เลือกได้หลายอย่าง)</span></p>
            <InterestChips interests={interests} selected={picked} onToggle={(k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
            <p className="mt-1.5 text-xs text-muted">ใช้จัดอันดับที่เที่ยวในหน้าแรกให้ตรงกับคุณ แก้ไขภายหลังได้</p>
          </div>

          {err && (
            <p role="alert" className="rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">
              {err.message}{' '}
              {err.code === 'phone_exists' && <Link to={`/login?phone=${encodeURIComponent(phone)}`} className="font-medium underline">เข้าสู่ระบบ</Link>}
            </p>
          )}

          <button disabled={busy} aria-busy={busy || undefined} className="btn-primary w-full rounded-full py-3 text-[15px] font-medium disabled:opacity-50">
            {otpOn ? (busy ? 'กำลังส่งรหัส…' : 'รับรหัส OTP') : busy ? 'กำลังสร้างบัญชี…' : 'สมัครสมาชิก'}
          </button>
          <p className="text-center text-sm text-muted">
            มีบัญชีอยู่แล้ว? <Link to={`/login${sp.get('redirect') ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="font-medium text-forest hover:underline">เข้าสู่ระบบ</Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
