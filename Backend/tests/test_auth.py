"""Auth flow tests (needs MongoDB; SMS provider must be console/test mode so the code is returned)."""
import random

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import settings
from app.services.auth import display_phone, normalize_th_mobile


def _db_ok() -> bool:
    try:
        MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500).admin.command("ping")
        return True
    except Exception:
        return False


def test_phone_normalisation():
    assert normalize_th_mobile("081-234-5678") == "+66812345678"
    assert normalize_th_mobile("+66 81 234 5678") == "+66812345678"
    assert normalize_th_mobile("66812345678") == "+66812345678"
    assert normalize_th_mobile("0612345678") == "+66612345678"
    assert normalize_th_mobile("021234567") is None      # landline
    assert normalize_th_mobile("08123") is None
    assert display_phone("+66812345678") == "081-234-5678"


needs_db = pytest.mark.skipif(
    not _db_ok() or settings.resolved_sms_provider() != "console", reason="MongoDB + console SMS mode required"
)


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


PW = "chill2026"


def rand_phone() -> str:
    return "09" + "".join(random.choice("0123456789") for _ in range(8))


@needs_db
def test_register_verify_login_logout(client):
    phone = rand_phone()
    # step 1: details -> OTP (account NOT created yet)
    r = client.post("/api/auth/register/start", json={"name": "  ทดสอบ   ระบบ ", "phone": phone, "password": PW, "interests": ["sea", "cafe"]})
    assert r.status_code == 200, r.text
    start = r.json()
    assert start["test_mode"] is True and len(start["dev_code"]) == 6
    assert client.post("/api/auth/login/start", json={"phone": phone}).status_code == 404

    # wrong code counts an attempt
    wrong = "000000" if start["dev_code"] != "000000" else "111111"
    bad = client.post("/api/auth/verify", json={"request_id": start["request_id"], "code": wrong})
    assert bad.status_code == 400 and bad.json()["error"]["details"]["attempts_left"] == settings.otp_max_attempts - 1

    # step 2: correct OTP -> account + token
    ok = client.post("/api/auth/verify", json={"request_id": start["request_id"], "code": start["dev_code"]})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["created"] is True
    assert body["user"]["name"] == "ทดสอบ ระบบ" and body["user"]["interests"] == ["sea", "cafe"]
    token = body["token"]
    h = {"Authorization": f"Bearer {token}"}

    # code is single-use
    assert client.post("/api/auth/verify", json={"request_id": start["request_id"], "code": start["dev_code"]}).status_code == 404
    # cannot register same phone twice
    assert client.post("/api/auth/register/start", json={"name": "x", "phone": phone, "password": PW}).status_code == 409

    me = client.get("/api/auth/me", headers=h)
    assert me.status_code == 200 and me.json()["phone"].endswith(phone[-4:])
    upd = client.patch("/api/auth/me", headers=h, json={"interests": ["mountain"]})
    assert upd.json()["interests"] == ["mountain"]

    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401


