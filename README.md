# Chat with Documents

The backend and frontend are separate projects:

```text
backend/
  app/                  # FastAPI routes, services, models and schemas
  tests/
  scripts/
  data/                 # Existing database, indexes and uploaded files (ignored)
  .env                  # Existing provider API keys and configuration (ignored)
  .env.example
  pyproject.toml
  uv.lock
  requirements.txt
  .venv/                # Backend Python environment (ignored)
frontend/
  src/                  # React UI
  scripts/
  .env.example
  package.json
  package-lock.json
```

## Run on Windows PowerShell

Open two terminals. If an old Python environment is active, run `deactivate` first.

**Backend terminal:**

```powershell
cd "E:\Chat-with-Documents-RAG-based-System-\backend"
uv sync --locked
# On a fresh checkout only; never overwrite an existing .env:
if (!(Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Alternatively, skip activation and use `uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload` from `backend/`.

**Frontend terminal:**

```powershell
cd "E:\Chat-with-Documents-RAG-based-System-\frontend"
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

App: **http://localhost:3000**. Backend documentation: **http://127.0.0.1:8000/docs**.

Provider keys, including `OPEN_ROUTER_API_KEY`, belong in **`backend/.env`**. The frontend only needs `VITE_API_URL=http://127.0.0.1:8000`. API routes and ports are unchanged. There is no authentication; keep this local unless you add access controls.

## Existing installation

The original backend `.env` and `data/` were moved into `backend/` and checked byte-for-byte using SHA-256 hashes. Existing workspaces, documents, indexes and messages are preserved. Run backend commands from `backend/` so relative configuration and data paths resolve correctly. No reindexing is needed for this folder move.

The previous project folder retains only its old root `.venv/` and test cache. Project files, backend configuration and data now live here. The moved `backend/.venv/` dependencies and activation paths were refreshed for this location; use that environment for backend commands.

## Documentation and checks

- [Backend setup, providers, API and limitations](backend/README.md)
- [Frontend setup, streaming and verification](frontend/README.md)

Run backend checks from `backend/`: `uv run --locked python -m pytest -q` and `uv run --locked python scripts/smoke.py`.

Run frontend checks from `frontend/`: `npm test`, `npm run build`, and `node scripts/smoke.mjs`.
