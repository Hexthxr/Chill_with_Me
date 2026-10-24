import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getOwnerKey } from '../lib/ownerKey'
import { fmtMMSS, OtpInput, useCountdown } from './AuthShell'

/** Step 2 of register / login: enter the 6-digit code. Calls onVerified(result) on success. */
export default function OtpStep({ otp, onOtpChange, onVerified, onBack, backLabel = 'แก้ไขข้อมูล', extra = {} }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [resendLeft] = useCountdown(otp.resend_in)
  const [expireLeft] = useCountdown(otp.expires_in)
  const len = otp.code_length || 6

  const submit = async (c = code) => {
    if (c.length !== len || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.verifyOtp({ request_id: otp.request_id, code: c, owner_key: getOwnerKey(), ...extra })
      onVerified(r)
    } catch (e) {
      setErr(e)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  // auto-submit when 6 digits are entered
  useEffect(() => {
    if (code.length === len) submit(code)
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    setErr(null)
    try {
      const r = await api.resendOtp(otp.request_id)
      onOtpChange(r)
      setCode('')
    } catch (e) {
      setErr(e)
    }
  }

  const mustRestart = err && ['otp_locked', 'otp_expired', 'otp_not_found'].includes(err.code)

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-muted">
        กรอกรหัส {len} หลักที่ส่งทาง SMS ไปยัง <b className="text-ink">{otp.phone_masked}</b>
        {otp.refno && (
          <span className="mt-1 block text-sm">
            รหัสอ้างอิง (Ref) <b className="font-mono text-ink">{otp.refno}</b> ต้องตรงกับใน SMS
          </span>
        )}
      </p>

      {otp.test_mode && (
        <div className="rounded-2xl border border-sun/40 bg-sun-soft px-4 py-3 text-sm text-[#6b4f0e]" role="note">
          <b>โหมดทดสอบ</b> — ยังไม่ได้ตั้งค่าผู้ให้บริการ SMS จึงไม่มี SMS ส่งจริง
          {otp.dev_code ? (
            <>
              {' '}รหัสของคุณคือ <b className="font-mono text-base tracking-[0.3em]">{otp.dev_code}</b>
            </>
          ) : (
            ' ดูรหัสได้ใน terminal ของ backend'
          )}
        </div>
      )}

      <OtpInput value={code} onChange={setCode} disabled={busy || expireLeft <= 0} invalid={!!err} length={len} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className={expireLeft <= 30 ? 'text-alert' : 'text-muted'}>
          {expireLeft > 0 ? `รหัสหมดอายุใน ${fmtMMSS(expireLeft)}` : 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่'}
        </span>
        <button type="button" onClick={resend} disabled={resendLeft > 0} className="font-medium text-forest disabled:text-muted">
          {resendLeft > 0 ? `ขอรหัสใหม่ได้ใน ${resendLeft} วินาที` : 'ส่งรหัสใหม่'}
        </button>
      </div>

      {err && (
        <p role="alert" className="rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">
          {err.message}
        </p>
      )}

      <button
        type="button"
        onClick={() => (mustRestart ? onBack() : submit())}
        disabled={busy || (!mustRestart && code.length !== len)}
        className="btn-primary w-full rounded-full py-3 text-[15px] font-medium disabled:opacity-50"
      >
        {busy ? 'กำลังตรวจสอบ…' : mustRestart ? 'เริ่มใหม่' : 'ยืนยันรหัส'}
      </button>
      <button type="button" onClick={onBack} className="w-full text-center text-sm text-muted hover:text-forest">
        {backLabel}
      </button>
    </div>
  )
}
