"""Train the sentiment model, score reviews and build the recommender. Run after import_csv.

Usage (from backend/):  python -m scripts.build_ml
"""
from __future__ import annotations

import sys
from pathlib import Path

from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402
from ml.pipeline import run  # noqa: E402


def main() -> None:
    db = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)[settings.mongodb_db]
    if db.places.estimated_document_count() == 0:
        raise SystemExit("No places in MongoDB. Run `python -m scripts.import_csv` first.")
    m = run(db, settings.ml_artifacts_dir)
    t = m["test"]
    print("\n===== SENTIMENT MODEL (held-out test set) =====")
    print(f"F1 macro   : {t['f1_macro']}")
    print(f"F1 positive: {t['f1_positive']}   F1 negative: {t['f1_negative']}")
    print(f"Accuracy   : {t['accuracy']}   threshold: {m['threshold']}")
    print(f"Baseline (stratified random) F1 macro: {m['baseline_stratified_random_test']['f1_macro']}")
    print(f"Confusion matrix [neg,pos]: {m['confusion_matrix_test']['matrix']}")
    print(f"Artifacts: {settings.ml_artifacts_dir}")


if __name__ == "__main__":
    main()
