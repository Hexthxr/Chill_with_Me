"""Accounts with Thai mobile number, password and OTP.

Register:        POST /api/auth/register/start {name, phone, password, interests} -> OTP sent
                 POST /api/auth/verify {request_id, code}       -> account created + token
Login:           POST /api/auth/login {phone, password}         -> token
Login with OTP:  POST /api/auth/login/start {phone} then /verify
Forgot password: POST /api/auth/password/reset/start {phone} then /verify {..., new_password}
Change password: POST /api/auth/password {current_password, new_password}
The account is created only after the OTP is verified. Passwords are stored only as PBKDF2 hashes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from ml.interests import INTERESTS

from ..config import settings
from ..db import get_db
from ..errors import APIError
from ..services import sms
from ..services.auth import (
    _bearer,
    create_session,
    delete_session,
    hash_otp,
    hash_password,
    mask_phone,
    new_otp,
    normalize_th_mobile,
    otp_matches,
    password_problem,
    require_user,
    user_out,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _clean_interests(v: list[str]) -> list[str]:
    bad = [i for i in v if i not in INTERESTS]
    if bad:
        raise ValueError(f"ไม่รู้จักความสนใจ: {', '.join(bad)}")
    return list(dict.fromkeys(v))


def _check_password(v: str) -> str:
    msg = password_problem(v)
    if msg:
        raise ValueError(msg)
    return v


class RegisterStart(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=9, max_length=20)
    password: str = Field(min_length=1, max_length=128)
    interests: list[str] = Field(default_factory=list, max_length=len(INTERESTS))

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("กรุณากรอกชื่อ")
        return v

    @field_validator("interests")
    @classmethod
    def _interests(cls, v: list[str]) -> list[str]:
        return _clean_interests(v)

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _check_password(v)


class LoginStart(BaseModel):
    phone: str = Field(min_length=9, max_length=20)


class PasswordLogin(BaseModel):
    phone: str = Field(min_length=9, max_length=20)
    password: str = Field(min_length=1, max_length=128)
    owner_key: str | None = Field(default=None, max_length=64)


class Verify(BaseModel):
    request_id: str
    code: str = Field(pattern=r"^\d{4,8}$")  # 6 by default; ThaiBulkSMS length is set in its OTP app
    owner_key: str | None = Field(default=None, max_length=64)  # attach this browser's anonymous trips
    new_password: str | None = Field(default=None, max_length=128)  # required for password reset


class PasswordChange(BaseModel):
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _check_password(v)


class Resend(BaseModel):
    request_id: str


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    interests: list[str] | None = Field(default=None, max_length=len(INTERESTS))

    @field_validator("interests")
    @classmethod
    def _interests(cls, v: list[str] | None) -> list[str] | None:
        return v if v is None else _clean_interests(v)


def _phone_or_422(raw: str) -> str:
    p = normalize_th_mobile(raw)
    if not p:
        raise APIError(422, "invalid_phone", "เบอร์โทรไม่ถูกต้อง กรุณากรอกเบอร์มือถือ 10 หลัก เช่น 0812345678")
    return p


async def _issue_otp(phone: str, purpose: str, payload: dict | None = None) -> dict:
    db = get_db()
    now = datetime.now(timezone.utc)
    last = await db.otp_requests.find_one({"phone": phone}, sort=[("created_at", -1)])
    if last:
        created = last["created_at"] if last["created_at"].tzinfo else last["created_at"].replace(tzinfo=timezone.utc)
        wait = settings.otp_resend_s - (now - created).total_seconds()
        if wait > 0:
            raise APIError(429, "otp_too_soon", f"ขอรหัสใหม่ได้อีกครั้งใน {int(wait) + 1} วินาที", {"retry_in": int(wait) + 1})
    hour_count = await db.otp_requests.count_documents({"phone": phone, "created_at": {"$gte": now - timedelta(hours=1)}})
    if hour_count >= settings.otp_max_per_hour:
        raise APIError(429, "otp_rate_limited", "ขอรหัส OTP บ่อยเกินไป กรุณารอ 1 ชั่วโมงแล้วลองใหม่")

    rid = ObjectId()
    provider = sms.provider()
    code = None if provider in ("twilio_verify", "thaibulksms") else new_otp()  # these providers generate the code
    await db.otp_requests.insert_one({
        "_id": rid, "phone": phone, "purpose": purpose, "payload": payload or {}, "provider": provider,
        "code_hash": hash_otp(str(rid), code) if code else None, "attempts": 0, "used": False,
        "created_at": now, "expires_at": now + timedelta(seconds=settings.otp_ttl_s),
    })
    refno = None
    try:
        if provider == "thaibulksms":
            token, refno = await sms.tbs_otp_request(phone)
            await db.otp_requests.update_one({"_id": rid}, {"$set": {"provider_token": token, "refno": refno}})
        elif provider == "twilio_verify":
            await sms.verify_start(phone)
        else:
            await sms.send_sms(phone, f"รหัส OTP Chill with me ของคุณคือ {code} (หมดอายุใน {settings.otp_ttl_s // 60} นาที) ห้ามบอกรหัสนี้กับผู้อื่น")
    except sms.SMSError as e:
        await db.otp_requests.delete_one({"_id": rid})
        raise APIError(502, "sms_failed", str(e))

    out = {
        "request_id": str(rid),
        "phone_masked": mask_phone(phone),
        "expires_in": settings.otp_ttl_s,
        "resend_in": settings.otp_resend_s,
        "sms_provider": sms.provider(),
        "code_length": settings.thaibulksms_otp_length if provider == "thaibulksms" else 6,
        "refno": refno,
    }
    if sms.provider() == "console":
        out["test_mode"] = True
        if settings.otp_dev_show_code:
            out["dev_code"] = code  # test mode only – never returned when a real SMS provider is configured
    return out


@router.get("/config")
async def auth_config():
    p = sms.provider()
    return {
        "sms_provider": p,
        "test_mode": p == "console",
        "otp_length": settings.thaibulksms_otp_length if p == "thaibulksms" else 6,
        "message": "โหมดทดสอบ: ยังไม่ได้ตั้งค่าผู้ให้บริการ SMS — รหัส OTP จะแสดงในหน้าจอนี้และใน terminal ของ backend แทนการส่ง SMS จริง"
        if p == "console" else "ส่งรหัส OTP ทาง SMS",
    }


@router.post("/register/start")
async def register_start(body: RegisterStart):
    phone = _phone_or_422(body.phone)
    if await get_db().users.find_one({"phone": phone}, {"_id": 1}):
        raise APIError(409, "phone_exists", "เบอร์นี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ")
    # only the hash is kept in the pending OTP record – never the plain password
    return await _issue_otp(phone, "register", {"name": body.name, "interests": body.interests,
                                                 "password_hash": hash_password(body.password)})


@router.post("/login/start")
async def login_start(body: LoginStart):
    phone = _phone_or_422(body.phone)
    if not await get_db().users.find_one({"phone": phone}, {"_id": 1}):
        raise APIError(404, "no_account", "ยังไม่มีบัญชีสำหรับเบอร์นี้ กรุณาสมัครสมาชิก")
    return await _issue_otp(phone, "login")


LOCK_AFTER_FAILS = 5
LOCK_MINUTES = 15


async def _attach_and_login(user: dict, owner_key: str | None, created: bool = False) -> dict:
    db = get_db()
    attached = 0
    if owner_key:
        r = await db.trips.update_many({"owner_key": owner_key, "user_id": None}, {"$set": {"user_id": user["_id"]}})
        attached = r.modified_count
    token = await create_session(user["_id"])
    return {"token": token, "user": user_out(user), "created": created, "attached_trips": attached}


@router.post("/login")
async def login_password(body: PasswordLogin):
    db = get_db()
    phone = _phone_or_422(body.phone)
    user = await db.users.find_one({"phone": phone})
    generic = APIError(401, "bad_credentials", "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง")
    if not user:
        raise generic
    now = datetime.now(timezone.utc)
    lock = user.get("lock_until")
    if lock and (lock if lock.tzinfo else lock.replace(tzinfo=timezone.utc)) > now:
        mins = int(((lock if lock.tzinfo else lock.replace(tzinfo=timezone.utc)) - now).total_seconds() // 60) + 1
        raise APIError(429, "account_locked", f"กรอกรหัสผ่านผิดหลายครั้ง กรุณารอ {mins} นาที หรือเข้าสู่ระบบด้วย OTP")
    if not user.get("password_hash"):
        raise APIError(400, "no_password", "บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาเข้าสู่ระบบด้วย OTP แล้วตั้งรหัสผ่านในหน้าบัญชี")
    if not verify_password(body.password, user["password_hash"]):
        fails = user.get("failed_logins", 0) + 1
        upd = {"failed_logins": fails}
        if fails >= LOCK_AFTER_FAILS:
            upd = {"failed_logins": 0, "lock_until": now + timedelta(minutes=LOCK_MINUTES)}
        await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
        raise generic
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"failed_logins": 0, "lock_until": None, "last_login_at": now}})
    return await _attach_and_login(user, body.owner_key)


@router.post("/password/reset/start")
async def reset_start(body: LoginStart):
    phone = _phone_or_422(body.phone)
    if not await get_db().users.find_one({"phone": phone}, {"_id": 1}):
        raise APIError(404, "no_account", "ยังไม่มีบัญชีสำหรับเบอร์นี้ กรุณาสมัครสมาชิก")
    return await _issue_otp(phone, "reset")


@router.post("/password")
async def change_password(body: PasswordChange, user: dict = Depends(require_user)):
    if user.get("password_hash") and not verify_password(body.current_password or "", user["password_hash"]):
        raise APIError(400, "bad_current_password", "รหัสผ่านปัจจุบันไม่ถูกต้อง")
    await get_db().users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "password_changed_at": datetime.now(timezone.utc),
                  "failed_logins": 0, "lock_until": None}},
    )
    return {"ok": True}


@router.post("/resend")
async def resend(body: Resend):
    try:
        old = await get_db().otp_requests.find_one({"_id": ObjectId(body.request_id)})
    except (InvalidId, TypeError):
        old = None
    if not old or old.get("used"):
        raise APIError(404, "otp_not_found", "ไม่พบคำขอ OTP นี้ กรุณาเริ่มใหม่")
    return await _issue_otp(old["phone"], old["purpose"], old.get("payload"))


@router.post("/verify")
async def verify(body: Verify):
    db = get_db()
    try:
        rid = ObjectId(body.request_id)
    except (InvalidId, TypeError):
        raise APIError(404, "otp_not_found", "ไม่พบคำขอ OTP นี้ กรุณาขอรหัสใหม่")
    req = await db.otp_requests.find_one({"_id": rid})
    if not req or req.get("used"):
        raise APIError(404, "otp_not_found", "ไม่พบคำขอ OTP นี้หรือใช้ไปแล้ว กรุณาขอรหัสใหม่")
    exp = req["expires_at"] if req["expires_at"].tzinfo else req["expires_at"].replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise APIError(410, "otp_expired", "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่")
    if req["attempts"] >= settings.otp_max_attempts:
        raise APIError(429, "otp_locked", "กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่")
    if req["purpose"] == "reset":
        msg = password_problem(body.new_password or "")
        if msg:
            raise APIError(422, "validation_error", msg, [{"field": "new_password", "message": msg}])

    if req.get("provider") == "thaibulksms":
        try:
            correct = bool(req.get("provider_token")) and await sms.tbs_otp_verify(req["provider_token"], body.code)
        except sms.SMSError as e:
            raise APIError(502, "sms_failed", str(e))
    elif req.get("provider") == "twilio_verify":
        try:
            correct = await sms.verify_check(req["phone"], body.code)
        except sms.SMSError as e:
            raise APIError(502, "sms_failed", str(e))
    else:
        correct = bool(req.get("code_hash")) and otp_matches(str(rid), body.code, req["code_hash"])
    if not correct:
        await db.otp_requests.update_one({"_id": rid}, {"$inc": {"attempts": 1}})
        left = settings.otp_max_attempts - req["attempts"] - 1
        raise APIError(400, "otp_invalid", f"รหัส OTP ไม่ถูกต้อง (เหลือ {left} ครั้ง)" if left > 0 else "รหัส OTP ไม่ถูกต้อง กรุณาขอรหัสใหม่",
                       {"attempts_left": max(0, left)})

    # single use
    res = await db.otp_requests.update_one({"_id": rid, "used": False}, {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}})
    if res.modified_count == 0:
        raise APIError(404, "otp_not_found", "รหัสนี้ถูกใช้ไปแล้ว")

    now = datetime.now(timezone.utc)
    created = False
    if req["purpose"] == "register":
        doc = {
            "name": req["payload"]["name"], "phone": req["phone"], "interests": req["payload"].get("interests", []),
            "password_hash": req["payload"].get("password_hash"),
            "phone_verified_at": now, "created_at": now, "updated_at": now, "last_login_at": now,
        }
        try:
            ins = await db.users.insert_one(doc)
        except DuplicateKeyError:
            raise APIError(409, "phone_exists", "เบอร์นี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ")
        doc["_id"] = ins.inserted_id
        user = doc
        created = True
    else:
        upd = {"last_login_at": now, "failed_logins": 0, "lock_until": None}
        if req["purpose"] == "reset":
            upd |= {"password_hash": hash_password(body.new_password), "password_changed_at": now}
        user = await db.users.find_one_and_update({"phone": req["phone"]}, {"$set": upd}, return_document=True)
        if not user:
            raise APIError(404, "no_account", "ไม่พบบัญชีนี้")
        if req["purpose"] == "reset":
            # sign out other devices after a password reset
            await db.sessions.delete_many({"user_id": user["_id"]})

    return await _attach_and_login(user, body.owner_key, created)


@router.get("/me")
async def me(user: dict = Depends(require_user)):
    return user_out(user)


@router.patch("/me")
async def update_me(body: ProfileUpdate, user: dict = Depends(require_user)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in patch:
        patch["name"] = " ".join(patch["name"].split())
    if not patch:
        return user_out(user)
    patch["updated_at"] = datetime.now(timezone.utc)
    u = await get_db().users.find_one_and_update({"_id": user["_id"]}, {"$set": patch}, return_document=True)
    return user_out(u)


@router.post("/logout", status_code=204)
async def logout(authorization: str | None = Header(default=None)):
    token = _bearer(authorization)
    if token:
        await delete_session(token)
    return Response(status_code=204)
