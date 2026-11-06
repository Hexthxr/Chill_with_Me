"""Admin panel API (users.role == "admin" only).

GET   /api/admin/stats               dashboard numbers
GET   /api/admin/options             provinces + place types for the edit form
GET   /api/admin/places              search places (hidden ones included)
GET   /api/admin/places/{id}         one place: editable fields + read-only data + its edit history
PATCH /api/admin/places/{id}         edit fields / hide / unhide
GET   /api/admin/audit               who changed what

Design notes
- Places are hidden, never deleted (reversible; reviews and ML results stay intact).
- Dataset numbers (rating, rating_count, reviews, ML scores) are read-only: they come from real data.
- Every change is written to `admin_audit` and the latest values to `place_overrides`, which
  scripts/import_csv.py re-applies after a re-import so edits are not lost.
- Hide/unhide and name/province/type edits reach the recommender immediately (in memory);
  the TF-IDF text profile itself only changes after `python -m scripts.build_ml`.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator

from ..db import get_db
from ..errors import APIError
from ..serializers import jsonable
from ..services.auth import require_admin
from ..services.ml_service import ml_service

router = APIRouter(prefix="/api/admin", tags=["admin"])

TZ = "Asia/Bangkok"
EDITABLE = ("name", "address", "district", "province", "lat", "lng", "google_maps_url", "primary_type", "is_food", "hidden")
# fields that also live in the `hotels` collection / the recommender's in-memory signals
HOTEL_FIELDS = {"name", "address", "district", "province", "province_en", "lat", "lng", "location",
                "google_maps_url", "primary_type", "hidden"}
SIGNAL_FIELDS = {"name", "province", "province_en", "primary_type"}

LIST_PROJECTION = {
    "name": 1, "province": 1, "district": 1, "primary_type": 1, "rating": 1, "rating_count": 1,
    "is_accommodation": 1, "is_food": 1, "hidden": 1, "admin_edited_at": 1,
}


def _since(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


async def _daily(coll, field: str, days: int, match: dict | None = None) -> list[dict]:
    """Counts per day (Bangkok time) for the last `days` days, zero-filled."""
    rows = await (await coll.aggregate([
        {"$match": {field: {"$gte": _since(days)}, **(match or {})}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": f"${field}", "timezone": TZ}}, "n": {"$sum": 1}}},
    ])).to_list(None)
    by_day = {r["_id"]: r["n"] for r in rows}
    today = datetime.now(timezone(timedelta(hours=7))).date()
    out = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        out.append({"date": d, "count": by_day.get(d, 0)})
    return out


# ------------------------------------------------------------------ dashboard
@router.get("/stats")
async def stats(_: dict = Depends(require_admin)):
    db = get_db()
    d7, d30 = _since(7), _since(30)

    top = await (await db.place_events.aggregate([
        {"$match": {"ts": {"$gte": d30}}},
        {"$group": {"_id": "$place_id", "views": {"$sum": {"$cond": [{"$eq": ["$action", "view"]}, 1, 0]}},
                    "trip_adds": {"$sum": {"$cond": [{"$eq": ["$action", "trip_add"]}, 1, 0]}},
                    "users": {"$addToSet": "$user_id"}}},
        {"$project": {"views": 1, "trip_adds": 1, "users": {"$size": "$users"}}},
        {"$sort": {"views": -1, "trip_adds": -1}},
        {"$limit": 10},
    ])).to_list(None)
    names = {p["_id"]: p async for p in db.places.find({"_id": {"$in": [t["_id"] for t in top]}},
                                                       {"name": 1, "province": 1, "hidden": 1})}
    top_places = [
        {"place_id": t["_id"], "name": names.get(t["_id"], {}).get("name"), "province": names.get(t["_id"], {}).get("province"),
         "hidden": bool(names.get(t["_id"], {}).get("hidden")), "views": t["views"], "trip_adds": t["trip_adds"], "users": t["users"]}
        for t in top
    ]

    top_provinces = await (await db.trips.aggregate([
        {"$unwind": "$days"}, {"$unwind": "$days.blocks"},
        {"$match": {"days.blocks.place_id": {"$ne": None}}},
        {"$lookup": {"from": "places", "localField": "days.blocks.place_id", "foreignField": "_id",
                     "as": "p", "pipeline": [{"$project": {"province": 1}}]}},
        {"$unwind": "$p"},
        {"$group": {"_id": "$p.province", "blocks": {"$sum": 1}, "trips": {"$addToSet": "$_id"}}},
        {"$project": {"blocks": 1, "trips": {"$size": "$trips"}}},
        {"$sort": {"trips": -1, "blocks": -1}}, {"$limit": 8},
    ])).to_list(None)

    m = ml_service.metrics or {}
    test = m.get("test") or {}
    recent = [jsonable(a) async for a in db.admin_audit.find({}, {"_id": 0}).sort("ts", -1).limit(8)]
    last_run = await db.ml_runs.find_one({}, {"created_at": 1}, sort=[("created_at", -1)])

    return {
        "users": {
            "total": await db.users.count_documents({}),
            "admins": await db.users.count_documents({"role": "admin"}),
            "new_7d": await db.users.count_documents({"created_at": {"$gte": d7}}),
            "new_30d": await db.users.count_documents({"created_at": {"$gte": d30}}),
            "active_7d": len(await db.place_events.distinct("user_id", {"ts": {"$gte": d7}})),
            "signups_daily": await _daily(db.users, "created_at", 30),
        },
        "trips": {
            "total": await db.trips.count_documents({}),
            "new_7d": await db.trips.count_documents({"created_at": {"$gte": d7}}),
            "created_daily": await _daily(db.trips, "created_at", 30),
            "top_provinces": [{"province": r["_id"], "trips": r["trips"], "places": r["blocks"]} for r in top_provinces if r["_id"]],
        },
        "activity": {
            "views_7d": await db.place_events.count_documents({"ts": {"$gte": d7}, "action": "view"}),
            "trip_adds_7d": await db.place_events.count_documents({"ts": {"$gte": d7}, "action": "trip_add"}),
            "views_daily": await _daily(db.place_events, "ts", 30, {"action": "view"}),
            "top_places_30d": top_places,
        },
        "places": {
            "total": await db.places.estimated_document_count(),
            "hidden": await db.places.count_documents({"hidden": True}),
            "edited": await db.places.count_documents({"admin_edited_at": {"$exists": True}}),
            "without_rating": await db.places.count_documents({"rating": None}),
            "accommodation": await db.places.count_documents({"is_accommodation": True}),
        },
        "reviews": {
            "total": await db.reviews.estimated_document_count(),
            "analyzed": await db.reviews.count_documents({"sentiment": {"$exists": True}}),
            "negative": await db.reviews.count_documents({"sentiment.label": "negative"}),
        },
        "ml": {
            "ready": ml_service.ready,
            "error": ml_service.error,
            "model": m.get("model"),
            "f1_macro": test.get("f1_macro"),
            "accuracy": test.get("accuracy"),
            "trained_at": jsonable(last_run["created_at"]) if last_run else None,
        },
        "recent_edits": recent,
    }


@router.get("/options")
async def options(_: dict = Depends(require_admin)):
    db = get_db()
    provs = await (await db.places.aggregate([
        {"$group": {"_id": {"th": "$province", "en": "$province_en"}}}, {"$sort": {"_id.th": 1}},
    ])).to_list(None)
    types = await (await db.places.aggregate([
        {"$match": {"primary_type": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$primary_type", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 300},
    ])).to_list(None)
    return {
        "provinces": [{"province": p["_id"]["th"], "province_en": p["_id"].get("en")} for p in provs if p["_id"].get("th")],
        "primary_types": [{"value": t["_id"], "count": t["n"]} for t in types],
    }


# ------------------------------------------------------------------ places
@router.get("/places")
async def list_places(
    q: str | None = Query(None, max_length=100),
    province: str | None = None,
    status: Literal["all", "visible", "hidden", "edited"] = "all",
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: dict = Depends(require_admin),
):
    db = get_db()
    f: dict = {}
    if q and q.strip():
        f["$or"] = [{"name": {"$regex": re.escape(q.strip()), "$options": "i"}}, {"_id": q.strip()}]
    if province:
        f["province"] = province
    if status == "visible":
        f["hidden"] = {"$ne": True}
    elif status == "hidden":
        f["hidden"] = True
    elif status == "edited":
        f["admin_edited_at"] = {"$exists": True}
    sort = [("admin_edited_at", -1)] if status == "edited" else [("rating_count", -1), ("_id", 1)]
    total = await db.places.count_documents(f)
    cur = db.places.find(f, LIST_PROJECTION).sort(sort).skip(offset).limit(limit)
    items = []
    async for d in cur:
        d = jsonable(d)
        d["place_id"] = d.pop("_id")
        d["hidden"] = bool(d.get("hidden"))
        items.append(d)
    return {"total": total, "items": items}


def _place_admin_out(d: dict) -> dict:
    ml = d.get("ml") or {}
    sent = ml.get("sentiment") or {}
    return jsonable({
        "place_id": d["_id"],
        "editable": {k: d.get(k) for k in EDITABLE} | {"hidden": bool(d.get("hidden")), "is_food": bool(d.get("is_food"))},
        "readonly": {
            "province_en": d.get("province_en"),
            "category": d.get("category"),
            "types": d.get("types") or [],
            "rating": d.get("rating"),
            "rating_count": d.get("rating_count"),
            "is_accommodation": d.get("is_accommodation", False),
            "reviews_analyzed": sent.get("n_analyzed", 0),
            "positive_share": sent.get("positive_share"),
            "sentiment_score": ml.get("sentiment_score"),
        },
        "hidden_reason": d.get("hidden_reason"),
        "admin_edited_at": d.get("admin_edited_at"),
        "admin_edited_by": d.get("admin_edited_by_name"),
    })


async def _get_place(place_id: str) -> dict:
    d = await get_db().places.find_one({"_id": place_id})
    if not d:
        raise APIError(404, "not_found", "ไม่พบสถานที่นี้")
    return d


@router.get("/places/{place_id}")
async def get_place(place_id: str, _: dict = Depends(require_admin)):
    d = await _get_place(place_id)
    history = [jsonable(a) async for a in get_db().admin_audit.find({"place_id": place_id}, {"_id": 0}).sort("ts", -1).limit(20)]
    return {**_place_admin_out(d), "history": history}


_URL = re.compile(r"^https?://\S+$", re.I)


class PlaceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    address: str | None = Field(None, max_length=300)
    district: str | None = Field(None, max_length=100)
    province: str | None = Field(None, min_length=1, max_length=100)
    lat: float | None = Field(None, ge=5, le=21, description="Thailand latitude range")
    lng: float | None = Field(None, ge=97, le=106, description="Thailand longitude range")
    google_maps_url: str | None = Field(None, max_length=500)
    primary_type: str | None = Field(None, max_length=80)
    is_food: bool | None = None
    hidden: bool | None = None
    hidden_reason: str | None = Field(None, max_length=200)
    note: str | None = Field(None, max_length=300, description="why the change was made (saved in the audit log)")

    @field_validator("name", "address", "district", "province", "primary_type", "google_maps_url", "hidden_reason", "note")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return None if v is None else " ".join(v.split())

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is not None and not v:
            raise ValueError("กรุณากรอกชื่อสถานที่")
        return v

    @field_validator("google_maps_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        if v and not _URL.match(v):
            raise ValueError("ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://")
        return v


@router.patch("/places/{place_id}")
async def update_place(place_id: str, body: PlaceUpdate, admin: dict = Depends(require_admin)):
    db = get_db()
    d = await _get_place(place_id)
    sent = body.model_dump(exclude_unset=True)
    note = sent.pop("note", None)
    hidden_reason = sent.pop("hidden_reason", None)

    new: dict = {}
    for k, v in sent.items():
        if k in ("address", "district", "google_maps_url", "primary_type") and v == "":
            v = None
        if v is None and k in ("name", "province", "lat", "lng", "is_food", "hidden"):
            continue  # required fields can't be cleared
        new[k] = v
    if "province" in new:
        ref = await db.places.find_one({"province": new["province"]}, {"province_en": 1})
        if not ref:
            raise APIError(422, "validation_error", "ไม่รู้จักจังหวัดนี้", [{"field": "province", "message": "เลือกจังหวัดจากรายการ"}])
        new["province_en"] = ref.get("province_en")

    changes = {k: {"old": d.get(k) if k != "hidden" else bool(d.get("hidden")), "new": v}
               for k, v in new.items() if (d.get(k) if k != "hidden" else bool(d.get("hidden"))) != v}
    if hidden_reason is not None and new.get("hidden", d.get("hidden")):
        if hidden_reason != d.get("hidden_reason"):
            changes["hidden_reason"] = {"old": d.get("hidden_reason"), "new": hidden_reason}
    if not changes:
        return {**_place_admin_out(d), "changed": []}

    now = datetime.now(timezone.utc)
    patch = {k: c["new"] for k, c in changes.items()}
    if "lat" in patch or "lng" in patch:
        lat, lng = patch.get("lat", d.get("lat")), patch.get("lng", d.get("lng"))
        patch["location"] = {"type": "Point", "coordinates": [float(lng), float(lat)]}
    if patch.get("hidden") is False:
        patch["hidden_reason"] = None
    meta = {"admin_edited_at": now, "admin_edited_by": admin["_id"], "admin_edited_by_name": admin["name"]}

    await db.places.update_one({"_id": place_id}, {"$set": {**patch, **meta}})
    hotel_patch = {k: v for k, v in patch.items() if k in HOTEL_FIELDS}
    if hotel_patch and d.get("is_accommodation"):
        await db.hotels.update_one({"_id": place_id}, {"$set": hotel_patch})
    # keep the latest admin values so a CSV re-import can re-apply them
    await db.place_overrides.update_one(
        {"_id": place_id},
        {"$set": {**{f"fields.{k}": v for k, v in patch.items()}, "updated_at": now, "updated_by": admin["_id"]}},
        upsert=True,
    )

    action = "hide" if patch.get("hidden") is True else "unhide" if patch.get("hidden") is False else "edit"
    await db.admin_audit.insert_one({
        "ts": now, "action": action, "place_id": place_id, "place_name": patch.get("name", d.get("name")),
        "admin_id": str(admin["_id"]), "admin_name": admin["name"], "changes": changes, "note": note,
    })

    rec = ml_service.recommender
    if rec is not None:
        if "hidden" in patch:
            rec.set_hidden(place_id, patch["hidden"])
        sig = {k: v for k, v in patch.items() if k in SIGNAL_FIELDS}
        if sig:
            rec.update_signals(place_id, sig)

    out = _place_admin_out(await _get_place(place_id))
    return {**out, "changed": list(changes)}


@router.get("/audit")
async def audit(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    place_id: str | None = None,
    _: dict = Depends(require_admin),
):
    db = get_db()
    f = {"place_id": place_id} if place_id else {}
    total = await db.admin_audit.count_documents(f)
    items = [jsonable(a) async for a in db.admin_audit.find(f, {"_id": 0}).sort("ts", -1).skip(offset).limit(limit)]
    return {"total": total, "items": items}


async def ensure_indexes(db) -> None:
    await db.admin_audit.create_index([("ts", -1)])
    await db.admin_audit.create_index([("place_id", 1), ("ts", -1)])
    await db.places.create_index("hidden", sparse=True)
