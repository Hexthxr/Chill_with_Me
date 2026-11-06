"""Content-based recommender (ML part only – route optimisation lives in app/services/route_optimizer.py).

Place profile  = name + primary_type + Google types (Thai labels) + tokens of the place's own reviews.
Vector space   = TF-IDF over those profiles (L2-normalised), so cosine similarity = dot product.
User profile   = TF-IDF vector of selected interest seed documents and/or free-text query.

Final score combines (all in [0, 1]):
    content     cosine(user profile, place profile), normalised by the best candidate
    type_match  place type is a strong indicator of a selected interest
    quality     Bayesian-smoothed Google rating
    sentiment   Bayesian-smoothed mean P(positive) from the ML sentiment model
    popularity  log(rating_count) scaled
    distance    exp(-d / (radius/2))   (location mode only)
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

from app.constants import TYPE_LABELS_TH

from .aspects import ASPECTS
from .interests import INTERESTS, interest_type_match
from .text import split_tokens, tokenize_join

WEIGHTS_INTEREST = {"content": 0.35, "type_match": 0.10, "quality": 0.20, "sentiment": 0.20, "popularity": 0.15}
DISTANCE_WEIGHT = 0.35  # location mode: final = (1-w)*base + w*distance_score
DIVERSITY_PENALTY = 0.03  # per repeat of the same specific primary_type in the result list
GENERIC_TYPES = {"สถานที่ท่องเที่ยว", None}


# ---------------------------------------------------------------- build (offline, scripts/build_ml.py)
def place_profile_text(place: dict, review_tokens: str) -> str:
    name = tokenize_join(place.get("name"))
    ptype = tokenize_join(place.get("primary_type"))
    type_labels = " ".join(tokenize_join(TYPE_LABELS_TH[t]) for t in place.get("types", []) if t in TYPE_LABELS_TH)
    # Repeat the structured fields so they weigh more than long review text.
    return " ".join([name, name, ptype, ptype, ptype, type_labels, type_labels, review_tokens])


def interest_query_text(key: str) -> str:
    spec = INTERESTS[key]
    parts = [tokenize_join(k) for k in spec["keywords"]]
    parts += [tokenize_join(p) for p in spec["primary_types"]]
    parts += [tokenize_join(TYPE_LABELS_TH[t]) for t in spec["types"] if t in TYPE_LABELS_TH]
    return " ".join(parts)


def build_content_model(place_ids: list[str], profiles: list[str]) -> dict:
    vec = TfidfVectorizer(analyzer=split_tokens, min_df=2, max_df=0.4, sublinear_tf=True)
    X = normalize(vec.fit_transform(profiles)).astype(np.float32).tocsr()
    interest_vecs = {
        k: normalize(vec.transform([interest_query_text(k)])).astype(np.float32).tocsr() for k in INTERESTS
    }
    return {"vectorizer": vec, "matrix": X, "place_ids": place_ids, "interest_vectors": interest_vecs}


def save_content_model(model: dict, path) -> None:
    joblib.dump(model, path, compress=3)


# ---------------------------------------------------------------- runtime
def haversine_km(lat1, lng1, lat2, lng2):
    lat1, lng1, lat2, lng2 = map(np.radians, (lat1, lng1, lat2, lng2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lng2 - lng1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(a))


@dataclass
class Scored:
    place_id: str
    score: float
    components: dict
    reasons: list[str]
    distance_km: float | None = None


class Recommender:
    """Holds the TF-IDF matrix (from artifacts) + per-place signals (from MongoDB places.ml)."""

    def __init__(self, content_model: dict, signals: pd.DataFrame):
        self.vec: TfidfVectorizer = content_model["vectorizer"]
        self.X: sp.csr_matrix = content_model["matrix"]
        self.place_ids: list[str] = content_model["place_ids"]
        self.interest_vecs: dict = content_model["interest_vectors"]
        self.feature_names = self.vec.get_feature_names_out()
        self.index = {pid: i for i, pid in enumerate(self.place_ids)}
        # align signals to matrix row order
        self.sig = signals.set_index("place_id").reindex(self.place_ids)
        self.sig["is_accommodation"] = self.sig["is_accommodation"].fillna(False).astype(bool)
        hidden = self.sig["hidden"].fillna(False).astype(bool) if "hidden" in self.sig else False
        # present = has data in MongoDB and not hidden by an admin -> the only places rank()/similar() return
        self.sig["present"] = self.sig["name"].notna() & ~hidden

    # ---- live updates from the admin panel (no retraining needed)
    def set_hidden(self, place_id: str, hidden: bool) -> None:
        i = self.index.get(place_id)
        if i is None:
            return
        col = self.sig.columns.get_loc("present")
        self.sig.iat[i, col] = bool(not hidden and pd.notna(self.sig.iat[i, self.sig.columns.get_loc("name")]))

    def update_signals(self, place_id: str, fields: dict) -> None:
        """Copy edited plain fields (name, province, primary_type, ...) into the in-memory signals."""
        i = self.index.get(place_id)
        if i is None:
            return
        for k, v in fields.items():
            if k in self.sig.columns:
                self.sig.iat[i, self.sig.columns.get_loc(k)] = v

    @classmethod
    def load(cls, artifact_path, signals: pd.DataFrame) -> "Recommender":
        return cls(joblib.load(artifact_path), signals)

    # ---- query vectors
    def query_vector(self, interests: list[str], q: str | None):
        vecs = [self.interest_vecs[i] for i in interests if i in self.interest_vecs]
        if q and q.strip():
            qv = self.vec.transform([tokenize_join(q)])
            if qv.nnz:
                vecs.append(normalize(qv).astype(np.float32) * 1.5)  # explicit text query weighs more
        if not vecs:
            return None
        v = vecs[0]
        for other in vecs[1:]:
            v = v + other
        return normalize(v).tocsr()

    def _matched_terms(self, row_idx: int, qv, k: int = 3) -> list[str]:
        row = self.X.getrow(row_idx)
        prod = row.multiply(qv)
        if prod.nnz == 0:
            return []
        prod = prod.tocoo()
        order = np.argsort(prod.data)[::-1][:k]
        return [str(self.feature_names[prod.col[i]]) for i in order]

    # ---- main entry
    def rank(
        self,
        interests: list[str],
        q: str | None = None,
        candidate_ids: list[str] | None = None,
        distances_km: dict[str, float] | None = None,
        radius_km: float | None = None,
        province: str | None = None,
        min_rating: float | None = None,
        include_accommodation: bool = False,
        only_accommodation: bool = False,
        limit: int = 20,
        offset: int = 0,
        query_vector=None,
        exclude_ids: set[str] | None = None,
    ) -> tuple[list[Scored], int]:
        """query_vector: a ready user-profile vector (personal recommendations) instead of interests/q.
        exclude_ids: places never to return (e.g. ones the user has already seen)."""
        s = self.sig
        mask = s["present"].values.copy()
        if exclude_ids:
            for pid in exclude_ids:
                i = self.index.get(pid)
                if i is not None:
                    mask[i] = False
        if candidate_ids is not None:
            cand = np.zeros(len(s), dtype=bool)
            for pid in candidate_ids:
                i = self.index.get(pid)
                if i is not None:
                    cand[i] = True
            mask &= cand
        if only_accommodation:
            mask &= s["is_accommodation"].values
        elif not include_accommodation:
            mask &= ~s["is_accommodation"].values
        if province:
            mask &= (s["province"].values == province) | (s["province_en"].values == province)
        if min_rating:
            mask &= np.nan_to_num(s["rating"].values.astype(float), nan=0.0) >= min_rating

        idx = np.flatnonzero(mask)
        total = int(len(idx))
        if total == 0:
            return [], 0

        qv = query_vector if query_vector is not None else self.query_vector(interests, q)
        comp: dict[str, np.ndarray] = {
            "quality": s["quality_score"].values[idx].astype(float),
            "sentiment": s["sentiment_score"].values[idx].astype(float),
            "popularity": s["popularity_score"].values[idx].astype(float),
        }
        weights = dict(WEIGHTS_INTEREST)
        if qv is not None:
            sims = np.asarray((self.X[idx] @ qv.T).todense()).ravel()
            top = sims.max()
            comp["content"] = sims / top if top > 0 else sims
        else:
            weights.pop("content")
        if interests:
            ptypes = s["primary_type"].values
            types = s["types"].values
            comp["type_match"] = np.array(
                [
                    1.0 if any(interest_type_match(it, ptypes[i], types[i] or []) for it in interests if it in INTERESTS) else 0.0
                    for i in idx
                ]
            )
        else:
            weights.pop("type_match")
        wsum = sum(weights.values())
        base = sum(weights[k] / wsum * np.nan_to_num(comp[k], nan=0.0) for k in weights)

        dist_arr = None
        if distances_km is not None and radius_km:
            dist_arr = np.array([distances_km.get(self.place_ids[i], np.nan) for i in idx], dtype=float)
            comp["distance"] = np.exp(-np.nan_to_num(dist_arr, nan=radius_km * 3) / (radius_km / 2))
            final = (1 - DISTANCE_WEIGHT) * base + DISTANCE_WEIGHT * comp["distance"]
        else:
            final = base

        order = self._diversify(idx, final, offset + limit)[offset : offset + limit]
        out: list[Scored] = []
        for j in order:
            i = idx[j]
            components = {k: round(float(np.nan_to_num(v[j])), 4) for k, v in comp.items()}
            d = None if dist_arr is None or np.isnan(dist_arr[j]) else float(dist_arr[j])
            out.append(
                Scored(
                    place_id=self.place_ids[i],
                    score=round(float(final[j]), 4),
                    components=components,
                    reasons=self._reasons(i, interests, q, qv, components, d),
                    distance_km=None if d is None else round(d, 2),
                )
            )
        return out, total

    def _diversify(self, idx: np.ndarray, final: np.ndarray, n: int) -> np.ndarray:
        """Greedy re-rank so one primary_type does not fill the whole list.
        Each repeat of an already-picked specific type costs DIVERSITY_PENALTY (deterministic -> stable paging)."""
        pool = np.argsort(-final, kind="stable")[: max(n * 4, 50)]
        ptypes = self.sig["primary_type"].values
        counts: dict = {}
        chosen: list[int] = []
        remaining = list(pool)
        while remaining and len(chosen) < n:
            best_j, best_v = None, -1e9
            for j in remaining:
                t = ptypes[idx[j]]
                pen = DIVERSITY_PENALTY * counts.get(t, 0) if t and t not in GENERIC_TYPES else 0.0
                v = final[j] - pen
                if v > best_v:
                    best_j, best_v = j, v
            chosen.append(best_j)
            remaining.remove(best_j)
            t = ptypes[idx[best_j]]
            counts[t] = counts.get(t, 0) + 1
        rest = [j for j in np.argsort(-final, kind="stable") if j not in set(chosen)] if len(chosen) < n else []
        return np.array(chosen + rest[: n - len(chosen)], dtype=int)

    # ---- personalisation (behaviour-based, still content-based filtering)
    def profile_vector(self, weights: dict[str, float], interests: list[str] | None = None, interest_share: float = 0.3):
        """User profile = weighted average of the TF-IDF vectors of places the user interacted with,
        blended with their declared interests. Returns an L2-normalised row vector or None."""
        rows, w = [], []
        for pid, wt in weights.items():
            i = self.index.get(pid)
            if i is not None and wt > 0:
                rows.append(i)
                w.append(wt)
        hist = None
        if rows:
            hist = sp.csr_matrix(np.asarray(w, dtype=np.float32)) @ self.X[rows]
            hist = normalize(hist)
        inter = self.query_vector(interests or [], None)
        if hist is None:
            return inter
        if inter is None:
            return hist.tocsr()
        return normalize((1 - interest_share) * hist + interest_share * inter).tocsr()

    def nearest_seed(self, place_id: str, seed_ids: list[str]) -> tuple[str | None, float]:
        """Which seen place is most similar to place_id (to explain 'because you viewed X')."""
        i = self.index.get(place_id)
        idx = [self.index[s] for s in seed_ids if s in self.index]
        if i is None or not idx:
            return None, 0.0
        sims = np.asarray((self.X[idx] @ self.X.getrow(i).T).todense()).ravel()
        j = int(np.argmax(sims))
        return self.place_ids[idx[j]], float(sims[j])

    def similar(self, place_id: str, limit: int = 8, include_accommodation: bool = False,
                exclude_ids: set[str] | None = None) -> list[tuple[str, float]]:
        i = self.index.get(place_id)
        if i is None:
            return []
        sims = np.asarray((self.X @ self.X.getrow(i).T).todense()).ravel()
        sims[i] = -1
        sims[~self.sig["present"].values] = -1  # hidden / missing places
        for pid in exclude_ids or ():
            j = self.index.get(pid)
            if j is not None:
                sims[j] = -1
        if not include_accommodation:
            sims[self.sig["is_accommodation"].values] = -1
        order = np.argsort(-sims)[:limit]
        return [(self.place_ids[j], round(float(sims[j]), 4)) for j in order if sims[j] > 0]

    # ---- explanations (built only from real signals)
    def _reasons(self, i, interests, q, qv, comp, distance_km) -> list[str]:
        row = self.sig.iloc[i]
        reasons: list[str] = []
        if qv is not None and comp.get("content", 0) > 0.05:
            terms = self._matched_terms(i, qv)
            labels = [INTERESTS[x]["label"] for x in interests if x in INTERESTS]
            target = ", ".join(labels) if labels else f"“{q}”"
            if q and labels:
                target += f" และ “{q}”"
            msg = f"เนื้อหาตรงกับ {target}" if (labels or q) else "เนื้อหาตรงกับสิ่งที่คุณสนใจและเคยดู"
            if terms:
                msg += f" (คำเด่น: {', '.join(terms)})"
            reasons.append(msg)
        if comp.get("type_match"):
            reasons.append(f"ประเภท “{row['primary_type'] or 'สถานที่'}” ตรงกับหมวดที่เลือก")
        n = int(row.get("sent_n") or 0)
        if n >= 3 and not math.isnan(row.get("sent_pos_share") or float("nan")):
            reasons.append(f"ML วิเคราะห์ {n:,} รีวิว พบเชิงบวก {row['sent_pos_share'] * 100:.0f}%")
        elif n == 0:
            reasons.append("ยังไม่มีข้อความรีวิวให้ ML วิเคราะห์ (ใช้ค่ากลางในการจัดอันดับ)")
        rating, cnt = row.get("rating"), row.get("rating_count")
        if rating and not (isinstance(rating, float) and math.isnan(rating)):
            reasons.append(f"คะแนน Google {rating:.1f} จาก {int(cnt or 0):,} รีวิว")
        best = row.get("best_aspect")
        if isinstance(best, str) and best in ASPECTS:
            reasons.append(f"รีวิวส่วนใหญ่ชมเรื่อง{ASPECTS[best]['label']}")
        if distance_km is not None:
            reasons.append(f"ห่างจากจุดเริ่มต้น {distance_km:.1f} กม. (ระยะเส้นตรง)")
        return reasons
