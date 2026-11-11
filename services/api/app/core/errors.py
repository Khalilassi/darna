"""Uniform API error model: ``{"error": {"code": str, "message": str, "details": ...}}``.

Clients localize by ``code``; ``message`` is an English developer-facing fallback.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("darna")


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str = "", *, code: str | None = None, details: Any = None, status_code: int | None = None):
        super().__init__(message or self.code)
        self.message = message or self.code
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class InvalidState(AppError):
    status_code = 409
    code = "invalid_state_transition"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_failed"


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"


def _body(code: str, message: str, details: Any = None) -> dict:
    from app.core.observability import current_request_id

    # request_id lets support find the matching server log line when a user reports an error.
    return {"error": {"code": code, "message": message, "details": details, "request_id": current_request_id()}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content=_body(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = []
        for e in exc.errors():
            d = {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")}
            # Limits (max_length, ge, pattern, ...) let clients build localized messages.
            # Only plain scalars are passed through: ctx may also hold the raised exception.
            ctx = {k: (str(v) if isinstance(v, Decimal) else v) for k, v in (e.get("ctx") or {}).items()
                   if isinstance(v, (str, int, float, bool, Decimal)) and k != "error"}
            if ctx:
                d["ctx"] = ctx
            details.append(d)
        return JSONResponse(status_code=422, content=_body("validation_failed", "Invalid request", details))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content=_body("http_error", str(exc.detail)))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # Never echo internals to clients; log only the exception type and route.
        log.exception("unhandled_error path=%s type=%s", request.url.path, type(exc).__name__)
        return JSONResponse(status_code=500, content=_body("internal_error", "Internal server error"))
