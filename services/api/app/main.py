from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core import logging_filters
from app.core.config import get_settings
from app.core.db import get_engine
from app.core.errors import install_error_handlers
from app.modules import (
    admin,
    auth,
    catalog,
    deals,
    documents,
    listings,
    market,
    messaging,
    notifications,
    phone,
    properties,
    saved_searches,
    support,
    verification,
    viewings,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=f"{settings.app_name} API",
        version="0.1.0",
        description="Owner-direct real estate marketplace and transaction workspace. "
        "Transaction statuses are records of what parties report; they are not legal transfers.",
        docs_url="/docs" if settings.env != "production" else None,
        redoc_url=None,
    )
    install_error_handlers(app)
    logging_filters.install()  # signed document tokens must never land in access logs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "Accept-Language"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith(("/auth", "/documents", "/deals", "/admin", "/conversations")):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    for r in (auth, phone, catalog, documents, verification, properties, market, listings, messaging, viewings, deals, notifications, saved_searches, support, admin):
        app.include_router(r.router)

    if settings.storage_backend == "local":  # with s3, photos are served by the CDN / bucket
        media = settings.storage_dir / "public"
        media.mkdir(parents=True, exist_ok=True)
        app.mount("/media", StaticFiles(directory=media), name="media")

    @app.get("/health", tags=["meta"])
    def health():
        with get_engine().connect() as c:
            c.execute(text("select 1"))
        return {"status": "ok"}

    return app


app = create_app()
