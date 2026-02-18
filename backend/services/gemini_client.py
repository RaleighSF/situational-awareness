"""Async Gemini API client for RAG synthesis and LLM tasks.

Uses the google-genai SDK (unified SDK for Gemini).
Designed to be swappable — all LLM calls go through this module.
"""

import logging
from google import genai
from google.genai import types

logger = logging.getLogger("vss-api.gemini")

_client: genai.Client | None = None


def get_client(api_key: str) -> genai.Client:
    """Get or create the Gemini client."""
    global _client
    if _client is None:
        _client = genai.Client(api_key=api_key)
    return _client


async def generate(
    api_key: str,
    prompt: str,
    model: str = "gemini-2.5-flash",
    max_tokens: int = 2048,
    temperature: float = 0.3,
) -> str:
    """Generate text using Gemini.

    Args:
        api_key: Gemini API key.
        prompt: The full prompt text.
        model: Model name (default: gemini-2.5-flash).
        max_tokens: Maximum output tokens.
        temperature: Sampling temperature.

    Returns:
        Generated text response.
    """
    client = get_client(api_key)

    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            ),
        )
        return response.text or ""
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        raise


async def generate_streaming(
    api_key: str,
    prompt: str,
    model: str = "gemini-2.5-flash",
    max_tokens: int = 2048,
    temperature: float = 0.3,
):
    """Generate text using Gemini with streaming.

    Yields text chunks as they arrive.
    """
    client = get_client(api_key)

    try:
        response = client.models.generate_content_stream(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            ),
        )
        for chunk in response:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        logger.error("Gemini streaming error: %s", e)
        raise
