import json

import httpx
import pytest

from app.config import Settings
from app.services.providers import Providers


def test_openrouter_routes_chat_and_text_embeddings(monkeypatch):
    settings = Settings(_env_file=None, llm_provider='openrouter', embedding_provider='openrouter',
                        llm_model='google/gemini-2.5-flash', embedding_model='openai/text-embedding-3-small',
                        open_router_api_key='test-key-not-real')
    factory = Providers(settings)
    embeddings, chat = factory.embeddings(), factory.llm()
    assert str(chat.root_client.base_url) == 'https://openrouter.ai/api/v1/'
    assert chat.root_client.api_key == 'test-key-not-real'
    assert chat.use_responses_api is False
    assert chat.stream_usage is False
    assert 'test-key-not-real' not in repr(settings)

    def handler(request):
        assert str(request.url) == 'https://openrouter.ai/api/v1/embeddings'
        assert request.headers['authorization'] == 'Bearer test-key-not-real'
        payload = json.loads(request.content)
        assert payload['model'] == settings.embedding_model
        assert all(isinstance(text, str) for text in payload['input'])
        return httpx.Response(200, json={'object': 'list', 'model': settings.embedding_model,
                              'data': [{'object': 'embedding', 'index': i, 'embedding': [1., 2.]} for i, _ in enumerate(payload['input'])],
                              'usage': {'prompt_tokens': 1, 'total_tokens': 1}})

    from openai import OpenAI
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        embeddings.client = OpenAI(api_key='test-key-not-real', base_url=settings.open_router_base_url,
                                   http_client=client).embeddings
        assert embeddings.embed_documents(['apple', 'banana']) == [[1., 2.], [1., 2.]]
        assert embeddings.embed_query('apple?') == [1., 2.]
    identity = settings.embedding_identity
    settings.open_router_base_url = 'https://different.example/v1'
    assert settings.embedding_identity != identity


@pytest.mark.parametrize('method', ['llm', 'embeddings'])
def test_openrouter_requires_key(method):
    provider = Providers(Settings(_env_file=None, llm_provider='openrouter', embedding_provider='openrouter',
                                  open_router_api_key=None))
    with pytest.raises(ValueError, match='OPEN_ROUTER_API_KEY'):
        getattr(provider, method)()
