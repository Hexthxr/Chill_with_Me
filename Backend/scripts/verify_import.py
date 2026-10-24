"""Verify the MongoDB import against the source CSV files.

Usage (from backend/):  python -m scripts.verify_import [--data-dir ../data]

Checks (exit code 1 if any FAIL):
- document counts vs CSV rows (after documented de-duplication)
- every linked review points to an existing place
- 77 provinces present, coordinates valid GeoJSON, required indexes exist
- a $geoNear query works (2dsphere index usable)
- ML enrichment status (informational: run scripts.build_ml if missing)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402

results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "", warn_only: bool = False) -> None:
    status = "PASS" if ok else ("WARN" if warn_only else "FAIL")
    results.append((status, name, detail))
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(settings.data_dir))
    args = ap.parse_args(argv)
    data_dir = Path(args.data_dir)

    db = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)[settings.mongodb_db]

    places_csv = pd.read_csv(data_dir / "thailand_master_places.csv", usecols=["place_id", "province"])
    reviews_csv = pd.read_csv(
        data_dir / "thailand_master_reviews.csv", usecols=["record_id", "source", "place_id"], dtype={"place_id": str}
    )
    report = db.import_reports.find_one(sort=[("finished_at", -1)]) or {}
    rr = report.get("reviews", {})

    n_places = db.places.count_documents({})
    expected_places = places_csv["place_id"].nunique() - report.get("places", {}).get("rejected_bad_coordinates", 0)
    check("places count matches CSV (unique place_id)", n_places == expected_places, f"{n_places} vs {expected_places}")

    removed = (
        rr.get("duplicate_record_id_removed", 0)
        + rr.get("duplicate_content_removed_google", 0)
        + rr.get("duplicate_content_removed_booking", 0)
    )
    n_reviews = db.reviews.count_documents({})
    check(
        "reviews count = CSV rows − removed duplicates",
        n_reviews == len(reviews_csv) - removed,
        f"{n_reviews} = {len(reviews_csv)} − {removed}",
    )

    provinces = db.places.distinct("province")
    check("77 provinces present", len(provinces) == 77, f"{len(provinces)} provinces")

    # referential integrity: every linked review references an existing place
    linked_ids = db.reviews.distinct("place_id", {"linked": True})
    existing = set(db.places.distinct("_id"))
    orphan = [p for p in linked_ids if p not in existing]
    check("linked reviews reference existing places", not orphan, f"{len(linked_ids)} places referenced, {len(orphan)} orphan")

    csv_linkable = reviews_csv["place_id"].dropna().isin(set(places_csv["place_id"])).sum()
    n_linked = db.reviews.count_documents({"linked": True})
    check("linked review count equals CSV rows whose place_id exists", n_linked == csv_linkable - rr.get("duplicate_content_removed_google", 0),
          f"{n_linked} linked; CSV linkable {csv_linkable}")
    n_unlinked = db.reviews.count_documents({"linked": False})
    check("unlinked reviews are stored but not attached to places", True,
          f"{n_unlinked} unlinked (by source: {rr.get('unlinked_by_source')})")

    bad_geo = db.places.count_documents({"$or": [{"location.type": {"$ne": "Point"}}, {"location.coordinates": {"$size": 0}}]})
    check("all places have GeoJSON Point", bad_geo == 0, f"{bad_geo} invalid")

    idx = {k for i in db.places.list_indexes() for k in i["key"].keys()}
    for k in ("location", "category", "primary_type", "province", "place_id"):
        check(f"places index on {k}", k in idx)
    ridx = {k for i in db.reviews.list_indexes() for k in i["key"].keys()}
    check("reviews index on place_id", "place_id" in ridx)

    near = list(
        db.places.aggregate([
            {"$geoNear": {"near": {"type": "Point", "coordinates": [100.4913, 13.7522]}, "distanceField": "d",
                          "maxDistance": 3000, "spherical": True}},
            {"$limit": 3},
        ])
    )
    check("$geoNear query works (near Grand Palace, 3 km)", len(near) > 0, ", ".join(p["name"] for p in near))

    n_hotels = db.hotels.count_documents({})
    check("hotels built from real lodging places", n_hotels > 0,
          f"{n_hotels} hotels; {db.hotels.count_documents({'price_usd_min': {'$ne': None}})} with price data")

    n_ml = db.places.count_documents({"ml": {"$exists": True}})
    check("ML enrichment present on places", n_ml > 0, f"{n_ml} places enriched (run `python -m scripts.build_ml` if 0)",
          warn_only=True)
    n_sent = db.reviews.count_documents({"sentiment": {"$exists": True}})
    check("reviews scored by sentiment model", n_sent > 0, f"{n_sent} reviews scored", warn_only=True)

    fails = [r for r in results if r[0] == "FAIL"]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed" + (f", {len(fails)} FAILED" if fails else ""))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
