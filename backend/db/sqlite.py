"""SQLite metadata store for caption records, timestamps, and camera associations."""

import aiosqlite
import json
from datetime import datetime

_db_path: str = ""


async def init_db(db_path: str):
    """Initialize the SQLite database with required tables."""
    global _db_path
    _db_path = db_path

    async with aiosqlite.connect(db_path) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS captions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camera_id TEXT NOT NULL,
                camera_name TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                video_time_seconds REAL DEFAULT 0,
                caption TEXT NOT NULL,
                chroma_id TEXT UNIQUE NOT NULL,
                frame_thumbnail_b64 TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_captions_camera_id ON captions(camera_id)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_captions_timestamp ON captions(timestamp)
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS indexer_state (
                camera_id TEXT PRIMARY KEY,
                last_video_time REAL DEFAULT 0,
                last_indexed_at TEXT,
                total_captions INTEGER DEFAULT 0
            )
        """)
        await db.commit()


async def get_db():
    """Get a database connection."""
    return aiosqlite.connect(_db_path)


async def insert_caption(
    camera_id: str,
    camera_name: str,
    timestamp: str,
    video_time_seconds: float,
    caption: str,
    chroma_id: str,
    frame_thumbnail_b64: str | None = None,
) -> int:
    """Insert a new caption record. Returns the row ID."""
    async with aiosqlite.connect(_db_path) as db:
        cursor = await db.execute(
            """
            INSERT INTO captions (camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, frame_thumbnail_b64)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, frame_thumbnail_b64),
        )
        await db.commit()
        return cursor.lastrowid


async def get_captions_for_camera(camera_id: str, limit: int = 100, offset: int = 0) -> list[dict]:
    """Get captions for a specific camera, ordered by timestamp."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, created_at
            FROM captions
            WHERE camera_id = ?
            ORDER BY video_time_seconds ASC
            LIMIT ? OFFSET ?
            """,
            (camera_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_captions_by_chroma_ids(chroma_ids: list[str]) -> list[dict]:
    """Fetch caption metadata for a list of ChromaDB IDs."""
    if not chroma_ids:
        return []
    placeholders = ",".join(["?"] * len(chroma_ids))
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            f"""
            SELECT id, camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, frame_thumbnail_b64, created_at
            FROM captions
            WHERE chroma_id IN ({placeholders})
            """,
            chroma_ids,
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_captions_in_time_range(
    camera_id: str | None,
    start_time: float,
    end_time: float,
    limit: int = 200,
) -> list[dict]:
    """Get captions within a video time range, optionally filtered by camera."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        if camera_id:
            cursor = await db.execute(
                """
                SELECT id, camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, created_at
                FROM captions
                WHERE camera_id = ? AND video_time_seconds BETWEEN ? AND ?
                ORDER BY video_time_seconds ASC
                LIMIT ?
                """,
                (camera_id, start_time, end_time, limit),
            )
        else:
            cursor = await db.execute(
                """
                SELECT id, camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, created_at
                FROM captions
                ORDER BY video_time_seconds ASC
                LIMIT ?
                """,
                (limit,),
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_caption_stats() -> dict:
    """Get overall caption indexing statistics."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row

        # Total count
        cursor = await db.execute("SELECT COUNT(*) as total FROM captions")
        row = await cursor.fetchone()
        total = row["total"] if row else 0

        # Per-camera counts
        cursor = await db.execute(
            """
            SELECT camera_id, camera_name, COUNT(*) as count,
                   MIN(video_time_seconds) as min_time,
                   MAX(video_time_seconds) as max_time
            FROM captions
            GROUP BY camera_id
            """
        )
        rows = await cursor.fetchall()
        cameras = [dict(row) for row in rows]

        return {"total_captions": total, "cameras": cameras}


async def update_indexer_state(camera_id: str, last_video_time: float, total_captions: int):
    """Update the indexer state for a camera."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute(
            """
            INSERT INTO indexer_state (camera_id, last_video_time, last_indexed_at, total_captions)
            VALUES (?, ?, datetime('now'), ?)
            ON CONFLICT(camera_id) DO UPDATE SET
                last_video_time = excluded.last_video_time,
                last_indexed_at = excluded.last_indexed_at,
                total_captions = excluded.total_captions
            """,
            (camera_id, last_video_time, total_captions),
        )
        await db.commit()


async def get_indexer_state(camera_id: str) -> dict | None:
    """Get the current indexer state for a camera."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM indexer_state WHERE camera_id = ?",
            (camera_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_timeline_events(camera_id: str, limit: int = 500) -> list[dict]:
    """Get timeline events (captions) for the event timeline component."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, camera_id, camera_name, timestamp, video_time_seconds, caption, chroma_id, created_at
            FROM captions
            WHERE camera_id = ?
            ORDER BY video_time_seconds ASC
            LIMIT ?
            """,
            (camera_id, limit),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
