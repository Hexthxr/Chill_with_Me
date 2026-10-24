"""Pydantic models for the trip planner and saved trips (request validation)."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
BlockKind = Literal["place", "hotel", "food", "rest", "custom"]


class OpeningHours(BaseModel):
    open: str = Field(pattern=HHMM)
    close: str = Field(pattern=HHMM)
    source: Literal["user"] = "user"  # dataset has no opening hours; only user-entered values are used


class Block(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: BlockKind
    name: str = Field(min_length=1, max_length=200)
    place_id: str | None = Field(default=None, max_length=128)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    duration_min: int = Field(default=60, ge=5, le=1440)
    locked: bool = False
    locked_start: str | None = Field(default=None, pattern=HHMM)
    opening_hours: OpeningHours | None = None
    province: str | None = None
    primary_type: str | None = None
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check(self):
        if self.locked and not self.locked_start:
            raise ValueError("ล็อกเวลาแล้วต้องระบุ locked_start (HH:MM)")
        if (self.lat is None) != (self.lng is None):
            raise ValueError("ต้องระบุ lat และ lng คู่กัน")
        return self

    @property
    def has_coords(self) -> bool:
        return self.lat is not None and self.lng is not None


class Day(BaseModel):
    start_time: str | None = Field(default=None, pattern=HHMM, description="override trip start time for this day")
    blocks: list[Block] = Field(default_factory=list, max_length=30)


class TripPlan(BaseModel):
    name: str = Field(default="ทริปของฉัน", min_length=1, max_length=120)
    start_date: date
    start_time: str = Field(default="08:00", pattern=HHMM)
    day_end_time: str = Field(default="20:00", pattern=HHMM)
    days: list[Day] = Field(min_length=1, max_length=14)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("days")
    @classmethod
    def _unique_ids(cls, days):
        ids = [b.id for d in days for b in d.blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("block id ต้องไม่ซ้ำกัน")
        return days


class TripCreate(TripPlan):
    owner_key: str | None = Field(default=None, max_length=64)


class OptimizeRequest(BaseModel):
    plan: TripPlan
    day_index: int = Field(ge=0)
    keep_first: bool = True
    keep_last_hotel: bool = True
