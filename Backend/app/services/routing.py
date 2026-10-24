"""Travel distance / time between points.

Providers (select with ROUTING_PROVIDER, keys from env – never hard-coded):
    ors     OpenRouteService  (ORS_API_KEY)          directions + matrix
    google  Google Routes API (GOOGLE_MAPS_API_KEY)  computeRoutes + computeRouteMatrix
    osrm    OSRM server       (OSRM_BASE_URL)        route + table
    mock    straight-line estimate for development – ALWAYS labelled `source="mock"`, `is_estimate=True`
            so the UI can show it is not real road data.

If a real provider fails and ROUTING_FALLBACK_TO_MOCK=true, the affected legs are returned as mock
with `fallback_reason` set – they are never presented as real.
"""
from __future__ import annotations

import hashlib
import logging
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import httpx

from ..config import settings

log = logging.getLogger("chill.routing")

Point = tuple[float, float]  # (lat, lng)


@dataclass
class Leg:
    distance_m: float
    duration_s: float
    source: str
    is_estimate: bool
    geometry: list[list[float]] = field(default_factory=list)  # [[lat, lng], ...]
    fallback_reason: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class RoutingError(RuntimeError):
    pass


# ------------------------------------------------------------------ mock (clearly labelled estimate)
ROAD_FACTOR = 1.3  # straight line -> road distance (rough)


def haversine_m(a: Point, b: Point) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def mock_leg(a: Point, b: Point, reason: str | None = None) -> Leg:
    d = haversine_m(a, b) * ROAD_FACTOR
    km = d / 1000
    speed = 25 if km < 5 else 45 if km < 30 else 65  # km/h assumptions, documented in README
    return Leg(
        distance_m=round(d), duration_s=round(km / speed * 3600), source="mock", is_estimate=True,
        geometry=[[a[0], a[1]], [b[0], b[1]]], fallback_reason=reason,
    )


# ------------------------------------------------------------------ polyline decoder (Google)
def decode_polyline(s: str) -> list[list[float]]:
    coords, idx, lat, lng = [], 0, 0, 0
    while idx < len(s):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(s[idx]) - 63
                idx += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += delta
            else:
                lng += delta
        coords.append([lat / 1e5, lng / 1e5])
    return coords


# ------------------------------------------------------------------ real providers
async def _ors_route(client: httpx.AsyncClient, pts: list[Point]) -> list[Leg]:
    r = await client.post(
        "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
        headers={"Authorization": settings.ors_api_key, "Content-Type": "application/json"},
        json={"coordinates": [[p[1], p[0]] for p in pts]},
    )
    if r.status_code != 200:
        raise RoutingError(f"ORS {r.status_code}: {r.text[:200]}")
    return parse_ors_route(r.json())


def parse_ors_route(data: dict) -> list[Leg]:
    feat = data["features"][0]
    coords = feat["geometry"]["coordinates"]
    wp = feat["properties"]["way_points"]
    legs = []
    for i, seg in enumerate(feat["properties"]["segments"]):
        part = coords[wp[i] : wp[i + 1] + 1]
        legs.append(Leg(seg["distance"], seg["duration"], "openrouteservice", False, [[c[1], c[0]] for c in part]))
    return legs


async def _google_route(client: httpx.AsyncClient, pts: list[Point]) -> list[Leg]:
    def wp(p):
        return {"location": {"latLng": {"latitude": p[0], "longitude": p[1]}}}

    body = {"origin": wp(pts[0]), "destination": wp(pts[-1]), "travelMode": "DRIVE",
            "intermediates": [wp(p) for p in pts[1:-1]]}
    r = await client.post(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        headers={"X-Goog-Api-Key": settings.google_maps_api_key,
                 "X-Goog-FieldMask": "routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline"},
        json=body,
    )
    if r.status_code != 200:
        raise RoutingError(f"Google {r.status_code}: {r.text[:200]}")
    return parse_google_route(r.json())


