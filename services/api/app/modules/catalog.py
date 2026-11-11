from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.entities import Project
from app.schemas.common import ORM

router = APIRouter(prefix="/projects", tags=["catalog"])


class DistrictOut(ORM):
    id: uuid.UUID
    code: str
    name_en: str
    name_ar: str


class ProjectOut(ORM):
    id: uuid.UUID
    slug: str
    name_en: str
    name_ar: str
    city_en: str
    city_ar: str
    districts: list[DistrictOut]


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.scalars(
        select(Project).where(Project.is_active.is_(True)).options(selectinload(Project.districts)).order_by(Project.name_en)
    ).all()
