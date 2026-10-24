"""MongoDB connection (PyMongo's native async client)."""
from __future__ import annotations

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import settings

_client: AsyncMongoClient | None = None


async def connect() -> AsyncDatabase:
    global _client
    _client = AsyncMongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    await _client.admin.command("ping")
    return _client[settings.mongodb_db]


async def close() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


def get_db() -> AsyncDatabase:
    if _client is None:
        raise RuntimeError("MongoDB client not initialised")
    return _client[settings.mongodb_db]
