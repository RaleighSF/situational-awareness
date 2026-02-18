#!/usr/bin/env python3
"""Seed demo data — pre-index video captions from the 8 demo video sources.

This script extracts frames from the demo MP4 videos at regular intervals,
sends each frame to the Cosmos VLM for captioning, embeds the captions,
and stores everything in ChromaDB + SQLite.

Run this ONCE before a demo to pre-populate the search index so that
"money shot" queries like "Show me all clips where a person loitered
near the entrance" return impressive results immediately.

Usage:
    cd backend/
    python -m scripts.seed_demo_data

Or from the project root:
    python scripts/seed_demo_data.py

Requirements:
    - Cosmos endpoint must be reachable
    - ffmpeg installed (for frame extraction from MP4s)
    - Backend dependencies installed (pip install -r backend/requirements.txt)
"""

import asyncio
import base64
import json
import logging
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Add backend to path
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("seed")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT", "https://cosmos.agentdemos.com")
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", str(BACKEND_DIR / "chroma_data"))
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", str(BACKEND_DIR / "vss_metadata.db"))

# Frame extraction settings
FRAME_INTERVAL_SECONDS = 5  # Extract 1 frame every N seconds (faster for seeding)
MAX_FRAMES_PER_VIDEO = 120  # Cap at 120 frames per video (10 minutes at 5s intervals)
FRAME_WIDTH = 1280  # Resize frames for faster Cosmos inference

# Demo video sources — maps to the Cosmos-Watcher attached_assets
COSMOS_WATCHER_DIR = PROJECT_ROOT / "Cosmos-Watcher"
DEMO_VIDEOS = [
    {
        "id": "loading-dock",
        "name": "Loading Dock",
        "path": COSMOS_WATCHER_DIR / "attached_assets" / "4473271-hd_1920_1080_30fps_1768617999296.mp4",
    },
    {
        "id": "product-picking",
        "name": "Product Picking",
        "path": COSMOS_WATCHER_DIR / "attached_assets" / "product-picking.mp4",
    },
    {
        "id": "engine-assembly",
        "name": "Engine Assembly",
        "path": COSMOS_WATCHER_DIR / "attached_assets" / "engine-assembly.mp4",
    },
    {
        "id": "parking-lot",
        "name": "Parking Lot",
        "path": COSMOS_WATCHER_DIR / "attached_assets" / "parking-lot.mp4",
    },
    {
        "id": "newspaper",
        "name": "The Newspaper",
        "path": COSMOS_WATCHER_DIR / "attached_assets" / "newspaper.mp4",
    },
]

# Caption prompt (same as backend/prompts/caption.py)
CAPTION_PROMPT = """ROLE: Expert visual scene descriptor for a video surveillance system.

TASK: Describe this frame comprehensively for a searchable index.

Include ALL of the following if visible:
1. PEOPLE: count, positions, actions, clothing, interactions, body language
2. VEHICLES: types, colors, positions, movement direction, license plates if visible
3. OBJECTS: notable items, packages, equipment, tools, signage
4. ENVIRONMENT: indoor/outdoor, lighting, weather conditions, time of day cues
5. ACTIVITY: what is happening, workflow state, any anomalies
6. SAFETY: PPE compliance, hazards, blocked exits, spills, fire/smoke

Write 3-5 sentences. Be factual, specific, and detailed.
Use precise terms (e.g., 'forklift' not 'vehicle', 'hard hat' not 'headgear').
Do NOT speculate about intent or make assumptions beyond what is visible.
No disclaimers. No metadata."""


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------


def get_video_duration(video_path: str) -> float:
    """Get video duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError) as e:
        logger.error("ffprobe failed for %s: %s", video_path, e)
        return 0


def extract_frame_at_time(video_path: str, time_seconds: float) -> str | None:
    """Extract a single frame at a given timestamp, return as base64 JPEG.

    Uses ffmpeg to seek and extract one frame.
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-ss", str(time_seconds),
                "-i", str(video_path),
                "-frames:v", "1",
                "-vf", f"scale={FRAME_WIDTH}:-1",
                "-f", "image2",
                "-vcodec", "mjpeg",
                "-q:v", "3",
                "pipe:1",
            ],
            capture_output=True,
            check=True,
            timeout=15,
        )
        if result.stdout:
            return base64.b64encode(result.stdout).decode("utf-8")
        return None
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.debug("Frame extraction failed at t=%.1fs: %s", time_seconds, e)
        return None


# ---------------------------------------------------------------------------
# Cosmos captioning
# ---------------------------------------------------------------------------


