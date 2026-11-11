"""Logging filters that keep credentials out of server logs."""
from __future__ import annotations

import logging
import re

_SENSITIVE_QUERY = re.compile(r"(?i)([?&](?:token|access_token|refresh_token|code|signature)=)[^&\s\"]*")


def redact_query(path: str) -> str:
    return _SENSITIVE_QUERY.sub(r"\1[REDACTED]", path)


class RedactQueryFilter(logging.Filter):
    """Uvicorn's access log record args are (client, method, path_with_query, http_version, status)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = (*args[:2], redact_query(args[2]), *args[3:])
        if isinstance(record.msg, str) and "token=" in record.msg:
            record.msg = redact_query(record.msg)
        return True


def install() -> None:
    f = RedactQueryFilter()
    for name in ("uvicorn.access", "uvicorn.error", "httpx"):
        logger = logging.getLogger(name)
        if not any(isinstance(x, RedactQueryFilter) for x in logger.filters):
            logger.addFilter(f)