def parse_google_route(data: dict) -> list[Leg]:
    if not data.get("routes"):
        raise RoutingError("Google: no route found")
    legs = []
    for leg in data["routes"][0]["legs"]:
        dur = float(str(leg.get("duration", "0s")).rstrip("s") or 0)
        geom = decode_polyline(leg.get("polyline", {}).get("encodedPolyline", ""))
        legs.append(Leg(float(leg.get("distanceMeters", 0)), dur, "google", False, geom))
    return legs


async def _osrm_route(client: httpx.AsyncClient, pts: list[Point]) -> list[Leg]:
    coords = ";".join(f"{p[1]},{p[0]}" for p in pts)
    base = settings.osrm_base_url.rstrip("/")
    r = await client.get(f"{base}/route/v1/driving/{coords}", params={"overview": "full", "geometries": "geojson", "steps": "true"})
    if r.status_code != 200:
        raise RoutingError(f"OSRM {r.status_code}: {r.text[:200]}")
    return parse_osrm_route(r.json())


def parse_osrm_route(data: dict) -> list[Leg]:
    if data.get("code") != "Ok":
        raise RoutingError(f"OSRM: {data.get('code')}")
    legs = []
    for leg in data["routes"][0]["legs"]:
        geom: list[list[float]] = []
        for step in leg.get("steps", []):
            geom.extend([[c[1], c[0]] for c in step["geometry"]["coordinates"]])
        legs.append(Leg(leg["distance"], leg["duration"], "osrm", False, geom))
    return legs


# ------------------------------------------------------------------ matrix
async def _matrix_real(client: httpx.AsyncClient, provider: str, pts: list[Point]) -> list[list[float]]:
    if provider == "ors":
        r = await client.post(
            "https://api.openrouteservice.org/v2/matrix/driving-car",
            headers={"Authorization": settings.ors_api_key},
            json={"locations": [[p[1], p[0]] for p in pts], "metrics": ["duration"]},
        )
        if r.status_code != 200:
            raise RoutingError(f"ORS matrix {r.status_code}")
        return r.json()["durations"]
    if provider == "osrm":
        coords = ";".join(f"{p[1]},{p[0]}" for p in pts)
        r = await client.get(f"{settings.osrm_base_url.rstrip('/')}/table/v1/driving/{coords}")
        if r.status_code != 200:
            raise RoutingError(f"OSRM table {r.status_code}")
        return r.json()["durations"]
    if provider == "google":
        wps = [{"waypoint": {"location": {"latLng": {"latitude": p[0], "longitude": p[1]}}}} for p in pts]
        r = await client.post(
            "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
            headers={"X-Goog-Api-Key": settings.google_maps_api_key,
                     "X-Goog-FieldMask": "originIndex,destinationIndex,duration"},
            json={"origins": wps, "destinations": wps, "travelMode": "DRIVE"},
        )
        if r.status_code != 200:
            raise RoutingError(f"Google matrix {r.status_code}")
        n = len(pts)
        m = [[0.0] * n for _ in range(n)]
        for e in r.json():
            m[e["originIndex"]][e["destinationIndex"]] = float(str(e.get("duration", "0s")).rstrip("s") or 0)
        return m
    raise RoutingError(f"unknown provider {provider}")


