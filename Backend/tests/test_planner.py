"""Unit tests for schedule rules, route optimiser and routing parsers (no DB, mock routing)."""
import asyncio
from datetime import date

import pytest

from app.schemas.trip import Block, Day, TripPlan
from app.services.planner import compute_schedule, hhmm_to_min, min_to_hhmm
from app.services.route_optimizer import optimize_day
from app.services.routing import RoutingService, decode_polyline, mock_leg, parse_ors_route, parse_osrm_route


class MockRouting(RoutingService):
    def __init__(self):
        self.db = None
        self.provider = "mock"


def run(coro):
    return asyncio.run(coro)


BKK = (13.7522, 100.4913)        # Grand Palace area
WAT_ARUN = (13.7437, 100.4889)
CHATUCHAK = (13.7999, 100.5502)
AYUTTHAYA = (14.3559, 100.5609)


def blk(i, kind="place", pt=None, dur=60, **kw):
    lat, lng = pt if pt else (None, None)
    return Block(id=f"b{i}", kind=kind, name=f"B{i}", lat=lat, lng=lng, duration_min=dur, **kw)


def plan(*days, start="08:00", end="20:00"):
    return TripPlan(start_date=date(2026, 11, 1), start_time=start, day_end_time=end,
                    days=[Day(blocks=list(b)) for b in days])


def test_time_helpers():
    assert hhmm_to_min("08:30") == 510
    assert min_to_hhmm(510) == "08:30"
    assert min_to_hhmm(1500) == "01:00 (+1)"


def test_times_follow_order_and_travel():
    p = plan([blk(1, pt=BKK, dur=90), blk(2, pt=WAT_ARUN, dur=60)])
    r = run(compute_schedule(p, MockRouting()))
    b1, b2 = r["days"][0]["blocks"]
    assert b1["start"] == "08:00" and b1["end"] == "09:30" and b1["travel"] is None
    leg = mock_leg(BKK, WAT_ARUN)
    assert b2["travel"]["source"] == "mock" and b2["travel"]["is_estimate"] is True
    assert b2["start_min"] == pytest.approx(570 + leg.duration_s / 60, abs=0.2)


def test_reorder_recomputes_times():
    a = run(compute_schedule(plan([blk(1, pt=BKK), blk(2, pt=AYUTTHAYA)]), MockRouting()))
    b = run(compute_schedule(plan([blk(2, pt=AYUTTHAYA), blk(1, pt=BKK)]), MockRouting()))
    assert a["days"][0]["blocks"][0]["id"] == "b1"
    assert b["days"][0]["blocks"][0]["id"] == "b2"
    assert b["days"][0]["blocks"][0]["start"] == "08:00"


def test_locked_time_conflict_and_wait():
    # long first block makes the locked 09:00 block impossible -> error
    p = plan([blk(1, pt=BKK, dur=180), blk(2, pt=WAT_ARUN, locked=True, locked_start="09:00")])
    r = run(compute_schedule(p, MockRouting()))
    codes = [w["code"] for w in r["warnings"]]
    assert "locked_conflict" in codes
    # starts at real arrival (after the 3h first block), not the impossible locked time
    assert r["days"][0]["blocks"][1]["start_min"] > 11 * 60
    # locked later than arrival -> waits
    p2 = plan([blk(1, pt=BKK, dur=30), blk(2, pt=WAT_ARUN, locked=True, locked_start="12:00")])
    r2 = run(compute_schedule(p2, MockRouting()))
    assert r2["days"][0]["blocks"][1]["wait_min"] > 60
    assert "idle_gap" in [w["code"] for w in r2["warnings"]]


def test_opening_hours_warnings():
    p = plan([blk(1, pt=BKK, dur=600, opening_hours={"open": "09:00", "close": "16:00"})])
    codes = {w["code"] for w in run(compute_schedule(p, MockRouting()))["warnings"]}
    assert {"before_open", "after_close"} <= codes
    p2 = plan([blk(1, pt=BKK, dur=60, opening_hours={"open": "17:00", "close": "18:00"})])
    assert "closed" in {w["code"] for w in run(compute_schedule(p2, MockRouting()))["warnings"]}


def test_packed_day_warnings():
    blocks = [blk(i, pt=(13.7 + i * 0.05, 100.5), dur=120) for i in range(8)]
    codes = {w["code"] for w in run(compute_schedule(plan(blocks), MockRouting()))["warnings"]}
    assert "too_many_stops" in codes
    assert "too_late" in codes or "past_midnight" in codes
    assert "no_lunch" in codes


def test_rest_block_has_no_travel_and_hotel_carries_to_next_day():
    p = plan(
        [blk(1, pt=BKK), blk(2, kind="rest", dur=30), blk(3, pt=CHATUCHAK), blk(4, kind="hotel", pt=AYUTTHAYA, dur=30)],
        [blk(5, pt=BKK)],
    )
    r = run(compute_schedule(p, MockRouting()))
    d1 = r["days"][0]["blocks"]
    assert d1[1]["travel"] is None            # rest block
    assert d1[2]["travel"] is not None        # travel computed from b1 (skipping rest)
    first_d2 = r["days"][1]["blocks"][0]
    assert first_d2["travel"] is not None     # day 2 starts from the hotel
    assert "no_hotel" not in {w["code"] for w in r["warnings"] if w["day_index"] == 0}


def test_validation_rules():
    with pytest.raises(ValueError):
        Block(id="x", kind="place", name="x", locked=True)  # locked without time
    with pytest.raises(ValueError):
        TripPlan(start_date=date(2026, 1, 1), days=[Day(blocks=[blk(1), blk(1)])])  # duplicate ids


def test_optimizer_reduces_travel_and_keeps_fixed():
    # zig-zag order Bangkok -> Ayutthaya -> Bangkok -> Ayutthaya
    p = plan([blk(1, pt=BKK), blk(2, pt=AYUTTHAYA), blk(3, pt=WAT_ARUN), blk(4, pt=(14.35, 100.57)),
              blk(5, kind="hotel", pt=(14.36, 100.58))])
    r = run(optimize_day(p, 0, MockRouting()))
    assert r["changed"] is True
    assert r["travel_after_min"] < r["travel_before_min"]
    assert r["order"][0] == "b1" and r["order"][-1] == "b5"


def test_parsers():
    assert decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
    ors = {"features": [{"geometry": {"coordinates": [[100.0, 13.0], [100.1, 13.1], [100.2, 13.2]]},
                         "properties": {"way_points": [0, 1, 2],
                                        "segments": [{"distance": 1000, "duration": 120}, {"distance": 2000, "duration": 240}]}}]}
    legs = parse_ors_route(ors)
    assert [lg.distance_m for lg in legs] == [1000, 2000] and legs[0].geometry[0] == [13.0, 100.0]
    osrm = {"code": "Ok", "routes": [{"legs": [{"distance": 500, "duration": 60, "steps": [
        {"geometry": {"coordinates": [[100.0, 13.0], [100.01, 13.01]]}}]}]}]}
    assert parse_osrm_route(osrm)[0].is_estimate is False
