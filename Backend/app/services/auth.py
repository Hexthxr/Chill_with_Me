"""Phone-number auth helpers: phone normalisation, OTP hashing, sessions, current-user dependency."""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import Header

from ..config import settings
from ..db import get_db
from ..errors import APIError

log = logging.getLogger("chill.auth")

_secret: bytes | None = None


def secret() -> bytes:
    """HMAC key for OTP hashes. Use AUTH_SECRET in production; a random per-process key is used
    otherwise (pending OTPs simply become invalid after a restart)."""
    global _secret
    if _secret is None:
        if settings.auth_secret:
            _secret = settings.auth_secret.encode()
        else:
            log.warning("AUTH_SECRET is not set – using a random key for this process")
            _secret = secrets.token_bytes(32)
    return _secret


# ------------------------------------------------------------------ phone
_DIGITS = re.compile(r"\D")


def normalize_th_mobile(raw: str) -> str | None:
    """Thai mobile number -> E.164 (+66XXXXXXXXX). Accepts 0812345678, 081-234-5678, +66812345678, 66812345678."""
    d = _DIGITS.sub("", raw or "")
    if d.startswith("66") and len(d) == 11:
        d = "0" + d[2:]
    if len(d) == 10 and d[0] == "0" and d[1] in "689":
        return "+66" + d[1:]
    return None


def display_phone(e164: str) -> str:
    local = "0" + e164[3:]
    return f"{local[:3]}-{local[3:6]}-{local[6:]}"


def mask_phone(e164: str) -> str:
    local = "0" + e164[3:]
    return f"{local[:3]}-xxx-{local[6:]}"


# ------------------------------------------------------------------ OTP
def new_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(request_id: str, code: str) -> str:
    return hmac.new(secret(), f"{request_id}:{code}".encode(), hashlib.sha256).hexdigest()


def otp_matches(request_id: str, code: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(request_id, code), stored_hash)


# ------------------------------------------------------------------ passwords
# PBKDF2-HMAC-SHA256 (Python stdlib, works on every platform). Only the salted hash is stored.
PBKDF2_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${b64(salt)}${b64(dk)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iters))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


def password_problem(pw: str) -> str | None:
    """Return a Thai error message if the password is too weak, else None."""
    if len(pw) < 8:
        return "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"
    if len(pw) > 128:
        return "รหัสผ่านยาวเกินไป (ไม่เกิน 128 ตัวอักษร)"
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข"
    return None


# ------------------------------------------------------------------ sessions
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(user_id: ObjectId) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await get_db().sessions.insert_one({
        "token_hash": _token_hash(token),
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=settings.session_days),
    })
    return token


async def delete_session(token: str) -> None:
    await get_db().sessions.delete_one({"token_hash": _token_hash(token)})


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


async def user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    db = get_db()
    s = await db.sessions.find_one({"token_hash": _token_hash(token)})
    if not s:
        return None
    exp = s["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        return None
    return await db.users.find_one({"_id": s["user_id"]})


async def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    return await user_from_token(_bearer(authorization))


async def require_user(authorization: str | None = Header(default=None)) -> dict:
    user = await user_from_token(_bearer(authorization))
    if not user:
        raise APIError(401, "unauthorized", "กรุณาเข้าสู่ระบบ")
    return user


ROLES = ("user", "admin")


async def require_admin(authorization: str | None = Header(default=None)) -> dict:
    """Signed-in user whose users.role is "admin" (set with: python -m scripts.set_admin <phone>)."""
    user = await require_user(authorization)
    if user.get("role") != "admin":
        raise APIError(403, "forbidden", "เฉพาะผู้ดูแลระบบเท่านั้น")
    return user


def user_out(u: dict) -> dict:
    return {
        "id": str(u["_id"]),
        "name": u["name"],
        "phone": display_phone(u["phone"]),
        "role": u.get("role") if u.get("role") in ROLES else "user",
        "interests": u.get("interests", []),
        "has_password": bool(u.get("password_hash")),
        "created_at": u["created_at"].isoformat() if u.get("created_at") else None,
    }


async def ensure_indexes(db) -> None:
    await db.users.create_index("phone", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.otp_requests.create_index([("phone", 1), ("created_at", -1)])
    # keep OTP records 1 day for rate limiting / audit, then auto-delete
    await db.otp_requests.create_index("created_at", expireAfterSeconds=24 * 3600)
    await db.trips.create_index([("user_id", 1), ("updated_at", -1)])
