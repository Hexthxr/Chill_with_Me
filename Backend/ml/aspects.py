"""Aspect lexicon for turning reviews into easy-to-read "key points".

An aspect is "mentioned" when a review contains one of its keywords (substring match works better
than tokens for Thai compounds such as ห้องน้ำ). Whether the mention is positive is taken from the
ML sentiment probability of that review – so aspects summarise what the model found.
"""
from __future__ import annotations

ASPECTS: dict[str, dict] = {
    "view": {"label": "วิว / ทิวทัศน์", "keywords": ["วิว", "ทิวทัศน์", "วิวสวย", "view", "scenery", "landscape"]},
    "atmosphere": {"label": "บรรยากาศ", "keywords": ["บรรยากาศ", "ร่มรื่น", "สงบ", "เงียบ", "atmosphere", "peaceful", "relax"]},
    "cleanliness": {"label": "ความสะอาด", "keywords": ["สะอาด", "สกปรก", "ขยะ", "clean", "dirty"]},
    "toilet": {"label": "ห้องน้ำ", "keywords": ["ห้องน้ำ", "ห้องสุขา", "toilet", "restroom", "bathroom"]},
    "parking": {"label": "ที่จอดรถ", "keywords": ["ที่จอดรถ", "จอดรถ", "parking"]},
    "access": {"label": "การเดินทาง", "keywords": ["การเดินทาง", "เดินทาง", "ทางเข้า", "ทางขึ้น", "ถนน", "หาง่าย", "หายาก", "access", "road"]},
    "price": {"label": "ราคา / ค่าเข้า", "keywords": ["ราคา", "ค่าเข้า", "ค่าบริการ", "แพง", "ราคาถูก", "ฟรี", "price", "expensive", "cheap", "ticket", "fee"]},
    "food": {"label": "อาหาร", "keywords": ["อาหาร", "อร่อย", "ร้านอาหาร", "กาแฟ", "food", "delicious", "restaurant"]},
    "service": {"label": "พนักงาน / บริการ", "keywords": ["พนักงาน", "เจ้าหน้าที่", "บริการ", "เจ้าของ", "staff", "service", "friendly"]},
    "crowd": {"label": "ความพลุกพล่าน", "keywords": ["คนเยอะ", "คนน้อย", "แออัด", "คิว", "crowded", "busy", "queue"]},
    "photo": {"label": "มุมถ่ายรูป", "keywords": ["ถ่ายรูป", "มุมถ่ายรูป", "photo", "instagram"]},
    "room": {"label": "ห้องพัก", "keywords": ["ห้องพัก", "เตียง", "ที่นอน", "room", "bed"]},
}


def detect_aspects(text: str | None) -> list[str]:
    if not text:
        return []
    t = text.lower()
    return [key for key, spec in ASPECTS.items() if any(k in t for k in spec["keywords"])]
