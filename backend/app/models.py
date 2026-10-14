from uuid import uuid4
from datetime import datetime, timezone

from sqlalchemy import JSON, ForeignKey, LargeBinary, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Workspace(Base):
    __tablename__ = 'workspaces'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str]


class Document(Base):
    __tablename__ = 'documents'
    __table_args__ = (UniqueConstraint('workspace_id', 'sha256'),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    filename: Mapped[str]
    extension: Mapped[str]
    sha256: Mapped[str]
    status: Mapped[str] = mapped_column(default='queued')
    error: Mapped[str | None]


class Chunk(Base):
    __tablename__ = 'chunks'
    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey('documents.id'), index=True)
    text: Mapped[str]
    location: Mapped[dict] = mapped_column(JSON)
    vector: Mapped[list] = mapped_column(JSON)


class VectorIndex(Base):
    __tablename__ = 'vector_indexes'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), primary_key=True)
    identity: Mapped[str]
    dimension: Mapped[int]
    chunk_ids: Mapped[list] = mapped_column(JSON)
    payload: Mapped[bytes] = mapped_column(LargeBinary)
    checksum: Mapped[str]


class Conversation(Base):
    __tablename__ = 'conversations'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)


class Message(Base):
    __tablename__ = 'messages'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey('conversations.id'), index=True)
    role: Mapped[str]
    content: Mapped[str] = mapped_column(default='')
    status: Mapped[str]
    sources: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
