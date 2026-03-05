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
# Kept low — Gemini reranker handles precision; we want broad recall here
_MIN_SIMILARITY = 0.30

# Max candidates to send to Gemini reranker. ChromaDB's embedding ranking means
# relevant results are always in the top N — fetching the entire corpus wastes
# Gemini calls on captions that are semantically distant from the query.
_MAX_RERANK_CANDIDATES = 80

# Rerank relevance threshold (Gemini scores 0-10; results below this are hidden).
# 5 = "partially matches" — keeps strong partial matches (e.g. "dark pants" for
# "dark clothing") while filtering out noise (0-4 = tangential or unrelated).
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
        # 100 chars is enough for Gemini to judge relevance — shorter = fewer tokens = faster
        safe_caption = cap["caption"].replace("\n", " ").replace("\r", " ")[:100]
        items.append(f"{i}: {safe_caption}")
    items_block = "\n".join(items)

    return f"""Rate how well each video caption matches this search query. Give a score 0-10.

QUERY: {query}

SCORING GUIDE:
- 9-10: Caption explicitly describes what the query asks for (direct match or clear synonym).
- 7-8: Caption describes something closely related — e.g. "dark pants" or "black attire" for "dark clothing".
- 5-6: Caption partially matches — some relevant details present but not the main focus.
- 3-4: Caption is in the same general context with minor relevance (e.g. same setting, nearby topic).
- 1-2: Caption mentions the general environment but lacks meaningful relevance to the query.
- 0: Caption is completely unrelated to the query.

RULES:
- Use semantic understanding — synonyms, partial matches, and implied attributes all count.
- "Dark pants", "black attire", "dark attire", "dressed in black" all score highly for "dark clothing".
- If the query is about clothing, score high for ANY caption that describes dark-colored garments on a person.
- Score based on overall relevance, not just exact keyword presence.
- A caption describing the same subject in different words should still score highly.

{items_block}

Output ONLY one score per line, index: score. You MUST score ALL {len(items)} captions — do not skip any. Example:
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

    Batches candidates in groups of 50 to avoid context-window truncation when the
    corpus is large. All batches run concurrently and scores are merged before sorting.

    Returns candidates with similarity overwritten by Gemini score (0.0-1.0),
    filtered to those at or above _RERANK_THRESHOLD.
    """
    if not candidates:
        return []

    import re
    _BATCH_SIZE = 50

    async def _score_batch(batch: list[dict], offset: int) -> dict[int, int]:
        """Score a single batch. Returns {global_candidate_index: score}."""
        prompt = _build_rerank_prompt(query, batch)
        try:
            raw = await generate(
                api_key=api_key,
                prompt=prompt,
                max_tokens=1500,  # 50 captions × ~5 output tokens
                temperature=0.0,
            )
            scores: dict[int, int] = {}
            for line in raw.strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                m = re.search(r'(\d+)\D+(\d+)', line)
                if m:
                    local_idx, score = int(m.group(1)), int(m.group(2))
                    scores[offset + local_idx] = score
            return scores
        except Exception as e:
            logger.warning("Rerank batch (offset=%d) failed: %s", offset, e)
            return {}

    # Split into batches and run concurrently
    batches = [
        (candidates[i:i + _BATCH_SIZE], i)
        for i in range(0, len(candidates), _BATCH_SIZE)
    ]
    batch_results = await asyncio.gather(
        *[_score_batch(batch, offset) for batch, offset in batches]
    )

    # Merge all batch scores
    score_map: dict[int, int] = {}
    for partial in batch_results:
        score_map.update(partial)

    if not score_map:
        logger.warning("Rerank: no scores from any batch — falling back to embedding ranking")
        return candidates

    logger.info("Rerank scores (%d/%d scored): %s", len(score_map), len(candidates), score_map)

    scored = []
    for idx, score in score_map.items():
        if 0 <= idx < len(candidates) and score >= _RERANK_THRESHOLD:
            result = candidates[idx].copy()
            result["similarity"] = round(score / 10.0, 4)
            scored.append(result)

    scored.sort(key=lambda r: r["similarity"], reverse=True)
    logger.info(
        "Reranked %d candidates → %d relevant (threshold=%d)",
        len(candidates), len(scored), _RERANK_THRESHOLD,
    )
    return scored


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

    # Fetch _MAX_RERANK_CANDIDATES from ChromaDB. The embedding model's cosine ranking
    # ensures semantically relevant captions always appear in the top N — going beyond
    # this just adds more Gemini batch calls for diminishing returns.
    fetch_count = _MAX_RERANK_CANDIDATES

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
    seen_slots: set[tuple] = set()  # deduplicate on (camera_id, video_time_seconds)

    for i, chroma_id in enumerate(ids):
        raw_sim = 1.0 - (distances[i] / 2.0)
        display_sim = min(1.0, max(0.0, raw_sim))

        # Hard similarity floor — skip obvious noise
        if display_sim < _MIN_SIMILARITY:
            continue

        cam_id = metadatas[i].get("camera_id", "")
        vid_time = metadatas[i].get("video_time_seconds", 0)
        slot = (cam_id, vid_time)
        if slot in seen_slots:
            continue  # skip duplicate (same camera + timestamp indexed twice)
        seen_slots.add(slot)

        sql_record = sql_map.get(chroma_id, {})
        candidates.append({
            "chroma_id": chroma_id,
            "camera_id": cam_id,
            "camera_name": metadatas[i].get("camera_name", ""),
            "video_time_seconds": vid_time,
            "caption": documents[i],
            "distance": distances[i],
            "similarity": round(display_sim, 4),
            "timestamp": metadatas[i].get("timestamp", ""),
            "frame_thumbnail_b64": sql_record.get("frame_thumbnail_b64"),
        })

    logger.info(
        "ChromaDB returned %d results, %d unique candidates passed threshold (%.2f)",
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
    mode: str = "grid",
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
        prompt = search_synthesis_prompt(query, results, mode=mode)
        answer = await generate(
            api_key=settings.gemini_api_key,
            prompt=prompt,
            max_tokens=400,
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
    mode: str = "grid",
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
    prompt = search_synthesis_prompt(query, results, mode=mode)
    try:
        async for chunk in generate_streaming(
            api_key=settings.gemini_api_key,
            prompt=prompt,
            max_tokens=400,
            temperature=0.3,
        ):
            yield {"type": "chunk", "data": chunk}
    except Exception as e:
        logger.error("Gemini streaming failed: %s", e)
        yield {"type": "chunk", "data": f"\n\n[Error generating summary: {e}]"}

    yield {"type": "done", "data": None}
