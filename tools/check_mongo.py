"""Ping the MongoDB that the backend is configured to use (MONGODB_URI from .env).

Prints exactly one word and never the URI itself:
    ok           connected
    down-local   URI points at this machine but nothing answers
    down-remote  URI points elsewhere (e.g. Atlas) and it can't be reached
Run from Backend/ with the venv python (tools/run.ps1 does this).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from urllib.parse import urlparse  # noqa: E402

from pymongo import MongoClient  # noqa: E402

from app.config import settings  # noqa: E402

uri = settings.mongodb_uri
try:
    first_host = urlparse(uri.replace("mongodb+srv://", "mongodb://", 1)).netloc.rsplit("@", 1)[-1].split(",")[0]
    host = first_host.rsplit(":", 1)[0].strip("[]").lower() if first_host else "localhost"
except Exception:
    host = ""
local = host in ("localhost", "127.0.0.1", "::1", "0.0.0.0")

try:
    MongoClient(uri, serverSelectionTimeoutMS=4000).admin.command("ping")
    print("ok")
except Exception:
    print("down-local" if local else "down-remote")
