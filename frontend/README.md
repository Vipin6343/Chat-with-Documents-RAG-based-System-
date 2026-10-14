# Margin — Chat with Documents frontend

React, Vite and Tailwind CSS interface for the existing FastAPI backend. All application data comes from real backend endpoints; there is no demo-data fallback. Mock responses are confined to automated tests.

## Windows PowerShell setup

Use Node.js 22.12+ or 24 LTS (tested with 24.19.0). Keep the backend and frontend in separate terminals.

**Terminal 1 — backend directory:**

```powershell
cd "E:\Chat-with-Documents-RAG-based-System-\backend"
uv sync --locked
uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Keep your existing backend `.env` and provider key, including `OPEN_ROUTER_API_KEY`, in `backend/.env`. Restart the backend if it was running before this frontend was added: the backend now includes `GET /api/workspaces/{workspace_id}/conversations` for persistent conversation discovery.

**Terminal 2 — frontend directory:**

```powershell
cd "E:\Chat-with-Documents-RAG-based-System-\frontend"
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open **http://localhost:3000**. Vite uses a strict port so it will report an occupied port instead of silently switching to an origin the backend doesn't allow.

`frontend/.env` contains only:

```dotenv
VITE_API_URL=http://127.0.0.1:8000
```

The backend's `ALLOWED_ORIGINS` must include the exact browser origin. Its default `http://localhost:3000` works with the supplied dev and preview configuration. If you use another host/port, update the backend `.env`, for example:

```dotenv
ALLOWED_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

Restart both servers after changing configuration. `VITE_API_URL` is compiled into a production build, so rebuild after changing it. Do not use `backend/` as Vite's environment directory; provider secrets belong only on the backend. Never place API keys in `VITE_*` variables.

## Using the app

1. Select an existing workspace or create one. The backend stores workspaces and history across restarts.
2. Drop multiple PDF, DOCX or TXT files into the library, or use the keyboard-accessible **Choose files** button.
3. The library polls every 2.5 seconds. Queued, processing, ready and failed states come directly from the backend. Per-file validation errors, duplicate notices, processing errors and upload retry controls are shown separately.
4. Choose **New chat** or reopen a conversation from the sidebar. Existing conversations are named using their ID prefix because the backend stores no titles or creation dates for conversations.
5. Ask a question. Enter sends, Shift+Enter inserts a newline. While generating, **Stop generation** aborts the fetch and marks the partial answer interrupted.
6. Source cards show backend-controlled filenames, page/paragraph/table locations and excerpts. Select a card to open the complete chunk in the source panel. Escape closes the panel; native dialog focus management keeps keyboard navigation inside it.
7. Deleting a document requires inline confirmation. The backend removes its searchable vectors and text. Failed ingestion can be retried by deleting that document entry and choosing the file again, as required by the existing backend contract.

## Contracts and streaming behavior

The UI uses `/api/workspaces`, workspace `/documents`, workspace `/conversations`, conversation `/messages`, `/chat/stream` and `/sources/{chunk_id}`. No model provider requests are made by the browser.

Chat uses `fetch` POST with JSON `{question, conversation_id}` and a streaming `TextDecoder`. The SSE parser buffers across network chunks, handles split UTF-8 characters, LF/CRLF/CR separators, comment lines and multiline `data:` fields. It emits only complete events and requires a terminal `done` or `error`; an unexpected EOF is interrupted, not successful. A server `error` never becomes a completed answer. Received tokens and initial sources remain provisional until completion. Final sources replace retrieval candidates.

An immediate request guard prevents duplicate submissions. Changing workspace or conversation unmounts the old chat, aborts its stream and pending history requests, and prevents late results from changing the new view. Aborting a browser request cannot guarantee that a provider immediately stops processing or billing; the backend handles cancellation on its side. An immediate retry may receive HTTP 409 while the backend finishes cancelling the previous generation.

Markdown uses `react-markdown` with GFM, raw HTML disabled, safe URL handling, and no remote image loading. Links open with `noopener noreferrer`. Source text is rendered as plain text. No `dangerouslySetInnerHTML` or provider keys are used.

The layout adapts from a desktop sidebar to a collapsible library above the chat on mobile. Controls have labels and visible keyboard focus; upload has a button alternative to drag-and-drop; loading/error states have appropriate live status/alert roles. Streaming tokens are not announced individually to avoid overwhelming screen readers.

## Build and verification

```powershell
npm test
npm run build
node scripts/smoke.mjs
npm run preview
```

Production output is in `frontend/dist`. Preview serves at **http://localhost:3000**, so stop the dev server before running it. This remains a localhost, single-user app with an unauthenticated backend; no hosting/deployment was performed.

Verified in this workspace: **14 frontend tests passed, 34 backend tests passed, production build passed, and production HTTP smoke passed**. The temporary smoke server is stopped automatically. Dependency installation reported zero known vulnerabilities after updating the test runner.

Automated checks:

- Vitest: incremental SSE fragmentation, Unicode, multiline events, malformed JSON, premature EOF, error terminal behavior and cancellation.
- React Testing Library: workspace creation/selection, server history, multipart uploads, processing errors/status refresh, deletion, streamed answers, citations/source detail, duplicate-send prevention, stopping, stale-stream cancellation and Markdown safety. These tests intercept HTTP requests; they do not require paid model calls.
- Backend pytest: real parsers, SQLite and FAISS with mocked LLM/embedding providers, including the new workspace-scoped conversation-list endpoint.
- Vite production build.
- Temporary localhost HTTP smoke check for the generated HTML, JavaScript and CSS assets.

Browser rendering, drag-and-drop from the operating system, mobile viewport appearance and a complete frontend session against your live OpenRouter account still need a manual check. To verify: upload a small TXT file, wait for ready, ask a question, open its citation, stop a second answer, switch workspaces during generation, reopen history, then delete the file and confirm it disappears. Provider failures/credits and real browser CORS cannot be verified by mocked UI tests.

References: [Vite environment variables](https://vite.dev/guide/env-and-mode), [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite), [react-markdown security](https://github.com/remarkjs/react-markdown#security).
