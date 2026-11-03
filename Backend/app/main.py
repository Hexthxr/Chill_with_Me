"""Chill with me – FastAPI application.

Run (from backend/):  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db as dbmod
from . import errors
from .config import settings
from .routers import activity, auth, hotels, meta, places, planner, recommend, trips
from .services.auth import ensure_indexes as ensure_auth_indexes
from .services.ml_service import ml_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("chill")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = await dbmod.connect()
    log.info("MongoDB connected: %s", settings.mongodb_db)
    await ensure_auth_indexes(database)
    await activity.ensure_indexes(database)
    log.info("SMS provider: %s", settings.resolved_sms_provider())
    await ml_service.load(database)
    log.info("Routing provider: %s", settings.resolved_routing_provider())
    yield
    await dbmod.close()


app = FastAPI(
    title="Chill with me API",
    description="แนะนำสถานที่ท่องเที่ยวในไทยด้วย ML + วางแผนทริปแบบ Block-based",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
errors.install(app)

for r in (auth.router, activity.router, meta.router, places.router, recommend.router, hotels.router, planner.router, trips.router):
    app.include_router(r)
