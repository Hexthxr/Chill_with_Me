"""Trip schedule computation (deterministic rules – not ML).

Given the current block order, computes arrival/start/end times using travel legs from the routing
service, honours user-locked start times, and produces warnings for:
  - locked-time conflicts / overlaps
  - user-entered opening hours (the dataset has no opening hours, so only user input is checked)
  - over-packed days (ends after day_end_time, past midnight, too many stops, travel-heavy days)
  - missing meal / rest / hotel blocks (informational)
"""
from __future__ import annotations

from datetime import timedelta

from ..schemas.trip import Block, TripPlan
from .routing import Leg, RoutingService


def hhmm_to_min(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def min_to_hhmm(m: float) -> str:
    m = int(round(m))
    day, rem = divmod(m, 1440)
    s = f"{rem // 60:02d}:{rem % 60:02d}"
    return s if day == 0 else f"{s} (+{day})"


def _w(level: str, code: str, message: str, block_id: str | None = None) -> dict:
    return {"level": level, "code": code, "message": message, "block_id": block_id}


MAX_PLACES_PER_DAY = 6
LONG_LEG_MIN = 180


async def compute_schedule(plan: TripPlan, routing: RoutingService) -> dict:
    # 1) collect consecutive located blocks across the whole trip (day N starts where day N-1 ended)
    located: list[tuple[int, int, Block]] = [
        (di, bi, b) for di, d in enumerate(plan.days) for bi, b in enumerate(d.blocks) if b.has_coords
    ]
    pts = [(b.lat, b.lng) for _, _, b in located]
    legs = await routing.legs_for_sequence(pts)
    leg_into: dict[str, Leg] = {located[i + 1][2].id: legs[i] for i in range(len(legs))}

    day_end_limit = hhmm_to_min(plan.day_end_time)
    out_days, all_warnings = [], []
    totals = {"distance_m": 0.0, "travel_s": 0.0, "visit_min": 0, "estimated_legs": 0, "real_legs": 0}
    n_days = len(plan.days)

    for di, day in enumerate(plan.days):
        day_start = hhmm_to_min(day.start_time or plan.start_time)
        cursor = day_start
        blocks_out, warnings = [], []
        travel_s = dist_m = 0.0
        n_places = 0
        food_times: list[tuple[float, float]] = []

        for b in day.blocks:
            leg = leg_into.get(b.id)
            travel_min = (leg.duration_s / 60) if leg else 0.0
            arrival = cursor + travel_min
            bw: list[dict] = []
            wait = 0.0
            if b.locked and b.locked_start:
                start = hhmm_to_min(b.locked_start)
                if arrival > start + 0.5:
                    bw.append(_w("error", "locked_conflict",
                                 f"ไปไม่ทันเวลาที่ล็อกไว้ {b.locked_start} (ถึงประมาณ {min_to_hhmm(arrival)}, ช้า {arrival - start:.0f} นาที) — เวลาทับซ้อนกับกิจกรรมก่อนหน้า",
                                 b.id))
                wait = max(0.0, start - arrival)
                start = max(start, arrival)  # can't start before arriving; conflict stays flagged
                if wait >= 60:
                    bw.append(_w("info", "idle_gap", f"มีเวลาว่างรอ {wait:.0f} นาทีก่อนเริ่มกิจกรรมนี้", b.id))
            else:
                start = arrival
            end = start + b.duration_min

            if b.opening_hours:
                o, c = hhmm_to_min(b.opening_hours.open), hhmm_to_min(b.opening_hours.close)
                s_mod, e_mod = start % 1440, (start % 1440) + b.duration_min
                if s_mod >= c or e_mod <= o:
                    bw.append(_w("error", "closed", f"สถานที่ปิดในช่วงเวลานี้ (เปิด {b.opening_hours.open}–{b.opening_hours.close})", b.id))
                else:
                    if s_mod < o:
                        bw.append(_w("warning", "before_open", f"ไปถึงก่อนเวลาเปิด {b.opening_hours.open} ประมาณ {o - s_mod:.0f} นาที", b.id))
                    if e_mod > c:
                        bw.append(_w("warning", "after_close", f"อยู่เลยเวลาปิด {b.opening_hours.close} ประมาณ {e_mod - c:.0f} นาที", b.id))

            if leg:
                travel_s += leg.duration_s
                dist_m += leg.distance_m
                totals["estimated_legs" if leg.is_estimate else "real_legs"] += 1
                if travel_min > LONG_LEG_MIN:
                    bw.append(_w("warning", "long_leg", f"ใช้เวลาเดินทางนานประมาณ {travel_min / 60:.1f} ชม.", b.id))
                if leg.fallback_reason:
                    bw.append(_w("warning", "routing_fallback", leg.fallback_reason, b.id))
            if b.kind == "place":
                n_places += 1
            if b.kind == "food":
                food_times.append((start, end))
            totals["visit_min"] += b.duration_min

            blocks_out.append({
                "id": b.id,
                "arrival": min_to_hhmm(arrival),
                "start": min_to_hhmm(start),
                "end": min_to_hhmm(end),
                "start_min": round(start, 1),
                "end_min": round(end, 1),
                "wait_min": round(wait, 1),
                "travel": None if leg is None else {**leg.to_dict(), "duration_min": round(travel_min, 1)},
                "warnings": bw,
            })
            warnings.extend(bw)
            cursor = end

        day_end = cursor
        span = day_end - day_start
        if day.blocks:
            if day_end > 1440:
                warnings.append(_w("error", "past_midnight", f"แผนวันนี้เลยเที่ยงคืน (จบ {min_to_hhmm(day_end)})"))
            elif day_end > day_end_limit:
                warnings.append(_w("warning", "too_late",
                                   f"แผนวันนี้จบ {min_to_hhmm(day_end)} เกินเวลาสิ้นสุดที่ตั้งไว้ {plan.day_end_time} ({day_end - day_end_limit:.0f} นาที)"))
            if n_places > MAX_PLACES_PER_DAY:
                warnings.append(_w("warning", "too_many_stops", f"มี {n_places} สถานที่ในวันเดียว อาจแน่นเกินไป (แนะนำไม่เกิน {MAX_PLACES_PER_DAY})"))
            if span > 0 and travel_s / 60 > 120 and travel_s / 60 > 0.5 * span:
                warnings.append(_w("warning", "travel_heavy",
                                   f"เวลาเดินทางรวม {travel_s / 3600:.1f} ชม. มากกว่าครึ่งหนึ่งของวัน ลองลดจุดหรือใช้ปุ่มจัดลำดับอัตโนมัติ"))
            covers_lunch = day_start <= 12 * 60 and day_end >= 13 * 60 + 30
            has_lunch = any(s <= 14 * 60 + 30 and e >= 11 * 60 for s, e in food_times)
            if covers_lunch and not has_lunch:
                warnings.append(_w("info", "no_lunch", "ยังไม่มี Block มื้อกลางวัน (ช่วง 11:00–14:30)"))
            has_rest = any(b.kind in {"rest", "food"} for b in day.blocks)
            if span > 6 * 60 and not has_rest:
                warnings.append(_w("info", "no_rest", "วันนี้ยาวเกิน 6 ชม. แต่ยังไม่มีเวลาพักหรือมื้ออาหาร"))
            if di < n_days - 1 and day.blocks[-1].kind != "hotel":
                warnings.append(_w("info", "no_hotel", "ยังไม่ได้เพิ่มที่พักสำหรับคืนนี้ (Block โรงแรมท้ายวัน)"))

        for w in warnings:
            all_warnings.append({**w, "day_index": di})
        totals["distance_m"] += dist_m
        totals["travel_s"] += travel_s
        out_days.append({
            "day_index": di,
            "date": (plan.start_date + timedelta(days=di)).isoformat(),
            "start": min_to_hhmm(day_start),
            "end": min_to_hhmm(day_end) if day.blocks else None,
            "blocks": blocks_out,
            "summary": {
                "n_blocks": len(day.blocks),
                "n_places": n_places,
                "travel_min": round(travel_s / 60, 1),
                "distance_km": round(dist_m / 1000, 1),
                "visit_min": sum(b.duration_min for b in day.blocks),
            },
            "warnings": warnings,
        })

    return {
        "days": out_days,
        "warnings": all_warnings,
        "totals": {
            "distance_km": round(totals["distance_m"] / 1000, 1),
            "travel_min": round(totals["travel_s"] / 60, 1),
            "visit_min": totals["visit_min"],
            "estimated_legs": totals["estimated_legs"],
            "real_legs": totals["real_legs"],
        },
        "routing": routing.status(),
    }
