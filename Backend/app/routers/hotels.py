"""Accommodation endpoints – real lodging rows only. Price data exists for very few hotels in the
dataset; responses always say how many results have a known price."""
from __future__ import annotations

import math

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..db import get_db
from ..errors import APIError

router = APIRouter(prefix="/api/hotels", tags=["hotels"])

HOTEL_PROJECTION = {
    "name": 1, "primary_type": 1, "province": 1, "district": 1, "address": 1, "lat": 1, "lng": 1, "rating": 1,
    "rating_count": 1, "google_maps_url": 1, "price_usd_min": 1, "price_usd_median": 1, "booking_rating_10": 1,
    "booking_n_reviews": 1, "price_source": 1, "ml.sentiment_score": 1, "ml.sentiment.positive_share": 1,
    "ml.sentiment.n_analyzed": 1,
}


def hotel_out(d: dict, distance_km: float | None = None) -> dict:
    ml = d.get("ml") or {}
    sent = ml.get("sentiment") or {}
    return {
        "place_id": d["_id"], "name": d.get("name"), "primary_type": d.get("primary_type"),
        "province": d.get("province"), "district": d.get("district"), "address": d.get("address"),
        "lat": d.get("lat"), "lng": d.get("lng"), "rating": d.get("rating"), "rating_count": d.get("rating_count"),
        "google_maps_url": d.get("google_maps_url"),
        "price": None if d.get("price_usd_min") is None else {
            "usd_min": d.get("price_usd_min"), "usd_median": d.get("price_usd_median"),
            "source": "Booking.com (ในชุดข้อมูล)", "booking_rating_10": d.get("booking_rating_10"),
        },
        "sentiment": {"positive_share": sent.get("positive_share"), "n_analyzed": sent.get("n_analyzed", 0)},
        "distance_km": None if distance_km is None else round(distance_km, 2),
    }


def _rank_key(h: dict):
    rating = h.get("rating") or 0
    cnt = h.get("rating_count") or 0
    bayes = (cnt * rating + 10 * 4.3) / (cnt + 10) if rating else 3.5
    return (-(bayes - 0.08 * (h.get("distance_km") or 0)),)


def _price_filter(max_price_usd: float | None, include_unpriced: bool) -> dict:
    if max_price_usd is None:
        return {}
    cond = {"price_usd_min": {"$lte": max_price_usd}}
    return {"$or": [cond, {"price_usd_min": None}]} if include_unpriced else cond


@router.get("/coverage")
async def coverage():
    db = get_db()
    total = await db.hotels.estimated_document_count()
    priced = await db.hotels.count_documents({"price_usd_min": {"$ne": None}})
    return {"total": total, "with_price": priced, "note": f"ชุดข้อมูลมีราคาที่พักเพียง {priced} แห่งจาก {total:,} แห่ง"}


@router.get("/near")
async def hotels_near(
    lat: float = Query(..., ge=5, le=21), lng: float = Query(..., ge=97, le=106),
    radius_km: float = Query(15, ge=0.5, le=100),
    max_price_usd: float | None = Query(None, gt=0), include_unpriced: bool = True,
    limit: int = Query(12, ge=1, le=50),
):
    db = get_db()
    docs = await (await db.hotels.aggregate([
        {"$geoNear": {"near": {"type": "Point", "coordinates": [lng, lat]}, "distanceField": "d",
                      "maxDistance": radius_km * 1000, "spherical": True,
                      "query": _price_filter(max_price_usd, include_unpriced)}},
        {"$limit": 300},
        {"$project": {**HOTEL_PROJECTION, "d": 1}},
    ])).to_list(None)
    items = sorted((hotel_out(d, d["d"] / 1000) for d in docs), key=_rank_key)[:limit]
    return {"items": items, "with_price": sum(1 for h in items if h["price"]), "radius_km": radius_km}


class AlongRouteRequest(BaseModel):
    points: list[list[float]] = Field(min_length=1, max_length=500, description="[[lat, lng], ...] route order")
    radius_km: float = Field(5, ge=0.5, le=50)
    max_price_usd: float | None = Field(None, gt=0)
    include_unpriced: bool = True
    limit: int = Field(12, ge=1, le=50)


def _point_segment_km(p, a, b) -> float:
    # equirectangular projection around p – accurate enough at these distances
    k = math.cos(math.radians(p[0]))
    def xy(q):
        return ((q[1] - p[1]) * 111.32 * k, (q[0] - p[0]) * 110.57)
    ax, ay = xy(a)
    bx, by = xy(b)
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(cx, cy)


@router.post("/along-route")
async def hotels_along_route(req: AlongRouteRequest):
    pts = [p for p in req.points if len(p) == 2]
    if not pts:
        raise APIError(422, "validation_error", "ต้องมีจุดพิกัดอย่างน้อย 1 จุด")
    pad_lat = req.radius_km / 110.57
    pad_lng = req.radius_km / (111.32 * math.cos(math.radians(sum(p[0] for p in pts) / len(pts))))
    box = [[min(p[1] for p in pts) - pad_lng, min(p[0] for p in pts) - pad_lat],
           [max(p[1] for p in pts) + pad_lng, max(p[0] for p in pts) + pad_lat]]
    db = get_db()
    q = {"location": {"$geoWithin": {"$box": box}}, **_price_filter(req.max_price_usd, req.include_unpriced)}
    cands = await db.hotels.find(q, HOTEL_PROJECTION).limit(5000).to_list(None)
    segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)] or [(pts[0], pts[0])]
    out = []
    for d in cands:
        p = (d["lat"], d["lng"])
        dist = min(_point_segment_km(p, a, b) for a, b in segs)
        if dist <= req.radius_km:
            out.append(hotel_out(d, dist))
    out.sort(key=_rank_key)
    items = out[: req.limit]
    return {
        "items": items, "matched": len(out), "with_price": sum(1 for h in items if h["price"]),
        "note": "ระยะห่างวัดจากเส้นเชื่อมระหว่างจุดในแผน (เส้นตรง)",
    }
