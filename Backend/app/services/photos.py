"""Real photos of places, from Wikipedia articles with free-licence images.

The dataset has no photos. A place only gets a photo when a Wikipedia article is both close by AND has
nearly the same name: a wrong picture is worse than none, so everything else keeps its illustration.
Lookups happen the first time a place is shown and are cached in `place_photos`, misses included.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

import httpx

from ..db import get_db

log = logging.getLogger("chill.photos")

SEARCH_RADIUS_M = 2000
MIN_NAME_SCORE = 0.8
MIN_NAME_LEN = 4  # very short names ("วัด") would match anything
FOUND_TTL = timedelta(days=180)
MISSING_TTL = timedelta(days=30)

# Wikimedia robot policy (https://w.wiki/4wJS): identify honestly with a way to reach the operator, one
# unauthenticated Action API request at a time, under 5 per second, and back off when told to.
CONTACT = os.getenv("WIKIMEDIA_CONTACT", "").strip() or "https://github.com/Hexthxr/Chill_with_Me"
HEADERS = {
    "User-Agent": f"ChillWithMe/1.0 ({CONTACT}) httpx/{httpx.__version__}",
    "Accept-Encoding": "gzip",
}
REQUEST_GAP_S = 0.4
BLOCKED_COOLDOWN_S = 3600
BUSY_COOLDOWN_S = 30

_gate = asyncio.Semaphore(1)
_paused_until = 0.0


class PhotoLookupError(Exception):
    """Wikimedia could not be asked (network, rate limit, refusal). Not cached, so it is retried later."""


def _pause(seconds: float) -> None:
    global _paused_until
    _paused_until = max(_paused_until, time.monotonic() + seconds)


async def ensure_indexes(db) -> None:
    await db.place_photos.create_index("expires_at", expireAfterSeconds=0)


def _norm(text: str | None) -> str:
    text = unicodedata.normalize("NFC", text or "").lower().replace("​", "")
    return re.sub(r"[\s\-–—_()\[\]\"'.,:/&]+", "", text)


def name_score(place_name: str, title: str) -> float:
    """How alike two names are, 0-1. A name inside another only counts if it is most of it."""
    best = 0.0
    without_brackets = re.sub(r"\(.*?\)", "", place_name or "")
    b = _norm(title)
    for variant in (place_name, without_brackets):
        a = _norm(variant)
        if min(len(a), len(b)) < MIN_NAME_LEN:
            continue
        short, long = sorted((a, b), key=len)
        if short in long and len(short) / len(long) >= 0.6:
            score = 0.8 + 0.2 * len(short) / len(long)
        else:
            score = SequenceMatcher(None, a, b).ratio()
        best = max(best, score)
    return best


def _is_photo_file(name: str | None) -> bool:
    # articles often lead with a map, flag or logo: those are svg/png, photographs are jpeg
    return bool(name) and name.lower().endswith((".jpg", ".jpeg"))


def best_match(place_name: str, pages: list[dict]) -> dict | None:
    """The article page that is really about this place and has a photo, or None."""
    scored = [
        (name_score(place_name, p.get("title", "")), i, p)
        for i, p in enumerate(pages)
        if p.get("thumbnail") and _is_photo_file(p.get("pageimage"))
    ]
    scored = [s for s in scored if s[0] >= MIN_NAME_SCORE]
    return max(scored, key=lambda s: (s[0], -s[1]))[2] if scored else None


def clean_credit(value: str | None) -> str | None:
    """Commons returns the author as HTML."""
    if not value:
        return None
    text = html.unescape(re.sub(r"<[^>]+>", " ", value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120] or None


async def _get_json(client: httpx.AsyncClient, url: str, params: dict) -> dict:
    if time.monotonic() < _paused_until:
        raise PhotoLookupError("waiting: Wikimedia asked us to back off")
    try:
        r = await client.get(url, params={"action": "query", "format": "json", **params})
        if r.status_code == 429:
            _pause(float(r.headers.get("retry-after") or 60) if (r.headers.get("retry-after") or "").isdigit() else 60)
        elif r.status_code == 403:
            log.warning("Wikimedia refused the request, pausing photo lookups for %ss: %s", BLOCKED_COOLDOWN_S, r.text[:160])
            _pause(BLOCKED_COOLDOWN_S)
        r.raise_for_status()
        data = r.json()
        if "error" in data:  # e.g. "search is too busy" arrives as HTTP 200: that is not "no photo exists"
            _pause(BUSY_COOLDOWN_S)
            raise PhotoLookupError(str(data["error"].get("code")))
        return data
    except (httpx.HTTPError, ValueError) as e:
        raise PhotoLookupError(str(e)) from e
    finally:
        await asyncio.sleep(REQUEST_GAP_S)


def _languages(name: str) -> list[str]:
    return ["th", "en"] if re.search(r"[A-Za-z]{3}", name or "") else ["th"]


async def _articles_nearby(client: httpx.AsyncClient, lang: str, lat: float, lng: float) -> list[dict]:
    data = await _get_json(client, f"https://{lang}.wikipedia.org/w/api.php", {
        "generator": "geosearch", "ggscoord": f"{lat}|{lng}", "ggsradius": SEARCH_RADIUS_M, "ggslimit": 50,
        "prop": "pageimages|info", "inprop": "url", "piprop": "thumbnail|name", "pithumbsize": 640, "pilimit": 50, "pilicense": "free",
    })
    return list((data.get("query", {}).get("pages") or {}).values())


async def _licence(client: httpx.AsyncClient, file_name: str) -> dict | None:
    """Author and licence from Commons. Without these we cannot credit the photo, so we don't use it."""
    data = await _get_json(client, "https://commons.wikimedia.org/w/api.php", {
        "titles": f"File:{file_name}", "prop": "imageinfo", "iiprop": "extmetadata|url",
        "iiextmetadatafilter": "Artist|LicenseShortName",
    })
    for page in (data.get("query", {}).get("pages") or {}).values():
        info = (page.get("imageinfo") or [None])[0]
        if not info:
            continue
        meta = info.get("extmetadata") or {}
        licence = (meta.get("LicenseShortName") or {}).get("value")
        if licence:
            return {
                "author": clean_credit((meta.get("Artist") or {}).get("value")),
                "license": clean_credit(licence),
                "source_url": info.get("descriptionurl"),
            }
    return None


