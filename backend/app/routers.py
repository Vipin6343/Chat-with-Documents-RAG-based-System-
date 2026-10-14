from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, Request, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.models import Workspace, Document, Conversation, Message, Chunk
from app.schemas import (WorkspaceCreate, WorkspaceOut, DocumentOut, UploadResult, ConversationOut,
                         MessageOut, ChatRequest, ChunkOut)
from app.services.chat import prepare, stream_answer

router = APIRouter()


@router.get('/health')
def health():
    return {'status': 'ok'}


@router.post('/api/workspaces', response_model=WorkspaceOut, status_code=201)
def create_workspace(body: WorkspaceCreate, request: Request):
    store = request.app.state.store
    with store.lock, store.session.begin() as db:
        workspace = Workspace(name=body.name.strip())
        db.add(workspace)
        db.flush()
        return WorkspaceOut.model_validate(workspace)


@router.get('/api/workspaces', response_model=list[WorkspaceOut])
def list_workspaces(request: Request):
    with request.app.state.store.session() as db:
        return list(db.scalars(select(Workspace).order_by(Workspace.id)))


@router.post('/api/workspaces/{workspace_id}/documents', response_model=list[UploadResult], status_code=202)
def upload_documents(workspace_id: UUID, request: Request, background: BackgroundTasks,
                     files: list[UploadFile] = File(
                         ...,
                         description='Select one or more PDF, DOCX or UTF-8 TXT files.',
                         # Swagger UI needs format=binary to render file pickers;
                         # current FastAPI emits only contentMediaType for UploadFile.
                         json_schema_extra={'items': {'type': 'string', 'format': 'binary'}},
                     )):
    store = request.app.state.store
    results, pending = store.upload(str(workspace_id), files)
    for did in pending:
        background.add_task(store.process, str(workspace_id), did)
    return results


@router.get('/api/workspaces/{workspace_id}/documents', response_model=list[DocumentOut])
def list_documents(workspace_id: UUID, request: Request):
    store = request.app.state.store
    with store.session() as db:
        store.workspace(db, str(workspace_id))
        return list(db.scalars(select(Document).where(Document.workspace_id == str(workspace_id)).order_by(Document.id)))


@router.delete('/api/workspaces/{workspace_id}/documents/{document_id}', status_code=204)
def delete_document(workspace_id: UUID, document_id: UUID, request: Request):
    request.app.state.store.delete_document(str(workspace_id), str(document_id))


@router.post('/api/workspaces/{workspace_id}/conversations', response_model=ConversationOut, status_code=201)
def create_conversation(workspace_id: UUID, request: Request):
    store = request.app.state.store
    with store.lock, store.session.begin() as db:
        store.workspace(db, str(workspace_id))
        conversation = Conversation(workspace_id=str(workspace_id))
        db.add(conversation)
        db.flush()
        return ConversationOut.model_validate(conversation)


@router.get('/api/workspaces/{workspace_id}/conversations', response_model=list[ConversationOut])
def list_conversations(workspace_id: UUID, request: Request):
    store = request.app.state.store
    with store.session() as db:
        store.workspace(db, str(workspace_id))
        return list(db.scalars(select(Conversation).where(Conversation.workspace_id == str(workspace_id))
                               .order_by(Conversation.id)))


@router.get('/api/workspaces/{workspace_id}/conversations/{conversation_id}/messages', response_model=list[MessageOut])
def messages(workspace_id: UUID, conversation_id: UUID, request: Request):
    store = request.app.state.store
    with store.session() as db:
        store.conversation(db, str(workspace_id), str(conversation_id))
        return list(db.scalars(select(Message).where(Message.conversation_id == str(conversation_id))
                               .order_by(Message.created_at, Message.id)))


@router.get('/api/workspaces/{workspace_id}/sources/{chunk_id}', response_model=ChunkOut)
def source(workspace_id: UUID, chunk_id: UUID, request: Request):
    store = request.app.state.store
    with store.session() as db:
        store.workspace(db, str(workspace_id))
        chunk = db.get(Chunk, str(chunk_id))
        if chunk is None or chunk.workspace_id != str(workspace_id):
            raise HTTPException(404, 'Source not found in workspace')
        doc = store.document(db, str(workspace_id), chunk.document_id)
        return ChunkOut(chunk_id=chunk.id, document_id=doc.id, workspace_id=str(workspace_id),
                        filename=doc.filename, location=chunk.location, text=chunk.text)


@router.post('/api/workspaces/{workspace_id}/chat/stream')
async def chat(workspace_id: UUID, body: ChatRequest, request: Request):
    store = request.app.state.store
    cid, mid, history = await run_in_threadpool(prepare, store, str(workspace_id), body)
    return StreamingResponse(stream_answer(store, request, str(workspace_id), body.question, cid, mid, history),
                             media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
