"""Chill with me – FastAPI application.

Run (from backend/):  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db as dbmod
from . import errors
from .config import settings
from .routers import activity, admin, admin_images, auth, hotels, meta, notifications, places, planner, recommend, trips
from .services.auth import ensure_indexes as ensure_auth_indexes
from .services.ml_service import ml_service
from .services.photos import ensure_indexes as ensure_photo_indexes
from .services.place_images import ensure_indexes as ensure_image_indexes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("chill")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = await dbmod.connect()
    log.info("MongoDB connected: %s", settings.mongodb_db)
    await ensure_auth_indexes(database)
    await activity.ensure_indexes(database)
    await admin.ensure_indexes(database)
    await notifications.ensure_indexes(database)
    await ensure_photo_indexes(database)
    await ensure_image_indexes(database)
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

for r in (auth.router, admin.router, admin_images.router, activity.router, meta.router, places.router, recommend.router, hotels.router, planner.router, trips.router, notifications.router):
    app.include_router(r)

# Uploaded photos. File names are random and server-generated, and the content was re-encoded on upload.
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")
