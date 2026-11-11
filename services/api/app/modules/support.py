from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import client_ip, current_user
from app.models.entities import SupportCase, User
from app.models.enums import SupportCategory, SupportStatus
from app.schemas.common import ORM

router = APIRouter(prefix="/support", tags=["support"])


class CaseIn(BaseModel):
    category: SupportCategory
    subject_type: str | None = Field(default=None, pattern="^(listing|user|deal|property)$")
    subject_id: uuid.UUID | None = None
    description: str = Field(min_length=10, max_length=4000)


class CaseOut(ORM):
    id: uuid.UUID
    category: SupportCategory
    subject_type: str | None
    subject_id: str | None
    description: str
    status: SupportStatus
    resolution_note: str | None
    created_at: datetime


@router.post("/cases", response_model=CaseOut, status_code=201, dependencies=[Depends(rate_limit.limit("support", 20, 3600))])
def open_case(body: CaseIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = SupportCase(reporter_id=user.id, category=body.category, subject_type=body.subject_type,
                       subject_id=str(body.subject_id) if body.subject_id else None, description=body.description)
    db.add(case)
    db.flush()
    audit(db, "support.opened", "support_case", case.id, actor_id=user.id, data={"category": body.category.value}, ip=client_ip(request))
    db.commit()
    return case


@router.get("/cases", response_model=list[CaseOut])
def my_cases(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(SupportCase).where(SupportCase.reporter_id == user.id).order_by(SupportCase.created_at.desc())).all()