@needs_db
def test_login_and_trip_ownership(client):
    phone = rand_phone()
    s = client.post("/api/auth/register/start", json={"name": "A", "phone": phone, "password": PW}).json()
    tok = client.post("/api/auth/verify", json={"request_id": s["request_id"], "code": s["dev_code"]}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    plan = {"name": "ของ A", "start_date": "2026-11-01", "days": [{"blocks": []}]}
    trip = client.post("/api/trips", json=plan, headers=h).json()
    assert trip["user_id"]
    assert any(t["id"] == trip["id"] for t in client.get("/api/trips", headers=h).json()["items"])
    # anonymous / other user cannot modify
    assert client.put(f"/api/trips/{trip['id']}", json=plan).status_code == 403
    assert client.delete(f"/api/trips/{trip['id']}").status_code == 403
    # anonymous list without owner_key is empty (no leaking everyone's trips)
    assert client.get("/api/trips").json()["items"] == []
    assert client.delete(f"/api/trips/{trip['id']}", headers=h).status_code == 204


@needs_db
def test_validation_and_rate_limit(client):
    assert client.post("/api/auth/register/start", json={"name": "x", "phone": "021234567", "password": PW}).json()["error"]["code"] == "invalid_phone"
    assert client.post("/api/auth/register/start", json={"name": "x", "phone": rand_phone(), "password": PW, "interests": ["space"]}).status_code == 422
    weak = client.post("/api/auth/register/start", json={"name": "x", "phone": rand_phone(), "password": "abcdefgh"})
    assert weak.status_code == 422 and "ตัวเลข" in weak.json()["error"]["details"][0]["message"]
    assert client.post("/api/auth/verify", json={"request_id": "nope", "code": "12"}).status_code == 422
    phone = rand_phone()
    assert client.post("/api/auth/register/start", json={"name": "x", "phone": phone, "password": PW}).status_code == 200
    again = client.post("/api/auth/register/start", json={"name": "x", "phone": phone, "password": PW})
    assert again.status_code == 429 and again.json()["error"]["code"] == "otp_too_soon"


@needs_db
def test_anonymous_trips_attach_on_login(client):
    key = f"pytest-{random.randint(0, 10**9)}"
    plan = {"name": "ร่าง", "start_date": "2026-11-01", "days": [{"blocks": []}], "owner_key": key}
    t = client.post("/api/trips", json=plan).json()
    assert t["user_id"] is None
    s = client.post("/api/auth/register/start", json={"name": "B", "phone": rand_phone(), "password": PW}).json()
    v = client.post("/api/auth/verify", json={"request_id": s["request_id"], "code": s["dev_code"], "owner_key": key}).json()
    assert v["attached_trips"] == 1
    h = {"Authorization": f"Bearer {v['token']}"}
    assert any(x["id"] == t["id"] for x in client.get("/api/trips", headers=h).json()["items"])


def _register(client, phone, pw=PW):
    s = client.post("/api/auth/register/start", json={"name": "P", "phone": phone, "password": pw}).json()
    return client.post("/api/auth/verify", json={"request_id": s["request_id"], "code": s["dev_code"]}).json()


@needs_db
def test_password_login_lockout_change_and_reset(client, monkeypatch):
    from pymongo import MongoClient as MC

    phone = rand_phone()
    reg = _register(client, phone)
    assert reg["user"]["has_password"] is True
    # password is stored only as a hash
    raw = MC(settings.mongodb_uri)[settings.mongodb_db].users.find_one({"phone": "+66" + phone[1:]})
    assert raw["password_hash"].startswith("pbkdf2_sha256$") and PW not in raw["password_hash"]

    ok = client.post("/api/auth/login", json={"phone": phone, "password": PW})
    assert ok.status_code == 200 and ok.json()["token"]
    bad = client.post("/api/auth/login", json={"phone": phone, "password": "wrong1234"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "bad_credentials"
    unknown = client.post("/api/auth/login", json={"phone": rand_phone(), "password": PW})
    assert unknown.status_code == 401  # same generic error, no account enumeration

    # change password (needs current one)
    h = {"Authorization": f"Bearer {ok.json()['token']}"}
    assert client.post("/api/auth/password", headers=h, json={"current_password": "nope1234", "new_password": "newpass99"}).status_code == 400
    assert client.post("/api/auth/password", headers=h, json={"current_password": PW, "new_password": "newpass99"}).status_code == 200
    assert client.post("/api/auth/login", json={"phone": phone, "password": "newpass99"}).status_code == 200

    # lockout after 5 wrong passwords
    for _ in range(5):
        client.post("/api/auth/login", json={"phone": phone, "password": "wrong1234"})
    locked = client.post("/api/auth/login", json={"phone": phone, "password": "newpass99"})
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "account_locked"

    # forgot password via OTP (also clears the lock and signs out other sessions)
    MC(settings.mongodb_uri)[settings.mongodb_db].otp_requests.delete_many({"phone": "+66" + phone[1:]})  # skip resend wait
    st = client.post("/api/auth/password/reset/start", json={"phone": phone}).json()
    missing = client.post("/api/auth/verify", json={"request_id": st["request_id"], "code": st["dev_code"]})
    assert missing.status_code == 422  # new_password required, OTP not consumed
    done = client.post("/api/auth/verify", json={"request_id": st["request_id"], "code": st["dev_code"], "new_password": "reset2026"})
    assert done.status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401  # old session revoked
    assert client.post("/api/auth/login", json={"phone": phone, "password": "reset2026"}).status_code == 200


@needs_db
def test_twilio_verify_flow_mocked(client, monkeypatch):
    """Twilio Verify path: our server never sees/stores the code; Twilio checks it (mocked here)."""
    from app.services import sms

    sent, approved = [], {"code": "424242"}

    async def fake_start(phone):
        sent.append(phone)

    async def fake_check(phone, code):
        return code == approved["code"]

    monkeypatch.setattr(sms, "provider", lambda: "twilio_verify")
    monkeypatch.setattr(sms, "verify_start", fake_start)
    monkeypatch.setattr(sms, "verify_check", fake_check)

    phone = rand_phone()
    st = client.post("/api/auth/register/start", json={"name": "V", "phone": phone, "password": PW}).json()
    assert sent == ["+66" + phone[1:]]
    assert "dev_code" not in st and "test_mode" not in st  # real provider: code never shown
    assert client.post("/api/auth/verify", json={"request_id": st["request_id"], "code": "000001"}).status_code == 400
    ok = client.post("/api/auth/verify", json={"request_id": st["request_id"], "code": "424242"})
    assert ok.status_code == 200 and ok.json()["created"] is True


def test_thaibulksms_http_payloads(monkeypatch):
    """Checks the exact requests sent to ThaiBulkSMS OTP v2 and how responses are interpreted."""
    import asyncio
    import json

    import httpx

    from app.services import sms

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append((str(request.url), body))
        if request.url.path.endswith("/request"):
            return httpx.Response(200, json={"status": "success", "token": "Qp3L2v1A", "refno": "T3A57"})
        if body["pin"] == "123456":
            return httpx.Response(200, json={"status": "success", "message": "Code is correct."})
        return httpx.Response(400, json={"code": 400, "errors": [{"message": "Code is invalid."}]})

    import dataclasses

    monkeypatch.setattr(sms, "settings", dataclasses.replace(sms.settings, thaibulksms_otp_key="1234567890", thaibulksms_otp_secret="s"))
    real = httpx.AsyncClient
    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    token, ref = asyncio.run(sms.tbs_otp_request("+66812345678"))
    assert (token, ref) == ("Qp3L2v1A", "T3A57")
    assert seen[0][0] == "https://otp.thaibulksms.com/v2/otp/request"
    assert seen[0][1]["msisdn"] == "0812345678" and set(seen[0][1]) == {"key", "secret", "msisdn"}
    assert asyncio.run(sms.tbs_otp_verify(token, "123456")) is True
    assert seen[1][0] == "https://otp.thaibulksms.com/v2/otp/verify" and seen[1][1]["token"] == "Qp3L2v1A"
    assert asyncio.run(sms.tbs_otp_verify(token, "000000")) is False
    # non-numeric key is rejected before calling ThaiBulkSMS (their API answers "key must be numeric")
    monkeypatch.setattr(sms, "settings", dataclasses.replace(sms.settings, thaibulksms_otp_key="abc"))
    with pytest.raises(sms.SMSError):
        asyncio.run(sms.tbs_otp_request("+66812345678"))


@needs_db
def test_thaibulksms_flow_mocked(client, monkeypatch):
    from app.services import sms

    async def fake_request(phone):
        return "TOKEN-1", "REF42"

    async def fake_verify(token, pin):
        return token == "TOKEN-1" and pin == "135790"

    monkeypatch.setattr(sms, "provider", lambda: "thaibulksms")
    monkeypatch.setattr(sms, "tbs_otp_request", fake_request)
    monkeypatch.setattr(sms, "tbs_otp_verify", fake_verify)
    st = client.post("/api/auth/register/start", json={"name": "ไทย", "phone": rand_phone(), "password": PW}).json()
    assert st["refno"] == "REF42" and st["code_length"] == settings.thaibulksms_otp_length and "dev_code" not in st
    assert client.post("/api/auth/verify", json={"request_id": st["request_id"], "code": "111111"}).status_code == 400
    ok = client.post("/api/auth/verify", json={"request_id": st["request_id"], "code": "135790"})
    assert ok.status_code == 200 and ok.json()["created"] is True
