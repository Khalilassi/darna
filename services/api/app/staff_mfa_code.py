"""Issue a one-time staff MFA enrolment code from the server (bootstrap for the first admin).

    python -m app.staff_mfa_code admin@example.com

Prints the code once. Requires database access, so only operators can run it.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.audit import audit
from app.core.db import session_factory
from app.core.mfa_enrollment import issue
from app.models.entities import User
from app.models.enums import Role


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python -m app.staff_mfa_code <email>", file=sys.stderr)
        return 2
    with session_factory()() as db:
        user = db.scalar(select(User).where(User.email == args[0].lower()))
        if user is None or user.role == Role.member:
            print("no staff account with that email", file=sys.stderr)
            return 1
        if user.mfa_enabled_at:
            print("two-factor authentication is already enabled for this account", file=sys.stderr)
            return 1
        code, expires = issue(user)
        audit(db, "user.mfa_enrollment_code_issued", "user", user.id, data={"via": "cli"})
        db.commit()
    print(f"{code}  (valid until {expires:%Y-%m-%d %H:%M} UTC)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