# ------------------------------------------------------------------ public service
class RoutingService:
    def __init__(self, db=None):
        self.db = db
        self.provider = settings.resolved_routing_provider()

    def status(self) -> dict:
        p = self.provider
        return {
            "provider": p,
            "is_mock": p == "mock",
            "configured": {
                "ors": bool(settings.ors_api_key),
                "google": bool(settings.google_maps_api_key),
                "osrm": bool(settings.osrm_base_url),
            },
            "fallback_to_mock": settings.routing_fallback_to_mock,
            "message": (
                "โหมดจำลอง (Mock): ระยะทาง/เวลาเป็นค่าประมาณจากระยะเส้นตรง ไม่ใช่ข้อมูลถนนจริง — ตั้งค่า ORS_API_KEY, "
                "GOOGLE_MAPS_API_KEY หรือ OSRM_BASE_URL เพื่อใช้ข้อมูลจริง"
                if p == "mock" else f"ใช้ข้อมูลเส้นทางจริงจาก {p}"
            ),
        }

    @staticmethod
    def _key(provider: str, a: Point, b: Point) -> str:
        raw = f"{provider}:{a[0]:.5f},{a[1]:.5f}->{b[0]:.5f},{b[1]:.5f}"
        return hashlib.sha1(raw.encode()).hexdigest()

    async def _cache_get(self, keys: list[str]) -> dict[str, Leg]:
        if self.db is None or not keys:
            return {}
        out = {}
        async for d in self.db.route_cache.find({"key": {"$in": keys}}):
            out[d["key"]] = Leg(**d["leg"])
        return out

    async def _cache_put(self, items: dict[str, Leg]) -> None:
        if self.db is None or not items:
            return
        from pymongo import UpdateOne

        now = datetime.now(timezone.utc)
        await self.db.route_cache.bulk_write(
            [UpdateOne({"key": k}, {"$set": {"key": k, "leg": v.to_dict(), "created_at": now}}, upsert=True)
             for k, v in items.items()],
            ordered=False,
        )

    async def legs_for_sequence(self, pts: list[Point]) -> list[Leg]:
        """Legs between consecutive points (len = len(pts)-1)."""
        if len(pts) < 2:
            return []
        provider = self.provider
        if provider == "mock":
            return [mock_leg(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]

        keys = [self._key(provider, pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        cached = await self._cache_get(keys)
        if all(k in cached for k in keys):
            return [cached[k] for k in keys]
        try:
            async with httpx.AsyncClient(timeout=settings.routing_timeout_s) as client:
                fetch = {"ors": _ors_route, "google": _google_route, "osrm": _osrm_route}[provider]
                legs: list[Leg] = []
                # providers limit waypoints per request; chunk with overlap
                chunk = 24
                for start in range(0, len(pts) - 1, chunk):
                    legs.extend(await fetch(client, pts[start : start + chunk + 1]))
            if len(legs) != len(keys):
                raise RoutingError("provider returned unexpected number of legs")
            await self._cache_put({k: lg for k, lg in zip(keys, legs)})
            return legs
        except (httpx.HTTPError, RoutingError, KeyError, ValueError) as e:
            log.warning("routing provider %s failed: %s", provider, e)
            if not settings.routing_fallback_to_mock:
                raise RoutingError(f"ดึงข้อมูลเส้นทางจาก {provider} ไม่สำเร็จ: {e}") from e
            reason = f"{provider} ใช้งานไม่ได้ ({type(e).__name__}) — แสดงค่าประมาณแทน"
            return [cached.get(k) or mock_leg(pts[i], pts[i + 1], reason) for i, k in enumerate(keys)]

    async def duration_matrix(self, pts: list[Point]) -> tuple[list[list[float]], str, bool]:
        """Returns (matrix seconds, source, is_estimate)."""
        def mock_matrix():
            return [[0.0 if i == j else mock_leg(a, b).duration_s for j, b in enumerate(pts)] for i, a in enumerate(pts)]

        if self.provider == "mock":
            return mock_matrix(), "mock", True
        try:
            async with httpx.AsyncClient(timeout=settings.routing_timeout_s) as client:
                return await _matrix_real(client, self.provider, pts), self.provider, False
        except (httpx.HTTPError, RoutingError, KeyError, ValueError) as e:
            log.warning("matrix provider failed: %s", e)
            if not settings.routing_fallback_to_mock:
                raise RoutingError(str(e)) from e
            return mock_matrix(), "mock", True
