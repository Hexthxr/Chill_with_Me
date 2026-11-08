from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Query

from ml.aspects import ASPECTS

from ..db import get_db
from ..errors import APIError
from ..serializers import CARD_PROJECTION, place_card, review_out
from ..services import photos
from ..services.ml_service import ml_service

router = APIRouter(prefix="/api/places", tags=["places"])


@router.get("")
async def search_places(
    q: str | None = Query(None, max_length=100),
    province: str | None = None,
    kind: Literal["all", "attraction", "accommodation", "food"] = "all",
    near_lat: float | None = Query(None, ge=-90, le=90),
    near_lng: float | None = Query(None, ge=-180, le=180),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Name search / browse (used by the planner's place picker and start-point search)."""
    db = get_db()
    f: dict = {"hidden": {"$ne": True}}  # admins can hide places
    if q:
        f["name"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    if province:
        f["$or"] = [{"province": province}, {"province_en": province}]
    if kind == "attraction":
        f["is_accommodation"] = False
    elif kind == "accommodation":
        f["is_accommodation"] = True
    elif kind == "food":
        f["is_food"] = True
    if near_lat is not None and near_lng is not None:
        pipeline = [
            {"$geoNear": {"near": {"type": "Point", "coordinates": [near_lng, near_lat]}, "distanceField": "distance_m",
                          "spherical": True, "query": f, "maxDistance": 200_000}},
            {"$skip": offset}, {"$limit": limit},
        ]
        docs = await (await db.places.aggregate(pipeline)).to_list(None)
        return {"total": None, "items": [{**place_card(d), "distance_km": round(d["distance_m"] / 1000, 2)} for d in docs]}
    total = await db.places.count_documents(f)
    cur = db.places.find(f, CARD_PROJECTION).sort([("rating_count", -1)]).skip(offset).limit(limit)
    return {"total": total, "items": [place_card(d) async for d in cur]}


@router.get("/{place_id}")
async def place_detail(place_id: str):
    db = get_db()
    d = await db.places.find_one({"_id": place_id})
    if not d or d.get("hidden"):
        raise APIError(404, "not_found", "ไม่พบสถานที่นี้")
    card = place_card(d)
    ml = d.get("ml") or {}
    sent = ml.get("sentiment") or {}

    highlight_ids = sent.get("highlight_review_ids") or {}
    ids = (highlight_ids.get("positive") or []) + (highlight_ids.get("negative") or [])
    by_id = {r["_id"]: review_out(r) async for r in db.reviews.find({"_id": {"$in": ids}})}

    dist = await (await db.reviews.aggregate([
        {"$match": {"place_id": place_id}},
        {"$group": {"_id": {"$round": ["$rating_5", 0]}, "n": {"$sum": 1}}},
    ])).to_list(None)

    return {
        **card,
        "dataset_review_stats": d.get("dataset_review_stats"),
        "analysis": {
            "available": bool(sent.get("n_analyzed")),
            "n_analyzed": sent.get("n_analyzed", 0),
            "positive_share": sent.get("positive_share"),
            "mean_pos_prob": sent.get("mean_pos_prob"),
            "sentiment_score": ml.get("sentiment_score"),
            "aspects": sent.get("aspects", []),
            "best_aspect": sent.get("best_aspect"),
            "best_aspect_label": ASPECTS.get(sent.get("best_aspect") or "", {}).get("label"),
            "concerns": [{"key": k, "label": ASPECTS[k]["label"]} for k in sent.get("concern_aspects", []) if k in ASPECTS],
            "highlights": {
                "positive": [by_id[i] for i in highlight_ids.get("positive", []) if i in by_id],
                "negative": [by_id[i] for i in highlight_ids.get("negative", []) if i in by_id],
            },
            "rating_distribution": {str(int(r["_id"])): r["n"] for r in dist if r["_id"] is not None},
            "quality_bayes": ml.get("quality_bayes"),
        },
    }


@router.get("/{place_id}/photo")
async def place_photo(place_id: str):
    """A real photo with its credit, or {"photo": null} when none was found (the UI keeps its illustration)."""
    d = await get_db().places.find_one(
        {"_id": place_id}, {"name": 1, "lat": 1, "lng": 1, "is_accommodation": 1, "is_food": 1, "hidden": 1}
    )
    if not d or d.get("hidden"):
        raise APIError(404, "not_found", "ไม่พบสถานที่นี้")
    try:
        return {"photo": await photos.photo_for(d)}
    except photos.PhotoLookupError as e:
        photos.log.warning("photo lookup failed for %s: %s", place_id, e)
        return {"photo": None}


@router.get("/{place_id}/reviews")
async def place_reviews(
    place_id: str,
    sentiment: Literal["all", "positive", "negative"] = "all",
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    db = get_db()
    f: dict = {"place_id": place_id, "has_text": True}
    if sentiment != "all":
        f["sentiment.label"] = sentiment
    total = await db.reviews.count_documents(f)
    cur = db.reviews.find(f).sort([("review_time", -1)]).skip(offset).limit(limit)
    return {"total": total, "items": [review_out(r) async for r in cur]}


@router.get("/{place_id}/similar")
async def similar_places(place_id: str, limit: int = Query(8, ge=1, le=24)):
    if not ml_service.ready:
        raise APIError(503, "ml_not_ready", ml_service.error or "ML ยังไม่พร้อม")
    sims = ml_service.recommender.similar(place_id, limit=limit)
    if not sims:
        return {"items": []}
    db = get_db()
    docs = {d["_id"]: d async for d in db.places.find({"_id": {"$in": [s[0] for s in sims]}, "hidden": {"$ne": True}}, CARD_PROJECTION)}
    return {"items": [{**place_card(docs[pid]), "similarity": s} for pid, s in sims if pid in docs]}
