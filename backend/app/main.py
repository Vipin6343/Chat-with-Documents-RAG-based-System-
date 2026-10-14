from contextlib import asynccontextmanager
import logging

import portalocker
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.routers import router
from app.services.providers import Providers
from app.services.storage import Store


class BodyLimitMiddleware:
    """Limit actual received bytes, including chunked HTTP uploads before multipart spooling."""
    def __init__(self, app, limit):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message['type'] == 'http.request':
                received += len(message.get('body', b''))
                if received > self.limit:
                    from starlette.exceptions import HTTPException
                    raise HTTPException(413, 'Request exceeds total upload byte limit')
            return message

        await self.app(scope, limited_receive, send)


def create_app(settings=None, providers=None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        lock = portalocker.Lock(str(settings.data_dir / 'server.lock'), timeout=0)
        await run_in_threadpool(lock.acquire)
        store = None
        try:
            store = await run_in_threadpool(Store, settings, providers or Providers(settings))
            app.state.store = store
            await run_in_threadpool(store.recover)
            yield
        finally:
            if store:
                await run_in_threadpool(store.engine.dispose)
            await run_in_threadpool(lock.release)

    logging.basicConfig(level=logging.INFO, format='%(message)s')
    # Do not log provider URLs, request bodies or SDK debug payloads.
    for name in ('httpx', 'httpcore', 'openai'):
        logging.getLogger(name).setLevel(logging.WARNING)
    app = FastAPI(title='Chat with Documents — RAG-based System', lifespan=lifespan)
    app.add_middleware(BodyLimitMiddleware, limit=settings.max_files * settings.max_file_bytes + 1024 * 1024)
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                       allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Content-Type'])
    app.include_router(router)
    return app


app = create_app()
