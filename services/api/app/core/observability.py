"""Request IDs, structured logs and Prometheus metrics.

- Every request gets an ID (the caller's ``X-Request-ID`` when well-formed, else a new one). It is echoed in
  the ``X-Request-ID`` response header, included in every error body and attached to every log record.
- ``DARNA_LOG_FORMAT=json`` emits one JSON object per log line (ts, level, logger, message, request_id).
- ``GET /metrics`` serves Prometheus metrics, labelled by route *template* (never raw paths, which contain
  ids). It is disabled unless ``DARNA_METRICS_TOKEN`` is set, and then requires ``Authorization: Bearer <token>``.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import time
import uuid
from contextvars import ContextVar

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest

from app.core.config import get_settings

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

REGISTRY = CollectorRegistry()
REQUESTS = Counter("darna_http_requests_total", "HTTP requests", ["method", "route", "status"], registry=REGISTRY)
LATENCY = Histogram("darna_http_request_duration_seconds", "HTTP request latency", ["method", "route"], registry=REGISTRY,
                    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5))


def current_request_id() -> str | None:
    return request_id_var.get()


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        if record.exc_info:
            out["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(out, ensure_ascii=False)


def configure_logging() -> None:
    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    root.setLevel(logging.INFO)
    for h in root.handlers:
        if not any(isinstance(f, RequestIdFilter) for f in h.filters):
            h.addFilter(RequestIdFilter())
        if get_settings().log_format == "json":
            h.setFormatter(JsonFormatter())
        else:
            h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"))


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _VALID_ID.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            route = _route_template(request)
            if route != "/metrics":
                REQUESTS.labels(request.method, route, str(status)).inc()
                LATENCY.labels(request.method, route).observe(time.perf_counter() - start)
            request_id_var.reset(token)

    @app.get("/metrics", include_in_schema=False)
    def metrics(request: Request):
        token = get_settings().metrics_token
        if not token:
            return Response(status_code=404)
        supplied = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(supplied, token):
            return Response(status_code=401)
        return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)
