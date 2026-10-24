"""Mongo document -> API JSON helpers."""
from __future__ import annotations

from datetime import datetime

from ml.interests import INTERESTS

CARD_PROJECTION = {
    "name": 1, "category": 1, "primary_type": 1, "types": 1, "province": 1, "province_en": 1, "district": 1,
    "address": 1, "lat": 1, "lng": 1, "rating": 1, "rating_count": 1, "google_maps_url": 1,
    "is_accommodation": 1, "is_food": 1, "has_hours": 1, "booking": 1,
    "ml.sentiment_score": 1, "ml.sentiment.n_analyzed": 1, "ml.sentiment.positive_share": 1,
    "ml.sentiment.best_aspect": 1, "ml.top_interest": 1, "ml.interest_scores": 1, "ml.quality_bayes": 1,
}


def place_card(d: dict) -> dict:
    ml = d.get("ml") or {}
    sent = ml.get("sentiment") or {}
    top = ml.get("top_interest")
    return {
        "place_id": d["_id"],
        "name": d.get("name"),
        "category": d.get("category"),
        "primary_type": d.get("primary_type"),
        "types": d.get("types") or [],
        "province": d.get("province"),
        "province_en": d.get("province_en"),
        "district": d.get("district"),
        "address": d.get("address"),
        "lat": d.get("lat"),
        "lng": d.get("lng"),
        "rating": d.get("rating"),
        "rating_count": d.get("rating_count"),
        "google_maps_url": d.get("google_maps_url"),
        "is_accommodation": d.get("is_accommodation", False),
        "is_food": d.get("is_food", False),
        "has_hours_on_google": d.get("has_hours", False),
        "booking": d.get("booking"),
        "ml": {
            "sentiment_score": ml.get("sentiment_score"),
            "positive_share": sent.get("positive_share"),
            "n_analyzed": sent.get("n_analyzed", 0),
            "best_aspect": sent.get("best_aspect"),
            "top_interest": top,
            "top_interest_label": INTERESTS[top]["label"] if top in INTERESTS else None,
            "interest_scores": ml.get("interest_scores") or {},
        },
    }


def review_out(d: dict) -> dict:
    t = d.get("review_time")
    return {
        "record_id": d["_id"],
        "source": d.get("source"),
        "rating": d.get("rating_5"),
        "text": d.get("text"),
        "author": d.get("author"),
        "review_time": t.isoformat() if isinstance(t, datetime) else t,
        "sentiment": d.get("sentiment"),
    }


def jsonable(o):
    """Recursively convert datetimes / ObjectIds for JSON."""
    from bson import ObjectId

    if isinstance(o, dict):
        return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, list):
        return [jsonable(v) for v in o]
    if isinstance(o, datetime):
        return o.isoformat()
    if isinstance(o, ObjectId):
        return str(o)
    return o
