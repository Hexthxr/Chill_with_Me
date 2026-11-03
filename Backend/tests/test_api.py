"""Integration tests against a running MongoDB that has been imported (+ build_ml).
Skipped automatically if MongoDB is unreachable or empty."""
import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import settings


def _db_ready() -> bool:
    try:
        c = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500)
        return c[settings.mongodb_db].places.estimated_document_count() > 0
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _db_ready(), reason="MongoDB with imported data not available")


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_health_and_stats(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok"
    s = client.get("/api/meta/stats").json()
    assert s["places"] > 20000 and s["provinces"] == 77


def test_recommend_interest(client):
    r = client.get("/api/recommend", params={"interests": "culture", "limit": 5})
    assert r.status_code == 200
    d = r.json()
    assert len(d["items"]) == 5
    scores = [i["score"] for i in d["items"]]
    # list is diversity re-ranked by primary_type, so only the head is guaranteed to be the best score
    assert scores[0] == max(scores)
    assert len({i["place_id"] for i in d["items"]}) == len(d["items"])
    assert all(i["reasons"] for i in d["items"])
    assert not any(i["is_accommodation"] for i in d["items"])


def test_recommend_location(client):
    r = client.get("/api/recommend", params={"mode": "location", "lat": 18.7883, "lng": 98.9853, "radius_km": 20, "limit": 10})
    d = r.json()
    assert r.status_code == 200 and d["items"]
    assert all(i["distance_km"] is not None and i["distance_km"] <= 20 for i in d["items"])


def test_recommend_validation(client):
    assert client.get("/api/recommend", params={"mode": "location"}).status_code == 422
    r = client.get("/api/recommend", params={"interests": "space"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_place_detail_reviews_similar(client):
    top = client.get("/api/places", params={"limit": 1}).json()["items"][0]
    d = client.get(f"/api/places/{top['place_id']}").json()
    assert d["analysis"]["available"] is True
    assert client.get(f"/api/places/{top['place_id']}/reviews").json()["total"] > 0
    assert client.get(f"/api/places/{top['place_id']}/similar").status_code == 200
    assert client.get("/api/places/does-not-exist").status_code == 404


def test_hotels(client):
    r = client.get("/api/hotels/near", params={"lat": 18.79, "lng": 98.98, "radius_km": 20}).json()
    assert r["items"] and all(h["distance_km"] <= 20 for h in r["items"])
    cov = client.get("/api/hotels/coverage").json()
    assert cov["with_price"] < cov["total"]
    ar = client.post("/api/hotels/along-route", json={"points": [[18.79, 98.98], [18.80, 99.0]], "radius_km": 5})
    assert ar.status_code == 200


PLAN = {
    "name": "ทดสอบ", "start_date": "2026-11-01", "start_time": "08:00", "day_end_time": "20:00",
    "days": [{"blocks": [
        {"id": "a", "kind": "place", "name": "A", "lat": 13.7522, "lng": 100.4913, "duration_min": 90},
        {"id": "b", "kind": "food", "name": "ข้าว", "duration_min": 60},
        {"id": "c", "kind": "place", "name": "C", "lat": 13.7437, "lng": 100.4889, "duration_min": 60},
    ]}],
}


def _login(client) -> dict:
    import random

    from app.services import sms

    from app.routers import auth as auth_router

    if auth_router.settings.otp_enabled and sms.provider() != "console":
        pytest.skip("needs console SMS mode")
    phone = "09" + "".join(random.choice("0123456789") for _ in range(8))
    s = client.post("/api/auth/register/start",
                    json={"name": "N", "phone": phone, "password": "chill2026"}).json()
    tok = s.get("token") or client.post("/api/auth/verify", json={"request_id": s["request_id"], "code": s["dev_code"]}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def test_planner_and_trip_crud(client):
    h = _login(client)
    assert client.post("/api/planner/compute", json=PLAN).status_code == 401  # guests can't plan
    r = client.post("/api/planner/compute", json=PLAN, headers=h)
    assert r.status_code == 200
    assert r.json()["days"][0]["blocks"][2]["travel"]["source"] in {"mock", "openrouteservice", "google", "osrm"}

    bad = client.post("/api/planner/compute", json={**PLAN, "start_time": "25:00"}, headers=h)
    assert bad.status_code == 422

    created = client.post("/api/trips", json=PLAN, headers=h)
    assert created.status_code == 201
    tid = created.json()["id"]
    assert client.get(f"/api/trips/{tid}", headers=h).json()["name"] == "ทดสอบ"
    upd = client.put(f"/api/trips/{tid}", json={**PLAN, "name": "แก้ไขแล้ว"}, headers=h)
    assert upd.json()["name"] == "แก้ไขแล้ว"
    assert any(t["id"] == tid for t in client.get("/api/trips", headers=h).json()["items"])
    assert client.delete(f"/api/trips/{tid}", headers=h).status_code == 204
    assert client.get(f"/api/trips/{tid}", headers=h).status_code == 404
    assert client.get("/api/trips/not-an-id", headers=h).status_code == 404
