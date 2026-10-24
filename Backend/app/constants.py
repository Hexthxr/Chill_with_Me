"""Shared constants derived from inspecting the real dataset (see README > Dataset findings)."""

# primary_type values (Thai, as they appear in thailand_master_places.csv) that denote lodging.
ACCOMMODATION_PRIMARY_TYPES = {
    "รีสอร์ท",
    "โรงแรม",
    "โฮมสเตย์",
    "ที่พัก",
    "ที่พักขนาดเล็ก",
    "โฮสเทล",
    "เกสต์เฮาส์",
    "บังกะโล",
    "ที่พักแบบบริการ",
    "ห้องพักให้เช่า",
    "แคมป์ปิ้งรีสอร์ท",
    "เกสท์เฮ้าส์",
    "เบด แอนด์ เบรกฟาสต์",
    "โมเต็ล",
    "กระท่อม",
    "แคมป์ปิ้ง เคบิน",
}

# Google `types` tokens that denote lodging / food (seen in the real types column)
LODGING_TYPE_TOKENS = {
    "lodging", "hotel", "resort_hotel", "inn", "hostel", "guest_house", "private_guest_room",
    "bed_and_breakfast", "cottage", "farmstay", "extended_stay_hotel", "motel", "camping_cabin",
}
FOOD_TYPE_TOKENS = {"restaurant", "cafe", "coffee_shop", "food", "thai_restaurant", "bakery", "bar", "food_court"}

# category values in the places CSV
ACCOMMODATION_CATEGORIES = {"resort", "attraction_resort"}

# Thailand bounding box (generous) used to validate coordinates on import
TH_LAT_RANGE = (5.0, 21.0)
TH_LNG_RANGE = (97.0, 106.0)

# Google "types" tokens -> Thai label (only the ones useful for display / profile text)
TYPE_LABELS_TH = {
    "tourist_attraction": "สถานที่ท่องเที่ยว",
    "park": "สวนสาธารณะ",
    "natural_feature": "ธรรมชาติ",
    "museum": "พิพิธภัณฑ์",
    "place_of_worship": "ศาสนสถาน",
    "buddhist_temple": "วัด",
    "hindu_temple": "เทวาลัย",
    "church": "โบสถ์",
    "mosque": "มัสยิด",
    "cafe": "คาเฟ่",
    "coffee_shop": "ร้านกาแฟ",
    "restaurant": "ร้านอาหาร",
    "food": "อาหาร",
    "lodging": "ที่พัก",
    "hotel": "โรงแรม",
    "resort_hotel": "รีสอร์ท",
    "campground": "ลานกางเต็นท์",
    "zoo": "สวนสัตว์",
    "aquarium": "พิพิธภัณฑ์สัตว์น้ำ",
    "amusement_park": "สวนสนุก",
    "art_gallery": "หอศิลป์",
    "beach": "ชายหาด",
    "hiking_area": "เดินป่า",
    "national_park": "อุทยานแห่งชาติ",
    "historical_landmark": "โบราณสถาน",
    "market": "ตลาด",
    "shopping_mall": "ห้างสรรพสินค้า",
    "farm": "ฟาร์ม",
    "garden": "สวน",
    "botanical_garden": "สวนพฤกษศาสตร์",
    "water_park": "สวนน้ำ",
    "observation_deck": "จุดชมวิว",
    "scenic_spot": "จุดชมวิว",
    "historical_place": "สถานที่ประวัติศาสตร์",
    "monument": "อนุสาวรีย์",
    "state_park": "วนอุทยาน",
    "nature_preserve": "เขตอนุรักษ์ธรรมชาติ",
    "wildlife_refuge": "เขตรักษาพันธุ์สัตว์ป่า",
    "city_park": "สวนสาธารณะ",
    "bridge": "สะพาน",
    "marina": "ท่าเรือ",
    "spa": "สปา",
    "art_museum": "พิพิธภัณฑ์ศิลปะ",
    "history_museum": "พิพิธภัณฑ์ประวัติศาสตร์",
    "inn": "ที่พัก",
    "hostel": "โฮสเทล",
    "guest_house": "เกสต์เฮาส์",
}
