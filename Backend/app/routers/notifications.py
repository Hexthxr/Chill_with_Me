"""In-app trip reminders: tell the user one day before a saved trip starts.

Reminders are derived from the trips on every request rather than stored, so moving a trip's date or
deleting it can never leave a stale reminder behind. Only "already read" is stored (collection
`notification_reads`), keyed by trip + start date, so moving a trip to a new date reminds the user again.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from ..db import get_db
from ..services.auth import require_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Thailand has no daylight saving, so a fixed offset is exact (and needs no tz database on Windows).
THAI_TZ = timezone(timedelta(hours=7))
READ_TTL_DAYS = 30


async def ensure_indexes(db) -> None:
    await db.trips.create_index([("user_id", 1), ("start_date", 1)])
    await db.notification_reads.create_index([("user_id", 1), ("key", 1)], unique=True)
    await db.notification_reads.create_index("read_at", expireAfterSeconds=READ_TTL_DAYS * 24 * 3600)


def thai_today() -> date:
    return datetime.now(THAI_TZ).date()


def _first_stop(trip: dict) -> str | None:
    for day in trip.get("days") or []:
        for block in day.get("blocks") or []:
            if block.get("name"):
                return block["name"]
    return None


def build_reminder(trip: dict, today: date, read_keys: set[str]) -> dict | None:
    """The reminder for one trip, or None unless it starts tomorrow or today.

    Today is included so that someone who didn't open the site the day before still gets told.
    """
    try:
        start = date.fromisoformat(trip["start_date"])
    except (KeyError, TypeError, ValueError):
        return None
    days_until = (start - today).days
    if days_until not in (0, 1):
        return None
    trip_id = str(trip["_id"])
    key = f"trip:{trip_id}:{trip['start_date']}"
    days = trip.get("days") or []
    start_time = (days[0].get("start_time") if days else None) or trip.get("start_time")
    return {
        "key": key,
        "kind": "trip_reminder",
        "trip_id": trip_id,
        "trip_name": trip.get("name") or "ทริปของฉัน",
        "start_date": trip["start_date"],
        "start_time": start_time,
        "days_until": days_until,
        "day_count": len(days),
        "first_stop": _first_stop(trip),
        "read": key in read_keys,
    }


async def _reminders(user_id) -> list[dict]:
    db = get_db()
    today = thai_today()
    dates = [today.isoformat(), (today + timedelta(days=1)).isoformat()]
    trips = await db.trips.find(
        {"user_id": user_id, "start_date": {"$in": dates}},
        {"name": 1, "start_date": 1, "start_time": 1, "days": 1},
    ).to_list(50)
    read_keys = {r["key"] async for r in db.notification_reads.find({"user_id": user_id}, {"key": 1})}
    items = [r for r in (build_reminder(t, today, read_keys) for t in trips) if r]
    # the trip leaving soonest first
    items.sort(key=lambda r: (r["days_until"], r["start_time"] or "", r["trip_name"]))
    return items


@router.get("")
async def list_notifications(user: dict = Depends(require_user)):
    items = await _reminders(user["_id"])
    return {"items": items, "unread": sum(1 for r in items if not r["read"])}


class ReadIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=50)


@router.post("/read", status_code=204)
async def mark_read(body: ReadIn, user: dict = Depends(require_user)):
    db = get_db()
    # only the user's current reminders can be marked, so junk keys can't pile up in the collection
    valid = {r["key"] for r in await _reminders(user["_id"])} & set(body.keys)
    now = datetime.now(timezone.utc)
    for key in valid:
        await db.notification_reads.update_one(
            {"user_id": user["_id"], "key": key},
            {"$set": {"read_at": now}},
            upsert=True,
        )
    return Response(status_code=204)
