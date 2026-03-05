"""Async HTTP client for the Cosmos-Reason2-8B VLM endpoint.

Adapted from proc-assist/app.py Pydantic models and inference patterns.
"""

import logging
import re

import httpx

logger = logging.getLogger("vss-api.cosmos")

# Timeout: Cosmos inference can take 30-90s per frame depending on load
_TIMEOUT = httpx.Timeout(120.0, connect=10.0)

# Persistent HTTP client — avoids TCP/TLS handshake on every call
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Return a module-level persistent async HTTP client."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _client


# Pre-compiled regexes for stripping chat markers (called on every response)
_RE_HEADING_ROLE = re.compile(r'^#{1,3}\s*(User|Assistant|System):\s*', re.IGNORECASE | re.MULTILINE)
_RE_BARE_ROLE = re.compile(r'^(user|assistant|system):\s*', re.IGNORECASE | re.MULTILINE)
_RE_SPECIAL_TOKENS = re.compile(r'<\|?(user|assistant|system|im_start|im_end|end_of_turn)\|?>\n?', re.IGNORECASE)
_RE_INST_TAGS = re.compile(r'\[INST\]|\[/INST\]', re.IGNORECASE)
_RE_SYS_TAGS = re.compile(r'<<SYS>>|<</SYS>>', re.IGNORECASE)


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

    client = _get_client()
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

    client = _get_client()
    response = await client.post(f"{endpoint}/infer_batch", json=payload)
    response.raise_for_status()
    result = response.json()
    results = result.get("results", [])
    return [_strip_chat_markers(r.get("text", "")) for r in results]


def _strip_chat_markers(text: str) -> str:
    """Remove common chat/role markers from model output."""
    cleaned = text
    cleaned = _RE_HEADING_ROLE.sub('', cleaned)
    cleaned = _RE_BARE_ROLE.sub('', cleaned)
    cleaned = _RE_SPECIAL_TOKENS.sub('', cleaned)
    cleaned = _RE_INST_TAGS.sub('', cleaned)
    cleaned = _RE_SYS_TAGS.sub('', cleaned)
    return cleaned.strip()
