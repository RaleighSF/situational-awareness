"""VSS API Gateway configuration."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Cosmos VLM endpoint
    cosmos_endpoint: str = "https://cosmos.agentdemos.com"

    # Gemini API
    gemini_api_key: str = ""

    # Server
    vss_api_port: int = 8200
    vss_api_host: str = "0.0.0.0"

    # Caption indexer
    caption_rate_seconds: int = 10
    caption_batch_size: int = 4

    # ChromaDB
    chroma_persist_dir: str = "./chroma_data"

    # SQLite metadata DB
    sqlite_db_path: str = "./vss_metadata.db"

    # CORS origins (Cosmos-Watcher frontend)
    cors_origins: list[str] = [
        "http://localhost:5000",
        "http://localhost:5173",
        "https://aware.agentdemos.com",
        "https://vss.agentdemos.com",
    ]

    # Video sources endpoint (Cosmos-Watcher Express backend)
    frontend_api_url: str = "http://localhost:5000"

    model_config = {
        "env_file": ("../.env", ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
