from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Evidence Intelligence API"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:3000"
    data_dir: Path = Path("./data")
    upload_dir: Path = Path("./data/uploads")
    database_path: Path = Path("./data/evidence.db")
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    openai_base_url: str = "https://openrouter.ai/api/v1"
    openai_api_key: str = ""
    llm_model: str = ""
    llm_timeout_seconds: int = 90
    retrieval_top_k: int = 6
    min_relevance_score: float = 0.22
    chunk_words: int = 220
    chunk_overlap_words: int = 40
    max_upload_mb: int = 20

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache

def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    return settings
