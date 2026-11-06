"""Admin role + place editing.

Unit tests run anywhere. The integration test needs MongoDB; it works only on a synthetic place and
synthetic users that it creates and deletes itself (real places are never touched).
"""
import secrets
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo import MongoClient

from app.config import settings
from app.routers.admin import PlaceUpdate
from app.services.auth import _token_hash, user_out


def _db_ok() -> bool:
    try:
        MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500).admin.command("ping")
        return True
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _db_ok(), reason="MongoDB required")


# ------------------------------------------------------------------ unit
def test_user_out_role_defaults_to_user():
    base = {"_id": "x", "name": "a", "phone": "+66812345678"}
    assert user_out(base)["role"] == "user"
    assert user_out({**base, "role": "admin"})["role"] == "admin"
    assert user_out({**base, "role": "superuser"})["role"] == "user"  # unknown roles are not exposed


def test_place_update_validation():
    assert PlaceUpdate(name="  วัด   อรุณ ").name == "วัด อรุณ"
    with pytest.raises(ValidationError):
        PlaceUpdate(name="   ")
    with pytest.raises(ValidationError):
        PlaceUpdate(lat=40)  # outside Thailand
    with pytest.raises(ValidationError):
        PlaceUpdate(google_maps_url="javascript:alert(1)")
    assert PlaceUpdate(google_maps_url="https://maps.google.com/?cid=1").google_maps_url


def _tiny_recommender():
    from ml.recommender import Recommender

    ids = ["a", "b", "c"]
    X = sp.csr_matrix(np.array([[1.0, 0.0], [0.9, 0.1], [0.8, 0.2]], dtype=np.float32))

    class Vec:
        def get_feature_names_out(self):
            return np.array(["f0", "f1"])

    model = {"vectorizer": Vec(), "matrix": X, "place_ids": ids, "interest_vectors": {}}
    sig = pd.DataFrame([
        {"place_id": p, "name": p.upper(), "province": "x", "province_en": "x", "primary_type": "t", "types": [],
         "rating": 4.5, "rating_count": 10, "is_accommodation": False, "quality_score": 0.5, "sentiment_score": 0.5,
         "popularity_score": 0.5, "sent_n": 0, "sent_pos_share": None, "best_aspect": None, "hidden": p == "c"}
        for p in ids
    ])
    return Recommender(model, sig)


def test_recommender_respects_hidden_live():
    rec = _tiny_recommender()
    ids = lambda: {r.place_id for r in rec.rank(interests=[], limit=10)[0]}  # noqa: E731
    assert ids() == {"a", "b"}                        # hidden at load time
    assert "c" not in [p for p, _ in rec.similar("a")]
    rec.set_hidden("b", True)
    rec.set_hidden("c", False)
    assert ids() == {"a", "c"}                        # admin hide/unhide applies without reload
    assert [p for p, _ in rec.similar("a")] == ["c"]
    rec.update_signals("a", {"name": "ใหม่", "province": "y"})
    assert rec.sig.loc["a", "name"] == "ใหม่"
    assert {r.place_id for r in rec.rank(interests=[], province="y", limit=10)[0]} == {"a"}


# ------------------------------------------------------------------ integration
@pytest.fixture(scope="module")
def env():
    from app.main import app

    db = MongoClient(settings.mongodb_uri)[settings.mongodb_db]
    tag = secrets.token_hex(4)
    pid = f"__test_admin_{tag}"
    ref = db.places.find_one({"province": {"$ne": None}}, {"province": 1, "province_en": 1}) or {"province": "กรุงเทพมหานคร"}
    db.places.insert_one({
        "_id": pid, "place_id": pid, "name": f"สถานที่ทดสอบ {tag}", "province": ref["province"],
        "province_en": ref.get("province_en"), "lat": 13.75, "lng": 100.5,
        "location": {"type": "Point", "coordinates": [100.5, 13.75]}, "is_accommodation": False, "is_food": False,
    })
    now = datetime.now(timezone.utc)
    tokens, uids = {}, []
    for role in ("admin", "user"):
        uid = db.users.insert_one({"name": f"test-{role}-{tag}", "phone": f"+6699{secrets.randbelow(10**7):07d}",
                                   "role": role, "created_at": now}).inserted_id
        uids.append(uid)
        tokens[role] = secrets.token_urlsafe(16)
        db.sessions.insert_one({"token_hash": _token_hash(tokens[role]), "user_id": uid, "created_at": now,
                                "expires_at": now + timedelta(hours=1)})
    try:
        with TestClient(app) as c:
            yield c, db, pid, ref, tokens
    finally:
        db.places.delete_one({"_id": pid})
        db.place_overrides.delete_one({"_id": pid})
        db.admin_audit.delete_many({"place_id": pid})
        db.sessions.delete_many({"user_id": {"$in": uids}})
        db.users.delete_many({"_id": {"$in": uids}})


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@needs_db
def test_admin_endpoints_need_admin_role(env):
    c, _, pid, _, tokens = env
    assert c.get("/api/admin/stats").status_code == 401
    r = c.get("/api/admin/stats", headers=_h(tokens["user"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert c.patch(f"/api/admin/places/{pid}", json={"name": "x"}, headers=_h(tokens["user"])).status_code == 403
    assert c.get("/api/auth/me", headers=_h(tokens["admin"])).json()["role"] == "admin"


@needs_db
def test_admin_edit_hide_and_audit(env):
    c, db, pid, ref, tokens = env
    h = _h(tokens["admin"])

    s = c.get("/api/admin/stats", headers=h)
    assert s.status_code == 200 and len(s.json()["users"]["signups_daily"]) == 30

    r = c.patch(f"/api/admin/places/{pid}", json={"name": "ชื่อใหม่", "lat": 14.0, "note": "ทดสอบ"}, headers=h)
    assert r.status_code == 200, r.text
    assert set(r.json()["changed"]) == {"name", "lat"}
    doc = db.places.find_one({"_id": pid})
    assert doc["name"] == "ชื่อใหม่" and doc["location"]["coordinates"] == [100.5, 14.0] and doc["admin_edited_at"]
    assert db.place_overrides.find_one({"_id": pid})["fields"]["name"] == "ชื่อใหม่"

    # same values again -> nothing changes, nothing logged
    assert c.patch(f"/api/admin/places/{pid}", json={"name": "ชื่อใหม่"}, headers=h).json()["changed"] == []
    assert c.patch(f"/api/admin/places/{pid}", json={"province": "ไม่มีจังหวัดนี้"}, headers=h).status_code == 422

    # hide -> gone from public endpoints, still visible to admin
    assert c.get(f"/api/places/{pid}").status_code == 200
    r = c.patch(f"/api/admin/places/{pid}", json={"hidden": True, "hidden_reason": "ปิดถาวร"}, headers=h)
    assert r.json()["editable"]["hidden"] is True
    assert c.get(f"/api/places/{pid}").status_code == 404
    assert all(p["place_id"] != pid for p in c.get("/api/places", params={"q": "ชื่อใหม่"}).json()["items"])
    assert c.get(f"/api/admin/places/{pid}", headers=h).status_code == 200
    hidden = c.get("/api/admin/places", params={"status": "hidden", "q": pid}, headers=h).json()
    assert [p["place_id"] for p in hidden["items"]] == [pid]

    c.patch(f"/api/admin/places/{pid}", json={"hidden": False}, headers=h)
    assert c.get(f"/api/places/{pid}").status_code == 200

    actions = [a["action"] for a in c.get("/api/admin/audit", params={"place_id": pid}, headers=h).json()["items"]]
    assert actions == ["unhide", "hide", "edit"]
