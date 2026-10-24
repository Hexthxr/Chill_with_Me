"""Application settings loaded from environment variables (.env supported)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    """Minimal .env loader (no extra dependency). Existing env vars win."""
    for candidate in (BACKEND_DIR / ".env", PROJECT_DIR / ".env"):
        if not candidate.exists():
            continue
        for raw in candidate.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv()


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str = field(default_factory=lambda: os.getenv("MONGODB_URI", "mongodb://localhost:27017"))
    mongodb_db: str = field(default_factory=lambda: os.getenv("MONGODB_DB", "chill_with_me"))

    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", str(PROJECT_DIR / "data"))))
    ml_artifacts_dir: Path = field(
        default_factory=lambda: Path(os.getenv("ML_ARTIFACTS_DIR", str(BACKEND_DIR / "ml" / "artifacts")))
    )

    # Routing: auto | ors | google | osrm | mock
    routing_provider: str = field(default_factory=lambda: os.getenv("ROUTING_PROVIDER", "auto").lower())
    ors_api_key: str = field(default_factory=lambda: os.getenv("ORS_API_KEY", ""))
    google_maps_api_key: str = field(default_factory=lambda: os.getenv("GOOGLE_MAPS_API_KEY", ""))
    osrm_base_url: str = field(default_factory=lambda: os.getenv("OSRM_BASE_URL", ""))
    routing_fallback_to_mock: bool = field(default_factory=lambda: _bool("ROUTING_FALLBACK_TO_MOCK", True))
    routing_timeout_s: float = field(default_factory=lambda: float(os.getenv("ROUTING_TIMEOUT_S", "12")))

    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ]
    )

    def resolved_routing_provider(self) -> str:
        """Pick the routing provider. 'auto' uses whichever real provider is configured, else mock."""
        p = self.routing_provider
        if p in {"ors", "google", "osrm", "mock"}:
            return p
        if self.ors_api_key:
            return "ors"
        if self.google_maps_api_key:
            return "google"
        if self.osrm_base_url:
            return "osrm"
        return "mock"


settings = Settings()
