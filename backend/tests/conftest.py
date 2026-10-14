import re
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, AIMessageChunk

from app.config import Settings
from app.main import create_app


class TestEmbeddings:
    __test__ = False
    def embed_documents(self, texts):
        return [self.embed_query(t) for t in texts]

    def embed_query(self, text):
        words = re.findall(r'\w+', text.lower())
        return [float(words.count('apple')), float(words.count('banana')), 0.1]


class TestProviders:
    __test__ = False
    def __init__(self):
        self.answer = 'Apples are red. [S1]'
        self.fail = False
        self.prompts = []
        self.rewrites = []

    def embeddings(self):
        return TestEmbeddings()

    def llm(self):
        return self

    async def ainvoke(self, prompt):
        self.rewrites.append(prompt)
        return AIMessage(content='What color is the apple?')

    async def astream(self, prompt):
        self.prompts.append(prompt)
        yield AIMessageChunk(content=self.answer[:10])
        if self.fail:
            raise RuntimeError('Pretend provider failure with secret details')
        yield AIMessageChunk(content=self.answer[10:])


@pytest.fixture
def setup(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, chunk_size=100, chunk_overlap=15)
    provider = TestProviders()
    app = create_app(settings, provider)
    with TestClient(app) as client:
        yield client, app.state.store, provider, settings


def workspace(client, name='test'):
    response = client.post('/api/workspaces', json={'name': name})
    assert response.status_code == 201
    return response.json()['id']


def upload(client, wid, text=b'apple is red', name='facts.txt'):
    response = client.post(f'/api/workspaces/{wid}/documents', files=[('files', (name, text))])
    assert response.status_code == 202
    return response.json()[0]


def events(response):
    import json
    assert response.headers['content-type'].startswith('text/event-stream')
    frames = response.text.strip().split('\n\n')
    return [(f.splitlines()[0].removeprefix('event: '), json.loads(f.splitlines()[1].removeprefix('data: '))) for f in frames]
