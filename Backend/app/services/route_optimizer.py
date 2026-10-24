"""Route optimisation for one day (heuristic TSP-path; deliberately separate from the ML recommender).

Minimises total travel duration of the day's located blocks while keeping fixed:
  - the first block (optional, default on – the day's starting point)
  - a final hotel block (optional, default on)
  - every time-locked block and every block without coordinates (rest / custom blocks)
Method: greedy nearest-neighbour fill of the movable slots, then local search with slot swaps and
segment reversals until no improvement. Exact for tiny days, good enough for ≤ 30 blocks.
"""
from __future__ import annotations

from ..schemas.trip import Block, TripPlan
from .routing import RoutingService


def _cost(order_idx: list[int], m: list[list[float]], origin: int | None) -> float:
    seq = ([origin] if origin is not None else []) + order_idx
    return sum(m[seq[i]][seq[i + 1]] for i in range(len(seq) - 1))


async def optimize_day(plan: TripPlan, day_index: int, routing: RoutingService,
                       keep_first: bool = True, keep_last_hotel: bool = True) -> dict:
    if day_index >= len(plan.days):
        raise ValueError("day_index เกินจำนวนวัน")
    blocks: list[Block] = plan.days[day_index].blocks
    located_pos = [i for i, b in enumerate(blocks) if b.has_coords]
    if len(located_pos) < 3:
        return {"changed": False, "order": [b.id for b in blocks], "message": "ต้องมีสถานที่ที่มีพิกัดอย่างน้อย 3 จุด"}

    # previous day's last located block is the fixed origin when day > 0
    origin_block = None
    for d in reversed(plan.days[:day_index]):
        loc = [b for b in d.blocks if b.has_coords]
        if loc:
            origin_block = loc[-1]
            break

    fixed = set()
    if keep_first:
        fixed.add(located_pos[0])
    if keep_last_hotel and blocks[located_pos[-1]].kind == "hotel":
        fixed.add(located_pos[-1])
    fixed |= {i for i in located_pos if blocks[i].locked}
    movable_slots = [i for i in located_pos if i not in fixed]
    if len(movable_slots) < 2:
        return {"changed": False, "order": [b.id for b in blocks], "message": "ไม่มีจุดที่ย้ายได้เพียงพอ (จุดส่วนใหญ่ถูกล็อก)"}

    pts_blocks = [blocks[i] for i in located_pos] + ([origin_block] if origin_block else [])
    pts = [(b.lat, b.lng) for b in pts_blocks]
    matrix, source, is_estimate = await routing.duration_matrix(pts)
    origin = len(located_pos) if origin_block else None
    pos_to_m = {p: k for k, p in enumerate(located_pos)}

    def seq_from(assign: dict[int, int]) -> list[int]:
        return [assign.get(p, pos_to_m[p]) for p in located_pos]

    # baseline
    base_assign = {p: pos_to_m[p] for p in located_pos}
    best_cost = before = _cost(seq_from(base_assign), matrix, origin)
    best = dict(base_assign)

    # greedy nearest-neighbour fill
    remaining = [pos_to_m[p] for p in movable_slots]
    greedy = dict(base_assign)
    prev = origin
    for p in located_pos:
        if p in fixed:
            prev = pos_to_m[p]
            continue
        if prev is None:
            nxt = remaining[0]
        else:
            nxt = min(remaining, key=lambda r: matrix[prev][r])
        remaining.remove(nxt)
        greedy[p] = nxt
        prev = nxt
    gc = _cost(seq_from(greedy), matrix, origin)
    if gc < best_cost:
        best, best_cost = greedy, gc

    # local search over movable slots: swaps + reversals
    improved = True
    it = 0
    while improved and it < 200:
        improved = False
        it += 1
        n = len(movable_slots)
        for a in range(n):
            for b in range(a + 1, n):
                for mode in ("swap", "reverse"):
                    cand = dict(best)
                    if mode == "swap":
                        pa, pb = movable_slots[a], movable_slots[b]
                        cand[pa], cand[pb] = best[pb], best[pa]
                    else:
                        seg = movable_slots[a : b + 1]
                        vals = [best[p] for p in seg][::-1]
                        for p, v in zip(seg, vals):
                            cand[p] = v
                    c = _cost(seq_from(cand), matrix, origin)
                    if c + 1e-6 < best_cost:
                        best, best_cost, improved = cand, c, True

    new_blocks = list(blocks)
    for p in located_pos:
        new_blocks[p] = pts_blocks[best[p]]
    order = [b.id for b in new_blocks]
    return {
        "changed": order != [b.id for b in blocks],
        "order": order,
        "travel_before_min": round(before / 60, 1),
        "travel_after_min": round(best_cost / 60, 1),
        "saved_min": round((before - best_cost) / 60, 1),
        "source": source,
        "is_estimate": is_estimate,
        "fixed_block_ids": [blocks[i].id for i in sorted(fixed)],
        "method": "nearest-neighbour + swap/2-opt local search (ไม่ใช่ ML)",
    }