async def caption_frame(frame_b64: str) -> str | None:
    """Send a frame to Cosmos for captioning."""
    import httpx

    payload = {
        "image_b64": frame_b64,
        "prompt": CAPTION_PROMPT,
        "mode": "qa",
        "max_new_tokens": 512,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{COSMOS_ENDPOINT}/infer", json=payload)
            response.raise_for_status()
            result = response.json()
            text = result.get("text", "").strip()
            # Strip any chat markers
            import re
            text = re.sub(r'^(user|assistant|system):\s*', '', text, flags=re.IGNORECASE | re.MULTILINE)
            text = re.sub(r'<\|?[^>]+\|?>\n?', '', text)
            return text if len(text) > 10 else None
    except Exception as e:
        logger.error("Cosmos captioning failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Main seeding loop
# ---------------------------------------------------------------------------


async def seed_video(
    video: dict,
    collection,
    embedding_model,
) -> int:
    """Seed captions for a single video. Returns number of captions indexed."""
    video_path = video["path"]
    camera_id = video["id"]
    camera_name = video["name"]

    if not video_path.exists():
        logger.warning("Video not found: %s — skipping", video_path)
        return 0

    duration = get_video_duration(str(video_path))
    if duration <= 0:
        logger.warning("Could not determine duration for %s — skipping", camera_name)
        return 0

    num_frames = min(int(duration / FRAME_INTERVAL_SECONDS), MAX_FRAMES_PER_VIDEO)
    logger.info(
        "Seeding [%s]: %.0fs duration, extracting %d frames every %ds",
        camera_name, duration, num_frames, FRAME_INTERVAL_SECONDS,
    )

    # Import DB functions
    from db.sqlite import insert_caption, update_indexer_state
    from db.chroma import add_caption

    indexed = 0
    for i in range(num_frames):
        t = i * FRAME_INTERVAL_SECONDS

        # Extract frame
        frame_b64 = extract_frame_at_time(str(video_path), t)
        if not frame_b64:
            continue

        # Caption with Cosmos
        caption_text = await caption_frame(frame_b64)
        if not caption_text:
            logger.debug("[%s] t=%ds: empty caption, skipping", camera_name, t)
            continue

        # Embed
        embedding = embedding_model.encode(caption_text).tolist()

        # Store in ChromaDB
        chroma_id = f"{camera_id}_{t:.0f}_{uuid.uuid4().hex[:8]}"
        metadata = {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "video_time_seconds": float(t),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        add_caption(collection, chroma_id, caption_text, embedding, metadata)

        # Store in SQLite
        thumb_b64 = frame_b64[:500]  # Small reference
        await insert_caption(
            camera_id=camera_id,
            camera_name=camera_name,
            timestamp=datetime.now(timezone.utc).isoformat(),
            video_time_seconds=float(t),
            caption=caption_text,
            chroma_id=chroma_id,
            frame_thumbnail_b64=thumb_b64,
        )

        indexed += 1
        if indexed % 5 == 0:
            logger.info("[%s] %d/%d frames indexed (t=%ds)", camera_name, indexed, num_frames, t)

        # Rate limiting: don't overwhelm Cosmos
        await asyncio.sleep(0.5)

    # Update indexer state
    await update_indexer_state(camera_id, float(num_frames * FRAME_INTERVAL_SECONDS), indexed)
    logger.info("[%s] Done: %d captions indexed.", camera_name, indexed)
    return indexed


async def main():
    """Main seeding entry point."""
    logger.info("=" * 60)
    logger.info("VSS Demo Data Seeding")
    logger.info("=" * 60)
    logger.info("Cosmos endpoint: %s", COSMOS_ENDPOINT)
    logger.info("ChromaDB dir: %s", CHROMA_PERSIST_DIR)
    logger.info("SQLite DB: %s", SQLITE_DB_PATH)

    # Check ffmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except FileNotFoundError:
        logger.error("ffmpeg not found! Install it: brew install ffmpeg (Mac) or apt install ffmpeg (Linux)")
        sys.exit(1)

    # Check Cosmos reachability
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{COSMOS_ENDPOINT}/health")
            logger.info("Cosmos health: %s", response.status_code)
    except Exception as e:
        logger.warning("Cosmos health check failed: %s — proceeding anyway", e)

    # Initialize databases
    from db.sqlite import init_db
    from db.chroma import get_chroma_collection

    await init_db(SQLITE_DB_PATH)
    collection = get_chroma_collection(CHROMA_PERSIST_DIR)
    existing_count = collection.count()
    logger.info("Existing captions in ChromaDB: %d", existing_count)

    # Load embedding model
    from sentence_transformers import SentenceTransformer
    logger.info("Loading embedding model (all-MiniLM-L6-v2)...")
    embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    logger.info("Embedding model loaded.")

    # Check which videos exist
    available_videos = [v for v in DEMO_VIDEOS if v["path"].exists()]
    logger.info("Found %d/%d demo videos", len(available_videos), len(DEMO_VIDEOS))

    if not available_videos:
        logger.error("No demo videos found! Check the paths in DEMO_VIDEOS.")
        sys.exit(1)

    # Seed each video
    start_time = time.time()
    total_indexed = 0

    for video in available_videos:
        count = await seed_video(video, collection, embedding_model)
        total_indexed += count

    elapsed = time.time() - start_time
    final_count = collection.count()

    logger.info("=" * 60)
    logger.info("Seeding complete!")
    logger.info("  New captions indexed: %d", total_indexed)
    logger.info("  Total captions in DB: %d", final_count)
    logger.info("  Time elapsed: %.1fs", elapsed)
    logger.info("=" * 60)

    # Quick test search
    if total_indexed > 0:
        logger.info("Running test search: 'person at loading dock'")
        query_embedding = embedding_model.encode("person at loading dock").tolist()
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=3,
            include=["documents", "metadatas", "distances"],
        )
        if results["documents"] and results["documents"][0]:
            for i, (doc, meta, dist) in enumerate(
                zip(results["documents"][0], results["metadatas"][0], results["distances"][0])
            ):
                sim = 1 - dist
                logger.info(
                    "  [%d] %.0f%% | %s (t=%ss) | %s",
                    i + 1,
                    sim * 100,
                    meta.get("camera_name", "?"),
                    meta.get("video_time_seconds", "?"),
                    doc[:80] + "..." if len(doc) > 80 else doc,
                )


if __name__ == "__main__":
    asyncio.run(main())
