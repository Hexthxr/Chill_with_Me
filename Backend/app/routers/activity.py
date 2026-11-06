"""Behaviour tracking + personal ("Netflix-style") recommendations. Logged-in users only.

Events (collection `place_events`): {user_id, place_id, action: view|trip_add, ts}
  - view      : user opened a place's detail page            weight 1
  - trip_add  : user added the place to a trip                weight 3
Weights decay with age (half-life 14 days). Events auto-expire after 180 days (TTL index).

GET /api/recommend/personal builds:
  - recent      : places the user viewed most recently
  - because     : "เพราะคุณดู X" rows = places most similar to the user's latest viewed places
  - for_you     : ranking with a user-profile vector (history + declared interests), unseen places only
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from ..db import get_db
from ..errors import APIError
from ..serializers import CARD_PROJECTION, place_card
from ..services.auth import require_user
from ..services.ml_service import ml_service

router = APIRouter(prefix="/api", tags=["activity"])

ACTION_WEIGHT = {"view": 1.0, "trip_add": 3.0}
HALF_LIFE_DAYS = 14
HISTORY_LIMIT = 300
EVENT_TTL_DAYS = 180


async def ensure_indexes(db) -> None:
    await db.place_events.create_index([("user_id", 1), ("ts", -1)])
    await db.place_events.create_index("ts", expireAfterSeconds=EVENT_TTL_DAYS * 24 * 3600)


class ActivityIn(BaseModel):
    place_id: str = Field(min_length=1, max_length=128)
    action: Literal["view", "trip_add"] = "view"


@router.post("/activity", status_code=204)
async def log_activity(body: ActivityIn, user: dict = Depends(require_user)):
    db = get_db()
    if not await db.places.find_one({"_id": body.place_id, "hidden": {"$ne": True}}, {"_id": 1}):
        raise APIError(404, "not_found", "ไม่พบสถานที่นี้")
    now = datetime.now(timezone.utc)
    # collapse repeated views of the same place within 30 minutes (page refreshes) - single atomic upsert
    if body.action == "view":
        await db.place_events.update_one(
            {"user_id": user["_id"], "place_id": body.place_id, "action": "view",
             "ts": {"$gte": now - timedelta(minutes=30)}},
            {"$set": {"ts": now}},
            upsert=True,
        )
        return Response(status_code=204)
    await db.place_events.insert_one({"user_id": user["_id"], "place_id": body.place_id, "action": body.action, "ts": now})
    return Response(status_code=204)


@router.get("/activity/summary")
async def activity_summary(user: dict = Depends(require_user)):
    db = get_db()
    return {
        "events": await db.place_events.count_documents({"user_id": user["_id"]}),
        "places": len(await db.place_events.distinct("place_id", {"user_id": user["_id"]})),
        "retention_days": EVENT_TTL_DAYS,
    }


@router.delete("/activity", status_code=204)
async def clear_activity(user: dict = Depends(require_user)):
    await get_db().place_events.delete_many({"user_id": user["_id"]})
    return Response(status_code=204)


async def _history(user_id) -> tuple[list[str], dict[str, float], set[str]]:
    """Returns (recently viewed place ids, newest first), decayed weights per place, all seen ids."""
    now = datetime.now(timezone.utc)
    events = await get_db().place_events.find({"user_id": user_id}).sort("ts", -1).limit(HISTORY_LIMIT).to_list(None)
    recent: list[str] = []
    weights: dict[str, float] = {}
    for e in events:
        ts = e["ts"] if e["ts"].tzinfo else e["ts"].replace(tzinfo=timezone.utc)
        age_days = max(0.0, (now - ts).total_seconds() / 86400)
        w = ACTION_WEIGHT.get(e["action"], 1.0) * math.pow(0.5, age_days / HALF_LIFE_DAYS)
        weights[e["place_id"]] = weights.get(e["place_id"], 0.0) + w
        if e["place_id"] not in recent:
            recent.append(e["place_id"])
    return recent, weights, set(weights)


async def _cards(ids: list[str]) -> dict[str, dict]:
    return {d["_id"]: place_card(d) async for d in get_db().places.find({"_id": {"$in": ids}, "hidden": {"$ne": True}}, CARD_PROJECTION)}


@router.get("/recommend/personal")
async def personal(
    limit: int = Query(12, ge=1, le=30),
    because_rows: int = Query(2, ge=0, le=4),
    user: dict = Depends(require_user),
):
    if not ml_service.ready:
        raise APIError(503, "ml_not_ready", ml_service.error or "ML ยังไม่พร้อม")
    rec = ml_service.recommender
    recent, weights, seen = await _history(user["_id"])
    interests = user.get("interests", [])

    # ---- for you: profile = history (70%) + declared interests (30%); never re-recommend seen places
    qv = rec.profile_vector(weights, interests)
    for_you, basis = [], "popular"
    if qv is not None:
        basis = "history+interests" if weights and interests else ("history" if weights else "interests")
        results, _ = rec.rank(interests=interests if not weights else [], query_vector=qv,
                              exclude_ids=seen, limit=limit)
        seed_pool = recent[:20]
        cards = await _cards([r.place_id for r in results] + seed_pool)
        for r in results:
            if r.place_id not in cards:
                continue
            reasons = list(r.reasons)
            if seed_pool:
                sid, sim = rec.nearest_seed(r.place_id, seed_pool)
                if sid and sim > 0.15 and sid in cards:
                    reasons.insert(0, f"คล้ายกับ “{cards[sid]['name']}” ที่คุณเคยดู")
            for_you.append({**cards[r.place_id], "score": r.score, "reasons": reasons})
    else:  # brand-new user with no interests and no history
        results, _ = rec.rank(interests=[], limit=limit)
        cards = await _cards([r.place_id for r in results])
        for_you = [{**cards[r.place_id], "score": r.score, "reasons": r.reasons} for r in results if r.place_id in cards]

    # ---- because you viewed X (latest distinct seeds that have similar places)
    because = []
    for seed in recent[: because_rows * 2]:
        if len(because) >= because_rows:
            break
        sims = rec.similar(seed, limit=8, exclude_ids=seen)
        if len(sims) < 3:
            continue
        cards = await _cards([seed] + [pid for pid, _ in sims])
        if seed not in cards:
            continue
        because.append({
            "seed": cards[seed],
            "items": [{**cards[pid], "similarity": s} for pid, s in sims if pid in cards],
        })

    recent_cards = await _cards(recent[:12])
    return {
        "basis": basis,
        "history_places": len(seen),
        "recent": [recent_cards[p] for p in recent[:12] if p in recent_cards],
        "because": because,
        "for_you": for_you,
        "explain": "แนะนำจากสถานที่ที่คุณเคยเปิดดูและเพิ่มลงทริป (เพิ่มลงทริปมีน้ำหนักมากกว่า, รายการเก่ามีน้ำหนักลดลง) "
                   "ร่วมกับความสนใจในบัญชี โดยใช้โมเดล Content-Based (TF-IDF) และไม่แนะนำที่ที่ดูไปแล้วซ้ำ",
    }
