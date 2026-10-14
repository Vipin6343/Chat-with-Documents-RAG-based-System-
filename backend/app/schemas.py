from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r'\S')


class WorkspaceOut(ORMModel):
    id: str
    name: str


class DocumentOut(ORMModel):
    id: str
    workspace_id: str
    filename: str
    status: Literal['queued', 'processing', 'ready', 'failed']
    error: str | None


class UploadResult(BaseModel):
    filename: str
    document: DocumentOut | None = None
    duplicate: bool = False
    error: str | None = None


class ConversationOut(ORMModel):
    id: str
    workspace_id: str


class ChatRequest(BaseModel):
    conversation_id: UUID | None = None
    question: str = Field(min_length=1, max_length=4000, pattern=r'\S')


class Source(BaseModel):
    source_id: str
    workspace_id: str
    document_id: str
    chunk_id: str
    filename: str
    location: dict[str, int]
    excerpt: str


class ChunkOut(BaseModel):
    chunk_id: str
    document_id: str
    workspace_id: str
    filename: str
    location: dict[str, int]
    text: str


class MessageOut(ORMModel):
    id: str
    conversation_id: str
    role: str
    content: str
    status: str
    sources: list[Source]
    error: str | None
    created_at: datetime
