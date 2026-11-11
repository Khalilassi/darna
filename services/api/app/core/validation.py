"""Coded validation errors.

Raising ``rule_error("code", "English message")`` inside a Pydantic validator makes the 422
detail carry ``type: "code"`` instead of the generic ``value_error``, so clients can show a
localized message for each business rule. It subclasses ValueError, so existing
``except ValueError`` handling keeps working.
"""
from __future__ import annotations

from pydantic_core import PydanticCustomError


def rule_error(code: str, message: str, ctx: dict | None = None) -> PydanticCustomError:
    """``message`` may reference ``ctx`` keys as ``{name}``; ctx is also sent to clients."""
    return PydanticCustomError(code, message, ctx)
