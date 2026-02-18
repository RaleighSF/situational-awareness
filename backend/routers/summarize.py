"""POST /api/summarize — Time-range video summarization using indexed captions + Gemini."""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import get_settings
from db.sqlite import get_captions_in_time_range
from services.gemini_client import generate

logger = logging.getLogger("vss-api.summarize")

router = APIRouter()


class SummarizeRequest(BaseModel):
    """Summarize video activity over a time range."""
    camera_id: str | None = Field(None, description="Camera to summarize (None = all cameras)")
    start_time: float = Field(0, ge=0, description="Start time in seconds")
    end_time: float = Field(3600, ge=0, description="End time in seconds")
    focus: str | None = Field(None, description="Optional focus area (e.g., 'safety', 'traffic', 'people')")


class SummarizeResponse(BaseModel):
    """Summarization result."""
    summary: str
    caption_count: int
    time_range: str
    camera_id: str | None


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_time_range(req: SummarizeRequest):
    """Summarize video activity over a time range.

    Retrieves all indexed captions in the time window and asks Gemini
    to synthesize a comprehensive summary.
    """
    settings = get_settings()

    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini API key not configured")

    # Fetch captions in the time range
    captions = await get_captions_in_time_range(
        camera_id=req.camera_id,
        start_time=req.start_time,
        end_time=req.end_time,
        limit=200,
    )

    if not captions:
        time_range_str = f"{_format_time(req.start_time)} - {_format_time(req.end_time)}"
        return SummarizeResponse(
            summary=f"No indexed footage available for the requested time range ({time_range_str}). The caption index may still be building.",
            caption_count=0,
            time_range=time_range_str,
            camera_id=req.camera_id,
        )

    # Build prompt for Gemini
    caption_lines = []
    for cap in captions:
        t = _format_time(cap.get("video_time_seconds", 0))
        camera = cap.get("camera_name", "Unknown")
        text = cap.get("caption", "")
        caption_lines.append(f"[{t}] {camera}: {text}")

    captions_text = "\n".join(caption_lines)
    time_range_str = f"{_format_time(req.start_time)} - {_format_time(req.end_time)}"

    focus_instruction = ""
    if req.focus:
        focus_instruction = f"\nFOCUS AREA: Pay special attention to anything related to '{req.focus}'.\n"

    prompt = f"""You are an AI surveillance analyst summarizing video activity over a time period.

TIME RANGE: {time_range_str}
CAMERA: {req.camera_id or "All cameras"}
TOTAL OBSERVATIONS: {len(captions)}
{focus_instruction}
VIDEO CAPTIONS (chronological):
{captions_text}

INSTRUCTIONS:
1. Provide a comprehensive summary of what happened during this time period.
2. Organize by themes: activity patterns, notable events, safety observations, anomalies.
3. Mention specific timestamps and cameras when referencing events.
4. Highlight any security or safety concerns.
5. Note any patterns or trends (e.g., increasing foot traffic, repeated events).

FORMAT:
- Start with a 2-3 sentence executive summary.
- Follow with categorized details (Activity, Safety, Anomalies).
- End with a brief assessment of overall risk level.

Be concise but thorough. Write for a security operations professional."""

    try:
        summary = await generate(
            api_key=settings.gemini_api_key,
            prompt=prompt,
            max_tokens=1500,
            temperature=0.3,
        )
    except Exception as e:
        logger.error("Gemini summarization failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Summarization failed: {e}")

    return SummarizeResponse(
        summary=summary,
        caption_count=len(captions),
        time_range=time_range_str,
        camera_id=req.camera_id,
    )


def _format_time(seconds: float) -> str:
    """Format seconds to human-readable time."""
    if seconds < 0:
        return "0:00"
    m = int(seconds // 60)
    s = int(seconds % 60)
    if m >= 60:
        h = m // 60
        m = m % 60
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
