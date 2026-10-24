"""Import thailand_master_places.csv / thailand_master_reviews.csv into MongoDB.

Usage (from backend/):
    python -m scripts.import_csv                 # import both files from DATA_DIR
    python -m scripts.import_csv --drop          # drop collections first (clean re-import)
    python -m scripts.import_csv --data-dir ../data

What it does
- Validates that every column the app relies on exists in the real files (fails loudly otherwise).
- Cleans: trims strings, converts NaN -> null, splits `types`, validates coordinates are inside Thailand,
  removes exact duplicate reviews, normalises review timestamps.
- Links reviews to places by `place_id` ONLY when the id exists in places (never assumed).
  Booking.com rows in the dataset carry no place_id / name / coordinates, so they are stored with
  `linked=false` and are used only for training the sentiment model.
- Builds `hotels` from lodging places (category resort or lodging types) – real rows only.
- Creates indexes (2dsphere on location, category, province, primary_type, place_id ...).
- Writes an import report to the `import_reports` collection and prints it.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from pymongo import ASCENDING, DESCENDING, GEOSPHERE, MongoClient, ReplaceOne

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.constants import (  # noqa: E402
    ACCOMMODATION_CATEGORIES,
    ACCOMMODATION_PRIMARY_TYPES,
    FOOD_TYPE_TOKENS,
    LODGING_TYPE_TOKENS,
    TH_LAT_RANGE,
    TH_LNG_RANGE,
)

PLACES_FILE = "thailand_master_places.csv"
REVIEWS_FILE = "thailand_master_reviews.csv"

REQUIRED_PLACE_COLUMNS = [
    "place_id", "place_name", "category", "primary_type", "address", "province", "district",
    "latitude", "longitude", "place_rating", "place_rating_count", "google_maps_url", "types",
    "province_en", "has_rating", "has_website", "has_phone", "has_hours", "n_reviews_in_file",
    "mean_review_rating", "share_5star", "share_1star", "n_with_text", "mean_text_len", "latest_review",
    "booking_resort_name", "booking_price_usd_min", "booking_price_usd_median", "booking_rating",
    "booking_n_reviews",
]
REQUIRED_REVIEW_COLUMNS = [
    "record_id", "source", "place_id", "review_rating_5", "review_rating_raw", "review_text",
    "review_time", "review_year", "review_month", "author", "has_text", "text_len", "has_thai",
    "text_positive", "text_negative", "review_title", "guest_type", "season", "room_nights",
    "accommodation_id", "accommodation_type", "accommodation_score", "accommodation_star_rating",
    "location_is_beach", "location_is_city_center",
]

BATCH = 2000


def clean(v):
    """NaN/NaT -> None, numpy scalars -> python, strings trimmed ('' -> None)."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def check_columns(df: pd.DataFrame, required: list[str], name: str) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise SystemExit(f"[import] {name}: missing required columns {missing}. Found: {list(df.columns)}")
    extra = [c for c in df.columns if c not in required]
    if extra:
        print(f"[import] {name}: extra columns (kept out of schema): {extra}")


def parse_time(v):
    v = clean(v)
    if v is None:
        return None
    try:
        ts = pd.to_datetime(v, utc=True).floor("us")
        return ts.to_pydatetime()
    except (ValueError, TypeError):
        return None


