"""POST /api/explain — Alert explanation using Cosmos VLM structured reasoning."""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import get_settings
from services.explain_service import explain_alert

logger = logging.getLogger("vss-api.explain")

router = APIRouter()


class ExplainRequest(BaseModel):
    """Request to explain a triggered alert."""
    frame_b64: str = Field(..., description="Base64-encoded frame that triggered the alert")
    rule_text: str = Field(..., description="The detection rule text")
    confidence: str = Field("MEDIUM", description="Original detection confidence")
    camera_id: str | None = Field(None, description="Camera ID for historical context")
    scene_context: str | None = Field(None, description="Scene context string")
    bounding_box: dict | None = Field(None, description="ROI as {x, y, width, height} in 0-100%")


class ExplainSection(BaseModel):
    """A section of the explanation."""
    description: str | None = None
    evidence_for: str | None = None
    evidence_against: str | None = None
    environmental: str | None = None
    recommendation: str | None = None


class ExplainResponse(BaseModel):
    """Structured alert explanation."""
    explanation: str
    verdict: str
    confidence: str
    sections: ExplainSection
    thinking: str | None = None


@router.post("/explain", response_model=ExplainResponse)
async def explain_alert_endpoint(req: ExplainRequest):
    """Generate a detailed explanation for a triggered alert.

    Sends the alert frame and context to Cosmos VLM for structured
    reasoning about whether the alert is a true/false positive,
    with evidence and recommendations.
    """
    settings = get_settings()

    result = await explain_alert(
        settings=settings,
        frame_b64=req.frame_b64,
        rule_text=req.rule_text,
        confidence=req.confidence,
        camera_id=req.camera_id,
        scene_context=req.scene_context,
        bounding_box=req.bounding_box,
    )

    return ExplainResponse(
        explanation=result["explanation"],
        verdict=result["verdict"],
        confidence=result["confidence"],
        sections=ExplainSection(**result.get("sections", {})),
        thinking=result.get("thinking"),
    )
