"""Ticking an interest must return only places of that kind, not just whatever is closest."""
import numpy as np
import pandas as pd
import scipy.sparse as sp

from ml.interests import interest_match
from ml.recommender import Recommender

NEAR_OTHER, NEAR_WEAK, FAR_SEA = "near_other", "near_weak", "far_sea"
DISTANCES = {NEAR_OTHER: 1.0, NEAR_WEAK: 1.0, FAR_SEA: 100.0}
NAMES = {NEAR_OTHER: "ตึกสูงกลางเมือง", NEAR_WEAK: "หาดเล็ก", FAR_SEA: "หาดใหญ่โต Beach"}


def _recommender():
    ids = [NEAR_OTHER, NEAR_WEAK, FAR_SEA]
    # feature f1 means "sea": cosine with the sea query is the second column.
    # NEAR_OTHER's reviews mention the sea, but it is not a sea place.
    X = sp.csr_matrix(np.array([[0.6, 0.8], [0.9, 0.436], [0.6, 0.8]], dtype=np.float32))

    class Vec:
        def get_feature_names_out(self):
            return np.array(["f0", "f1"])

    sea = sp.csr_matrix(np.array([[0.0, 1.0]], dtype=np.float32))
    model = {"vectorizer": Vec(), "matrix": X, "place_ids": ids, "interest_vectors": {"sea": sea}}
    sig = pd.DataFrame([
        {"place_id": p, "name": NAMES[p].replace("หาดใหญ่โต", "ชายหาดโต"), "province": "ชลบุรี", "province_en": "x", "primary_type": "t", "types": [],
         "rating": 4.5, "rating_count": 10, "is_accommodation": False, "quality_score": 0.5, "sentiment_score": 0.5,
         "popularity_score": 0.5, "sent_n": 0, "sent_pos_share": None, "best_aspect": None}
        for p in ids
    ])
    return Recommender(model, sig)


def _rank(rec, **kw):
    results, total = rec.rank(candidate_ids=list(DISTANCES), distances_km=DISTANCES, radius_km=150, **kw)
    return [r.place_id for r in results], total


def test_interest_drops_places_that_do_not_match():
    ids, total = _rank(_recommender(), interests=["sea"])
    assert NEAR_OTHER not in ids and total == 2


def test_strong_match_far_away_beats_weak_match_nearby():
    assert _rank(_recommender(), interests=["sea"])[0][0] == FAR_SEA


def test_nothing_asked_for_still_ranks_by_distance():
    ids, total = _rank(_recommender(), interests=[])
    assert total == 3 and ids[-1] == FAR_SEA


def test_personal_query_vector_is_not_filtered():
    rec = _recommender()
    _, total = _rank(rec, interests=[], query_vector=rec.interest_vecs["sea"])
    assert total == 3


def test_admin_rename_updates_the_interest_match():
    rec = _recommender()
    rec.update_signals(NEAR_OTHER, {"name": "ชายหาดใหม่"})
    assert NEAR_OTHER in _rank(rec, interests=["sea"])[0]


def _match(interest, name, province="ชลบุรี", ptype="สถานที่ท่องเที่ยว", types=()):
    return interest_match(interest, name, province, ptype, list(types))


def test_sea_needs_a_coast():
    assert _match("sea", "หาดบางแสน")
    assert _match("sea", "Koh Larn Nual Beach")
    assert not _match("sea", "ม่อนเกาะดอย", province="เชียงใหม่")  # inland
    assert not _match("sea", "Sky Beach Cafe", province="เชียงใหม่")


def test_names_that_only_look_like_a_match():
    assert not _match("sea", "ตลาดกิมหยง หาดใหญ่", province="สงขลา")   # a city
    assert not _match("sea", "ทะเลสาบโอโซน", province="กรุงเทพมหานคร")  # a lake
    assert not _match("sea", "วัดเกาะวังไทร")
    assert not _match("culture", "ป้ายยินดีต้อนรับสู่จังหวัดชัยนาท")  # จังหวัด contains วัด
    assert not _match("mountain", "ภูเก็ต เอทีวี ทัวร์", province="ภูเก็ต")
    assert not _match("mountain", "สวนแม่หม่อน")
    assert not _match("cafe", "ตึกคิงเพาเวอร์ มหานคร", province="กรุงเทพมหานคร")


def test_type_still_counts_without_a_telling_name():
    assert _match("culture", "พระบรมมหาราชวัง", ptype="ปราสาท", types=["historical_landmark"])
    assert _match("cafe", "บ้านสวนริมน้ำ", ptype="ร้านกาแฟ")
