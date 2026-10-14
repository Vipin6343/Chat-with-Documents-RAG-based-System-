from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings


class Providers:
    def __init__(self, settings):
        self.settings = settings

    def embeddings(self):
        s = self.settings
        if s.embedding_provider == 'openrouter':
            return OpenAIEmbeddings(model=s.embedding_model, api_key=self.openrouter_key(),
                                    base_url=s.open_router_base_url, check_embedding_ctx_length=False,
                                    request_timeout=s.provider_timeout, max_retries=1)
        if s.embedding_provider == 'gemini':
            return GoogleGenerativeAIEmbeddings(model=s.embedding_model, google_api_key=self.gemini_key(),
                                                vertexai=False,
                                                client_args={'timeout': s.provider_timeout})
        if s.embedding_provider == 'ollama':
            return OllamaEmbeddings(model=s.embedding_model, base_url=s.ollama_base_url,
                                    client_kwargs={'timeout': s.provider_timeout})
        return OpenAIEmbeddings(model=s.embedding_model, api_key=s.openai_api_key,
                                base_url=s.openai_base_url, request_timeout=s.provider_timeout, max_retries=1)

    def llm(self):
        s = self.settings
        if s.llm_provider == 'openrouter':
            return ChatOpenAI(model=s.llm_model, api_key=self.openrouter_key(),
                              base_url=s.open_router_base_url, max_tokens=s.max_output_tokens,
                              timeout=s.provider_timeout, max_retries=1, stream_usage=False,
                              use_responses_api=False)
        if s.llm_provider == 'gemini':
            return ChatGoogleGenerativeAI(model=s.llm_model, google_api_key=self.gemini_key(),
                                          vertexai=False, temperature=0,
                                          max_output_tokens=s.max_output_tokens,
                                          timeout=s.provider_timeout, max_retries=1)
        if s.llm_provider == 'ollama':
            return ChatOllama(model=s.llm_model, base_url=s.ollama_base_url, temperature=0,
                              num_ctx=s.context_window, num_predict=s.max_output_tokens,
                              client_kwargs={'timeout': s.provider_timeout})
        return ChatOpenAI(model=s.llm_model, api_key=s.openai_api_key, base_url=s.openai_base_url,
                          max_tokens=s.max_output_tokens, timeout=s.provider_timeout, max_retries=1)

    def gemini_key(self):
        key = self.settings.gemini_api_key
        if key is None or not key.get_secret_value().strip():
            raise ValueError('Set GEMINI_API_KEY in your local .env to use Gemini')
        return key

    def openrouter_key(self):
        key = self.settings.open_router_api_key
        if key is None or not key.get_secret_value().strip():
            raise ValueError('Set OPEN_ROUTER_API_KEY in your local .env to use OpenRouter')
        return key
