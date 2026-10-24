from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Query, Response

from ..db import get_db
from ..errors import APIError
from ..schemas.trip import TripCreate
from ..serializers import jsonable
from ..services.planner import compute_schedule
from ..services.routing import RoutingError, RoutingService

router = APIRouter(prefix="/api/trips", tags=["trips"])


def _oid(trip_id: str) -> ObjectId:
    try:
        return ObjectId(trip_id)
    except (InvalidId, TypeError):
        raise APIError(404, "not_found", "ไม่พบทริปนี้")


def _out(d: dict) -> dict:
    d = jsonable(d)
    d["id"] = d.pop("_id")
    return d


async def _snapshot(trip: TripCreate) -> dict:
    """Schedule summary saved with the trip (recomputed whenever the trip is loaded in the planner)."""
    try:
        sched = await compute_schedule(trip, RoutingService(get_db()))
    except RoutingError:
        return {"available": False}
    return {
        "available": True,
        "totals": sched["totals"],
        "days": [{"date": d["date"], "start": d["start"], "end": d["end"], "summary": d["summary"]} for d in sched["days"]],
        "warning_counts": {
            lvl: sum(1 for w in sched["warnings"] if w["level"] == lvl) for lvl in ("error", "warning", "info")
        },
        "routing_provider": sched["routing"]["provider"],
    }


def _doc(trip: TripCreate) -> dict:
    d = trip.model_dump(mode="json")
    d["start_date"] = trip.start_date.isoformat()
    return d


@router.post("", status_code=201)
async def create_trip(trip: TripCreate):
    now = datetime.now(timezone.utc)
    doc = {**_doc(trip), "schedule_snapshot": await _snapshot(trip), "created_at": now, "updated_at": now}
    res = await get_db().trips.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _out(doc)


@router.get("")
async def list_trips(owner_key: str | None = Query(None, max_length=64), limit: int = Query(50, ge=1, le=200)):
    f = {"owner_key": owner_key} if owner_key else {}
    cur = get_db().trips.find(f, {"days": 0}).sort([("updated_at", -1)]).limit(limit)
    return {"items": [_out(d) async for d in cur]}


@router.get("/{trip_id}")
async def get_trip(trip_id: str):
    d = await get_db().trips.find_one({"_id": _oid(trip_id)})
    if not d:
        raise APIError(404, "not_found", "ไม่พบทริปนี้")
    return _out(d)


@router.put("/{trip_id}")
async def update_trip(trip_id: str, trip: TripCreate):
    oid = _oid(trip_id)
    db = get_db()
    existing = await db.trips.find_one({"_id": oid}, {"created_at": 1})
    if not existing:
        raise APIError(404, "not_found", "ไม่พบทริปนี้")
    doc = {**_doc(trip), "schedule_snapshot": await _snapshot(trip), "updated_at": datetime.now(timezone.utc),
           "created_at": existing["created_at"]}
    await db.trips.replace_one({"_id": oid}, doc)
    doc["_id"] = oid
    return _out(doc)


@router.delete("/{trip_id}", status_code=204)
async def delete_trip(trip_id: str):
    res = await get_db().trips.delete_one({"_id": _oid(trip_id)})
    if res.deleted_count == 0:
        raise APIError(404, "not_found", "ไม่พบทริปนี้")
    return Response(status_code=204)
