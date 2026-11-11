"""Application configuration loaded from environment variables (prefix ``DARNA_``).

Secrets are never hardcoded for non-development environments: ``Settings.validate_for_env``
refuses to start a staging/production process with development defaults.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789"
# Fernet key used only for local development. Production must provide its own key.
DEV_FERNET_KEY = "ZGV2LW9ubHktZmVybmV0LWtleS1kby1ub3QtdXNlISE="


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DARNA_", env_file=".env", extra="ignore")

    env: str = "development"  # development | test | staging | production
    app_name: str = "Darna"
    database_url: str = "postgresql+psycopg://postgres@localhost:5432/darna"

    jwt_secret: str = DEV_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    document_encryption_key: str = DEV_FERNET_KEY
    document_url_ttl_seconds: int = 300
    document_retention_days: int = 365 * 7

    storage_dir: Path = Path(__file__).resolve().parents[2] / "storage"
    storage_backend: str = "local"  # local | s3
    s3_private_bucket: str = ""
    s3_public_bucket: str = ""
    s3_region: str = "eu-central-1"
    s3_endpoint_url: str | None = None  # S3-compatible stores (MinIO, R2, ...)
    s3_kms_key_id: str | None = None
    media_base_url: str = ""  # CDN / public bucket URL for listing photos when storage_backend=s3
    public_base_url: str = "http://localhost:8000"
    max_upload_bytes: int = 10 * 1024 * 1024

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8081",
        "http://localhost:19006",
    ]
    log_format: str = "text"  # text | json
    metrics_token: str | None = None  # enables GET /metrics when set
    rate_limit_enabled: bool = True
    rate_limit_backend: str = "memory"  # memory | redis
    redis_url: str = "redis://localhost:6379/0"
    offer_default_expiry_hours: int = 72

    malware_scanner: str = "none"  # none | clamd
    clamd_host: str = "localhost"
    clamd_port: int = 3310
    scan_fail_open: bool = False

    sms_provider: str = "log"  # log (development only) | <real provider, not implemented>

    push_provider: str = "log"  # log | expo
    expo_access_token: str | None = None
    # Staff (reviewer/support/admin) must use two-factor authentication to sign in.
    require_staff_mfa: bool = False

    def validate_for_env(self) -> None:
        from app.core.crypto import parse_keys

        try:
            keys = parse_keys(self.document_encryption_key)
        except ValueError as exc:
            raise RuntimeError(f"DARNA_DOCUMENT_ENCRYPTION_KEY is invalid: {exc}") from exc
        if self.env in {"staging", "production"}:
            if self.jwt_secret == DEV_SECRET or len(self.jwt_secret) < 32:
                raise RuntimeError("DARNA_JWT_SECRET must be set to a strong secret outside development")
            if self.malware_scanner != "clamd":
                raise RuntimeError("DARNA_MALWARE_SCANNER must be 'clamd' outside development")
            if DEV_FERNET_KEY in keys:
                raise RuntimeError("DARNA_DOCUMENT_ENCRYPTION_KEY must be set outside development")
        if self.malware_scanner not in {"none", "clamd"}:
            raise RuntimeError("DARNA_MALWARE_SCANNER must be 'none' or 'clamd'")
        if self.storage_backend not in {"local", "s3"}:
            raise RuntimeError("DARNA_STORAGE_BACKEND must be 'local' or 's3'")
        if self.storage_backend == "s3" and not (self.s3_private_bucket and self.s3_public_bucket and self.media_base_url):
            raise RuntimeError("s3 storage needs DARNA_S3_PRIVATE_BUCKET, DARNA_S3_PUBLIC_BUCKET and DARNA_MEDIA_BASE_URL")
        if self.s3_private_bucket and self.s3_private_bucket == self.s3_public_bucket:
            raise RuntimeError("Private documents and public photos must use different buckets")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.validate_for_env()
    return s
