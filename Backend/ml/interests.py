"""Interest profiles used by content-based filtering.

Each interest is a small "query document": seed keywords (Thai + English, as they appear in real
reviews/types) plus place types that strongly indicate it. These are *inputs* to the TF-IDF
content model – scores are computed from the data, not hard-coded per place.
"""
from __future__ import annotations

import re

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


# What a place must be to count as an interest at all. Only its type and name are trusted: a review that
# mentions "sunset" or "cafe" does not make a temple or a tower a sea or cafe place.
# Most places have the generic type "สถานที่ท่องเที่ยว" (and none has a beach type), so names carry most matches.
_COASTAL_PROVINCES = frozenset(
    "ตราด จันทบุรี ระยอง ชลบุรี ฉะเชิงเทรา สมุทรปราการ กรุงเทพมหานคร สมุทรสาคร สมุทรสงคราม เพชรบุรี ประจวบคีรีขันธ์ "
    "ชุมพร สุราษฎร์ธานี นครศรีธรรมราช สงขลา ปัตตานี นราธิวาส ระนอง พังงา ภูเก็ต กระบี่ ตรัง สตูล".split()
)
_NOT_AN_ATTRACTION = r"^ป้าย|welcome sign|^ร้าน|^ตำบล|^หมู่บ้าน"
_MATCH_RULES: dict[str, dict] = {
    "sea": {
        "name": r"หาด|ทะเล|เกาะ|อ่าว|แหลม|ปะการัง|ดำน้ำ|beach|island|coral|snorkel|\bkoh?\b|\bbay\b",
        # หาดใหญ่ is a city; the others are lakes, seafood and fog ("sea of mist")
        "exclude": r"หาดใหญ่|ทะเลสาบ|ทะเลหมอก|ทะเลบัว|ทะเลน้ำจืด|ทะเลทราย|ปูทะเล|อาหารทะเล|^วัด",
        "provinces": _COASTAL_PROVINCES,
    },
    "mountain": {
        "name": r"ภูเขา|ยอดเขา|ดอย|เขา|ภู(?!เก็ต|มิ|ษิต|ริ|พาน)|ผา|(?<!ห)ม่อน|จุดชมวิว|กางเต็นท์|กางเต๊นท์|แคมป์"
                r"|mountain|viewpoint|hiking|trekking|camping|\bdoi\b|\bpeak\b",
        "exclude": r"ทะเล|หาด|เกาะ|beach|island|แม่น้ำ|^น้ำตก|^ถ้ำ|^อ่าง|^วัด|^สวน",
    },
    "nature": {
        "name": r"ธรรมชาติ|น้ำตก|ถ้ำ|อุทยาน|ป่า|ลำธาร|บึง|สวนพฤกษ|ทุ่ง(?:ดอก|นา|หญ้า|ปอ|บัว|ทาน|กังหัน|สะวัน)"
                r"|waterfall|forest|\bcave\b|national park|nature",
        "exclude": r"^วัด|ป่าตอง|พุทธอุทยาน|อุทยานประวัติศาสตร์",
    },
    "cafe": {"name": r"คาเฟ่|กาแฟ|เบเกอรี่|cafe|café|coffee|bakery"},
    "culture": {
        "name": r"(?<!จัง)วัด|พิพิธภัณฑ์|เมืองโบราณ|โบราณสถาน|โบราณคดี|ศาลเจ้า|เจดีย์|พระธาตุ|วิหาร|โบสถ์|มัสยิด|อนุสาวรีย์"
                r"|พระราชวัง|อุทยานประวัติศาสตร์|หอศิลป์|temple|museum|gallery|\bwat\b",
        "exclude": r"^ตลาด|^สวน",
    },
    "family": {
        "name": r"สวนสัตว์|สวนน้ำ|สวนสนุก|ฟาร์ม|พิพิธภัณฑ์สัตว์น้ำ|\bzoo\b|\bfarm\b|water ?park|amusement|aquarium",
        "exclude": r"ไก่ชน",
    },
}
_NAME_RE = {k: re.compile(r["name"], re.I) for k, r in _MATCH_RULES.items()}
_EXCLUDE_RE = {k: re.compile("|".join(filter(None, [_NOT_AN_ATTRACTION, r.get("exclude")])), re.I) for k, r in _MATCH_RULES.items()}


def all_seed_keywords() -> set[str]:
    return {k for spec in INTERESTS.values() for k in spec["keywords"]}


def interest_match(interest: str, name: str | None, province: str | None, primary_type: str | None, types: list[str]) -> bool:
    """True if this place really is the kind of place the interest asks for."""
    spec, rules = INTERESTS[interest], _MATCH_RULES[interest]
    name = name or ""
    if _EXCLUDE_RE[interest].search(name):
        return False
    if "provinces" in rules and province not in rules["provinces"]:
        return False
    return bool(primary_type in spec["primary_types"] or set(types) & spec["types"] or _NAME_RE[interest].search(name))
