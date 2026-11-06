"""Give (or take away) the admin role for an existing account.

Usage (from Backend/):
    python -m scripts.set_admin 0812345678            make this account an admin
    python -m scripts.set_admin 0812345678 --revoke   back to a normal user
    python -m scripts.set_admin --list                show current admins

The account must already exist (register on the website first). The user may need to log in again
(or reload the page) to see the admin menu.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pymongo import MongoClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.services.auth import display_phone, normalize_th_mobile  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Set or revoke the admin role")
    ap.add_argument("phone", nargs="?", help="Thai mobile number, e.g. 0812345678")
    ap.add_argument("--revoke", action="store_true", help="remove the admin role")
    ap.add_argument("--list", action="store_true", help="list admins")
    args = ap.parse_args()

    db = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)[settings.mongodb_db]

    if args.list:
        admins = list(db.users.find({"role": "admin"}, {"name": 1, "phone": 1}))
        if not admins:
            print("ยังไม่มีผู้ดูแลระบบ")
        for u in admins:
            print(f"- {u['name']}  {display_phone(u['phone'])}")
        return

    if not args.phone:
        ap.error("ต้องระบุเบอร์โทร หรือใช้ --list")
    phone = normalize_th_mobile(args.phone)
    if not phone:
        raise SystemExit(f"เบอร์ไม่ถูกต้อง ({args.phone!r}): ใช้เบอร์มือถือไทย 10 หลัก เช่น 0812345678")
    role = "user" if args.revoke else "admin"
    res = db.users.update_one({"phone": phone}, {"$set": {"role": role, "role_updated_at": datetime.now(timezone.utc)}})
    if res.matched_count == 0:
        raise SystemExit(f"ไม่พบบัญชีเบอร์ {display_phone(phone)} — สมัครสมาชิกบนเว็บก่อน")
    print(f"{display_phone(phone)} -> {role}")


if __name__ == "__main__":
    main()
