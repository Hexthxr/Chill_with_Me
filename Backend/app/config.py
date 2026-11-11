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
    uploads_dir: Path = field(default_factory=lambda: Path(os.getenv("UPLOADS_DIR", str(BACKEND_DIR / "uploads"))))
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

    # ---- auth / OTP
    auth_secret: str = field(default_factory=lambda: os.getenv("AUTH_SECRET", ""))
    sms_provider: str = field(default_factory=lambda: os.getenv("SMS_PROVIDER", "auto").lower())  # auto|thaibulksms|twilio_verify|twilio|console
    twilio_account_sid: str = field(default_factory=lambda: os.getenv("TWILIO_ACCOUNT_SID", ""))
    twilio_auth_token: str = field(default_factory=lambda: os.getenv("TWILIO_AUTH_TOKEN", ""))
    twilio_from: str = field(default_factory=lambda: os.getenv("TWILIO_FROM", ""))
    twilio_verify_service_sid: str = field(default_factory=lambda: os.getenv("TWILIO_VERIFY_SERVICE_SID", ""))
    thaibulksms_otp_key: str = field(default_factory=lambda: os.getenv("THAIBULKSMS_OTP_KEY", ""))
    thaibulksms_otp_secret: str = field(default_factory=lambda: os.getenv("THAIBULKSMS_OTP_SECRET", ""))
    thaibulksms_otp_length: int = field(default_factory=lambda: int(os.getenv("THAIBULKSMS_OTP_LENGTH", "6")))
    # OTP is optional: off = register/login with phone + password only (no SMS, no cost)
    otp_enabled: bool = field(default_factory=lambda: _bool("OTP_ENABLED", False))
    otp_ttl_s: int = field(default_factory=lambda: int(os.getenv("OTP_TTL_S", "300")))
    otp_resend_s: int = field(default_factory=lambda: int(os.getenv("OTP_RESEND_S", "60")))
    otp_max_attempts: int = field(default_factory=lambda: int(os.getenv("OTP_MAX_ATTEMPTS", "5")))
    otp_max_per_hour: int = field(default_factory=lambda: int(os.getenv("OTP_MAX_PER_HOUR", "5")))
    otp_dev_show_code: bool = field(default_factory=lambda: _bool("OTP_DEV_SHOW_CODE", True))
    session_days: int = field(default_factory=lambda: int(os.getenv("SESSION_DAYS", "30")))

    def resolved_sms_provider(self) -> str:
        if self.sms_provider in {"thaibulksms", "twilio_verify", "twilio", "console"}:
            return self.sms_provider
        if self.thaibulksms_otp_key and self.thaibulksms_otp_secret:
            return "thaibulksms"
        if self.twilio_account_sid and self.twilio_auth_token and self.twilio_verify_service_sid:
            return "twilio_verify"
        if self.twilio_account_sid and self.twilio_auth_token and self.twilio_from:
            return "twilio"
        return "console"

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
