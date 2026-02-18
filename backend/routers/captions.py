"""GET /api/captions/* — Caption index status and timeline data."""

import logging
from fastapi import APIRouter, Query
from pydantic import BaseModel

from config import get_settings
from db.sqlite import get_caption_stats, get_timeline_events

logger = logging.getLogger("vss-api.captions")

router = APIRouter()


class CameraStats(BaseModel):
    """Per-camera indexing statistics."""
    camera_id: str
    camera_name: str
    count: int
    min_time: float | None
    max_time: float | None


class CaptionStatusResponse(BaseModel):
    """Overall caption indexing status."""
    total_captions: int
    cameras: list[CameraStats]


class TimelineEvent(BaseModel):
    """A single event on the timeline."""
    id: int
    camera_id: str
    camera_name: str
    timestamp: str
    video_time_seconds: float
    caption: str
    event_type: str = "caption"  # "caption", "alert", "scene_agent"


class TimelineResponse(BaseModel):
    """Timeline events for a camera."""
    camera_id: str
    events: list[TimelineEvent]
    total: int


@router.get("/captions/status", response_model=CaptionStatusResponse)
async def caption_status():
    """Get the current caption indexing status.

    Returns total caption count and per-camera breakdown.
    """
    stats = await get_caption_stats()
    return CaptionStatusResponse(
        total_captions=stats["total_captions"],
        cameras=[CameraStats(**c) for c in stats["cameras"]],
    )


@router.get("/captions/timeline", response_model=TimelineResponse)
async def caption_timeline(
    camera_id: str = Query(..., description="Camera ID to get timeline for"),
    limit: int = Query(500, ge=1, le=2000, description="Maximum events to return"),
):
    """Get timeline events for the event timeline component.

    Returns chronologically ordered events for a specific camera,
    including indexed captions, alert triggers, and Scene Agent reports.
    """
    events = await get_timeline_events(camera_id, limit=limit)

    timeline_events = [
        TimelineEvent(
            id=e["id"],
            camera_id=e["camera_id"],
            camera_name=e["camera_name"],
            timestamp=e["timestamp"],
            video_time_seconds=e["video_time_seconds"],
            caption=e["caption"],
            event_type="caption",
        )
        for e in events
    ]

    return TimelineResponse(
        camera_id=camera_id,
        events=timeline_events,
        total=len(timeline_events),
    )
