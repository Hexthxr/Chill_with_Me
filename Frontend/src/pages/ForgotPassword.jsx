import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthShell, Field, inputCls, PasswordInput, passwordProblem, PasswordRules } from '../components/AuthShell'
import OtpStep from '../components/OtpStep'
import { api } from '../lib/api'
import { useAuthConfig } from '../lib/useAuthConfig'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/tripStore'
import { isThaiMobile } from './Register'

export default function ForgotPassword() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const setSession = useAuth((s) => s.setSession)
  const push = useToast((s) => s.push)
  const [phone, setPhone] = useState(sp.get('phone') || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [otp, setOtp] = useState(null)
  const cfg = useAuthConfig()

  const phoneErr = touched && !isThaiMobile(phone) ? 'กรอกเบอร์มือถือ 10 หลัก เช่น 0812345678' : null
  const pwErr = touched && passwordProblem(password) ? `รหัสผ่าน${passwordProblem(password)}` : null
  const confirmErr = touched && confirm !== password ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : null

  const start = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (!isThaiMobile(phone) || passwordProblem(password) || confirm !== password) return
    setBusy(true)
    setErr(null)
    try {
      setOtp(await api.resetStart({ phone }))
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  const done = (r) => {
    setSession(r.token, r.user)
    push('ตั้งรหัสผ่านใหม่แล้ว อุปกรณ์อื่นที่เคยเข้าสู่ระบบจะถูกออกจากระบบ')
    navigate('/', { replace: true })
  }

  if (cfg && !cfg.otp_enabled) {
    return (
      <AuthShell title="ลืมรหัสผ่าน" subtitle="ตอนนี้ระบบไม่ได้ใช้รหัส OTP จึงยังรีเซ็ตรหัสผ่านเองไม่ได้">
        <p className="rounded-xl bg-mist px-4 py-3 text-sm text-ink">
          ลองนึกรหัสผ่านแล้วเข้าสู่ระบบอีกครั้ง หรือติดต่อผู้ดูแลระบบเพื่อขอตั้งรหัสใหม่
        </p>
        <Link to="/login" className="btn-primary mt-6 block w-full rounded-full py-3 text-center text-[15px] font-medium">กลับไปหน้าเข้าสู่ระบบ</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="ตั้งรหัสผ่านใหม่" subtitle={otp ? 'ยืนยันด้วยรหัส OTP เพื่อบันทึกรหัสผ่านใหม่' : 'กรอกเบอร์ที่สมัครไว้และรหัสผ่านใหม่ แล้วยืนยันด้วย OTP'}>
      {otp ? (
        <OtpStep key={otp.request_id} otp={otp} onOtpChange={setOtp} onVerified={done} onBack={() => setOtp(null)} extra={{ new_password: password }} />
      ) : (
        <form onSubmit={start} className="space-y-5" noValidate>
          <Field label="เบอร์โทรศัพท์มือถือ" htmlFor="phone" error={phoneErr}>
            <input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={15} autoComplete="tel" placeholder="08x-xxx-xxxx" className={inputCls} />
          </Field>
          <Field label="รหัสผ่านใหม่" htmlFor="np" error={pwErr}>
            <PasswordInput id="np" value={password} onChange={setPassword} autoComplete="new-password" />
            {!pwErr && <PasswordRules value={password} />}
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่" htmlFor="np2" error={confirmErr}>
            <PasswordInput id="np2" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
          {err && (
            <p role="alert" className="rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">
              {err.message}{' '}
              {err.code === 'no_account' && <Link to={`/register?phone=${encodeURIComponent(phone)}`} className="font-medium underline">สมัครสมาชิก</Link>}
            </p>
          )}
          <button disabled={busy} className="btn-primary w-full rounded-full py-3 text-[15px] font-medium disabled:opacity-50">
            {busy ? 'กำลังส่งรหัส…' : 'รับรหัส OTP'}
          </button>
          <p className="text-center text-sm text-muted">
            จำรหัสผ่านได้แล้ว? <Link to="/login" className="font-medium text-forest hover:underline">เข้าสู่ระบบ</Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