def build_place_docs(df: pd.DataFrame, report: dict) -> list[dict]:
    docs, bad_coords = [], 0
    for row in df.itertuples(index=False):
        r = row._asdict()
        lat, lng = clean(r["latitude"]), clean(r["longitude"])
        if (
            lat is None or lng is None
            or not (TH_LAT_RANGE[0] <= lat <= TH_LAT_RANGE[1])
            or not (TH_LNG_RANGE[0] <= lng <= TH_LNG_RANGE[1])
        ):
            bad_coords += 1
            continue
        types = [t.strip() for t in (clean(r["types"]) or "").split(",") if t.strip()]
        category = clean(r["category"])
        primary_type = clean(r["primary_type"])
        is_accommodation = (
            category in ACCOMMODATION_CATEGORIES
            or (primary_type in ACCOMMODATION_PRIMARY_TYPES)
            or any(t in LODGING_TYPE_TOKENS for t in types)
        )
        is_food = any(t in FOOD_TYPE_TOKENS for t in types) and not is_accommodation
        booking = None
        if clean(r["booking_resort_name"]):
            booking = {
                "resort_name": clean(r["booking_resort_name"]),
                "price_usd_min": clean(r["booking_price_usd_min"]),
                "price_usd_median": clean(r["booking_price_usd_median"]),
                "rating_10": clean(r["booking_rating"]),
                "n_reviews": clean(r["booking_n_reviews"]),
            }
        docs.append(
            {
                "_id": r["place_id"],
                "place_id": r["place_id"],
                "name": clean(r["place_name"]),
                "category": category,
                "primary_type": primary_type,
                "types": types,
                "address": clean(r["address"]),
                "province": clean(r["province"]),
                "province_en": clean(r["province_en"]),
                "district": clean(r["district"]),
                "location": {"type": "Point", "coordinates": [float(lng), float(lat)]},
                "lat": float(lat),
                "lng": float(lng),
                "rating": clean(r["place_rating"]),
                "rating_count": int(clean(r["place_rating_count"]) or 0) if clean(r["place_rating_count"]) else None,
                "google_maps_url": clean(r["google_maps_url"]),
                "has_website": bool(clean(r["has_website"])),
                "has_phone": bool(clean(r["has_phone"])),
                "has_hours": bool(clean(r["has_hours"])),
                "is_accommodation": bool(is_accommodation),
                "is_food": bool(is_food),
                "dataset_review_stats": {
                    "n_reviews_in_file": clean(r["n_reviews_in_file"]),
                    "mean_review_rating": clean(r["mean_review_rating"]),
                    "share_5star": clean(r["share_5star"]),
                    "share_1star": clean(r["share_1star"]),
                    "n_with_text": clean(r["n_with_text"]),
                    "mean_text_len": clean(r["mean_text_len"]),
                    "latest_review": parse_time(r["latest_review"]),
                },
                "booking": booking,
            }
        )
    report["places"]["rejected_bad_coordinates"] = bad_coords
    return docs


def build_review_docs(df: pd.DataFrame, place_ids: set[str], report: dict) -> list[dict]:
    rr = report["reviews"]
    before = len(df)
    df = df.drop_duplicates(subset=["record_id"])
    rr["duplicate_record_id_removed"] = before - len(df)

    # Exact duplicate content (same place/author/text/rating) -> keep first.
    g = df["source"] == "google"
    dup_g = df[g].duplicated(subset=["place_id", "author", "review_text", "review_rating_5"], keep="first")
    dup_b = df[~g].duplicated(
        subset=["accommodation_id", "review_text", "review_rating_raw", "review_month"], keep="first"
    )
    dup_mask = pd.concat([dup_g, dup_b]).reindex(df.index).fillna(False).astype(bool)
    rr["duplicate_content_removed_google"] = int(dup_g.sum())
    rr["duplicate_content_removed_booking"] = int(dup_b.sum())
    df = df[~dup_mask]

    docs = []
    unmatched_google = 0
    for row in df.itertuples(index=False):
        r = row._asdict()
        source = clean(r["source"])
        pid = clean(r["place_id"])
        linked = bool(pid and pid in place_ids)
        if source == "google" and pid and not linked:
            unmatched_google += 1
        text = clean(r["review_text"])
        doc = {
            "_id": int(r["record_id"]),
            "record_id": int(r["record_id"]),
            "source": source,
            "place_id": pid if linked else None,
            "raw_place_id": pid,
            "linked": linked,
            "rating_5": clean(r["review_rating_5"]),
            "rating_raw": clean(r["review_rating_raw"]),
            "text": text,
            "has_text": text is not None,
            "text_len": len(text) if text else 0,
            "has_thai": bool(clean(r["has_thai"])),
            "review_time": parse_time(r["review_time"]),
            "review_year": int(clean(r["review_year"])) if clean(r["review_year"]) else None,
            "review_month": clean(r["review_month"]),
            "author": clean(r["author"]),
        }
        if source == "booking":
            doc["booking"] = {
                "accommodation_id": clean(r["accommodation_id"]),
                "accommodation_type": clean(r["accommodation_type"]),
                "accommodation_score": clean(r["accommodation_score"]),
                "star_rating": clean(r["accommodation_star_rating"]),
                "location_is_beach": clean(r["location_is_beach"]),
                "location_is_city_center": clean(r["location_is_city_center"]),
                "text_positive": clean(r["text_positive"]),
                "text_negative": clean(r["text_negative"]),
                "title": clean(r["review_title"]),
                "guest_type": clean(r["guest_type"]),
                "season": clean(r["season"]),
                "room_nights": clean(r["room_nights"]),
            }
        docs.append(doc)
    rr["google_with_unknown_place_id"] = unmatched_google
    return docs


