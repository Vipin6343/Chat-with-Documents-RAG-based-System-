import pytest
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings

from app.config import Settings
from app.services.providers import Providers


def test_gemini_providers_without_network():
    settings = Settings(_env_file=None, llm_provider='gemini', embedding_provider='gemini',
                        llm_model='gemini-2.5-flash', embedding_model='gemini-embedding-001',
                        gemini_api_key='test-key-not-real')
    providers = Providers(settings)
    chat, embeddings = providers.llm(), providers.embeddings()
    assert isinstance(chat, ChatGoogleGenerativeAI)
    assert isinstance(embeddings, GoogleGenerativeAIEmbeddings)
    assert chat.vertexai is False and embeddings.vertexai is False
    assert chat.max_output_tokens == settings.max_output_tokens
    assert chat.timeout == settings.provider_timeout
    assert embeddings.client_args['timeout'] == settings.provider_timeout
    assert 'test-key-not-real' not in repr(settings)
    identity = settings.embedding_identity
    settings.ollama_base_url = 'http://unrelated.example'
    assert settings.embedding_identity == identity
    settings.embedding_model = 'different-model'
    assert settings.embedding_identity != identity


@pytest.mark.parametrize('method', ['llm', 'embeddings'])
def test_gemini_requires_explicit_key(method):
    providers = Providers(Settings(_env_file=None, llm_provider='gemini', embedding_provider='gemini', gemini_api_key=None))
    with pytest.raises(ValueError, match='GEMINI_API_KEY'):
        getattr(providers, method)()
