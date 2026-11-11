"""Small explicit finite-state-machine helper.

Every stateful aggregate (listing, offer, deal, verification, claim, viewing, dispute) declares its
allowed transitions as data. ``assert_transition`` is the single gate used by services, so an
illegal transition can never be persisted silently.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from enum import StrEnum

from app.core.errors import InvalidState


class StateMachine[S: StrEnum]:
    def __init__(self, name: str, transitions: Mapping[S, Iterable[S]], terminal: Iterable[S] = ()):
        self.name = name
        self.transitions = {k: frozenset(v) for k, v in transitions.items()}
        self.terminal = frozenset(terminal)

    def can(self, current: S, target: S) -> bool:
        return target in self.transitions.get(current, frozenset())

    def assert_transition(self, current: S, target: S) -> None:
        if not self.can(current, target):
            raise InvalidState(
                f"{self.name}: cannot move from '{current}' to '{target}'",
                details={"machine": self.name, "from": str(current), "to": str(target)},
            )

    def allowed_from(self, current: S) -> list[str]:
        return sorted(str(s) for s in self.transitions.get(current, ()))
