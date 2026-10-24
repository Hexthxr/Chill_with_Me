"""SMS sending for OTP.

SMS_PROVIDER:
    thaibulksms    ThaiBulkSMS OTP API v2 (THAIBULKSMS_OTP_KEY, THAIBULKSMS_OTP_SECRET).
                   ThaiBulkSMS generates, sends (Thai sender) and checks the OTP.
    twilio_verify  Twilio Verify (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID).
                   Twilio generates, sends and checks the OTP and handles the sender ID. Recommended.
    twilio   real SMS via Twilio Messaging (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM) – keys from env only
    console  development/test mode: NO SMS is sent; the code is printed in the backend log and, when
             OTP_DEV_SHOW_CODE=true, returned to the UI labelled as test mode.
    auto     thaibulksms > twilio_verify > twilio, whichever is configured; otherwise console.
"""
from __future__ import annotations

import logging

import httpx

from ..config import settings

log = logging.getLogger("chill.sms")


class SMSError(RuntimeError):
    pass


def provider() -> str:
    return settings.resolved_sms_provider()


async def send_sms(phone_e164: str, message: str) -> None:
    p = provider()
    if p == "console":
        log.warning("[OTP TEST MODE] SMS to %s: %s", phone_e164, message)
        print(f"\n===== [OTP TEST MODE] SMS to {phone_e164}: {message} =====\n", flush=True)
        return
    if p == "twilio":
        url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    url,
                    auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                    data={"To": phone_e164, "From": settings.twilio_from, "Body": message},
                )
        except httpx.HTTPError as e:
            raise SMSError(f"ส่ง SMS ไม่สำเร็จ ({type(e).__name__})") from e
        if r.status_code >= 300:
            log.error("Twilio error %s: %s", r.status_code, r.text[:300])
            raise SMSError("ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
        return
    raise SMSError(f"unknown SMS provider {p}")


# ------------------------------------------------------------------ Twilio Verify
VERIFY_BASE = "https://verify.twilio.com/v2/Services"


async def verify_start(phone_e164: str) -> None:
    """Ask Twilio Verify to generate and send an OTP by SMS."""
    url = f"{VERIFY_BASE}/{settings.twilio_verify_service_sid}/Verifications"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                                  data={"To": phone_e164, "Channel": "sms", "Locale": "th"})
    except httpx.HTTPError as e:
        raise SMSError(f"ส่ง SMS ไม่สำเร็จ ({type(e).__name__})") from e
    if r.status_code >= 300:
        log.error("Twilio Verify start error %s: %s", r.status_code, r.text[:300])
        raise SMSError("ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")


async def verify_check(phone_e164: str, code: str) -> bool:
    """True when Twilio Verify approves the code."""
    url = f"{VERIFY_BASE}/{settings.twilio_verify_service_sid}/VerificationCheck"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                                  data={"To": phone_e164, "Code": code})
    except httpx.HTTPError as e:
        raise SMSError(f"ตรวจรหัสไม่สำเร็จ ({type(e).__name__})") from e
    if r.status_code == 404:  # verification expired / already approved / not found
        return False
    if r.status_code >= 300:
        log.error("Twilio Verify check error %s: %s", r.status_code, r.text[:300])
        raise SMSError("ตรวจรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    return r.json().get("status") == "approved"


# ------------------------------------------------------------------ ThaiBulkSMS OTP (Thai provider)
# Endpoints/fields as used by ThaiBulkSMS's own client library (npm "thaibulksms-api", otp v2):
#   POST https://otp.thaibulksms.com/v2/otp/request  {key, secret, msisdn}     -> {status, token, refno}
#   POST https://otp.thaibulksms.com/v2/otp/verify   {key, secret, token, pin} -> {status: "success", message}
TBS_OTP_BASE = "https://otp.thaibulksms.com/v2/otp"


def _local_th(phone_e164: str) -> str:
    return "0" + phone_e164[3:]  # +66812345678 -> 0812345678


def _tbs_error(r: httpx.Response) -> str:
    try:
        data = r.json()
        errs = data.get("errors") or []
        first = errs[0] if errs else (data.get("detail") or data)
        return str(first)[:200]
    except ValueError:
        return r.text[:200]


async def tbs_otp_request(phone_e164: str) -> tuple[str, str | None]:
    """Ask ThaiBulkSMS to generate + send an OTP. Returns (token, refno)."""
    key = settings.thaibulksms_otp_key.strip()
    if not key.isdigit():
        # ThaiBulkSMS OTP API rejects non-numeric keys ("key must be numeric")
        raise SMSError(
            "THAIBULKSMS_OTP_KEY ต้องเป็นตัวเลขล้วน — ใช้ Key ของ OTP Application (เมนู OTP) "
            "ไม่ใช่ API Key ของบริการส่ง SMS"
        )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{TBS_OTP_BASE}/request", json={
                "key": settings.thaibulksms_otp_key,
                "secret": settings.thaibulksms_otp_secret,
                "msisdn": _local_th(phone_e164),
            })
    except httpx.HTTPError as e:
        raise SMSError(f"ส่ง SMS ไม่สำเร็จ ({type(e).__name__})") from e
    if r.status_code >= 300:
        log.error("ThaiBulkSMS OTP request error %s: %s", r.status_code, _tbs_error(r))
        if r.status_code in (401, 403):
            raise SMSError("ตั้งค่า THAIBULKSMS_OTP_KEY / SECRET ไม่ถูกต้อง")
        raise SMSError(f"ThaiBulkSMS ปฏิเสธคำขอ: {_tbs_error(r)}")
    data = r.json()
    token = data.get("token")
    if not token:
        log.error("ThaiBulkSMS OTP request: unexpected response %s", str(data)[:200])
        raise SMSError("ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    return token, data.get("refno")


async def tbs_otp_verify(token: str, pin: str) -> bool:
    """True when ThaiBulkSMS says the PIN is correct. Wrong/expired PIN -> False."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{TBS_OTP_BASE}/verify", json={
                "key": settings.thaibulksms_otp_key,
                "secret": settings.thaibulksms_otp_secret,
                "token": token,
                "pin": pin,
            })
    except httpx.HTTPError as e:
        raise SMSError(f"ตรวจรหัสไม่สำเร็จ ({type(e).__name__})") from e
    if r.status_code == 200:
        try:
            return r.json().get("status") == "success"
        except ValueError:
            return False
    if r.status_code in (400, 404, 422):  # wrong pin / token expired
        log.info("ThaiBulkSMS OTP verify rejected: %s", _tbs_error(r))
        return False
    log.error("ThaiBulkSMS OTP verify error %s: %s", r.status_code, _tbs_error(r))
    raise SMSError("ตรวจรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
