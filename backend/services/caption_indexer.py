"""Background caption indexer — captures frames from video sources, generates captions via Cosmos,
embeds them, and stores in ChromaDB + SQLite.

Runs as an asyncio background task. Rate-limited to avoid overwhelming Cosmos during live demos.
"""

import asyncio
import logging
import uuid
import time
import base64
from datetime import datetime, timezone

import httpx
from sentence_transformers import SentenceTransformer

from config import Settings
from db.chroma import get_chroma_collection, add_caption
from db.sqlite import insert_caption, update_indexer_state, get_indexer_state
from services.cosmos_client import infer
from prompts.caption import caption_prompt

logger = logging.getLogger("vss-api.indexer")

# Embedding model — loaded once, runs on CPU
_embedding_model: SentenceTransformer | None = None


def get_embedding_model() -> SentenceTransformer:
    """Lazy-load the sentence-transformers embedding model."""
    global _embedding_model
    if _embedding_model is None:
        logger.info("Loading embedding model (all-MiniLM-L6-v2)...")
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded.")
    return _embedding_model


class CaptionIndexer:
    """Background worker that continuously indexes video frames."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.running = False
        self._stop_event = asyncio.Event()
        self._rate_seconds = settings.caption_rate_seconds
        self._cosmos_endpoint = settings.cosmos_endpoint
        self._prompt = caption_prompt()

    def stop(self):
        """Signal the indexer to stop."""
        self._stop_event.set()

    async def run(self):
        """Main indexer loop — runs until stopped."""
        self.running = True
        logger.info("Caption indexer started.")

        # Load embedding model eagerly
        model = await asyncio.to_thread(get_embedding_model)

        # Fetch video sources from the Cosmos-Watcher Express backend
        sources = await self._fetch_video_sources()
        if not sources:
            logger.warning("No video sources found. Indexer will retry in 30s...")
            await asyncio.sleep(30)
            sources = await self._fetch_video_sources()

        if not sources:
            logger.error("Still no video sources. Indexer stopping.")
            self.running = False
            return

        logger.info("Indexing %d video sources in parallel, cycle every %ds.", len(sources), self._rate_seconds)

        while not self._stop_event.is_set():
            # Index all sources concurrently each cycle
            tasks = [self._index_source(source, model) for source in sources]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for source, result in zip(sources, results):
                if isinstance(result, Exception):
                    logger.error("Error indexing source %s: %s", source.get("name", "?"), result)

            # Wait for the next cycle
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self._rate_seconds)
                break  # Stop event was set
            except asyncio.TimeoutError:
                continue  # Timeout = time for next cycle

        self.running = False
        logger.info("Caption indexer stopped.")

    async def _fetch_video_sources(self) -> list[dict]:
        """Fetch video sources from the Cosmos-Watcher API."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.settings.frontend_api_url}/api/video-sources")
                response.raise_for_status()
                sources = response.json()
                logger.info("Found %d video sources.", len(sources))
                return sources
        except Exception as e:
            logger.error("Failed to fetch video sources: %s", e)
            return []

    async def _index_source(self, source: dict, model: SentenceTransformer):
        """Index a single frame from a video source."""
        camera_id = source.get("id", "")
        camera_name = source.get("name", "Unknown")
        video_url = source.get("url", "")

        if not video_url:
            return

        # Known durations for demo MP4s — prevents re-indexing after loop point
        _VIDEO_DURATIONS: dict[str, float] = {
            "/attached_assets/4473271-hd_1920_1080_30fps_1768617999296.mp4": 30,
            "/attached_assets/engine-assembly.mp4": 35,
            "/attached_assets/ring-camera.mp4": 31,
            "/attached_assets/plant-fire.mp4": 19,
            "/attached_assets/parking-lot.mp4": 37,
            "/attached_assets/product-picking.mp4": 19,
            "/attached_assets/doc-video.mp4": 61,
        }
        video_duration = _VIDEO_DURATIONS.get(video_url)

        # Get the indexer state for this camera
        state = await get_indexer_state(camera_id)
        last_video_time = state["last_video_time"] if state else 0
        total_captions = state["total_captions"] if state else 0

        # For demo videos (finite MP4s), skip if fully indexed
        if video_duration and last_video_time >= video_duration:
            logger.debug("Skipping %s — fully indexed (t=%.0fs >= duration=%.0fs)", camera_name, last_video_time, video_duration)
            return

        # For demo videos (MP4s), we increment the video time offset
        # In production with live RTSP, this would be wall-clock time
        current_video_time = last_video_time + self._rate_seconds

        # Capture a frame from the video source
        # For hosted MP4s, we extract a frame at the target time offset
        frame_b64 = await self._capture_frame(video_url, current_video_time)
        if not frame_b64:
            return

        # Generate caption via Cosmos VLM
        try:
            caption_text = await infer(
                endpoint=self._cosmos_endpoint,
                image_b64=frame_b64,
                prompt=self._prompt,
                mode="qa",
                max_new_tokens=512,
            )
        except Exception as e:
            logger.error("Cosmos caption failed for %s at t=%ds: %s", camera_name, current_video_time, e)
            return

        if not caption_text or len(caption_text) < 10:
            logger.warning("Empty or too-short caption for %s at t=%ds", camera_name, current_video_time)
            return

        # Generate embedding
        embedding = await asyncio.to_thread(model.encode, caption_text)
        embedding_list = embedding.tolist()

        # Store in ChromaDB
        chroma_id = f"{camera_id}_{current_video_time:.0f}_{uuid.uuid4().hex[:8]}"
        collection = get_chroma_collection(self.settings.chroma_persist_dir)
        metadata = {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "video_time_seconds": current_video_time,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        add_caption(collection, chroma_id, caption_text, embedding_list, metadata)

        # Store in SQLite
        # Create a small thumbnail (just store first 500 chars of b64 as reference)
        thumb_b64 = frame_b64[:500] if len(frame_b64) > 500 else frame_b64
        await insert_caption(
            camera_id=camera_id,
            camera_name=camera_name,
            timestamp=datetime.now(timezone.utc).isoformat(),
            video_time_seconds=current_video_time,
            caption=caption_text,
            chroma_id=chroma_id,
            frame_thumbnail_b64=thumb_b64,
        )

        # Update indexer state
        total_captions += 1
        await update_indexer_state(camera_id, current_video_time, total_captions)

        logger.info(
            "Indexed [%s] t=%.0fs: %s",
            camera_name,
            current_video_time,
            caption_text[:80] + "..." if len(caption_text) > 80 else caption_text,
        )

    async def _capture_frame(self, video_url: str, time_offset: float) -> str | None:
        """Capture a frame from a video source at a given time offset.

        For hosted MP4 videos, this downloads and extracts a frame.
        For live RTSP streams (Phase 2+), this would connect to the stream.

        Returns base64-encoded JPEG image, or None on failure.
        """
        # For the demo, we POST to a frame extraction endpoint on the Express backend
        # or we can use a simple approach: download the video headers to check duration
        # and then use a canvas-based extraction (client-side) or ffmpeg (server-side).
        #
        # Since the Cosmos-Watcher frontend already captures frames via canvas,
        # we'll use a simple HTTP-based approach: request a frame from the Express backend.
        # If no frame extraction endpoint exists, we'll add one.
        #
        # For now: attempt to capture via a /api/capture-frame endpoint
        # Fallback: return None and log
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"http://localhost:5000/api/capture-frame",
                    json={"url": video_url, "time_offset": time_offset},
                )
                if response.status_code == 200:
                    data = response.json()
                    return data.get("frame_b64", None)
                else:
                    # Fallback: for MP4s, we can try to download and use a placeholder
                    logger.debug(
                        "Frame capture endpoint not available (status %d). "
                        "Skipping frame for url=%s t=%.0f",
                        response.status_code,
                        video_url[:50],
                        time_offset,
                    )
                    return None
        except Exception as e:
            logger.debug("Frame capture failed: %s", e)
            return None
