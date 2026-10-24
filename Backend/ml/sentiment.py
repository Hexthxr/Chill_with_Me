"""Review sentiment classifier: TF-IDF (Thai words + char n-grams) + Logistic Regression.

Labels (weak supervision from the reviewer's own star rating, Google reviews only):
    rating_5 >= 4 -> positive (1)      rating_5 <= 2 -> negative (0)      3 stars -> excluded from training
Booking.com reviews are not used for training: the dataset has only ~91 negative Booking reviews,
which made the model worse in experiments (see README > ML).

Evaluation: stratified split train 70 / validation 10 / test 20. The decision threshold is tuned on
the validation split for macro-F1; all reported scores come from the untouched test split.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split

from .text import split_tokens

RANDOM_STATE = 42


@dataclass
class SentimentModel:
    word_vec: TfidfVectorizer = field(
        default_factory=lambda: TfidfVectorizer(
            analyzer=split_tokens, min_df=2, sublinear_tf=True
        )
    )
    word_bigram_vec: TfidfVectorizer = field(
        default_factory=lambda: TfidfVectorizer(
            tokenizer=split_tokens, token_pattern=None, lowercase=False, ngram_range=(2, 2), min_df=3, sublinear_tf=True
        )
    )
    char_vec: TfidfVectorizer = field(
        default_factory=lambda: TfidfVectorizer(
            analyzer="char_wb", ngram_range=(2, 4), min_df=3, sublinear_tf=True, max_features=300_000
        )
    )
    clf: LogisticRegression = field(
        default_factory=lambda: LogisticRegression(max_iter=3000, class_weight="balanced", C=4.0)
    )
    threshold: float = 0.5

    def _features(self, cleaned: pd.Series, tokens: pd.Series, fit: bool = False):
        if fit:
            parts = [
                self.word_vec.fit_transform(tokens),
                self.word_bigram_vec.fit_transform(tokens),
                self.char_vec.fit_transform(cleaned),
            ]
        else:
            parts = [
                self.word_vec.transform(tokens),
                self.word_bigram_vec.transform(tokens),
                self.char_vec.transform(cleaned),
            ]
        return sp.hstack(parts).tocsr()

    def fit(self, cleaned: pd.Series, tokens: pd.Series, y: np.ndarray) -> "SentimentModel":
        X = self._features(cleaned, tokens, fit=True)
        self.clf.fit(X, y)
        return self

    def predict_proba(self, cleaned: pd.Series, tokens: pd.Series) -> np.ndarray:
        """Probability that each review is positive."""
        return self.clf.predict_proba(self._features(cleaned, tokens))[:, 1]

    def predict(self, cleaned: pd.Series, tokens: pd.Series) -> np.ndarray:
        return (self.predict_proba(cleaned, tokens) >= self.threshold).astype(int)

    def save(self, path) -> None:
        joblib.dump(self, path)

    @staticmethod
    def load(path) -> "SentimentModel":
        return joblib.load(path)


def make_labels(df: pd.DataFrame) -> pd.DataFrame:
    """df needs columns: source, rating_5, clean, tokens. Returns labelled Google subset."""
    g = df[(df["source"] == "google") & (df["clean"].str.len() > 0)]
    g = g[(g["rating_5"] >= 4) | (g["rating_5"] <= 2)].copy()
    g["y"] = (g["rating_5"] >= 4).astype(int)
    return g


def _scores(y_true, y_pred) -> dict:
    return {
        "f1_macro": round(float(f1_score(y_true, y_pred, average="macro")), 4),
        "f1_positive": round(float(f1_score(y_true, y_pred, pos_label=1)), 4),
        "f1_negative": round(float(f1_score(y_true, y_pred, pos_label=0)), 4),
        "precision_negative": round(float(precision_score(y_true, y_pred, pos_label=0, zero_division=0)), 4),
        "recall_negative": round(float(recall_score(y_true, y_pred, pos_label=0, zero_division=0)), 4),
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
    }


def train_and_evaluate(labelled: pd.DataFrame) -> tuple[SentimentModel, dict]:
    train_val, test = train_test_split(
        labelled, test_size=0.20, random_state=RANDOM_STATE, stratify=labelled["y"]
    )
    train, val = train_test_split(
        train_val, test_size=0.125, random_state=RANDOM_STATE, stratify=train_val["y"]
    )  # 0.125 * 0.8 = 10%

    model = SentimentModel().fit(train["clean"], train["tokens"], train["y"].values)

    # Tune threshold on validation only.
    val_p = model.predict_proba(val["clean"], val["tokens"])
    grid = np.round(np.arange(0.20, 0.81, 0.025), 3)
    val_f1 = [(f1_score(val["y"], (val_p >= t).astype(int), average="macro"), t) for t in grid]
    best_f1, best_t = max(val_f1)
    model.threshold = float(best_t)

    test_p = model.predict_proba(test["clean"], test["tokens"])
    test_pred = (test_p >= model.threshold).astype(int)
    test_pred_05 = (test_p >= 0.5).astype(int)

    baseline = DummyClassifier(strategy="stratified", random_state=RANDOM_STATE).fit(train[["y"]], train["y"])
    base_pred = baseline.predict(test[["y"]])

    metrics = {
        "model": "TF-IDF (PyThaiNLP newmm word uni+bigram + char_wb 2-4) + LogisticRegression(C=4, class_weight=balanced)",
        "labeling": "Google reviews: rating>=4 positive, rating<=2 negative, 3-star excluded",
        "n_labelled": int(len(labelled)),
        "class_counts": {"positive": int(labelled["y"].sum()), "negative": int((1 - labelled["y"]).sum())},
        "split": {"train": int(len(train)), "validation": int(len(val)), "test": int(len(test))},
        "threshold": model.threshold,
        "validation_f1_macro_at_threshold": round(float(best_f1), 4),
        "test": _scores(test["y"], test_pred),
        "test_at_threshold_0_5": _scores(test["y"], test_pred_05),
        "baseline_stratified_random_test": _scores(test["y"], base_pred),
        "confusion_matrix_test": {
            "labels": ["negative", "positive"],
            "matrix": confusion_matrix(test["y"], test_pred, labels=[0, 1]).tolist(),
        },
        "classification_report_test": classification_report(
            test["y"], test_pred, target_names=["negative", "positive"], output_dict=True
        ),
        "feature_count": int(
            len(model.word_vec.vocabulary_) + len(model.word_bigram_vec.vocabulary_) + len(model.char_vec.vocabulary_)
        ),
    }
    # Refit on train+val with the chosen threshold for production use (test stays held out of reporting).
    final = SentimentModel(threshold=model.threshold).fit(
        train_val["clean"], train_val["tokens"], train_val["y"].values
    )
    return final, metrics


def top_terms(model: SentimentModel, k: int = 25) -> dict:
    """Most indicative word features for each class (for explainability in README / API)."""
    n_w = len(model.word_vec.vocabulary_)
    n_b = len(model.word_bigram_vec.vocabulary_)
    coefs = model.clf.coef_[0]
    names = np.concatenate([
        model.word_vec.get_feature_names_out(),
        model.word_bigram_vec.get_feature_names_out(),
    ])
    word_coefs = coefs[: n_w + n_b]
    order = np.argsort(word_coefs)
    return {
        "negative": [str(names[i]) for i in order[:k]],
        "positive": [str(names[i]) for i in order[::-1][:k]],
    }
