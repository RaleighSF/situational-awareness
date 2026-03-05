"""Alert explanation service — sends alert frame + context to Cosmos VLM for structured reasoning."""

import logging

from config import Settings
from services.cosmos_client import infer
from prompts.explain import explain_alert_prompt, explain_with_context_prompt
from db.sqlite import get_captions_for_camera

logger = logging.getLogger("vss-api.explain")


async def explain_alert(
    settings: Settings,
    frame_b64: str,
    rule_text: str,
    confidence: str = "MEDIUM",
    camera_id: str | None = None,
    scene_context: str | None = None,
    bounding_box: dict | None = None,
) -> dict:
    """Generate a detailed explanation for an alert.

    Args:
        settings: App settings.
        frame_b64: Base64-encoded frame that triggered the alert.
        rule_text: The detection rule text.
        confidence: Original detection confidence.
        camera_id: Optional camera ID for historical context.
        scene_context: Optional scene context string.
        bounding_box: Optional ROI as {x, y, width, height} in 0-100%.

    Returns:
        Dict with "explanation" text and parsed structured fields.
    """
    # Build prompt with context if available
    previous_captions = None
    if camera_id:
        try:
            recent = await get_captions_for_camera(camera_id, limit=5)
            previous_captions = [r["caption"] for r in recent]
        except Exception as e:
            logger.warning("Could not fetch recent captions for context: %s", e)

    if previous_captions or scene_context:
        prompt = explain_with_context_prompt(
            rule_text=rule_text,
            confidence=confidence,
            scene_context=scene_context or "",
            previous_captions=previous_captions,
        )
    else:
        prompt = explain_alert_prompt(rule_text, confidence)

    # Convert bounding box to ROI format if provided
    roi = None
    if bounding_box:
        roi = [
            bounding_box["x"] / 100,
            bounding_box["y"] / 100,
            (bounding_box["x"] + bounding_box["width"]) / 100,
            (bounding_box["y"] + bounding_box["height"]) / 100,
        ]

    # Call Cosmos VLM
    try:
        explanation_text = await infer(
            endpoint=settings.cosmos_endpoint,
            image_b64=frame_b64,
            prompt=prompt,
            mode="qa",
            max_new_tokens=1024,
            roi=roi,
            scene_context=scene_context,
        )
    except Exception as e:
        logger.error("Cosmos explanation failed: %s", e)
        return {
            "explanation": f"Unable to generate explanation: {e}",
            "verdict": "ERROR",
            "confidence": "LOW",
            "sections": {},
        }

    # Extract chain-of-thought reasoning if present
    thinking, clean_text = _extract_thinking(explanation_text)

    # Parse structured response from the clean text (without <think> block)
    parsed = _parse_explanation(clean_text)

    return {
        "explanation": clean_text,
        "thinking": thinking,
        **parsed,
    }


def _extract_thinking(text: str) -> tuple[str | None, str]:
    """Extract <think>...</think> block from Cosmos response.

    Returns (thinking_text, remaining_text).
    """
    import re

    match = re.search(r'<think>([\s\S]*?)</think>', text)
    if match:
        thinking = match.group(1).strip()
        remaining = text[:match.start()] + text[match.end():]
        return thinking, remaining.strip()
    return None, text


def _parse_explanation(text: str) -> dict:
    """Parse the structured explanation response into sections."""
    import re

    result = {
        "verdict": "INCONCLUSIVE",
        "confidence": "MEDIUM",
        "sections": {},
    }

    # Extract verdict
    verdict_match = re.search(r'VERDICT:\s*(TRUE POSITIVE|FALSE POSITIVE|INCONCLUSIVE)', text, re.IGNORECASE)
    if verdict_match:
        result["verdict"] = verdict_match.group(1).upper()

    # Extract confidence
    conf_match = re.search(r'CONFIDENCE:\s*(HIGH|MEDIUM|LOW)', text, re.IGNORECASE)
    if conf_match:
        result["confidence"] = conf_match.group(1).upper()

    # Extract sections
    section_patterns = {
        "description": r'DESCRIPTION:\s*\n?([\s\S]*?)(?=\n(?:EVIDENCE|ENVIRONMENTAL|RECOMMENDATION|$))',
        "evidence_for": r'EVIDENCE FOR ALERT:\s*\n?([\s\S]*?)(?=\n(?:EVIDENCE AGAINST|ENVIRONMENTAL|RECOMMENDATION|$))',
        "evidence_against": r'EVIDENCE AGAINST ALERT:\s*\n?([\s\S]*?)(?=\n(?:ENVIRONMENTAL|RECOMMENDATION|$))',
        "environmental": r'ENVIRONMENTAL FACTORS:\s*\n?([\s\S]*?)(?=\n(?:RECOMMENDATION|$))',
        "recommendation": r'RECOMMENDATION:\s*\n?([\s\S]*?)$',
    }

    for key, pattern in section_patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            result["sections"][key] = match.group(1).strip()

    return result
