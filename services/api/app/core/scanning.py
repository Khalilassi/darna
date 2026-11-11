"""Malware scanning for uploads, before anything is stored.

``DARNA_MALWARE_SCANNER``:
- ``none`` (development default): uploads are not scanned. Refused in staging/production by config validation.
- ``clamd``: stream each upload to a ClamAV daemon (``DARNA_CLAMD_HOST``/``DARNA_CLAMD_PORT``) with the
  INSTREAM command. If the daemon cannot be reached the upload is refused (fail closed) unless
  ``DARNA_SCAN_FAIL_OPEN=true``.
"""
from __future__ import annotations

import logging
import socket
import struct
from typing import Protocol

from app.core.config import get_settings
from app.core.errors import AppError, ValidationFailed

log = logging.getLogger("darna.scan")
CHUNK = 64 * 1024


class ScannerUnavailable(AppError):
    status_code = 503
    code = "scanner_unavailable"


class Scanner(Protocol):
    def scan(self, data: bytes) -> str | None:
        """Return the malware signature name, or None when clean. Raise OSError when unreachable."""
        ...


class NoScanner:
    def scan(self, data: bytes) -> str | None:
        return None


class ClamdScanner:
    def __init__(self, host: str, port: int, timeout: float = 15.0):
        self.host, self.port, self.timeout = host, port, timeout

    def scan(self, data: bytes) -> str | None:
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as sock:
            sock.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), CHUNK):
                chunk = data[i : i + CHUNK]
                sock.sendall(struct.pack(">I", len(chunk)) + chunk)
            sock.sendall(struct.pack(">I", 0))
            reply = b""
            while not reply.endswith(b"\0"):
                part = sock.recv(4096)
                if not part:
                    break
                reply += part
        text = reply.rstrip(b"\0").decode(errors="replace")
        # "stream: OK" | "stream: <Signature> FOUND" | "INSTREAM size limit exceeded. ERROR"
        if text.endswith("OK"):
            return None
        if text.endswith("FOUND"):
            return text.removeprefix("stream:").removesuffix("FOUND").strip() or "unknown"
        raise OSError(f"unexpected clamd reply: {text[:80]}")


def scanner() -> Scanner:
    s = get_settings()
    if s.malware_scanner == "clamd":
        return ClamdScanner(s.clamd_host, s.clamd_port)
    return NoScanner()


def ensure_clean(data: bytes) -> None:
    """Raise if ``data`` is infected (422) or cannot be scanned under fail-closed policy (503)."""
    try:
        signature = scanner().scan(data)
    except OSError as exc:
        if get_settings().scan_fail_open:
            log.warning("malware scanner unavailable; accepting upload (fail-open)")
            return
        raise ScannerUnavailable("Upload scanning is temporarily unavailable. Please try again shortly.") from exc
    if signature:
        log.warning("upload rejected by malware scanner signature=%s", signature)
        raise ValidationFailed("This file was rejected by the security scan", code="file_rejected_malware")
