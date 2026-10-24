"""Text cleaning + Thai/English tokenisation shared by the sentiment model and the recommender."""
from __future__ import annotations

import re
from functools import lru_cache

from .interests import all_seed_keywords

_URL = re.compile(r"https?://\S+|www\.\S+")
_REPEAT = re.compile(r"(.)\1{2,}")          # "ดีมากกกกก" -> "ดีมากก", "sooo" -> "soo"
_NON_TEXT = re.compile(r"[^฀-๿a-z0-9\s]")  # keep Thai, latin, digits
_WS = re.compile(r"\s+")
_THAI_MAI_YAMOK = "ๆ"


def clean_text(text: str | None) -> str:
    if not text:
        return ""
    t = text.lower()
    t = _URL.sub(" ", t)
    t = _REPEAT.sub(r"\1\1", t)
    t = t.replace(_THAI_MAI_YAMOK, " ")
    t = _NON_TEXT.sub(" ", t)
    return _WS.sub(" ", t).strip()


@lru_cache(maxsize=1)
def _trie():
    from pythainlp.corpus import thai_words
    from pythainlp.util import dict_trie

    extra = {
        "ที่จอดรถ", "ห้องน้ำ", "ทะเลหมอก", "จุดชมวิว", "ค่าเข้า", "คนเยอะ", "คาเฟ่", "ร้านกาแฟ",
        "น้ำตก", "ชายหาด", "ดำน้ำ", "ถ่ายรูป", "มุมถ่ายรูป", "ไหว้พระ", "โบราณสถาน", "เจ้าหน้าที่",
    }
    words = set(thai_words()) | extra | {w for w in all_seed_keywords() if re.search(r"[฀-๿]", w)}
    return dict_trie(words)


_STOP = {
    "ที่", "และ", "ก็", "มี", "เป็น", "ได้", "ไป", "มา", "ของ", "ให้", "แต่", "จะ", "กับ", "ใน", "นี้", "ว่า",
    "the", "a", "an", "and", "is", "it", "of", "to", "in", "for", "on", "was", "with", "are", "this",
}


def tokenize(text: str) -> list[str]:
    """Tokenise already-cleaned text. Thai via PyThaiNLP newmm (custom dict), latin via whitespace."""
    from pythainlp.tokenize import word_tokenize

    if not text:
        return []
    toks = word_tokenize(text, custom_dict=_trie(), engine="newmm", keep_whitespace=False)
    return [w for w in (t.strip() for t in toks) if w and w not in _STOP and not w.isdigit()]


def tokenize_join(text: str | None) -> str:
    """clean + tokenise, returned space-joined (what the TF-IDF vectorisers consume)."""
    return " ".join(tokenize(clean_text(text)))


def split_tokens(s: str) -> list[str]:
    """Analyzer helper: input is already space-joined tokens. Module-level so joblib can pickle it."""
    return s.split()