def bulk_upsert(coll, docs: list[dict]) -> int:
    n = 0
    for i in range(0, len(docs), BATCH):
        chunk = docs[i : i + BATCH]
        res = coll.bulk_write([ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in chunk], ordered=False)
        n += len(chunk)
    return n


def create_indexes(db) -> None:
    db.places.create_index([("location", GEOSPHERE)])
    db.places.create_index([("category", ASCENDING)])
    db.places.create_index([("primary_type", ASCENDING)])
    db.places.create_index([("province", ASCENDING)])
    db.places.create_index([("province_en", ASCENDING)])
    db.places.create_index([("is_accommodation", ASCENDING), ("rating", DESCENDING)])
    db.places.create_index([("place_id", ASCENDING)], unique=True)
    db.places.create_index([("name", ASCENDING)])

    db.reviews.create_index([("place_id", ASCENDING), ("review_time", DESCENDING)])
    db.reviews.create_index([("source", ASCENDING), ("linked", ASCENDING)])
    db.reviews.create_index([("place_id", ASCENDING), ("sentiment.label", ASCENDING)])

    db.hotels.create_index([("location", GEOSPHERE)])
    db.hotels.create_index([("province", ASCENDING)])
    db.hotels.create_index([("price_usd_min", ASCENDING)])

    db.trips.create_index([("owner_key", ASCENDING), ("updated_at", DESCENDING)])
    db.route_cache.create_index([("key", ASCENDING)], unique=True)
    db.route_cache.create_index([("created_at", ASCENDING)], expireAfterSeconds=7 * 24 * 3600)


def build_hotels(db, report: dict) -> None:
    """hotels = lodging places from the real places data (no synthetic rows)."""
    db.hotels.delete_many({})
    pipeline = [
        {"$match": {"is_accommodation": True}},
        {
            "$project": {
                "_id": "$_id",
                "place_id": "$place_id",
                "name": 1, "primary_type": 1, "types": 1, "address": 1, "province": 1, "province_en": 1,
                "district": 1, "location": 1, "lat": 1, "lng": 1, "rating": 1, "rating_count": 1,
                "google_maps_url": 1,
                "price_usd_min": "$booking.price_usd_min",
                "price_usd_median": "$booking.price_usd_median",
                "booking_rating_10": "$booking.rating_10",
                "booking_n_reviews": "$booking.n_reviews",
                "price_source": {"$cond": [{"$ifNull": ["$booking.price_usd_min", False]}, "booking_dataset", None]},
            }
        },
        {"$merge": {"into": "hotels", "whenMatched": "replace"}},
    ]
    db.places.aggregate(pipeline)
    report["hotels"] = {
        "total": db.hotels.count_documents({}),
        "with_price": db.hotels.count_documents({"price_usd_min": {"$ne": None}}),
        "with_google_rating": db.hotels.count_documents({"rating": {"$ne": None}}),
    }


