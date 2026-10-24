"""End-to-end ML pipeline: clean reviews -> train/evaluate sentiment -> score reviews ->
aggregate per place (sentiment, aspects, highlights) -> build content model -> write to MongoDB.

Run via:  python -m scripts.build_ml
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from pymongo import UpdateOne

from .aspects import ASPECTS, detect_aspects
from .interests import INTERESTS
from .recommender import build_content_model, place_profile_text, save_content_model
from .sentiment import make_labels, top_terms, train_and_evaluate
from .text import clean_text, tokenize

SENTIMENT_FILE = "sentiment_model.joblib"
CONTENT_FILE = "content_model.joblib"
METRICS_FILE = "metrics.json"

SENTIMENT_PRIOR_M = 5      # pseudo-reviews for Bayesian smoothing of sentiment
RATING_PRIOR_M = 20        # pseudo-ratings for Bayesian smoothing of Google rating
MAX_REVIEWS_IN_PROFILE = 40


def _log(msg: str, t0: float) -> None:
    print(f"[ml {time.time() - t0:6.1f}s] {msg}", flush=True)


def _bulk(coll, ops, batch=2000):
    for i in range(0, len(ops), batch):
        coll.bulk_write(ops[i : i + batch], ordered=False)


def run(db, artifacts_dir: Path) -> dict:
    t0 = time.time()
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    # ---------------- 1. load + clean reviews (linked Google reviews with text)
    rows = list(
        db.reviews.find(
            {"source": "google", "has_text": True},
            {"_id": 1, "place_id": 1, "rating_5": 1, "text": 1, "source": 1, "linked": 1, "review_time": 1},
        )
    )
    df = pd.DataFrame(rows)
    _log(f"loaded {len(df):,} Google reviews with text", t0)
    df["clean"] = df["text"].map(clean_text)
    before = len(df)
    df = df[df["clean"].str.len() >= 2]
    # drop exact duplicate texts for the same place (spam/copies) before training & aggregation
    df = df.drop_duplicates(subset=["place_id", "clean"])
    cleaning = {"loaded": before, "after_empty_and_duplicate_removal": len(df)}
    df["tokens"] = df["clean"].map(lambda s: " ".join(tokenize(s)))
    _log(f"cleaned + tokenised {len(df):,} reviews", t0)

    # ---------------- 2. train + evaluate sentiment
    labelled = make_labels(df)
    model, metrics = train_and_evaluate(labelled)
    model.save(artifacts_dir / SENTIMENT_FILE)
    metrics["cleaning"] = cleaning
    metrics["indicative_terms"] = top_terms(model)
    _log(
        f"sentiment test F1 macro={metrics['test']['f1_macro']} "
        f"(neg F1={metrics['test']['f1_negative']}, pos F1={metrics['test']['f1_positive']}) thr={model.threshold}",
        t0,
    )

    # ---------------- 3. score all reviews
    df["pos_prob"] = model.predict_proba(df["clean"], df["tokens"])
    df["label"] = np.where(df["pos_prob"] >= model.threshold, "positive", "negative")
    ops = [
        UpdateOne(
            {"_id": int(r.rid)},
            {"$set": {"sentiment": {"label": r.label, "pos_prob": round(float(r.pos_prob), 4),
                                    "model": "tfidf_logreg_v1"}}},
        )
        for r in df[["_id", "label", "pos_prob"]].rename(columns={"_id": "rid"}).itertuples(index=False)
    ]
    _bulk(db.reviews, ops)
    _log(f"wrote sentiment for {len(ops):,} reviews", t0)

    # ---------------- 4. aggregate per place
    linked = df[df["place_id"].notna()].copy()
    linked["aspects"] = linked["text"].map(detect_aspects)
    global_mean = float(linked["pos_prob"].mean())
    agg: dict[str, dict] = {}
    for pid, g in linked.groupby("place_id", sort=False):
        n = len(g)
        probs = g["pos_prob"].values
        pos_share = float((g["label"] == "positive").mean())
        smoothed = (probs.sum() + SENTIMENT_PRIOR_M * global_mean) / (n + SENTIMENT_PRIOR_M)
        aspect_rows = []
        for key in ASPECTS:
            m = g["aspects"].map(lambda a, k=key: k in a)
            cnt = int(m.sum())
            if cnt >= 2:
                aspect_rows.append({
                    "key": key, "label": ASPECTS[key]["label"], "mentions": cnt,
                    "positive_share": round(float((g.loc[m, "label"] == "positive").mean()), 3),
                })
        aspect_rows.sort(key=lambda a: -a["mentions"])
        best = [a for a in aspect_rows if a["mentions"] >= 3 and a["positive_share"] >= 0.8]
        concern = [a for a in aspect_rows if a["mentions"] >= 2 and a["positive_share"] <= 0.5]
        g_len = g[(g["text"].str.len() >= 30) & (g["text"].str.len() <= 400)]
        pos_h = g_len.sort_values("pos_prob", ascending=False).head(3)
        neg_h = g_len[g_len["label"] == "negative"].sort_values("pos_prob").head(2)
        agg[pid] = {
            "n_analyzed": n,
            "positive_share": round(pos_share, 4),
            "mean_pos_prob": round(float(probs.mean()), 4),
            "score": round(float(smoothed), 4),
            "aspects": aspect_rows[:8],
            "best_aspect": best[0]["key"] if best else None,
            "concern_aspects": [a["key"] for a in concern[:3]],
            "highlight_review_ids": {"positive": [int(x) for x in pos_h["_id"]],
                                     "negative": [int(x) for x in neg_h["_id"]]},
        }
    _log(f"aggregated sentiment/aspects for {len(agg):,} places", t0)

    # ---------------- 5. place profiles + content model
    places = list(db.places.find({}, {"name": 1, "primary_type": 1, "types": 1, "rating": 1, "rating_count": 1}))
    rev_tokens = (
        linked.sort_values("review_time", ascending=False)
        .groupby("place_id")["tokens"]
        .apply(lambda s: " ".join(s.head(MAX_REVIEWS_IN_PROFILE)))
        .to_dict()
    )
    place_ids = [p["_id"] for p in places]
    profiles = [place_profile_text(p, rev_tokens.get(p["_id"], "")) for p in places]
    content = build_content_model(place_ids, profiles)
    save_content_model(content, artifacts_dir / CONTENT_FILE)
    _log(f"content model: {content['matrix'].shape[0]:,} places × {content['matrix'].shape[1]:,} terms", t0)

    # interest affinity per place (normalised by the 99th percentile so 1.0 ≈ top 1%)
    X = content["matrix"]
    interest_scores = {}
    for key, v in content["interest_vectors"].items():
        sims = np.asarray((X @ v.T).todense()).ravel()
        p99 = np.percentile(sims[sims > 0], 99) if (sims > 0).any() else 1.0
        interest_scores[key] = np.clip(sims / p99, 0, 1)

    # ---------------- 6. quality / popularity + write places.ml
    ratings = [(p.get("rating"), p.get("rating_count") or 0) for p in places]
    rated = [(r, c) for r, c in ratings if r is not None]
    c_mean = sum(r * c for r, c in rated) / max(1, sum(c for _, c in rated))
    max_log = math.log1p(max(c for _, c in ratings) or 1)
    ops, hotel_ops = [], []
    for i, p in enumerate(places):
        r, c = ratings[i]
        if r is None:
            quality = None
            quality_norm = 0.5  # unknown -> neutral; explained in reasons
        else:
            quality = (c * r + RATING_PRIOR_M * c_mean) / (c + RATING_PRIOR_M)
            quality_norm = min(1.0, max(0.0, (quality - 3.0) / 2.0))
        sent = agg.get(p["_id"])
        sscore = sent["score"] if sent else global_mean
        iscores = {k: round(float(v[i]), 4) for k, v in interest_scores.items()}
        top_interest = max(iscores, key=iscores.get)
        ml = {
            "quality_bayes": round(quality, 4) if quality is not None else None,
            "quality_score": round(quality_norm, 4),
            "popularity_score": round(math.log1p(c) / max_log, 4),
            "sentiment": sent or {"n_analyzed": 0, "score": round(global_mean, 4), "positive_share": None,
                                  "mean_pos_prob": None, "aspects": [], "best_aspect": None,
                                  "concern_aspects": [], "highlight_review_ids": {"positive": [], "negative": []}},
            "sentiment_score": round(float(sscore), 4),
            "interest_scores": iscores,
            "top_interest": top_interest if iscores[top_interest] >= 0.25 else None,
            "updated_at": datetime.now(timezone.utc),
        }
        ops.append(UpdateOne({"_id": p["_id"]}, {"$set": {"ml": ml}}))
        hotel_ops.append(UpdateOne({"_id": p["_id"]}, {"$set": {"ml": ml}}))
    _bulk(db.places, ops)
    # propagate to hotels collection (same _id; non-hotel ids simply match nothing)
    _bulk(db.hotels, hotel_ops)
    _log(f"wrote ml fields for {len(ops):,} places", t0)

    metrics["recommender"] = {
        "places": int(X.shape[0]),
        "vocabulary": int(X.shape[1]),
        "places_with_review_text": len(rev_tokens),
        "global_mean_pos_prob": round(global_mean, 4),
        "rating_prior_mean": round(c_mean, 4),
        "interests": {k: v["label"] for k, v in INTERESTS.items()},
    }
    metrics["built_at"] = datetime.now(timezone.utc).isoformat()
    (artifacts_dir / METRICS_FILE).write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    db.ml_runs.insert_one({**json.loads(json.dumps(metrics, ensure_ascii=False)), "created_at": datetime.now(timezone.utc)})
    _log("done", t0)
    return metrics
