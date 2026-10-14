from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    data_dir: Path = Path('data')
    allowed_origins: list[str] = ['http://localhost:3000']
    llm_provider: Literal['openai', 'ollama', 'gemini', 'openrouter'] = 'ollama'
    embedding_provider: Literal['openai', 'ollama', 'gemini', 'openrouter'] = 'ollama'
    llm_model: str = 'llama3.2'
    embedding_model: str = 'nomic-embed-text'
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None
    open_router_api_key: SecretStr | None = None
    open_router_base_url: str = 'https://openrouter.ai/api/v1'
    openai_base_url: str = 'https://api.openai.com/v1'
    ollama_base_url: str = 'http://localhost:11434'
    max_file_bytes: int = Field(10 * 1024 * 1024, ge=1)
    max_files: int = Field(10, ge=1, le=100)
    max_extracted_chars: int = Field(2_000_000, ge=1000)
    chunk_size: int = Field(1000, ge=100)
    chunk_overlap: int = Field(150, ge=0)
    retrieval_count: int = Field(5, ge=1, le=50)
    history_messages: int = Field(8, ge=0, le=100)
    context_window: int = Field(8192, ge=2048)
    max_output_tokens: int = Field(1024, ge=64)
    provider_timeout: float = Field(120, gt=0)

    @model_validator(mode='after')
    def valid_budget(self):
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError('chunk_overlap must be smaller than chunk_size')
        if self.max_output_tokens + 1024 >= self.context_window:
            raise ValueError('context_window must leave room for the prompt')
        return self

    @property
    def embedding_identity(self):
        if self.embedding_provider == 'openrouter':
            return f'openrouter:{self.open_router_base_url}:{self.embedding_model}'
        if self.embedding_provider == 'gemini':
            return f'gemini:https://generativelanguage.googleapis.com:{self.embedding_model}'
        endpoint = self.openai_base_url if self.embedding_provider == 'openai' else self.ollama_base_url
        return f'{self.embedding_provider}:{endpoint}:{self.embedding_model}'
