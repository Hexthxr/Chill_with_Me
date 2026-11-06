"""Loads the ML artifacts + per-place signals once and serves the recommender to the API layer."""
from __future__ import annotations

import json
import logging

import pandas as pd

from ml.pipeline import CONTENT_FILE, METRICS_FILE
from ml.recommender import Recommender

from ..config import settings

log = logging.getLogger("chill.ml")

SIGNAL_PROJECTION = {
    "name": 1, "province": 1, "province_en": 1, "primary_type": 1, "types": 1, "rating": 1,
    "rating_count": 1, "is_accommodation": 1, "ml.quality_score": 1, "ml.sentiment_score": 1,
    "ml.popularity_score": 1, "ml.sentiment.n_analyzed": 1, "ml.sentiment.positive_share": 1,
    "ml.sentiment.best_aspect": 1, "hidden": 1,
}


class MLService:
    def __init__(self) -> None:
        self.recommender: Recommender | None = None
        self.metrics: dict | None = None
        self.error: str | None = None

    @property
    def ready(self) -> bool:
        return self.recommender is not None

    async def load(self, db) -> None:
        artifact = settings.ml_artifacts_dir / CONTENT_FILE
        metrics_path = settings.ml_artifacts_dir / METRICS_FILE
        if not artifact.exists():
            self.error = "ยังไม่ได้สร้างโมเดล ML — รัน `python -m scripts.build_ml` หลังนำเข้าข้อมูล"
            log.warning(self.error)
            return
        rows = []
        async for d in db.places.find({"ml": {"$exists": True}}, SIGNAL_PROJECTION):
            ml = d.get("ml", {})
            sent = ml.get("sentiment", {})
            rows.append({
                "place_id": d["_id"], "name": d.get("name"), "province": d.get("province"),
                "province_en": d.get("province_en"), "primary_type": d.get("primary_type"),
                "types": d.get("types") or [], "rating": d.get("rating"), "rating_count": d.get("rating_count"),
                "is_accommodation": d.get("is_accommodation", False),
                "quality_score": ml.get("quality_score", 0.5), "sentiment_score": ml.get("sentiment_score", 0.5),
                "popularity_score": ml.get("popularity_score", 0.0), "sent_n": sent.get("n_analyzed", 0),
                "sent_pos_share": sent.get("positive_share"), "best_aspect": sent.get("best_aspect"),
                "hidden": bool(d.get("hidden", False)),
            })
        if not rows:
            self.error = "ไม่พบข้อมูล ML ในฐานข้อมูล — รัน `python -m scripts.build_ml`"
            log.warning(self.error)
            return
        self.recommender = Recommender.load(artifact, pd.DataFrame(rows))
        if metrics_path.exists():
            self.metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        self.error = None
        log.info("Recommender loaded: %d places", len(rows))


ml_service = MLService()
