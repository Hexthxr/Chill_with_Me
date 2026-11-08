"""Photo matching rules run anywhere; the API tests need MongoDB with imported data. No test calls Wikipedia."""
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import settings
from app.services import photos
from app.services.photos import best_match, clean_credit, name_score


def _page(title, image="Photo.jpg"):
    return {"title": title, "pageimage": image, "thumbnail": {"source": f"https://img/{title}"}}


@pytest.mark.parametrize("name,title", [
    ("วัดพระศรีรัตนศาสดาราม", "วัดพระศรีรัตนศาสดาราม"),
    ("เกาะแสมสาร", "เกาะแสมสาร"),
    ("Wat Arun", "Wat Arun"),
    ("พระบรมมหาราชวัง (Grand Palace)", "พระบรมมหาราชวัง"),
])
def test_same_place_matches(name, title):
    assert best_match(name, [_page(title)])["title"] == title


@pytest.mark.parametrize("name,title", [
    ("พิพิธภัณฑ์กรุงเทพมหานคร", "กรุงเทพมหานคร"),   # the city is not the museum
    ("ตลาดน้ำอัมพวา", "อำเภออัมพวา"),                # nor the district the market
    ("หาดลูกลม (เกาะแสมสาร)", "เกาะแสมสาร"),          # nor the island the beach
    ("น้ำตกเอราวัณ", "อุทยานแห่งชาติเขาใหญ่"),
])
def test_nearby_but_different_place_does_not_match(name, title):
    assert best_match(name, [_page(title)]) is None


def test_very_short_names_never_match():
    assert name_score("วัด", "วัด") == 0


@pytest.mark.parametrize("image", ["Map of Thailand.svg", "Flag.png", None])
def test_maps_and_logos_are_not_photos(image):
    assert best_match("เกาะแสมสาร", [_page("เกาะแสมสาร", image)]) is None


def test_page_without_a_free_image_is_skipped():
    assert best_match("เกาะแสมสาร", [{"title": "เกาะแสมสาร", "pageimage": "A.jpg"}]) is None


def test_best_of_several_wins():
    assert best_match("วัดอรุณราชวราราม", [_page("วัดอรุณ"), _page("วัดอรุณราชวราราม")])["title"] == "วัดอรุณราชวราราม"


def test_clean_credit_strips_html():
    assert clean_credit('<a href="x">Jo &amp; Co</a>\n <span>(talk)</span>') == "Jo & Co (talk)"
    assert clean_credit(None) is None


def _run_get_json(handler):
    """Runs one lookup request against a fake server, without any waiting between requests."""
    import asyncio

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await photos._get_json(client, "https://wiki.test/w/api.php", {})

    return asyncio.run(go())


@pytest.fixture()
def fresh_pause(monkeypatch):
    monkeypatch.setattr(photos, "_paused_until", 0.0)
    monkeypatch.setattr(photos, "REQUEST_GAP_S", 0)


def test_busy_error_inside_http_200_is_a_failure_not_a_miss(fresh_pause):
    with pytest.raises(photos.PhotoLookupError):
        _run_get_json(lambda req: httpx.Response(200, json={"error": {"code": "cirrussearch-too-busy-error"}}))
    assert photos._paused_until > 0


def test_refusal_pauses_all_lookups(fresh_pause):
    calls = []

    def refuse(req):
        calls.append(req)
        return httpx.Response(403, text="Please respect our robot policy")

    for _ in range(3):
        with pytest.raises(photos.PhotoLookupError):
            _run_get_json(refuse)
    assert len(calls) == 1  # after the refusal we stop asking


def test_rate_limit_honours_retry_after(fresh_pause):
    with pytest.raises(photos.PhotoLookupError):
        _run_get_json(lambda req: httpx.Response(429, headers={"retry-after": "120"}))
    assert photos._paused_until - time.monotonic() > 100


def test_user_agent_identifies_the_project():
    assert "ChillWithMe" in photos.HEADERS["User-Agent"] and "http" in photos.HEADERS["User-Agent"]


def _ready() -> bool:
    try:
        db = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500)[settings.mongodb_db]
        return db.places.count_documents({}, limit=1) > 0
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _ready(), reason="MongoDB with imported data required")


@pytest.fixture()
def place_id():
    db = MongoClient(settings.mongodb_uri)[settings.mongodb_db]
    pid = db.places.find_one({"is_accommodation": False, "is_food": False, "hidden": {"$ne": True}, "lat": {"$ne": None}}, {"_id": 1})["_id"]
    saved = db.place_photos.find_one({"_id": pid})
    db.place_photos.delete_one({"_id": pid})
    yield pid
    db.place_photos.delete_one({"_id": pid})
    if saved:
        db.place_photos.insert_one(saved)


@needs_db
def test_api_finds_then_serves_from_cache(place_id, monkeypatch):
    from app.main import app

    calls = []

    async def fake(name, lat, lng):
        calls.append(name)
        return {"url": "https://img/x.jpg", "title": "T", "article_url": "u", "author": "A", "license": "CC BY-SA 4.0", "source_url": "s"}

    monkeypatch.setattr(photos, "fetch_wikipedia", fake)
    with TestClient(app) as c:
        assert c.get(f"/api/places/{place_id}/photo").json()["photo"]["license"] == "CC BY-SA 4.0"
        assert c.get(f"/api/places/{place_id}/photo").json()["photo"]["url"] == "https://img/x.jpg"
    assert len(calls) == 1


@needs_db
def test_api_caches_misses_but_not_failures(place_id, monkeypatch):
    from app.main import app

    calls = []

    async def down(name, lat, lng):
        calls.append("down")
        raise photos.PhotoLookupError("rate limited")

    async def none(name, lat, lng):
        calls.append("none")

    with TestClient(app) as c:
        monkeypatch.setattr(photos, "fetch_wikipedia", down)
        assert c.get(f"/api/places/{place_id}/photo").json() == {"photo": None}
        monkeypatch.setattr(photos, "fetch_wikipedia", none)
        assert c.get(f"/api/places/{place_id}/photo").json() == {"photo": None}
        assert c.get(f"/api/places/{place_id}/photo").json() == {"photo": None}
    assert calls == ["down", "none"]


@needs_db
def test_api_unknown_place_is_404():
    from app.main import app

    with TestClient(app) as c:
        assert c.get("/api/places/nope/photo").status_code == 404
