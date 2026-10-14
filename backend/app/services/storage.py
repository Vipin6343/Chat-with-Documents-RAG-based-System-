import hashlib
import json
import logging
from pathlib import Path
from threading import RLock

import faiss
import numpy as np
from fastapi import HTTPException
from sqlalchemy import create_engine, delete, event, select
from sqlalchemy.orm import sessionmaker

from app.models import Base, Chunk, Conversation, Document, Message, VectorIndex, Workspace, uid
from app.schemas import DocumentOut, UploadResult
from app.services.parsing import parse_chunks

logger = logging.getLogger('rag')


class ReindexRequired(ValueError):
    pass


class Store:
    def __init__(self, settings, providers):
        self.settings, self.providers = settings, providers
        self.lock = RLock()
        self.root = settings.data_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(f'sqlite:///{(self.root / "metadata.db").as_posix()}',
                                    connect_args={'check_same_thread': False, 'timeout': 30})

        @event.listens_for(self.engine, 'connect')
        def pragmas(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('PRAGMA secure_delete=ON')

        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(self.engine, expire_on_commit=False)

    def recover(self):
        with self.lock, self.session.begin() as db:
            for doc in db.scalars(select(Document).where(Document.status.in_(['queued', 'processing']))):
                doc.status, doc.error = 'failed', 'Processing interrupted by restart; delete and upload again.'
            for msg in db.scalars(select(Message).where(Message.status == 'streaming')):
                msg.status, msg.error = 'interrupted', 'Server restarted before completion.'
            known = {self.path(d) for d in db.scalars(select(Document))}
            for file in (self.root / 'uploads').glob('*/*'):
                if file.is_file() and file not in known:
                    file.unlink()

    def path(self, doc):
        return self.root / 'uploads' / doc.workspace_id / f'{doc.id}{doc.extension}'

    def workspace(self, db, wid):
        obj = db.get(Workspace, wid)
        if obj is None:
            raise HTTPException(404, 'Workspace not found')
        return obj

    def document(self, db, wid, did):
        self.workspace(db, wid)
        doc = db.get(Document, did)
        if doc is None or doc.workspace_id != wid:
            raise HTTPException(404, 'Document not found in workspace')
        return doc

    def conversation(self, db, wid, cid):
        self.workspace(db, wid)
        conv = db.get(Conversation, cid)
        if conv is None or conv.workspace_id != wid:
            raise HTTPException(404, 'Conversation not found in workspace')
        return conv

    def upload(self, wid, files):
        results, pending = [], []
        with self.lock, self.session() as db:
            self.workspace(db, wid)
            if len(files) > self.settings.max_files:
                raise HTTPException(413, 'Too many files')
            for upload in files:
                name = (upload.filename or 'unnamed')[:255]
                extension = Path(name).suffix.lower()
                path = None
                try:
                    if extension not in {'.pdf', '.docx', '.txt'}:
                        raise ValueError('Supported extensions: PDF, DOCX, TXT')
                    did = uid()
                    path = self.root / 'uploads' / wid / f'{did}{extension}'
                    path.parent.mkdir(parents=True, exist_ok=True)
                    digest, size = hashlib.sha256(), 0
                    with path.open('xb') as target:
                        while data := upload.file.read(64 * 1024):
                            size += len(data)
                            if size > self.settings.max_file_bytes:
                                raise ValueError('File exceeds configured byte limit')
                            digest.update(data)
                            target.write(data)
                    if not size:
                        raise ValueError('Empty file')
                    duplicate = db.scalar(select(Document).where(Document.workspace_id == wid,
                                                                Document.sha256 == digest.hexdigest()))
                    if duplicate:
                        path.unlink()
                        results.append(UploadResult(filename=name, document=DocumentOut.model_validate(duplicate), duplicate=True))
                        continue
                    doc = Document(id=did, workspace_id=wid, filename=name, extension=extension,
                                   sha256=digest.hexdigest(), status='queued')
                    db.add(doc)
                    db.commit()
                    results.append(UploadResult(filename=name, document=DocumentOut.model_validate(doc)))
                    pending.append(did)
                except ValueError as exc:
                    if path:
                        path.unlink(missing_ok=True)
                    results.append(UploadResult(filename=name, error=str(exc)))
                except Exception:
                    db.rollback()
                    if path:
                        path.unlink(missing_ok=True)
                    logger.error(json.dumps({'event': 'upload_failed', 'workspace_id': wid}))
                    results.append(UploadResult(filename=name, error='Storage failure'))
                finally:
                    upload.file.close()
        return results, pending

    def check_identity(self, index):
        if index and index.identity != self.settings.embedding_identity:
            raise ReindexRequired('Embedding settings changed. Reindex the workspace with the CLI.')

    def rebuild(self, db, wid, identity=None):
        chunks = list(db.scalars(select(Chunk).where(Chunk.workspace_id == wid).order_by(Chunk.id)))
        old = db.get(VectorIndex, wid)
        if not chunks:
            if old:
                db.delete(old)
            return
        vectors = np.asarray([c.vector for c in chunks], dtype='float32')
        if vectors.ndim != 2 or not np.isfinite(vectors).all() or np.any(np.linalg.norm(vectors, axis=1) == 0):
            raise ValueError('Invalid embedding vectors')
        faiss.normalize_L2(vectors)
        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)
        payload = faiss.serialize_index(index).tobytes()
        db.merge(VectorIndex(workspace_id=wid, identity=identity or (old.identity if old else self.settings.embedding_identity),
                             dimension=vectors.shape[1], chunk_ids=[c.id for c in chunks], payload=payload,
                             checksum=hashlib.sha256(payload).hexdigest()))

    def process(self, wid, did):
        # Serialize ingestion, deletion and retrieval snapshots. Intended for small local datasets.
        with self.lock:
            stage = 'parse'
            try:
                with self.session.begin() as db:
                    doc = self.document(db, wid, did)
                    doc.status, doc.error = 'processing', None
                    path = self.path(doc)
                    self.check_identity(db.get(VectorIndex, wid))
                chunks = parse_chunks(path, did, self.settings)
                stage = 'embed'
                vectors = self.providers.embeddings().embed_documents([c[1] for c in chunks])
                if len(vectors) != len(chunks):
                    raise ValueError('Embedding count mismatch')
                with self.session.begin() as db:
                    old = db.get(VectorIndex, wid)
                    if old and any(len(v) != old.dimension for v in vectors):
                        raise ReindexRequired('Embedding dimensions changed. Reindex the workspace with the CLI.')
                    for (cid, text, location), vector in zip(chunks, vectors):
                        db.add(Chunk(id=cid, workspace_id=wid, document_id=did, text=text, location=location, vector=vector))
                    db.flush()
                    self.rebuild(db, wid)
                    self.document(db, wid, did).status = 'ready'
                logger.info(json.dumps({'event': 'document_ready', 'document_id': did, 'chunks': len(chunks)}))
            except Exception as exc:
                # Provider exceptions may contain sensitive request details: do not persist them.
                safe = str(exc) if isinstance(exc, ReindexRequired) or (stage == 'parse' and isinstance(exc, ValueError)) else 'Parsing or embedding failed; check file format and provider configuration.'
                with self.session.begin() as db:
                    doc = db.get(Document, did)
                    if doc:
                        doc.status, doc.error = 'failed', safe[:400]
                logger.warning(json.dumps({'event': 'document_failed', 'document_id': did, 'type': type(exc).__name__}))

    def delete_document(self, wid, did):
        with self.lock, self.session.begin() as db:
            doc = self.document(db, wid, did)
            path = self.path(doc)
            db.execute(delete(Chunk).where(Chunk.document_id == did, Chunk.workspace_id == wid))
            db.delete(doc)
            self.rebuild(db, wid)
            # Remove retained citation excerpts for this document too.
            for msg in db.scalars(select(Message).join(Conversation).where(Conversation.workspace_id == wid)):
                msg.sources = [s for s in msg.sources if s['document_id'] != did]
        path.unlink(missing_ok=True)

    def retrieve(self, wid, question):
        with self.lock, self.session() as db:
            self.workspace(db, wid)
            stored = db.get(VectorIndex, wid)
            if stored is None:
                return []
            self.check_identity(stored)
            vector = np.asarray([self.providers.embeddings().embed_query(question)], dtype='float32')
            if vector.shape != (1, stored.dimension):
                raise ReindexRequired('Embedding dimensions changed. Reindex the workspace with the CLI.')
            if not np.isfinite(vector).all() or not np.linalg.norm(vector):
                raise ValueError('Invalid query embedding')
            if hashlib.sha256(stored.payload).hexdigest() != stored.checksum:
                raise ReindexRequired('Index checksum mismatch. Reindex the workspace with the CLI.')
            index = faiss.deserialize_index(np.frombuffer(stored.payload, dtype='uint8').copy())
            if index.d != stored.dimension or index.ntotal != len(stored.chunk_ids):
                raise ReindexRequired('Index metadata mismatch. Reindex the workspace with the CLI.')
            faiss.normalize_L2(vector)
            _, positions = index.search(vector, min(self.settings.retrieval_count, index.ntotal))
            results = []
            for position in positions[0]:
                chunk = db.get(Chunk, stored.chunk_ids[int(position)])
                if chunk is None or chunk.workspace_id != wid:
                    continue
                doc = db.get(Document, chunk.document_id)
                if doc is None or doc.status != 'ready':
                    continue
                results.append({'workspace_id': wid, 'document_id': doc.id, 'chunk_id': chunk.id,
                                'filename': doc.filename, 'location': chunk.location, 'text': chunk.text})
            return results

    def reindex(self, wid):
        with self.lock, self.session.begin() as db:
            self.workspace(db, wid)
            chunks = list(db.scalars(select(Chunk).where(Chunk.workspace_id == wid)))
            if chunks:
                vectors = self.providers.embeddings().embed_documents([c.text for c in chunks])
                if len(vectors) != len(chunks):
                    raise ValueError('Embedding count mismatch')
                for chunk, vector in zip(chunks, vectors):
                    chunk.vector = vector
                db.flush()
            self.rebuild(db, wid, self.settings.embedding_identity)