def main(argv=None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=str(settings.data_dir))
    ap.add_argument("--drop", action="store_true", help="drop places/reviews/hotels before import")
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir)
    pf, rf = data_dir / PLACES_FILE, data_dir / REVIEWS_FILE
    for f in (pf, rf):
        if not f.exists():
            raise SystemExit(f"[import] file not found: {f}. Put the CSVs in {data_dir} or pass --data-dir")

    t0 = time.time()
    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    db = client[settings.mongodb_db]
    if args.drop:
        for c in ("places", "reviews", "hotels"):
            db.drop_collection(c)

    report: dict = {
        "started_at": datetime.now(timezone.utc),
        "files": {"places": str(pf), "reviews": str(rf)},
        "places": {},
        "reviews": {},
    }

    print(f"[import] reading {pf.name} ...")
    places_df = pd.read_csv(pf, low_memory=False, dtype={"place_id": str})
    check_columns(places_df, REQUIRED_PLACE_COLUMNS, PLACES_FILE)
    report["places"]["rows_in_file"] = len(places_df)
    report["places"]["duplicate_place_id_removed"] = int(places_df["place_id"].duplicated().sum())
    places_df = places_df.drop_duplicates(subset=["place_id"]).dropna(subset=["place_id"])
    report["places"]["missing_values"] = {
        k: int(v) for k, v in places_df[REQUIRED_PLACE_COLUMNS].isna().sum().items() if v
    }
    place_docs = build_place_docs(places_df, report)
    bulk_upsert(db.places, place_docs)
    report["places"]["imported"] = len(place_docs)
    report["places"]["provinces"] = len({d["province"] for d in place_docs})
    report["places"]["accommodation"] = sum(d["is_accommodation"] for d in place_docs)
    report["places"]["food"] = sum(d["is_food"] for d in place_docs)
    report["places"]["without_rating"] = sum(d["rating"] is None for d in place_docs)
    place_ids = {d["_id"] for d in place_docs}
    print(f"[import] places imported: {len(place_docs)}")

    print(f"[import] reading {rf.name} ...")
    reviews_df = pd.read_csv(rf, low_memory=False, dtype={"place_id": str})
    check_columns(reviews_df, REQUIRED_REVIEW_COLUMNS, REVIEWS_FILE)
    report["reviews"]["rows_in_file"] = len(reviews_df)
    report["reviews"]["by_source_in_file"] = {k: int(v) for k, v in reviews_df["source"].value_counts().items()}
    report["reviews"]["missing_text"] = int(reviews_df["review_text"].isna().sum())
    review_docs = build_review_docs(reviews_df, place_ids, report)
    bulk_upsert(db.reviews, review_docs)
    rr = report["reviews"]
    rr["imported"] = len(review_docs)
    rr["linked_to_place"] = sum(d["linked"] for d in review_docs)
    rr["unlinked"] = rr["imported"] - rr["linked_to_place"]
    rr["unlinked_by_source"] = {}
    for d in review_docs:
        if not d["linked"]:
            rr["unlinked_by_source"][d["source"]] = rr["unlinked_by_source"].get(d["source"], 0) + 1
    rr["linked_with_text"] = sum(d["linked"] and d["has_text"] for d in review_docs)
    rr["places_with_linked_reviews"] = len({d["place_id"] for d in review_docs if d["linked"]})
    print(f"[import] reviews imported: {len(review_docs)} (linked {rr['linked_to_place']})")

    build_hotels(db, report)
    create_indexes(db)

    report["finished_at"] = datetime.now(timezone.utc)
    report["seconds"] = round(time.time() - t0, 1)
    db.import_reports.insert_one(dict(report))
    _print_report(report)
    return report


def _print_report(report: dict) -> None:
    import json

    def default(o):
        return o.isoformat() if isinstance(o, datetime) else str(o)

    print("\n===== IMPORT REPORT =====")
    print(json.dumps({k: v for k, v in report.items() if k != "_id"}, ensure_ascii=False, indent=2, default=default))


if __name__ == "__main__":
    main()
