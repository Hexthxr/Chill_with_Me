from __future__ import annotations

from fastapi import APIRouter

from ml.interests import INTERESTS

from ..db import get_db
from ..services.ml_service import ml_service
from ..services.routing import RoutingService

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
async def health():
    db = get_db()
    await db.command("ping")
    return {
        "status": "ok",
        "mongo": "ok",
        "ml_ready": ml_service.ready,
        "ml_error": ml_service.error,
        "routing": RoutingService().status(),
    }


@router.get("/meta/stats")
async def stats():
    db = get_db()
    return {
        "places": await db.places.estimated_document_count(),
        "provinces": len(await db.places.distinct("province")),
        "reviews_total": await db.reviews.estimated_document_count(),
        "reviews_linked": await db.reviews.count_documents({"linked": True}),
        "reviews_analyzed": await db.reviews.count_documents({"sentiment": {"$exists": True}}),
        "hotels": await db.hotels.estimated_document_count(),
        "hotels_with_price": await db.hotels.count_documents({"price_usd_min": {"$ne": None}}),
    }


@router.get("/meta/provinces")
async def provinces():
    db = get_db()
    rows = await (await db.places.aggregate([
        {"$group": {"_id": {"th": "$province", "en": "$province_en"}, "count": {"$sum": 1}}},
        {"$sort": {"_id.th": 1}},
    ])).to_list(None)
    return [{"province": r["_id"]["th"], "province_en": r["_id"]["en"], "count": r["count"]} for r in rows]


@router.get("/meta/interests")
async def interests():
    return [{"key": k, "label": v["label"], "emoji": v["emoji"]} for k, v in INTERESTS.items()]


@router.get("/meta/ml")
async def ml_info():
    m = ml_service.metrics or {}
    return {
        "ready": ml_service.ready,
        "error": ml_service.error,
        "sentiment": {k: m.get(k) for k in (
            "model", "labeling", "n_labelled", "class_counts", "split", "threshold", "test",
            "test_at_threshold_0_5", "baseline_stratified_random_test", "confusion_matrix_test", "indicative_terms",
            "cleaning",
        )} if m else None,
        "recommender": m.get("recommender"),
        "built_at": m.get("built_at"),
    }


@router.get("/routing/status")
async def routing_status():
    return RoutingService().status()
