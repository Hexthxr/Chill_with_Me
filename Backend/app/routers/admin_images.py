"""Admin photo management for a place. All routes need the admin role and are written to `admin_audit`.

GET    /api/admin/places/{id}/images        the place's photos
GET    /api/admin/places/{id}/wiki-photo    its Wikipedia photo, if any
POST   /api/admin/places/{id}/images        upload one photo (multipart: file, caption, credit)
PUT    /api/admin/places/{id}/images/order  set the order; the first photo is the main one
PATCH  /api/admin/places/{id}/wiki-photo    stop or resume showing the Wikipedia photo
PATCH  /api/admin/images/{image_id}         edit caption / credit
PUT    /api/admin/images/{image_id}/file    replace the picture, keeping its place in the order
DELETE /api/admin/images/{image_id}         delete
"""
from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from pydantic import BaseModel, Field, field_validator

from ..db import get_db
from ..errors import APIError
from ..services import photos
from ..services import place_images as images
from ..services.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _clean(text: str | None, limit: int) -> str | None:
    return " ".join((text or "").split())[:limit] or None


async def _place(place_id: str) -> dict:
    d = await get_db().places.find_one({"_id": place_id})
    if not d:
        raise APIError(404, "not_found", "ไม่พบสถานที่นี้")
    return d


async def _image(image_id: str) -> dict:
    try:
        oid = ObjectId(image_id)
    except (InvalidId, TypeError):
        raise APIError(404, "not_found", "ไม่พบรูปนี้")
    d = await get_db().place_images.find_one({"_id": oid})
    if not d:
        raise APIError(404, "not_found", "ไม่พบรูปนี้")
    return d


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read(images.MAX_UPLOAD_BYTES + 1)
    if len(raw) > images.MAX_UPLOAD_BYTES:
        raise APIError(413, "file_too_large", "ไฟล์ใหญ่เกินไป ขนาดสูงสุด 10 MB")
    return raw


async def _store(raw: bytes) -> tuple[str, dict]:
    try:
        return await images.store_image(raw)
    except images.ImageRejected as e:
        raise APIError(422, "invalid_image", str(e))


async def _record(place: dict, admin: dict, action: str, changes: dict) -> None:
    now = datetime.now(timezone.utc)
    db = get_db()
    await db.places.update_one({"_id": place["_id"]}, {"$set": {
        "admin_edited_at": now, "admin_edited_by": admin["_id"], "admin_edited_by_name": admin["name"],
    }})
    await db.admin_audit.insert_one({
        "ts": now, "action": action, "place_id": place["_id"], "place_name": place.get("name"),
        "admin_id": str(admin["_id"]), "admin_name": admin["name"], "changes": changes, "note": None,
    })


def _admin_out(d: dict) -> dict:
    return {
        **images.public_out(d),
        "original_name": d.get("original_name"),
        "uploaded_by": d.get("uploaded_by_name"),
        "uploaded_at": d["uploaded_at"].isoformat(),
    }


async def _listing(place_id: str) -> list[dict]:
    return [_admin_out(d) for d in await images.list_images(place_id)]


@router.get("/places/{place_id}/images")
async def list_place_images(place_id: str, _: dict = Depends(require_admin)):
    await _place(place_id)
    return {"items": await _listing(place_id), "max_images": images.MAX_IMAGES_PER_PLACE}


@router.get("/places/{place_id}/wiki-photo")
async def get_wiki_photo(place_id: str, _: dict = Depends(require_admin)):
    """Separate from the list: a Wikipedia lookup can wait in a queue, and managing photos shouldn't."""
    place = await _place(place_id)
    try:
        # ignores the off switch: the admin needs to see the photo in order to turn it back on
        wiki = await photos.photo_for({**place, "wiki_photo_off": False})
        unavailable = False
    except photos.PhotoLookupError:
        wiki, unavailable = None, True
    return {"photo": wiki, "disabled": bool(place.get("wiki_photo_off")), "unavailable": unavailable}


