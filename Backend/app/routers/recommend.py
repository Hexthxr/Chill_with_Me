from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from ml.interests import INTERESTS
from ml.recommender import DISTANCE_WEIGHT, DISTANCE_WEIGHT_QUERY, WEIGHTS_INTEREST

from ..db import get_db
from ..errors import APIError
from ..serializers import CARD_PROJECTION, place_card
from ..services.ml_service import ml_service

router = APIRouter(prefix="/api/recommend", tags=["recommend"])


@router.get("")
async def recommend(
    mode: Literal["interest", "location"] = "interest",
    interests: str | None = Query(None, description="comma-separated: " + ",".join(INTERESTS)),
    q: str | None = Query(None, max_length=100),
    province: str | None = None,
    min_rating: float | None = Query(None, ge=0, le=5),
    lat: float | None = Query(None, ge=5, le=21, description="start point latitude (location mode)"),
    lng: float | None = Query(None, ge=97, le=106, description="start point longitude (location mode)"),
    radius_km: float = Query(30, ge=1, le=300),
    include_accommodation: bool = False,
    only_accommodation: bool = False,
    limit: int = Query(20, ge=1, le=60),
    offset: int = Query(0, ge=0, le=1000),
):
    if not ml_service.ready:
        raise APIError(503, "ml_not_ready", ml_service.error or "ML ยังไม่พร้อม")

    ints = [i.strip() for i in (interests or "").split(",") if i.strip()]
    unknown = [i for i in ints if i not in INTERESTS]
    if unknown:
        raise APIError(422, "validation_error", f"ไม่รู้จักความสนใจ: {', '.join(unknown)}",
                       {"allowed": list(INTERESTS)})

    db = get_db()
    candidate_ids = distances = None
    if mode == "location":
        if lat is None or lng is None:
            raise APIError(422, "validation_error", "โหมดตามตำแหน่งต้องระบุ lat และ lng ของจุดเริ่มต้น")
        geo = await (await db.places.aggregate([
            {"$geoNear": {"near": {"type": "Point", "coordinates": [lng, lat]}, "distanceField": "d",
                          "maxDistance": radius_km * 1000, "spherical": True}},
            {"$limit": 5000},
            {"$project": {"_id": 1, "d": 1}},
        ])).to_list(None)
        candidate_ids = [g["_id"] for g in geo]
        distances = {g["_id"]: g["d"] / 1000 for g in geo}

    results, total = ml_service.recommender.rank(
        interests=ints, q=q, candidate_ids=candidate_ids, distances_km=distances,
        radius_km=radius_km if mode == "location" else None, province=province, min_rating=min_rating,
        include_accommodation=include_accommodation, only_accommodation=only_accommodation,
        limit=limit, offset=offset,
    )
    docs = {d["_id"]: d async for d in db.places.find({"_id": {"$in": [r.place_id for r in results]}, "hidden": {"$ne": True}}, CARD_PROJECTION)}
    items = [
        {**place_card(docs[r.place_id]), "score": r.score, "components": r.components, "reasons": r.reasons,
         "distance_km": r.distance_km}
        for r in results if r.place_id in docs
    ]
    return {
        "mode": mode,
        "total": total,
        "offset": offset,
        "items": items,
        "explain": {
            "method": "Content-Based Filtering (TF-IDF profile ของสถานที่ + รีวิว) ร่วมกับคะแนนรีวิวและ Sentiment จาก ML",
            "weights": WEIGHTS_INTEREST,
            "distance_weight": (DISTANCE_WEIGHT_QUERY if ints or (q and q.strip()) else DISTANCE_WEIGHT) if mode == "location" else None,
            "distance_note": "ระยะทางในหน้านี้เป็นระยะเส้นตรง (ใช้สำหรับจัดอันดับ) — เวลาเดินทางจริงคำนวณใน Trip Planner",
        },
    }
