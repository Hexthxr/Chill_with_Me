from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..db import get_db
from ..errors import APIError
from ..schemas.trip import OptimizeRequest, TripPlan
from ..services.planner import compute_schedule
from ..services.route_optimizer import optimize_day
from ..services.routing import RoutingError, RoutingService

router = APIRouter(prefix="/api", tags=["planner"])


@router.post("/planner/compute")
async def compute(plan: TripPlan):
    try:
        return await compute_schedule(plan, RoutingService(get_db()))
    except RoutingError as e:
        raise APIError(502, "routing_error", str(e))


@router.post("/planner/optimize")
async def optimize(req: OptimizeRequest):
    if req.day_index >= len(req.plan.days):
        raise APIError(422, "validation_error", "day_index เกินจำนวนวัน")
    try:
        return await optimize_day(req.plan, req.day_index, RoutingService(get_db()), req.keep_first, req.keep_last_hotel)
    except RoutingError as e:
        raise APIError(502, "routing_error", str(e))


class LegsRequest(BaseModel):
    points: list[list[float]] = Field(min_length=2, max_length=60)


@router.post("/routing/legs")
async def legs(req: LegsRequest):
    pts = []
    for p in req.points:
        if len(p) != 2 or not (-90 <= p[0] <= 90 and -180 <= p[1] <= 180):
            raise APIError(422, "validation_error", "จุดพิกัดต้องอยู่ในรูป [lat, lng]")
        pts.append((p[0], p[1]))
    svc = RoutingService(get_db())
    try:
        out = await svc.legs_for_sequence(pts)
    except RoutingError as e:
        raise APIError(502, "routing_error", str(e))
    return {"legs": [lg.to_dict() for lg in out], "routing": svc.status()}
