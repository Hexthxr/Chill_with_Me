"""Admin photo uploads. Works on a synthetic place and synthetic users, and writes files to a temp folder."""
import secrets
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pymongo import MongoClient

from app.config import settings
from app.services import photos
from app.services import place_images as images
from app.services.auth import _token_hash


def _picture(fmt="JPEG", size=(800, 600), mode="RGB", **save):
    out = BytesIO()
    Image.new(mode, size, (20, 120, 160) if mode == "RGB" else (20, 120, 160, 128)).save(out, fmt, **save)
    return out.getvalue()


# ------------------------------------------------------------------ processing rules
def test_big_photo_is_shrunk_and_thumbnailed():
    r = images.process_image(_picture(size=(4000, 3000)))
    assert (r["width"], r["height"]) == (1600, 1200)
    assert Image.open(BytesIO(r["thumb"])).size == (640, 480)
    assert Image.open(BytesIO(r["large"])).format == "JPEG"


def test_small_photo_is_not_enlarged():
    assert images.process_image(_picture(size=(400, 300)))["width"] == 400


def test_gps_metadata_is_removed():
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"
    exif.get_ifd(0x8825)[2] = (13.0, 45.0, 0.0)  # GPSLatitude
    raw = _picture(exif=exif)
    assert Image.open(BytesIO(raw)).getexif()  # the upload really had metadata
    r = images.process_image(raw)
    assert not Image.open(BytesIO(r["large"])).getexif()
    assert not Image.open(BytesIO(r["thumb"])).getexif()


def test_phone_rotation_is_applied():
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90" orientation flag
    r = images.process_image(_picture(size=(800, 400), exif=exif))
    assert (r["width"], r["height"]) == (400, 800)


def test_transparent_png_becomes_a_white_background():
    assert images.process_image(_picture("PNG", mode="RGBA"))["width"] == 800


@pytest.mark.parametrize("raw", [
    b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    b"<?php echo 1; ?>",
    b"",
    _picture("GIF"),
    _picture()[:40],  # a damaged file
], ids=["svg", "script", "empty", "gif", "truncated"])
def test_non_photos_are_rejected(raw):
    with pytest.raises(images.ImageRejected):
        images.process_image(raw)


def test_tiny_and_huge_images_are_rejected(monkeypatch):
    with pytest.raises(images.ImageRejected, match="เล็กเกินไป"):
        images.process_image(_picture(size=(100, 100)))
    monkeypatch.setattr(images, "MAX_PIXELS", 1000)
    with pytest.raises(images.ImageRejected, match="ความละเอียด"):
        images.process_image(_picture())


# ------------------------------------------------------------------ API
def _db_ok() -> bool:
    try:
        MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1500).admin.command("ping")
        return True
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _db_ok(), reason="MongoDB required")


@pytest.fixture(scope="module")
def client():
    from app.main import app  # starting the app loads the ML model, so this file does it once

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def env(client, tmp_path, monkeypatch):
    monkeypatch.setattr(images, "UPLOAD_DIR", tmp_path)
    db = MongoClient(settings.mongodb_uri)[settings.mongodb_db]
    tag = secrets.token_hex(4)
    pid = f"__test_images_{tag}"
    db.places.insert_one({"_id": pid, "place_id": pid, "name": f"สถานที่ทดสอบรูป {tag}", "province": "x", "lat": 13.75, "lng": 100.5,
                          "location": {"type": "Point", "coordinates": [100.5, 13.75]}, "is_accommodation": False, "is_food": False})
    now = datetime.now(timezone.utc)
    tokens, uids = {}, []
    for role in ("admin", "user"):
        uid = db.users.insert_one({"name": f"test-{role}-{tag}", "phone": f"+6698{secrets.randbelow(10**7):07d}", "role": role, "created_at": now}).inserted_id
        uids.append(uid)
        tokens[role] = secrets.token_urlsafe(16)
        db.sessions.insert_one({"token_hash": _token_hash(tokens[role]), "user_id": uid, "created_at": now, "expires_at": now + timedelta(hours=1)})

    async def no_wiki(name, lat, lng):
        return None

    monkeypatch.setattr(photos, "fetch_wikipedia", no_wiki)
    try:
        yield client, db, pid, {"Authorization": f"Bearer {tokens['admin']}"}, {"Authorization": f"Bearer {tokens['user']}"}, tmp_path
    finally:
        db.place_images.delete_many({"place_id": pid})
        db.places.delete_one({"_id": pid})
        db.place_photos.delete_one({"_id": pid})
        db.place_overrides.delete_one({"_id": pid})
        db.admin_audit.delete_many({"place_id": pid})
        db.sessions.delete_many({"user_id": {"$in": uids}})
        db.users.delete_many({"_id": {"$in": uids}})


