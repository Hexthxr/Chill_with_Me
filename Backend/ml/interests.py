"""Interest profiles used by content-based filtering.

Each interest is a small "query document": seed keywords (Thai + English, as they appear in real
reviews/types) plus place types that strongly indicate it. These are *inputs* to the TF-IDF
content model – scores are computed from the data, not hard-coded per place.
"""
from __future__ import annotations

INTERESTS: dict[str, dict] = {
    "sea": {
        "label": "ทะเล",
        "emoji": "🌊",
        "keywords": [
            "ทะเล", "ชายหาด", "หาด", "เกาะ", "ดำน้ำ", "ปะการัง", "อ่าว", "น้ำทะเล", "ริมทะเล", "คลื่น",
            "ทราย", "พระอาทิตย์ตก", "ท่าเรือ", "beach", "sea", "island", "snorkeling", "sunset",
        ],
        "types": {"beach"},
        "primary_types": {"ชายหาด", "เกาะ"},
    },
    "mountain": {
        "label": "ภูเขา",
        "emoji": "⛰️",
        "keywords": [
            "ภูเขา", "ดอย", "ยอดดอย", "ทะเลหมอก", "จุดชมวิว", "เดินป่า", "หน้าผา", "ผา", "ยอดเขา",
            "อากาศเย็น", "กางเต็นท์", "หมอก", "ขึ้นเขา", "mountain", "viewpoint", "hiking", "camping",
        ],
        "types": {"hiking_area", "scenic_spot", "observation_deck", "campground"},
        "primary_types": {"จุดชมวิว", "แหล่งเดินป่าปีนเขา", "พื้นที่ตั้งแคมป์", "ดาดฟ้าชมวิว", "ยอดเขา"},
    },
    "nature": {
        "label": "ธรรมชาติ",
        "emoji": "🌿",
        "keywords": [
            "ธรรมชาติ", "น้ำตก", "ป่า", "อุทยาน", "ต้นไม้", "ร่มรื่น", "ถ้ำ", "ลำธาร", "แม่น้ำ", "บึง",
            "ทุ่ง", "ดอกไม้", "นก", "สดชื่น", "waterfall", "nature", "forest", "cave",
        ],
        "types": {"national_park", "state_park", "botanical_garden", "garden"},
        "primary_types": {"อุทยานแห่งชาติ", "อุทยาน", "สวนพฤกษศาสตร์", "น้ำตก", "ถ้ำ"},
    },
    "cafe": {
        "label": "คาเฟ่",
        "emoji": "☕",
        "keywords": [
            "คาเฟ่", "กาแฟ", "ร้านกาแฟ", "เครื่องดื่ม", "ขนม", "เค้ก", "เบเกอรี่", "ชาไทย", "มุมถ่ายรูป",
            "นั่งชิล", "cafe", "coffee", "dessert", "bakery",
        ],
        "types": {"cafe", "coffee_shop", "bakery"},
        "primary_types": {"ร้านกาแฟ", "คาเฟ่", "ร้านเบเกอรี่"},
    },
    "culture": {
        "label": "วัฒนธรรม",
        "emoji": "🛕",
        "keywords": [
            "วัด", "พระ", "โบราณสถาน", "ประวัติศาสตร์", "พิพิธภัณฑ์", "วัฒนธรรม", "ศิลปะ", "สถาปัตยกรรม",
            "เจดีย์", "โบสถ์", "ไหว้พระ", "ศาลเจ้า", "ชุมชน", "temple", "museum", "history", "heritage",
        ],
        "types": {"buddhist_temple", "place_of_worship", "museum", "historical_landmark", "historical_place",
                  "monument", "art_gallery", "art_museum", "history_museum", "hindu_temple", "church", "mosque"},
        "primary_types": {"วัด", "พิพิธภัณฑ์", "สถานที่สำคัญทางประวัติศาสตร์", "สถานที่ประกอบพิธีกรรมทางศาสนา",
                          "อนุสรณ์สถาน", "มัสยิด", "โบสถ์", "Art museum", "ศาลเจ้า"},
    },
    "family": {
        "label": "ครอบครัว",
        "emoji": "👨‍👩‍👧",
        "keywords": [
            "ครอบครัว", "เด็ก", "สวนสัตว์", "สวนน้ำ", "สวนสนุก", "ฟาร์ม", "ให้อาหารสัตว์", "เครื่องเล่น",
            "family", "kids", "zoo",
        ],
        "types": {"zoo", "water_park", "amusement_park", "farm", "aquarium", "playground", "amusement_center"},
        "primary_types": {"สวนสัตว์", "สวนน้ำ", "สวนสนุก", "ฟาร์ม", "พิพิธภัณฑ์สัตว์น้ำ"},
    },
}


def all_seed_keywords() -> set[str]:
    return {k for spec in INTERESTS.values() for k in spec["keywords"]}


def interest_type_match(interest: str, primary_type: str | None, types: list[str]) -> bool:
    spec = INTERESTS[interest]
    return bool((primary_type and primary_type in spec["primary_types"]) or (set(types) & spec["types"]))
