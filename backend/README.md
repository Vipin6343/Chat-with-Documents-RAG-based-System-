# Chat with Documents — RAG-based System

A runnable Python 3.12 backend using FastAPI, LangChain integrations and recursive text splitting, FAISS, PyMuPDF, python-docx, and SQLAlchemy/SQLite, with a React/Vite/Tailwind frontend in `../frontend/`. The application uses real Ollama, OpenAI, Gemini or OpenRouter providers; test doubles are confined to tests. See [frontend setup and verification](../frontend/README.md) to use the app at http://localhost:3000.

**This is a local, single-user application with no authentication. Bind to `127.0.0.1`. Do not expose it publicly without authentication, authorization, request limits, and appropriate access controls. Workspace IDs are isolation boundaries, not credentials. CORS is not authentication.**

## Windows PowerShell setup

Install Python 3.12 and [uv](https://docs.astral.sh/uv/getting-started/installation/), then run from the `backend/` directory:

```powershell
uv sync --locked
Copy-Item .env.example .env
```

The committed `uv.lock` pins the full dependency graph and distribution hashes. Use `--locked` to reproduce the tested environment; do not update dependencies as part of routine startup. Python is constrained to 3.12. Virtual environment activation is optional.

The default configuration uses [Ollama](https://docs.ollama.com/quickstart) locally. Install and start Ollama, then download real models:

```powershell
ollama pull llama3.2
ollama pull nomic-embed-text
uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Alternatively edit `.env` to use OpenAI (paid requests may apply):

```dotenv
LLM_PROVIDER=openai
EMBEDDING_PROVIDER=openai
LLM_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=your-server-side-key
```

LLM and embedding providers can be chosen independently. Model identifiers must exist at the selected provider. `OPENAI_BASE_URL` supports an endpoint implementing the relevant standard API; arbitrary third-party extensions are not supported. No credentials are sent to API clients. Do not commit `.env`. Provider configuration is checked when used, so `/health` can work before a model is installed; it is a liveness endpoint, not a provider readiness check.

To use a Gemini API key instead, set these values in your local `.env`:

```dotenv
LLM_PROVIDER=gemini
EMBEDDING_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
EMBEDDING_MODEL=gemini-embedding-001
GEMINI_API_KEY=your-key-from-google-ai-studio
```

Run `uv sync --locked` and restart the server. This uses the Gemini Developer API for both streaming answers and embeddings; Ollama is not needed. Keep the key in `.env`, not in chat or source code. Get a key from [Google AI Studio](https://aistudio.google.com/apikey). See the [LangChain Gemini integration reference](https://reference.langchain.com/python/langchain-google-genai/chat_models/ChatGoogleGenerativeAI) and [Google embedding documentation](https://ai.google.dev/gemini-api/docs/embeddings). If you already indexed documents with another provider, stop the server and run the reindex command below for each workspace before restarting. Missing keys fail when a Gemini provider is used; health and configuration-free tests remain available. Live Gemini API calls have not been verified.

To use OpenRouter for both chat and embeddings, set:

```dotenv
LLM_PROVIDER=openrouter
EMBEDDING_PROVIDER=openrouter
LLM_MODEL=google/gemini-2.5-flash
EMBEDDING_MODEL=openai/text-embedding-3-small
OPEN_ROUTER_API_KEY=your-openrouter-key
OPEN_ROUTER_BASE_URL=https://openrouter.ai/api/v1
```

The application reads the exact variable `OPEN_ROUTER_API_KEY`; no separate Gemini or OpenAI key is required for this configuration. Chat uses OpenRouter's OpenAI-compatible chat-completions endpoint and embeddings send plain text to its [embeddings endpoint](https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings). Provider-specific reasoning extensions are not used. Account access and credits must permit the selected models. Restart after changing `.env`. Existing workspaces indexed with a different provider/model require the reindex command below. OpenRouter routing and payloads are tested with mocked requests; live account access has not been verified.

Interactive API documentation: <http://127.0.0.1:8000/docs>.

## API examples (PowerShell)

```powershell
$base = 'http://127.0.0.1:8000'
Invoke-RestMethod "$base/health"
$workspace = Invoke-RestMethod "$base/api/workspaces" -Method Post -ContentType 'application/json' -Body '{"name":"Portfolio research"}'
$wid = $workspace.id
Invoke-RestMethod "$base/api/workspaces"

# Use actual paths to your documents. curl.exe avoids PowerShell's curl alias.
curl.exe -X POST "$base/api/workspaces/$wid/documents" -F 'files=@C:/docs/report.pdf' -F 'files=@C:/docs/notes.txt'
Invoke-RestMethod "$base/api/workspaces/$wid/documents"
# Poll until the desired documents are ready or failed.

$conversation = Invoke-RestMethod "$base/api/workspaces/$wid/conversations" -Method Post
$cid = $conversation.id
$body = @{ conversation_id = $cid; question = 'What do the documents say about the project?' } | ConvertTo-Json -Compress
# A UTF-8 file avoids JSON quoting differences between PowerShell versions.
$chatFile = Join-Path $env:TEMP 'rag-chat-request.json'
[IO.File]::WriteAllText($chatFile, $body, [Text.UTF8Encoding]::new($false))
curl.exe -N -X POST "$base/api/workspaces/$wid/chat/stream" -H 'Content-Type: application/json' --data-binary "@$chatFile"
Invoke-RestMethod "$base/api/workspaces/$wid/conversations/$cid/messages"

# Substitute IDs returned in a sources event and the documents listing.
$chunkId = 'CHUNK_UUID'
$documentId = 'DOCUMENT_UUID'
Invoke-RestMethod "$base/api/workspaces/$wid/sources/$chunkId"
Invoke-RestMethod "$base/api/workspaces/$wid/documents/$documentId" -Method Delete
```

`conversation_id` may be omitted from chat to create a conversation automatically. IDs are UUIDs; malformed IDs return 422, unknown or cross-workspace relationships return 404. Concurrent answers in one conversation return 409. All workspace, document, conversation and source relationships are checked on the backend.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | Liveness |
| POST / GET | `/api/workspaces` | Create / list |
| POST / GET | `/api/workspaces/{workspace_id}/documents` | Multi-file upload / status list |
| DELETE | `/api/workspaces/{workspace_id}/documents/{document_id}` | Remove file, chunks and searchable vectors |
| POST / GET | `/api/workspaces/{workspace_id}/conversations` | Create / list conversations |
| GET | `/api/workspaces/{workspace_id}/conversations/{conversation_id}/messages` | Stored messages, statuses and sources |
| POST | `/api/workspaces/{workspace_id}/chat/stream` | SSE stream |
| GET | `/api/workspaces/{workspace_id}/sources/{chunk_id}` | Original chunk text and backend metadata |

## Ingestion and persistence

Uploads return HTTP 202 with one result per file: `filename`, `document`, `duplicate`, and `error`. The response snapshots new documents as `queued`; poll the listing for `processing`, `ready`, or `failed`. Unsupported extensions, empty files and byte limits produce per-file errors. Parse and embedding errors persist on the document. A duplicate hash within a workspace returns the existing document and its current status; it does not enqueue another job. To retry a failed document, delete it and upload again. The same file can exist in separate workspaces.

Only PDF, DOCX and UTF-8 TXT are accepted. PDFs are read page by page with **1-based page numbers**. Empty or scanned PDFs fail with an OCR explanation; OCR is outside this version. DOCX body paragraphs retain 1-based paragraph numbers; table rows retain table and row numbers. TXT paragraphs are split at blank lines. PDF reading order, DOCX headers/footers and complex layouts are not fully reconstructed.

LangChain's `RecursiveCharacterTextSplitter` defaults to **1000 characters with 150-character overlap**. These are character-based settings, not tokens; overlap does not cross source sections/pages. Every chunk has a deterministic UUID derived from its document ID and chunk position, plus workspace/document IDs, source location and filename through its document relation. IDs remain stable across reloads and vector reindexing; deleting and reuploading creates a new document identity.

Original filenames are metadata only. Disk paths use generated UUIDs:

```text
data/
  metadata.db                  # metadata, chunks, vectors, histories, FAISS blobs
  uploads/<workspace-uuid>/<document-uuid>.<validated-extension>
  server.lock                  # prevents multiple application/CLI writers
```

Workspace-specific FAISS `IndexFlatIP` indexes use normalized vectors for cosine ranking. Document and question embeddings use the same configured embedding provider/model. Each index stores provider/endpoint/model identity, dimension, chunk ordering and a SHA-256 checksum. Native serialized FAISS bytes are stored **inside SQLite**, with no pickle or uploaded-index import feature. Only locally generated application data is deserialized; the data directory must remain trusted. A checksum detects accidental corruption, not a malicious actor with database write access.

SQLite commits chunks, document readiness, FAISS bytes and index metadata atomically. A process lock enforces one server/CLI owner per data directory; an in-process lock serializes ingestion, retrieval snapshots and deletion. This favors correctness over throughput. A rebuild on mutation reuses saved vectors and never re-embeds other documents. Deletion removes chunks and index entries in one transaction, then unlinks the file. A crash between these operations can leave an orphan file, which startup cleans. Historical citation excerpts for deleted documents are removed; previously generated answer text remains in conversation history. This is logical deletion, not guaranteed forensic erasure of SQLite/WAL pages or backups.

On restart, queued/processing documents become `failed` with an interruption reason; streaming messages become `interrupted`. They are not silently marked complete or automatically retried. There is no durable job queue. In-process background jobs may be lost on crashes, deployments or forced shutdown. Native parsing and blocking provider/DB/file work run in worker threads; generation uses the provider's async interface. Parsing is not sandboxed and cannot be forcibly cancelled safely inside a thread. Upload and expanded-DOCX limits reduce resource usage but are not protection against every hostile parser input.

## Model changes and reindexing

Changes to the embedding identity or returned vector dimension block retrieval/new ingestion into an existing index. Stop the server, update `.env`, and rebuild the selected workspace:

```powershell
uv run --locked python -m app.reindex WORKSPACE_UUID
```

The CLI embeds all existing chunks using the new model and replaces vectors and the index in one transaction. If it fails, the old transaction remains intact. Repeat for each workspace. Failed documents without chunks still need deletion/reupload. Changing chunk settings requires deletion/reupload to reparse/rechunk documents. A provider silently changing model weights while retaining the same identity and dimensions cannot be detected; reindex manually in that case.

## Retrieval, grounding and citations

Recent complete messages are bounded by `HISTORY_MESSAGES` and a prompt budget. Follow-ups are rewritten by the LLM into a standalone retrieval question. The selected workspace's index returns up to `RETRIEVAL_COUNT` chunks. The prompt treats document text and history as untrusted data, instructs the model to ignore embedded instructions, and permits answers only from supplied sources.

Context construction uses a conservative UTF-8 byte budget (one token per byte), reserves output and message-framing space, bounds history, and includes only whole chunks that fit. Set `CONTEXT_WINDOW` no higher than the selected model's supported context. This intentionally underuses many models' actual token budgets; it is not a provider-specific exact tokenizer. Oversized question/history combinations fail explicitly instead of overflowing the configured budget. If no chunks fit or no documents are indexed, the server emits: `The documents do not support an answer to this question.` without calling the answer LLM.

Nearest-neighbor retrieval always returns candidates when an index is nonempty. Similarity scores alone do **not** establish that an answer is supported. The model is instructed to abstain with the same sentence when context is irrelevant. Prompt instructions and valid citations cannot guarantee factual entailment or prevent all prompt injection; this version has no independent semantic verifier or calibrated relevance cutoff.

The backend assigns `S1`, `S2`, etc. The model must cite exact markers such as `[S1]`. Unknown, malformed, or missing citations make the response `failed` with an `invalid_citations` error. The exact abstention sentence is allowed without citations. Filename, location and excerpts are built from backend records, never model output. Citation validation checks IDs, not whether a claim is truly supported. Clients can view the complete chunk using the source endpoint.

## Streaming contract

`POST` streaming uses `StreamingResponse`, `text/event-stream`, and blank-line-separated SSE frames:

```text
event: sources
data: {"conversation_id":"...","message_id":"...","sources":[...],"provisional":true}

event: token
data: {"conversation_id":"...","message_id":"...","text":"Answer fragment"}

event: sources
data: {"conversation_id":"...","message_id":"...","sources":[...],"provisional":false}

event: done
data: {"conversation_id":"...","message_id":"...","status":"complete"}

```

Initial sources are retrieval candidates. Final sources contain only validated, referenced sources. Tokens remain **provisional until `done`**. A failure emits `error` with `code`/`message` and IDs, never `done`. An error after partial tokens invalidates that partial answer; clients should visibly mark it failed. Successful text and final sources are saved before completion is emitted. Partial responses persist as `failed` or `interrupted` without validated sources. Disconnects cancel generation where supported; blocking work already running in a thread may finish. A document removed during generation invalidates completion if cited. Content already delivered over the network cannot be recalled.

Use `fetch`/a POST-capable SSE parser or `curl.exe -N`; native browser `EventSource` cannot issue this POST. Decode UTF-8 incrementally and buffer across arbitrary network packet boundaries. There are no heartbeat events, replay IDs, or reconnect/resume semantics. Configure proxy timeouts accordingly if adding a local proxy.

## Configuration and limits

`.env.example` lists all settings. `ALLOWED_ORIGINS` is a JSON array, not a comma-separated string. Defaults are 10 files per request, 10 MiB per file, 2 million extracted characters, 5 retrieval chunks, 8 history messages, 8192 context tokens, 1024 output tokens, and a 120-second generation/provider timeout. DOCX expansion is limited to 50 MB. An ASGI receive limit also bounds total request bytes (file count × file limit + 1 MiB multipart overhead), including chunked requests. The multipart parser may spool data to temporary disk before per-file validation, within that aggregate cap.

No global disk quota, pagination, conversation deletion, migrations, distributed workers, durable queues, OCR or reranking are included. Exact FAISS search, whole-workspace index rebuilds and JSON vector storage target small portfolio datasets. Slow embedding jobs can delay operations requiring the store lock. Stop the server before backing up both the database and uploads. Changing schemas in later versions will require migrations.

Application ingestion/error logs are JSON records containing event names and IDs; API keys, full documents and raw provider errors are excluded. Uvicorn's normal access logs remain in its own format. Avoid enabling SDK debug logging or external LangSmith tracing with sensitive documents. Cloud providers receive document chunks and questions as necessary; choose local Ollama to keep inference local.

## Verification

```powershell
uv run --locked python -m pytest -q
uv run --locked python scripts/smoke.py
```

Tests use deterministic embeddings and mocked LLM responses **only in tests**, while exercising real parsers, FAISS, SQLite, HTTP routes and SSE serialization. Coverage includes page/paragraph metadata, workspace ownership, duplicate hashes, deletion, citation validation, no-context responses, follow-up rewriting, streaming success/failure, disconnect status, concurrent ingestion, restart recovery, index reload/model mismatch, and single-process locking.

Verified on Windows with Python 3.12.10: **34 backend tests passed**, including provider initialization, upload schema and workspace-scoped conversation listing without paid API calls. The separate smoke script starts a temporary loopback server, checks health/workspace creation/no-context SSE over real HTTP, and stops the server. It requires no provider calls and stores its database in a temporary directory. Frontend checks and limitations are documented in [frontend/README.md](../frontend/README.md).

Native libraries can be blocked by Windows application-control policies in restricted shells. The implementation was imported and tested using an approved execution environment. Live paid API calls and local model inference were not exercised; you must install/configure a provider for real ingestion and chat. TestClient verifies framing and disconnect state handling, not every browser/proxy network cancellation scenario.

## Official API references checked during implementation

- [LangChain recursive text splitting](https://docs.langchain.com/oss/python/integrations/splitters/recursive_text_splitter)
- [LangChain ChatOpenAI](https://docs.langchain.com/oss/python/integrations/chat/openai) and [OpenAIEmbeddings](https://reference.langchain.com/python/langchain-openai/embeddings/base/OpenAIEmbeddings)
- [LangChain ChatOllama](https://docs.langchain.com/oss/python/integrations/chat/ollama)
- [FastAPI StreamingResponse](https://fastapi.tiangolo.com/advanced/custom-response/) and [background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [FAISS index I/O and trust warning](https://github.com/facebookresearch/faiss/wiki/Index-IO%2C-cloning-and-hyper-parameter-tuning)
- [PyMuPDF text extraction](https://pymupdf.readthedocs.io/en/latest/recipes-text.html)
- [SQLAlchemy SQLite behavior](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html)