def _upload(c, pid, h, name="a.jpg", raw=None, **form):
    return c.post(f"/api/admin/places/{pid}/images", headers=h, data=form, files={"file": (name, raw or _picture(), "image/jpeg")})


@needs_db
def test_only_admins_can_manage(env):
    c, _, pid, admin, user, folder = env
    assert _upload(c, pid, {}).status_code == 401
    assert _upload(c, pid, user).status_code == 403
    assert list(folder.iterdir()) == []  # a refused upload leaves nothing behind
    image_id = _upload(c, pid, admin).json()["id"]
    assert c.delete(f"/api/admin/images/{image_id}", headers=user).status_code == 403
    assert c.patch(f"/api/admin/images/{image_id}", headers=user, json={"caption": "x"}).status_code == 403
    assert c.put(f"/api/admin/places/{pid}/images/order", headers=user, json={"ids": [image_id]}).status_code == 403
    assert c.get(f"/api/admin/places/{pid}/images", headers=user).status_code == 403


@needs_db
def test_upload_shows_on_the_public_site_and_is_audited(env):
    c, db, pid, admin, _, folder = env
    assert c.get(f"/api/places/{pid}/photo").json() == {"photo": None}
    r = _upload(c, pid, admin, name="วัด.jpg", caption="  มุมสวย  ", credit="ทีมงาน")
    assert r.status_code == 201
    assert len(list(folder.iterdir())) == 2  # large + thumbnail

    photo = c.get(f"/api/places/{pid}/photo").json()["photo"]
    assert photo["source"] == "admin" and photo["caption"] == "มุมสวย" and photo["author"] == "ทีมงาน"
    assert photo["url"].startswith("/api/uploads/places/") and photo["thumb_url"].endswith("_sm.jpg")
    assert "original_name" not in photo and "uploaded_by" not in photo  # admin details stay private
    assert len(c.get(f"/api/places/{pid}/photos").json()["items"]) == 1

    audit = db.admin_audit.find_one({"place_id": pid, "action": "image_add"})
    assert audit and audit["changes"]["image"]["new"] == "วัด.jpg"


@needs_db
def test_admin_photo_wins_over_wikipedia(env, monkeypatch):
    c, _, pid, admin, _, _ = env

    async def wiki(name, lat, lng):
        return {"url": "https://wiki/x.jpg", "title": "T", "article_url": "u", "author": "A", "license": "CC", "source_url": "s"}

    monkeypatch.setattr(photos, "fetch_wikipedia", wiki)
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["url"] == "https://wiki/x.jpg"
    _upload(c, pid, admin)
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["source"] == "admin"


@needs_db
def test_wrong_wikipedia_photo_can_be_switched_off(env, monkeypatch):
    c, db, pid, admin, _, _ = env

    async def wiki(name, lat, lng):
        return {"url": "https://wiki/x.jpg", "title": "T", "article_url": "u", "author": "A", "license": "CC", "source_url": "s"}

    monkeypatch.setattr(photos, "fetch_wikipedia", wiki)
    assert c.patch(f"/api/admin/places/{pid}/wiki-photo", headers=admin, json={"disabled": True}).json() == {"disabled": True}
    assert c.get(f"/api/places/{pid}/photo").json() == {"photo": None}
    listing = c.get(f"/api/admin/places/{pid}/wiki-photo", headers=admin).json()
    assert listing["disabled"] is True and listing["photo"]["url"] == "https://wiki/x.jpg"  # still visible to the admin
    assert db.place_overrides.find_one({"_id": pid})["fields"]["wiki_photo_off"] is True  # survives a re-import
    c.patch(f"/api/admin/places/{pid}/wiki-photo", headers=admin, json={"disabled": False})
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["url"] == "https://wiki/x.jpg"