async def fetch_wikipedia(name: str, lat: float, lng: float) -> dict | None:
    async with _gate, httpx.AsyncClient(headers=HEADERS, timeout=10, follow_redirects=True) as client:
        for lang in _languages(name):
            page = best_match(name, await _articles_nearby(client, lang, lat, lng))
            if not page:
                continue
            credit = await _licence(client, page["pageimage"])
            if credit:
                return {"url": page["thumbnail"]["source"], "title": page["title"], "article_url": page.get("fullurl"), **credit}
    return None


async def photo_for(place: dict) -> dict | None:
    """The cached or newly found photo of a place (a place doc with _id, name, lat, lng)."""
    db = get_db()
    cached = await db.place_photos.find_one({"_id": place["_id"]})
    if cached:
        return cached.get("photo")
    # hotels and restaurants rarely have articles, and a same-named article is rarely about them
    if place.get("is_accommodation") or place.get("is_food") or place.get("lat") is None or place.get("lng") is None:
        return None
    photo = await fetch_wikipedia(place.get("name") or "", place["lat"], place["lng"])
    now = datetime.now(timezone.utc)
    await db.place_photos.replace_one(
        {"_id": place["_id"]},
        {"photo": photo, "checked_at": now, "expires_at": now + (FOUND_TTL if photo else MISSING_TTL)},
        upsert=True,
    )
    return photo
