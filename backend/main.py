"""VSS API Gateway — FastAPI backend for video search, summarization, and alert explanation."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db.sqlite import init_db
from db.chroma import get_chroma_collection
from services.caption_indexer import CaptionIndexer
from routers import query, summarize, explain, captions

logger = logging.getLogger("vss-api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

# Global caption indexer reference
_caption_indexer: CaptionIndexer | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    global _caption_indexer
    settings = get_settings()

    # Initialize SQLite metadata database
    logger.info("Initializing SQLite metadata database...")
    await init_db(settings.sqlite_db_path)

    # Initialize ChromaDB collection
    logger.info("Initializing ChromaDB collection...")
    get_chroma_collection(settings.chroma_persist_dir)

    # Start caption indexer background task
    logger.info("Starting caption indexer (rate: %ds per source)...", settings.caption_rate_seconds)
    _caption_indexer = CaptionIndexer(settings)
    indexer_task = asyncio.create_task(_caption_indexer.run())

    logger.info("VSS API Gateway ready on port %d", settings.vss_api_port)
    yield

    # Shutdown
    logger.info("Shutting down caption indexer...")
    if _caption_indexer:
        _caption_indexer.stop()
    indexer_task.cancel()
    try:
        await indexer_task
    except asyncio.CancelledError:
        pass
    logger.info("VSS API Gateway shutdown complete.")


app = FastAPI(
    title="VSS API Gateway",
    description="Video Search & Summarization API — semantic search, alert explanation, and timeline queries over indexed video captions.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(query.router, prefix="/api")
app.include_router(summarize.router, prefix="/api")
app.include_router(explain.router, prefix="/api")
app.include_router(captions.router, prefix="/api")


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    from db.chroma import get_chroma_collection
    settings = get_settings()
    collection = get_chroma_collection(settings.chroma_persist_dir)
    count = collection.count()
    return {
        "ok": True,
        "indexed_captions": count,
        "indexer_running": _caption_indexer is not None and _caption_indexer.running,
    }


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.vss_api_host,
        port=settings.vss_api_port,
        reload=True,
    )
