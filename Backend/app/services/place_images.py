"""Photos that admins upload for a place.

Stored as files under settings.uploads_dir plus one document per image in `place_images`. They live apart
from `places` so that re-importing the CSV can never lose them.

Uploads are never kept as received: every file is decoded and re-encoded to JPEG. That rejects anything
that isn't really a photo (a script renamed to .jpg, SVG), and drops metadata such as a phone's GPS position.
"""
from __future__ import annotations

import asyncio
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import settings
from ..db import get_db

UPLOAD_DIR: Path = settings.uploads_dir / "places"
URL_PREFIX = "/api/uploads/places"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 50_000_000
MIN_SIDE = 200
MAX_IMAGES_PER_PLACE = 20
LARGE_SIDE = 1600
THUMB_SIDE = 640


class ImageRejected(ValueError):
    """The upload is not a usable photo. The message is shown to the admin."""


def _jpeg(img: Image.Image, longest_side: int) -> bytes:
    copy = img.copy()
    copy.thumbnail((longest_side, longest_side), Image.Resampling.LANCZOS)
    out = BytesIO()
    copy.save(out, "JPEG", quality=85, optimize=True, progressive=True)  # saved without any metadata
    return out.getvalue()


def process_image(raw: bytes) -> dict:
    """Validates an upload. Returns the re-encoded large and thumbnail JPEGs, or raises ImageRejected."""
    try:
        with Image.open(BytesIO(raw), formats=("JPEG", "PNG", "WEBP")) as source:
            if source.width * source.height > MAX_PIXELS:
                raise ImageRejected("รูปมีความละเอียดสูงเกินไป (เกิน 50 ล้านพิกเซล)")
            if min(source.size) < MIN_SIDE:
                raise ImageRejected(f"รูปเล็กเกินไป ด้านที่สั้นที่สุดต้องอย่างน้อย {MIN_SIDE} พิกเซล")
            img = ImageOps.exif_transpose(source)  # phone photos store their rotation in metadata
            if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
                rgba = img.convert("RGBA")
                img = Image.new("RGB", rgba.size, "white")
                img.paste(rgba, mask=rgba.getchannel("A"))
            else:
                img = img.convert("RGB")
            large = _jpeg(img, LARGE_SIDE)
            thumb = _jpeg(img, THUMB_SIDE)
            width, height = Image.open(BytesIO(large)).size
    except ImageRejected:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError) as e:
        raise ImageRejected("ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ ใช้ได้เฉพาะ JPG, PNG หรือ WebP") from e
    return {"large": large, "thumb": thumb, "width": width, "height": height}


def _write_files(processed: dict) -> str:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex  # never derived from the uploaded file name; a new name also defeats stale caches
    (UPLOAD_DIR / f"{name}.jpg").write_bytes(processed["large"])
    (UPLOAD_DIR / f"{name}_sm.jpg").write_bytes(processed["thumb"])
    return name


def delete_files(name: str) -> None:
    (UPLOAD_DIR / f"{name}.jpg").unlink(missing_ok=True)
    (UPLOAD_DIR / f"{name}_sm.jpg").unlink(missing_ok=True)


async def store_image(raw: bytes) -> tuple[str, dict]:
    """Decoding is CPU work and writing is disk work: both stay off the event loop."""
    processed = await asyncio.to_thread(process_image, raw)
    return await asyncio.to_thread(_write_files, processed), processed


def public_out(d: dict) -> dict:
    """Same shape as a Wikipedia photo, so the site can show either."""
    return {
        "id": str(d["_id"]),
        "source": "admin",
        "url": f"{URL_PREFIX}/{d['file']}.jpg",
        "thumb_url": f"{URL_PREFIX}/{d['file']}_sm.jpg",
        "width": d.get("width"),
        "height": d.get("height"),
        "caption": d.get("caption"),
        "author": d.get("credit"),
    }


async def list_images(place_id: str) -> list[dict]:
    return await get_db().place_images.find({"place_id": place_id}).sort([("order", 1), ("uploaded_at", 1)]).to_list(MAX_IMAGES_PER_PLACE + 5)


async def public_images(place_id: str) -> list[dict]:
    return [public_out(d) for d in await list_images(place_id)]


async def main_image(place_id: str) -> dict | None:
    d = await get_db().place_images.find_one({"place_id": place_id}, sort=[("order", 1), ("uploaded_at", 1)])
    return public_out(d) if d else None


async def ensure_indexes(db) -> None:
    await db.place_images.create_index([("place_id", 1), ("order", 1)])
