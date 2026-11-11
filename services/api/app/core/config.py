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
    public_base_url: str = "http://localhost:8000"
    max_upload_bytes: int = 10 * 1024 * 1024

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8081",
        "http://localhost:19006",
    ]
    rate_limit_enabled: bool = True
    offer_default_expiry_hours: int = 72

    push_provider: str = "log"  # log | expo
    expo_access_token: str | None = None
    # Staff (reviewer/support/admin) must use two-factor authentication to sign in.
    require_staff_mfa: bool = False

    def validate_for_env(self) -> None:
        if self.env in {"staging", "production"}:
            if self.jwt_secret == DEV_SECRET or len(self.jwt_secret) < 32:
                raise RuntimeError("DARNA_JWT_SECRET must be set to a strong secret outside development")
            if self.document_encryption_key == DEV_FERNET_KEY:
                raise RuntimeError("DARNA_DOCUMENT_ENCRYPTION_KEY must be set outside development")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.validate_for_env()
    return s
