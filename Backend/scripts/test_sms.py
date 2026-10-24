"""Send one test SMS with the configured provider (checks your SMS settings in .env).

Usage (from backend/):  python -m scripts.test_sms 0812345678
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import sms  # noqa: E402
from app.services.auth import normalize_th_mobile  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m scripts.test_sms 0812345678")
    phone = normalize_th_mobile(sys.argv[1])
    if not phone:
        raise SystemExit(f"เบอร์ไม่ถูกต้อง ({sys.argv[1]!r}): ใช้เบอร์มือถือไทย 10 หลัก เช่น 0812345678")
    provider = sms.provider()
    print(f"SMS provider: {provider}")
    if provider == "console":
        print("ยังอยู่ในโหมดทดสอบ (console) — ใส่ THAIBULKSMS_OTP_KEY / THAIBULKSMS_OTP_SECRET (หรือค่า Twilio) ใน .env ก่อน")
    try:
        if provider == "thaibulksms":
            token, refno = asyncio.run(sms.tbs_otp_request(phone))  # sends a real OTP SMS via ThaiBulkSMS
            print(f"ThaiBulkSMS ส่ง OTP แล้ว (refno={refno})")
        elif provider == "twilio_verify":
            asyncio.run(sms.verify_start(phone))  # sends a real OTP via Twilio Verify
        else:
            asyncio.run(sms.send_sms(phone, "ทดสอบ SMS จาก Chill with me"))
    except sms.SMSError as e:
        raise SystemExit(f"ส่งไม่สำเร็จ: {e}")
    print(f"ส่งแล้วไปที่ {phone}" if provider != "console" else "พิมพ์ข้อความใน console แล้ว (ไม่ได้ส่งจริง)")


if __name__ == "__main__":
    main()