@needs_db
def test_photo_list_does_not_wait_for_wikipedia(env, monkeypatch):
    c, _, pid, admin, user, _ = env

    async def must_not_run(name, lat, lng):
        raise AssertionError("the list must not ask Wikipedia")

    monkeypatch.setattr(photos, "fetch_wikipedia", must_not_run)
    assert c.get(f"/api/admin/places/{pid}/images", headers=admin).json()["items"] == []
    assert c.get(f"/api/admin/places/{pid}/wiki-photo", headers=user).status_code == 403


@needs_db
def test_order_decides_the_main_photo(env):
    c, _, pid, admin, _, _ = env
    a = _upload(c, pid, admin, caption="a").json()["id"]
    b = _upload(c, pid, admin, caption="b").json()["id"]
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["id"] == a
    assert c.put(f"/api/admin/places/{pid}/images/order", headers=admin, json={"ids": [b, a]}).status_code == 200
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["id"] == b
    assert [i["id"] for i in c.get(f"/api/places/{pid}/photos").json()["items"]] == [b, a]
    # a list that doesn't match exactly is refused, so a stale tab can't lose or mix up photos
    assert c.put(f"/api/admin/places/{pid}/images/order", headers=admin, json={"ids": [b]}).status_code == 422
    assert c.put(f"/api/admin/places/{pid}/images/order", headers=admin, json={"ids": [a, a]}).status_code == 422


@needs_db
def test_edit_replace_delete(env):
    c, db, pid, admin, _, folder = env
    first = _upload(c, pid, admin).json()
    other = _upload(c, pid, admin).json()

    assert c.patch(f"/api/admin/images/{first['id']}", headers=admin, json={"caption": " ใหม่ ", "credit": ""}).json()["caption"] == "ใหม่"

    new = c.put(f"/api/admin/images/{first['id']}/file", headers=admin,
                files={"file": ("new.jpg", _picture(size=(500, 500)), "image/jpeg")}).json()
    assert new["id"] == first["id"] and new["url"] != first["url"] and new["caption"] == "ใหม่" and new["width"] == 500
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["id"] == first["id"]  # keeps its position
    assert len(list(folder.iterdir())) == 4  # the replaced files are gone

    assert c.delete(f"/api/admin/images/{first['id']}", headers=admin).status_code == 204
    assert c.get(f"/api/places/{pid}/photo").json()["photo"]["id"] == other["id"]
    assert len(list(folder.iterdir())) == 2
    assert c.delete(f"/api/admin/images/{first['id']}", headers=admin).status_code == 404
    assert c.delete("/api/admin/images/not-an-id", headers=admin).status_code == 404
    actions = {a["action"] for a in db.admin_audit.find({"place_id": pid})}
    assert {"image_add", "image_edit", "image_replace", "image_remove"} <= actions


@needs_db
def test_bad_uploads_are_refused_and_leave_nothing(env, monkeypatch):
    c, db, pid, admin, _, folder = env
    r = _upload(c, pid, admin, name="evil.jpg", raw=b"<script>alert(1)</script>")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_image"
    monkeypatch.setattr(images, "MAX_UPLOAD_BYTES", 10)
    assert _upload(c, pid, admin).status_code == 413
    assert list(folder.iterdir()) == [] and db.place_images.count_documents({"place_id": pid}) == 0

    monkeypatch.setattr(images, "MAX_UPLOAD_BYTES", 10**7)
    monkeypatch.setattr(images, "MAX_IMAGES_PER_PLACE", 1)
    assert _upload(c, pid, admin).status_code == 201
    assert _upload(c, pid, admin).json()["error"]["code"] == "too_many_images"


@needs_db
def test_hidden_place_shows_no_photos(env):
    c, db, pid, admin, _, _ = env
    _upload(c, pid, admin)
    db.places.update_one({"_id": pid}, {"$set": {"hidden": True}})
    assert c.get(f"/api/places/{pid}/photo").status_code == 404
    assert c.get(f"/api/places/{pid}/photos").status_code == 404
    assert c.get(f"/api/admin/places/{pid}/images", headers=admin).status_code == 200
    assert c.post(f"/api/admin/places/nope/images", headers=admin, files={"file": ("a.jpg", _picture(), "image/jpeg")}).status_code == 404
