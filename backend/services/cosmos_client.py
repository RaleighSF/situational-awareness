"""Async HTTP client for the Cosmos-Reason2-8B VLM endpoint.

Adapted from proc-assist/app.py Pydantic models and inference patterns.
"""

import logging
import httpx

logger = logging.getLogger("vss-api.cosmos")

# Timeout: Cosmos inference can take 30-90s per frame depending on load
_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


async def infer(
    endpoint: str,
    image_b64: str,
    prompt: str,
    mode: str = "qa",
    max_new_tokens: int = 512,
    roi: list[float] | None = None,
    scene_context: str | None = None,
) -> str:
    """Single-frame inference via Cosmos /infer endpoint.

    Args:
        endpoint: Cosmos API base URL (e.g., https://cosmos.agentdemos.com).
        image_b64: Base64-encoded image (without data URL prefix).
        prompt: The text prompt for the VLM.
        mode: Inference mode — "qa", "detect", or "caption".
        max_new_tokens: Maximum tokens to generate.
        roi: Optional ROI as [x1, y1, x2, y2] normalized 0..1.
        scene_context: Optional scene context string.

    Returns:
        The generated text response from Cosmos.
    """
    # Strip data URL prefix if present
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    payload = {
        "image_b64": image_b64,
        "prompt": prompt,
        "mode": mode,
        "max_new_tokens": max_new_tokens,
    }
    if roi:
        payload["roi"] = roi
    if scene_context:
        payload["scene_context"] = scene_context

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(f"{endpoint}/infer", json=payload)
        response.raise_for_status()
        result = response.json()
        text = result.get("text", "")
        # Strip chat markers (model sometimes echoes role tokens)
        text = _strip_chat_markers(text)
        return text


async def infer_batch(
    endpoint: str,
    frames: list[dict],
    max_new_tokens: int = 256,
) -> list[str]:
    """Multi-frame batch inference via Cosmos /infer_batch endpoint.

    Args:
        endpoint: Cosmos API base URL.
        frames: List of dicts with keys: image_b64, prompt, (optional) mode.
        max_new_tokens: Maximum tokens per frame.

    Returns:
        List of text responses, one per frame.
    """
    items = []
    for f in frames:
        b64 = f["image_b64"]
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        items.append({
            "image_b64": b64,
            "prompt": f.get("prompt", "Describe this scene."),
            "mode": f.get("mode", "qa"),
            "max_new_tokens": max_new_tokens,
        })

    payload = {"items": items}

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        response = await client.post(f"{endpoint}/infer_batch", json=payload)
        response.raise_for_status()
        result = response.json()
        results = result.get("results", [])
        return [_strip_chat_markers(r.get("text", "")) for r in results]


def _strip_chat_markers(text: str) -> str:
    """Remove common chat/role markers from model output."""
    import re
    cleaned = text
    cleaned = re.sub(r'^#{1,3}\s*(User|Assistant|System):\s*', '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r'^(user|assistant|system):\s*', '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r'<\|?(user|assistant|system|im_start|im_end|end_of_turn)\|?>\n?', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\[INST\]|\[/INST\]', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'<<SYS>>|<</SYS>>', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()
