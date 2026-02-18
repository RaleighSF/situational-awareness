"""Semantic search service — embed query, search ChromaDB, synthesize answer via Gemini."""

import logging
import asyncio
from sentence_transformers import SentenceTransformer

from config import Settings
from db.chroma import get_chroma_collection, search_captions
from db.sqlite import get_captions_by_chroma_ids
from services.gemini_client import generate, generate_streaming
from services.caption_indexer import get_embedding_model
from prompts.search_synthesis import search_synthesis_prompt

logger = logging.getLogger("vss-api.search")


async def search(
    settings: Settings,
    query: str,
    camera_id: str | None = None,
    n_results: int = 10,
) -> dict:
    """Search indexed captions semantically and return synthesized results.

    Args:
        settings: Application settings.
        query: Natural language search query.
        camera_id: Optional camera filter.
        n_results: Number of results to retrieve from ChromaDB.

    Returns:
        Dict with "answer" (synthesized text) and "results" (matching clips).
    """
    # 1. Embed the query
    model = await asyncio.to_thread(get_embedding_model)
    query_embedding = await asyncio.to_thread(model.encode, query)
    query_embedding_list = query_embedding.tolist()

    # 2. Search ChromaDB
    collection = get_chroma_collection(settings.chroma_persist_dir)

    where_filter = None
    if camera_id:
        where_filter = {"camera_id": camera_id}

    chroma_results = search_captions(
        collection=collection,
        query_embedding=query_embedding_list,
        n_results=n_results,
        where=where_filter,
    )

    # 3. Parse results
    ids = chroma_results.get("ids", [[]])[0]
    distances = chroma_results.get("distances", [[]])[0]
    documents = chroma_results.get("documents", [[]])[0]
    metadatas = chroma_results.get("metadatas", [[]])[0]

    if not ids:
        return {
            "answer": f"No indexed footage found matching '{query}'. The caption index may still be building.",
            "results": [],
            "query": query,
        }

    # 4. Fetch full metadata from SQLite (includes thumbnails)
    sql_records = await get_captions_by_chroma_ids(ids)
    sql_map = {r["chroma_id"]: r for r in sql_records}

    # 5. Build enriched results
    # ChromaDB cosine distance ranges 0‑2.  Convert to a 0‑1 similarity score.
    results = []
    for i, chroma_id in enumerate(ids):
        sql_record = sql_map.get(chroma_id, {})
        raw_sim = 1.0 - (distances[i] / 2.0)          # 0‑2 → 1.0‑0.0
        display_sim = min(1.0, max(0.0, raw_sim))
        result = {
            "chroma_id": chroma_id,
            "camera_id": metadatas[i].get("camera_id", ""),
            "camera_name": metadatas[i].get("camera_name", ""),
            "video_time_seconds": metadatas[i].get("video_time_seconds", 0),
            "caption": documents[i],
            "distance": distances[i],
            "similarity": round(display_sim, 4),
            "timestamp": metadatas[i].get("timestamp", ""),
            "frame_thumbnail_b64": sql_record.get("frame_thumbnail_b64"),
        }
        results.append(result)

    # 6. Synthesize answer with Gemini
    try:
        prompt = search_synthesis_prompt(query, results)
        answer = await generate(
            api_key=settings.gemini_api_key,
            prompt=prompt,
            max_tokens=1024,
            temperature=0.3,
        )
    except Exception as e:
        logger.error("Gemini synthesis failed: %s", e)
        answer = f"Found {len(results)} matching clips but could not generate a summary. Error: {e}"

    return {
        "answer": answer,
        "results": results,
        "query": query,
    }


async def search_streaming(
    settings: Settings,
    query: str,
    camera_id: str | None = None,
    n_results: int = 10,
):
    """Search and stream the synthesized answer via SSE.

    Yields dicts suitable for SSE: {"type": "results"|"chunk"|"done", "data": ...}
    """
    # 1. Embed + search (same as above)
    model = await asyncio.to_thread(get_embedding_model)
    query_embedding = await asyncio.to_thread(model.encode, query)
    query_embedding_list = query_embedding.tolist()

    collection = get_chroma_collection(settings.chroma_persist_dir)
    where_filter = {"camera_id": camera_id} if camera_id else None

    chroma_results = search_captions(
        collection=collection,
        query_embedding=query_embedding_list,
        n_results=n_results,
        where=where_filter,
    )

    ids = chroma_results.get("ids", [[]])[0]
    distances = chroma_results.get("distances", [[]])[0]
    documents = chroma_results.get("documents", [[]])[0]
    metadatas = chroma_results.get("metadatas", [[]])[0]

    if not ids:
        yield {
            "type": "done",
            "data": {
                "answer": f"No indexed footage found matching '{query}'.",
                "results": [],
            },
        }
        return

    sql_records = await get_captions_by_chroma_ids(ids)
    sql_map = {r["chroma_id"]: r for r in sql_records}

    results = []
    for i, chroma_id in enumerate(ids):
        sql_record = sql_map.get(chroma_id, {})
        raw_sim = 1.0 - (distances[i] / 2.0)
        display_sim = min(1.0, max(0.0, raw_sim))
        results.append({
            "chroma_id": chroma_id,
            "camera_id": metadatas[i].get("camera_id", ""),
            "camera_name": metadatas[i].get("camera_name", ""),
            "video_time_seconds": metadatas[i].get("video_time_seconds", 0),
            "caption": documents[i],
            "distance": distances[i],
            "similarity": round(display_sim, 4),
            "timestamp": metadatas[i].get("timestamp", ""),
            "frame_thumbnail_b64": sql_record.get("frame_thumbnail_b64"),
        })

    # 2. Yield results immediately
    yield {"type": "results", "data": results}

    # 3. Stream synthesis from Gemini
    prompt = search_synthesis_prompt(query, results)
    try:
        async for chunk in generate_streaming(
            api_key=settings.gemini_api_key,
            prompt=prompt,
            max_tokens=1024,
            temperature=0.3,
        ):
            yield {"type": "chunk", "data": chunk}
    except Exception as e:
        logger.error("Gemini streaming failed: %s", e)
        yield {"type": "chunk", "data": f"\n\n[Error generating summary: {e}]"}

    yield {"type": "done", "data": None}
