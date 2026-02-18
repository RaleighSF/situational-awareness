"""RAG search synthesis prompt — Gemini takes retrieved captions and synthesizes an answer."""


def search_synthesis_prompt(user_query: str, captions: list[dict]) -> str:
    """Build the RAG synthesis prompt.

    Args:
        user_query: The user's natural language search query.
        captions: List of dicts with keys: camera_name, video_time_seconds, caption, distance.
    """
    # Format retrieved captions as context
    context_lines = []
    for i, cap in enumerate(captions, 1):
        time_str = _format_time(cap.get("video_time_seconds", 0))
        camera = cap.get("camera_name", "Unknown Camera")
        text = cap.get("caption", "")
        score = 1 - cap.get("distance", 0)  # Convert distance to similarity
        context_lines.append(f"[{i}] Camera: {camera} | Time: {time_str} | Relevance: {score:.0%}\n{text}")

    context = "\n\n".join(context_lines)

    return f"""You are an AI video analytics assistant. A user is searching through indexed video surveillance footage.

SEARCH QUERY: "{user_query}"

RETRIEVED VIDEO CAPTIONS (ranked by relevance):
{context}

INSTRUCTIONS:
1. Synthesize a clear, direct answer to the user's query based on the retrieved captions.
2. Reference specific cameras and timestamps when relevant.
3. If the captions contain relevant matches, describe what was found.
4. If no captions are relevant to the query, say so honestly.
5. If the query asks for counts, provide the best estimate from available data.
6. Highlight any safety concerns or anomalies if relevant.

FORMAT:
- Start with a 1-2 sentence direct answer.
- Follow with supporting details referencing specific clips.
- End with any caveats about coverage gaps (e.g., "Note: only X cameras were indexed during this period").

Be concise but thorough. No disclaimers about being an AI."""


def _format_time(seconds: float) -> str:
    """Format seconds into a human-readable time string."""
    if seconds < 0:
        return "0:00"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    if minutes >= 60:
        hours = minutes // 60
        minutes = minutes % 60
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"
