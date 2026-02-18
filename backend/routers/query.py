"""POST /api/query — Natural language search over indexed video captions."""

import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from config import get_settings
from services.search_service import search, search_streaming

logger = logging.getLogger("vss-api.query")

router = APIRouter()


class QueryRequest(BaseModel):
    """Natural language query over video captions."""
    query: str = Field(..., min_length=1, max_length=500, description="Natural language search query")
    camera_id: str | None = Field(None, description="Optional camera filter")
    n_results: int = Field(10, ge=1, le=50, description="Number of results to retrieve")
    stream: bool = Field(False, description="Whether to stream the response via SSE")


class QueryResult(BaseModel):
    """A single search result."""
    chroma_id: str
    camera_id: str
    camera_name: str
    video_time_seconds: float
    caption: str
    similarity: float
    timestamp: str
    frame_thumbnail_b64: str | None = None


class QueryResponse(BaseModel):
    """Search response with synthesized answer and matching clips."""
    answer: str
    results: list[QueryResult]
    query: str


@router.post("/query", response_model=QueryResponse)
async def query_captions(req: QueryRequest):
    """Search indexed video captions using natural language.

    Returns a synthesized answer (via Gemini RAG) and matching video clips
    with timestamps, camera info, and thumbnails.
    """
    settings = get_settings()

    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini API key not configured")

    if req.stream:
        return _stream_response(settings, req)

    result = await search(
        settings=settings,
        query=req.query,
        camera_id=req.camera_id,
        n_results=req.n_results,
    )

    return QueryResponse(
        answer=result["answer"],
        results=[QueryResult(**r) for r in result["results"]],
        query=result["query"],
    )


@router.post("/query/stream")
async def query_captions_stream(req: QueryRequest):
    """Search with streaming response via SSE.

    Events:
    - type="results": The matching clips (sent immediately)
    - type="chunk": A text chunk of the synthesized answer
    - type="done": Stream complete
    """
    settings = get_settings()

    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini API key not configured")

    async def event_generator():
        async for event in search_streaming(
            settings=settings,
            query=req.query,
            camera_id=req.camera_id,
            n_results=req.n_results,
        ):
            yield {
                "event": event["type"],
                "data": json.dumps(event["data"]) if isinstance(event["data"], (dict, list)) else (event["data"] or ""),
            }

    return EventSourceResponse(event_generator())