@router.post("/places/{place_id}/images", status_code=201)
async def upload_image(
    place_id: str,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    credit: str | None = Form(None),
    admin: dict = Depends(require_admin),
):
    place = await _place(place_id)
    db = get_db()
    existing = await images.list_images(place_id)
    if len(existing) >= images.MAX_IMAGES_PER_PLACE:
        raise APIError(422, "too_many_images", f"เพิ่มได้สูงสุด {images.MAX_IMAGES_PER_PLACE} รูปต่อสถานที่")
    name, processed = await _store(await _read_upload(file))
    doc = {
        "place_id": place_id, "file": name, "width": processed["width"], "height": processed["height"],
        "caption": _clean(caption, 200), "credit": _clean(credit, 120), "original_name": _clean(file.filename, 120),
        "order": max((d.get("order", 0) for d in existing), default=-1) + 1,
        "uploaded_at": datetime.now(timezone.utc), "uploaded_by": admin["_id"], "uploaded_by_name": admin["name"],
    }
    try:
        doc["_id"] = (await db.place_images.insert_one(doc)).inserted_id
    except Exception:
        images.delete_files(name)  # no document points at the files, so nothing else would ever clean them up
        raise
    await _record(place, admin, "image_add", {"image": {"old": None, "new": doc["original_name"] or "รูปใหม่"}})
    return _admin_out(doc)


class OrderIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=images.MAX_IMAGES_PER_PLACE + 5)


@router.put("/places/{place_id}/images/order")
async def set_order(place_id: str, body: OrderIn, admin: dict = Depends(require_admin)):
    place = await _place(place_id)
    db = get_db()
    existing = await images.list_images(place_id)
    if sorted(body.ids) != sorted(str(d["_id"]) for d in existing):
        raise APIError(422, "validation_error", "รายการรูปไม่ตรงกับรูปของสถานที่นี้ ลองโหลดหน้าใหม่")
    if body.ids != [str(d["_id"]) for d in existing]:
        for i, image_id in enumerate(body.ids):
            await db.place_images.update_one({"_id": ObjectId(image_id)}, {"$set": {"order": i}})
        await _record(place, admin, "image_order", {})
    return {"items": await _listing(place_id)}


class WikiIn(BaseModel):
    disabled: bool


@router.patch("/places/{place_id}/wiki-photo")
async def set_wiki_photo(place_id: str, body: WikiIn, admin: dict = Depends(require_admin)):
    place = await _place(place_id)
    db = get_db()
    if bool(place.get("wiki_photo_off")) != body.disabled:
        await db.places.update_one({"_id": place_id}, {"$set": {"wiki_photo_off": body.disabled}})
        # kept with the other admin values so a CSV re-import can re-apply it
        await db.place_overrides.update_one(
            {"_id": place_id},
            {"$set": {"fields.wiki_photo_off": body.disabled, "updated_at": datetime.now(timezone.utc), "updated_by": admin["_id"]}},
            upsert=True,
        )
        await _record(place, admin, "wiki_off" if body.disabled else "wiki_on", {})
    return {"disabled": body.disabled}


class ImageUpdate(BaseModel):
    caption: str | None = Field(None, max_length=400)
    credit: str | None = Field(None, max_length=240)

    @field_validator("caption")
    @classmethod
    def _caption(cls, v: str | None) -> str | None:
        return _clean(v, 200)

    @field_validator("credit")
    @classmethod
    def _credit(cls, v: str | None) -> str | None:
        return _clean(v, 120)


@router.patch("/images/{image_id}")
async def update_image(image_id: str, body: ImageUpdate, admin: dict = Depends(require_admin)):
    d = await _image(image_id)
    sent = body.model_dump(exclude_unset=True)
    changes = {k: {"old": d.get(k), "new": v} for k, v in sent.items() if d.get(k) != v}
    if changes:
        await get_db().place_images.update_one({"_id": d["_id"]}, {"$set": {k: c["new"] for k, c in changes.items()}})
        await _record(await _place(d["place_id"]), admin, "image_edit", changes)
    return _admin_out({**d, **sent})


@router.put("/images/{image_id}/file")
async def replace_image(image_id: str, file: UploadFile = File(...), admin: dict = Depends(require_admin)):
    d = await _image(image_id)
    place = await _place(d["place_id"])
    name, processed = await _store(await _read_upload(file))
    patch = {"file": name, "width": processed["width"], "height": processed["height"], "original_name": _clean(file.filename, 120)}
    try:
        await get_db().place_images.update_one({"_id": d["_id"]}, {"$set": patch})
    except Exception:
        images.delete_files(name)
        raise
    images.delete_files(d["file"])  # only once the document points at the new files
    await _record(place, admin, "image_replace", {"image": {"old": d.get("original_name"), "new": patch["original_name"] or "รูปใหม่"}})
    return _admin_out({**d, **patch})


@router.delete("/images/{image_id}", status_code=204)
async def delete_image(image_id: str, admin: dict = Depends(require_admin)):
    d = await _image(image_id)
    await get_db().place_images.delete_one({"_id": d["_id"]})
    images.delete_files(d["file"])
    await _record(await _place(d["place_id"]), admin, "image_remove", {"image": {"old": d.get("original_name") or "รูป", "new": None}})
    return Response(status_code=204)
