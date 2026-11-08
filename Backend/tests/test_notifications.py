"""Trip reminders. The date rules run anywhere; the API tests need MongoDB with imported data (like test_activity)."""
import random
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import settings
from app.routers.notifications import build_reminder, thai_today

TODAY = date(2026, 11, 8)


def _trip(start="2026-11-09", **kw):
    return {"_id": "abc", "name": "ทะเลใต้", "start_date": start, "start_time": "08:00",
            "days": [{"start_time": None, "blocks": [{"name": "หาดลูกลม"}]}, {"blocks": []}], **kw}


def test_reminds_one_day_before():
    r = build_reminder(_trip(), TODAY, set())
    assert r["days_until"] == 1 and r["read"] is False
    assert r["key"] == "trip:abc:2026-11-09"
    assert (r["trip_id"], r["first_stop"], r["start_time"], r["day_count"]) == ("abc", "หาดลูกลม", "08:00", 2)


def test_also_shows_on_the_day_itself():
    assert build_reminder(_trip("2026-11-08"), TODAY, set())["days_until"] == 0


@pytest.mark.parametrize("start", ["2026-11-10", "2026-11-07", "2027-11-09", "not-a-date", None])
def test_no_reminder_outside_the_window(start):
    assert build_reminder(_trip(start), TODAY, set()) is None


def test_day_start_time_overrides_trip_start_time():
    t = _trip()
    t["days"][0]["start_time"] = "06:30"
    assert build_reminder(t, TODAY, set())["start_time"] == "06:30"


def test_read_state_follows_the_date():
    assert build_reminder(_trip(), TODAY, {"trip:abc:2026-11-09"})["read"] is True
    # the same trip moved to another date is a new reminder
    assert build_reminder(_trip("2026-11-08"), TODAY, {"trip:abc:2026-11-09"})["read"] is False


def _ready() -> bool:
    try:
        db = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500)[settings.mongodb_db]
        return db.places.count_documents({"ml": {"$exists": True}}, limit=1) > 0
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _ready(), reason="MongoDB with imported data required")


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


def _user(client):
    phone = "09" + "".join(random.choice("0123456789") for _ in range(8))
    s = client.post("/api/auth/register/start",
                    json={"name": "N", "phone": phone, "password": "chill2026", "interests": []}).json()
    tok = s.get("token") or client.post("/api/auth/verify", json={"request_id": s["request_id"], "code": s["dev_code"]}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def _body(start: date):
    return {"name": "ทริปทดสอบ", "start_date": start.isoformat(), "start_time": "09:00",
            "days": [{"blocks": [{"id": "b1", "kind": "custom", "name": "จุดแรก", "duration_min": 60}]}]}


@needs_db
def test_guest_is_rejected(client):
    assert client.get("/api/notifications").status_code == 401
    assert client.post("/api/notifications/read", json={"keys": ["x"]}).status_code == 401


@needs_db
def test_flow_create_read_move_delete(client):
    h = _user(client)
    tomorrow = thai_today() + timedelta(days=1)
    assert client.get("/api/notifications", headers=h).json() == {"items": [], "unread": 0}

    far = client.post("/api/trips", json=_body(thai_today() + timedelta(days=5)), headers=h).json()
    assert client.get("/api/notifications", headers=h).json()["items"] == []

    # moving the trip to tomorrow makes the reminder appear straight away
    assert client.put(f"/api/trips/{far['id']}", json=_body(tomorrow), headers=h).status_code == 200
    r = client.get("/api/notifications", headers=h).json()
    assert r["unread"] == 1 and r["items"][0]["trip_id"] == far["id"] and r["items"][0]["first_stop"] == "จุดแรก"

    # someone else's account sees nothing and cannot mark it read
    other = _user(client)
    key = r["items"][0]["key"]
    assert client.get("/api/notifications", headers=other).json()["items"] == []
    assert client.post("/api/notifications/read", json={"keys": [key]}, headers=other).status_code == 204
    assert client.get("/api/notifications", headers=h).json()["unread"] == 1

    assert client.post("/api/notifications/read", json={"keys": [key]}, headers=h).status_code == 204
    after = client.get("/api/notifications", headers=h).json()
    assert after["unread"] == 0 and after["items"][0]["read"] is True

    # deleting the trip removes its reminder
    assert client.delete(f"/api/trips/{far['id']}", headers=h).status_code == 204
    assert client.get("/api/notifications", headers=h).json()["items"] == []
