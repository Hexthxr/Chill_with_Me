"""Behaviour tracking + personal recommendations (needs MongoDB with imported data + build_ml, console SMS mode)."""
import random

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import settings


def _ready() -> bool:
    try:
        db = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500)[settings.mongodb_db]
        return db.places.count_documents({"ml": {"$exists": True}}, limit=1) > 0 and settings.resolved_sms_provider() == "console"
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _ready(), reason="MongoDB with ML data + console SMS mode required")


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


def _user(client, interests=None):
    phone = "09" + "".join(random.choice("0123456789") for _ in range(8))
    s = client.post("/api/auth/register/start",
                    json={"name": "N", "phone": phone, "password": "chill2026", "interests": interests or []}).json()
    tok = s.get("token") or client.post("/api/auth/verify", json={"request_id": s["request_id"], "code": s["dev_code"]}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def _sea_places(client, n=3):
    items = client.get("/api/recommend", params={"interests": "sea", "limit": n}).json()["items"]
    return [p["place_id"] for p in items]


def test_guest_cannot_track_or_get_personal(client):
    pid = _sea_places(client, 1)[0]
    assert client.post("/api/activity", json={"place_id": pid}).status_code == 401
    assert client.get("/api/recommend/personal").status_code == 401


def test_views_drive_recent_because_and_for_you(client):
    h = _user(client)
    seen = _sea_places(client, 3)
    for pid in seen:
        assert client.post("/api/activity", json={"place_id": pid, "action": "view"}, headers=h).status_code == 204
    # repeated view within 30 min is collapsed, trip_add adds a weighted event
    client.post("/api/activity", json={"place_id": seen[0], "action": "view"}, headers=h)
    client.post("/api/activity", json={"place_id": seen[1], "action": "trip_add"}, headers=h)
    assert client.get("/api/activity/summary", headers=h).json() == {"events": 4, "places": 3, "retention_days": 180}

    r = client.get("/api/recommend/personal", headers=h).json()
    assert r["basis"] == "history"
    # most recent first (seen[1] was touched last by trip_add)
    assert r["recent"][0]["place_id"] == seen[1]
    assert {p["place_id"] for p in r["recent"]} == set(seen)
    assert r["because"] and r["because"][0]["seed"]["place_id"] in seen
    # never re-recommend places already seen
    rec_ids = {p["place_id"] for p in r["for_you"]} | {p["place_id"] for b in r["because"] for p in b["items"]}
    assert not rec_ids & set(seen)
    # viewing sea places makes 'for you' lean to sea places
    assert sum(1 for p in r["for_you"] if (p["ml"]["interest_scores"].get("sea") or 0) > 0.3) >= len(r["for_you"]) // 2
    assert any("ที่คุณเคยดู" in reason for p in r["for_you"] for reason in p["reasons"])

    assert client.post("/api/activity", json={"place_id": "nope"}, headers=h).status_code == 404
    assert client.delete("/api/activity", headers=h).status_code == 204
    after = client.get("/api/recommend/personal", headers=h).json()
    assert after["recent"] == [] and after["because"] == [] and after["basis"] == "popular"


def test_new_user_with_interests_only(client):
    h = _user(client, interests=["culture"])
    r = client.get("/api/recommend/personal", headers=h).json()
    assert r["basis"] == "interests" and r["for_you"] and r["recent"] == []
