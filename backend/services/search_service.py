"""Semantic search service — embed query, search ChromaDB, rerank via Gemini, synthesize answer."""

import json
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

# Minimum cosine similarity to even consider a result (pre-rerank filter)
_MIN_SIMILARITY = 0.45

# Over-fetch multiplier: pull 3× from ChromaDB so we have enough after reranking
_OVERFETCH_MULTIPLIER = 3

# Rerank relevance threshold (Gemini scores 0-10; results below this are dropped)
_RERANK_THRESHOLD = 5


# ---------------------------------------------------------------------------
# Gemini-based reranker
# ---------------------------------------------------------------------------

def _build_rerank_prompt(query: str, captions: list[dict]) -> str:
    """Build a fast Gemini prompt that scores each caption's relevance to the query.

    Uses a simple line-based format (one score per line) instead of JSON to avoid
    truncation issues with large caption sets.
    """
    items = []
    for i, cap in enumerate(captions):
        safe_caption = cap["caption"].replace("\n", " ").replace("\r", " ")[:200]
        items.append(f"Caption {i}: {safe_caption}")
    items_block = "\n".join(items)

    return f"""Rate how well each video caption matches this search query. Give a score 0-10.

QUERY: {query}

SCORING GUIDE:
- 9-10: Caption explicitly mentions the exact thing (e.g. "black shirt" or "black t-shirt").
- 7-8: Caption mentions black clothing/attire that plausibly includes a shirt.
- 4-6: Caption mentions dark-colored clothing but not specifically black, or black item that isn't a shirt.
- 1-3: Caption mentions a person but no black clothing.
- 0: No person or clothing visible, or completely unrelated.

RULES:
- "black attire", "black jacket", "black clothing" → score 7-8 (close match).
- "dark attire" without specifying black → score 4-5.
- "white shirt", "purple shirt", "beige uniform" → score 0-2.
- Score based only on what is explicitly stated, not inferred.

{items_block}

Output ONLY one score per line, index: score. Score ALL {len(items)} captions. Example:
0: 8
1: 2
2: 0

Scores:"""


async def _rerank_with_gemini(
    api_key: str,
    query: str,
    candidates: list[dict],
) -> list[dict]:
    """Use Gemini to score and filter results by true relevance.

    Returns the candidates list with an added "rerank_score" key, sorted by score desc,
    filtered to only those above _RERANK_THRESHOLD.
    """
    if not candidates:
        return []

    prompt = _build_rerank_prompt(query, candidates)

    try:
        raw = await generate(
            api_key=api_key,
            prompt=prompt,
            max_tokens=512,   # Each entry is ~20 tokens; 15 entries = ~300 tokens
            temperature=0.0,
        )

        # Parse line-based scores: "0: 8\n1: 2\n..."
        text = raw.strip()
        score_map: dict[int, int] = {}
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            # Accept formats: "0: 8", "0 8", "Caption 0: 8"
            import re
            m = re.search(r'(\d+)\D+(\d+)', line)
            if m:
                idx, score = int(m.group(1)), int(m.group(2))
                score_map[idx] = score

        if not score_map:
            logger.warning("Rerank: could not parse any scores from response (len=%d): %s", len(text), text[:300])
            raise ValueError("No scores parsed from rerank response")

        logger.info("Rerank scores: %s", score_map)

        scored = []
        for idx, score in score_map.items():
            if 0 <= idx < len(candidates) and score >= _RERANK_THRESHOLD:
                result = candidates[idx].copy()
                result["similarity"] = round(score / 10.0, 4)
                scored.append(result)

        # Sort by rerank score descending
        scored.sort(key=lambda r: r["similarity"], reverse=True)
        logger.info(
            "Reranked %d candidates → %d relevant (threshold=%d)",
            len(candidates), len(scored), _RERANK_THRESHOLD,
        )
        return scored

    except Exception as e:
        logger.warning("Gemini rerank failed, falling back to embedding-only ranking: %s", e)
        # Fallback: return all candidates as-is (no reranking)
        return candidates


# ---------------------------------------------------------------------------
# Shared: fetch + filter candidates from ChromaDB
# ---------------------------------------------------------------------------

async def _fetch_candidates(
    settings: Settings,
    query: str,
    camera_id: str | None,
    n_results: int,
) -> list[dict]:
    """Embed query, search ChromaDB, apply similarity threshold, enrich with SQLite metadata."""
    model = await asyncio.to_thread(get_embedding_model)
    query_embedding = await asyncio.to_thread(model.encode, query)
    query_embedding_list = query_embedding.tolist()

    collection = get_chroma_collection(settings.chroma_persist_dir)
    where_filter = {"camera_id": camera_id} if camera_id else None

    # Over-fetch so we have enough after filtering
    fetch_count = min(n_results * _OVERFETCH_MULTIPLIER, 50)

    chroma_results = search_captions(
        collection=collection,
        query_embedding=query_embedding_list,
        n_results=fetch_count,
        where=where_filter,
    )

    ids = chroma_results.get("ids", [[]])[0]
    distances = chroma_results.get("distances", [[]])[0]
    documents = chroma_results.get("documents", [[]])[0]
    metadatas = chroma_results.get("metadatas", [[]])[0]

    if not ids:
        return []

    # Fetch full metadata from SQLite
    sql_records = await get_captions_by_chroma_ids(ids)
    sql_map = {r["chroma_id"]: r for r in sql_records}

    candidates = []
    for i, chroma_id in enumerate(ids):
        raw_sim = 1.0 - (distances[i] / 2.0)
        display_sim = min(1.0, max(0.0, raw_sim))

        # Hard similarity floor — skip obvious noise
        if display_sim < _MIN_SIMILARITY:
            continue

        sql_record = sql_map.get(chroma_id, {})
        candidates.append({
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

    logger.info(
        "ChromaDB returned %d results, %d passed similarity threshold (%.2f)",
        len(ids), len(candidates), _MIN_SIMILARITY,
    )
    return candidates


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def search(
    settings: Settings,
    query: str,
    camera_id: str | None = None,
    n_results: int = 10,
) -> dict:
    """Search indexed captions semantically, rerank with Gemini, and return synthesized results."""

    # 1. Fetch candidates (embedding search + similarity threshold)
    candidates = await _fetch_candidates(settings, query, camera_id, n_results)

    if not candidates:
        return {
            "answer": f"No indexed footage found matching '{query}'. The caption index may still be building.",
            "results": [],
            "query": query,
        }

    # 2. Rerank with Gemini (LLM-based relevance scoring)
    results = await _rerank_with_gemini(settings.gemini_api_key, query, candidates)

    # Cap to requested count
    results = results[:n_results]

    if not results:
        return {
            "answer": f"No footage clearly matched '{query}'. The indexed captions did not contain strong evidence of what you're looking for.",
            "results": [],
            "query": query,
        }

    # 3. Synthesize answer with Gemini
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
    """Search, rerank, and stream the synthesized answer via SSE."""

    # 1. Fetch candidates
    candidates = await _fetch_candidates(settings, query, camera_id, n_results)

    if not candidates:
        yield {
            "type": "done",
            "data": {
                "answer": f"No indexed footage found matching '{query}'.",
                "results": [],
            },
        }
        return

    # 2. Rerank with Gemini
    results = await _rerank_with_gemini(settings.gemini_api_key, query, candidates)
    results = results[:n_results]

    if not results:
        yield {
            "type": "done",
            "data": {
                "answer": f"No footage clearly matched '{query}'.",
                "results": [],
            },
        }
        return

    # 3. Yield reranked results immediately
    yield {"type": "results", "data": results}

    # 4. Stream synthesis from Gemini
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
