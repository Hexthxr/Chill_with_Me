import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthShell, Field, inputCls, PasswordInput } from '../components/AuthShell'
import OtpStep from '../components/OtpStep'
import { api } from '../lib/api'
import { getOwnerKey } from '../lib/ownerKey'
import { useAuthConfig } from '../lib/useAuthConfig'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/tripStore'
import { isThaiMobile } from './Register'

export default function Login() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const setSession = useAuth((s) => s.setSession)
  const push = useToast((s) => s.push)
  const [mode, setMode] = useState('password') // password | otp
  const [phone, setPhone] = useState(sp.get('phone') || '')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [otp, setOtp] = useState(null)
  const otpOn = !!useAuthConfig()?.otp_enabled
  const redirect = sp.get('redirect') || '/'
  const qs = sp.get('redirect') ? `?redirect=${encodeURIComponent(redirect)}` : ''
  const phoneErr = touched && !isThaiMobile(phone) ? 'กรอกเบอร์มือถือ 10 หลัก เช่น 0812345678' : null
  const pwErr = touched && mode === 'password' && !password ? 'กรุณากรอกรหัสผ่าน' : null

  const done = (r) => {
    setSession(r.token, r.user)
    push(r.attached_trips ? `เข้าสู่ระบบแล้ว และย้ายทริป ${r.attached_trips} ทริปเข้าบัญชี` : `ยินดีต้อนรับกลับ ${r.user.name}`)
    navigate(redirect, { replace: true })
  }

  const submit = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (!isThaiMobile(phone) || (mode === 'password' && !password)) return
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'password') done(await api.loginPassword({ phone, password, owner_key: getOwnerKey() }))
      else setOtp(await api.loginStart({ phone }))
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m) => {
    setMode(m)
    setErr(null)
    setTouched(false)
  }

  return (
    <AuthShell
      title="เข้าสู่ระบบ"
      subtitle={otp ? 'กรอกรหัส OTP เพื่อเข้าสู่ระบบ' : mode === 'password' ? 'ใช้เบอร์มือถือและรหัสผ่านที่สมัครไว้' : 'เราจะส่งรหัส OTP ไปยังเบอร์ของคุณ'}
    >
      {otp ? (
        <OtpStep key={otp.request_id} otp={otp} onOtpChange={setOtp} onVerified={done} onBack={() => setOtp(null)} backLabel="เปลี่ยนเบอร์โทร" />
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          {otpOn && <div className="grid grid-cols-2 gap-1 rounded-2xl bg-mist p-1" role="radiogroup" aria-label="วิธีเข้าสู่ระบบ">
            {[
              ['password', 'รหัสผ่าน'],
              ['otp', 'รหัส OTP'],
            ].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => switchMode(k)} className={`rounded-xl py-2 text-sm font-medium transition ${mode === k ? 'bg-white text-forest shadow-sm' : 'text-muted'}`}>
                {l}
              </button>
            ))}
          </div>}
          <Field label="เบอร์โทรศัพท์มือถือ" htmlFor="phone" error={phoneErr}>
            <input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={15} autoComplete="tel" placeholder="08x-xxx-xxxx" className={inputCls} autoFocus />
          </Field>
          {mode === 'password' && (
            <Field label="รหัสผ่าน" htmlFor="password" error={pwErr}>
              <PasswordInput id="password" value={password} onChange={setPassword} />
              {otpOn && <div className="mt-1.5 text-right">
                <Link to={`/forgot-password${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`} className="text-sm text-forest hover:underline">ลืมรหัสผ่าน?</Link>
              </div>}
            </Field>
          )}
          {err && (
            <p role="alert" className="rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">
              {err.message}{' '}
              {err.code === 'no_account' && <Link to={`/register?phone=${encodeURIComponent(phone)}`} className="font-medium underline">สมัครสมาชิก</Link>}
              {otpOn && (err.code === 'account_locked' || err.code === 'no_password') && (
                <button type="button" onClick={() => switchMode('otp')} className="font-medium underline">ใช้รหัส OTP</button>
              )}
            </p>
          )}
          <button disabled={busy} className="btn-primary w-full rounded-full py-3 text-[15px] font-medium disabled:opacity-50">
            {busy ? 'กำลังดำเนินการ…' : mode === 'password' ? 'เข้าสู่ระบบ' : 'รับรหัส OTP'}
          </button>
          <p className="text-center text-sm text-muted">
            ยังไม่มีบัญชี? <Link to={`/register${qs}`} className="font-medium text-forest hover:underline">สมัครสมาชิก</Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
