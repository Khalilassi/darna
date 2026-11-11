"""Direct owner <-> buyer/tenant conversations, scoped to a listing."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import rate_limit
from app.core.db import get_db, utcnow
from app.core.deps import current_user
from app.core.errors import Forbidden, NotFound
from app.core.notify import notify
from app.core.redaction import contains_contact_details
from app.models.entities import Conversation, Listing, Message, User
from app.models.enums import LISTING_PUBLIC_STATUSES
from app.schemas.common import ORM, Ok

router = APIRouter(prefix="/conversations", tags=["messaging"])


class StartIn(BaseModel):
    listing_id: uuid.UUID
    message: str = Field(min_length=1, max_length=2000)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class MessageOut(ORM):
    id: uuid.UUID
    sender_id: uuid.UUID
    body: str
    created_at: datetime
    read_at: datetime | None


class ConversationOut(BaseModel):
    id: uuid.UUID
    listing_id: uuid.UUID
    listing_title: str
    my_role: str  # buyer | owner
    counterpart_name: str
    last_message: MessageOut | None
    unread: int
    last_message_at: datetime | None


class SentOut(BaseModel):
    conversation_id: uuid.UUID
    message: MessageOut
    safety_tip: str | None = None


def _party(conv: Conversation, user: User) -> str:
    if conv.buyer_id == user.id:
        return "buyer"
    if conv.owner_id == user.id:
        return "owner"
    raise NotFound("Conversation not found")


def _send(db: Session, conv: Conversation, user: User, body: str) -> SentOut:
    msg = Message(conversation_id=conv.id, sender_id=user.id, body=body.strip())
    db.add(msg)
    conv.last_message_at = utcnow()
    other = conv.owner_id if user.id == conv.buyer_id else conv.buyer_id
    notify(db, other, "new_message", conversation_id=conv.id)
    db.flush()
    tip = "keep_payments_off_chat" if contains_contact_details(body) else None
    return SentOut(conversation_id=conv.id, message=MessageOut.model_validate(msg), safety_tip=tip)


@router.post("", response_model=SentOut, status_code=201, dependencies=[Depends(rate_limit.limit("conv_start", 30, 3600))])
def start(body: StartIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = db.get(Listing, body.listing_id)
    if listing is None or listing.status not in LISTING_PUBLIC_STATUSES:
        raise NotFound("Listing not found")
    if listing.owner_id == user.id:
        raise Forbidden("You cannot message your own listing", code="own_listing")
    conv = db.scalar(select(Conversation).where(Conversation.listing_id == listing.id, Conversation.buyer_id == user.id))
    if conv is None:
        conv = Conversation(listing_id=listing.id, buyer_id=user.id, owner_id=listing.owner_id)
        db.add(conv)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            conv = db.scalar(select(Conversation).where(Conversation.listing_id == listing.id, Conversation.buyer_id == user.id))
    out = _send(db, conv, user, body.message)
    db.commit()
    return out


@router.get("", response_model=list[ConversationOut])
def my_conversations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    convs = db.scalars(
        select(Conversation).options(joinedload(Conversation.listing))
        .where(or_(Conversation.buyer_id == user.id, Conversation.owner_id == user.id))
        .order_by(Conversation.last_message_at.desc().nulls_last())
    ).all()
    out = []
    for c in convs:
        role = _party(c, user)
        other = db.get(User, c.owner_id if role == "buyer" else c.buyer_id)
        last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(Message.created_at.desc()).limit(1))
        unread = db.scalar(select(func.count()).select_from(Message).where(
            Message.conversation_id == c.id, Message.sender_id != user.id, Message.read_at.is_(None))) or 0
        out.append(ConversationOut(
            id=c.id, listing_id=c.listing_id, listing_title=c.listing.title, my_role=role,
            counterpart_name=other.full_name.split(" ")[0] if other else "",
            last_message=MessageOut.model_validate(last) if last else None, unread=unread, last_message_at=c.last_message_at,
        ))
    return out


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
def messages(conversation_id: uuid.UUID, before: datetime | None = None, limit: int = Query(default=50, le=100),
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise NotFound("Conversation not found")
    _party(conv, user)
    stmt = select(Message).where(Message.conversation_id == conv.id)
    if before:
        stmt = stmt.where(Message.created_at < before)
    rows = db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit)).all()
    return list(reversed(rows))


@router.post("/{conversation_id}/messages", response_model=SentOut, status_code=201,
             dependencies=[Depends(rate_limit.limit("message", 120, 600))])
def send(conversation_id: uuid.UUID, body: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise NotFound("Conversation not found")
    _party(conv, user)
    out = _send(db, conv, user, body.body)
    db.commit()
    return out


@router.post("/{conversation_id}/read", response_model=Ok)
def mark_read(conversation_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise NotFound("Conversation not found")
    _party(conv, user)
    db.execute(update(Message).where(Message.conversation_id == conv.id, Message.sender_id != user.id, Message.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
    return Ok()
