"""RAG search synthesis prompt — Gemini takes retrieved captions and synthesizes an answer."""


def search_synthesis_prompt(user_query: str, captions: list[dict]) -> str:
    """Build the RAG synthesis prompt.

    Args:
        user_query: The user's natural language search query.
        captions: List of dicts with keys: camera_name, video_time_seconds, caption, similarity.
    """
    # Format retrieved captions as context
    context_lines = []
    for i, cap in enumerate(captions, 1):
        time_str = _format_time(cap.get("video_time_seconds", 0))
        camera = cap.get("camera_name", "Unknown Camera")
        text = cap.get("caption", "")
        score = cap.get("similarity", 0)
        context_lines.append(f"[{i}] Camera: {camera} | Time: {time_str} | Relevance: {score:.0%}\n{text}")

    context = "\n\n".join(context_lines)

    return f"""You are an AI video analytics assistant. A user is searching through indexed video surveillance footage. These results have already been filtered for relevance.

SEARCH QUERY: "{user_query}"

MATCHING VIDEO CAPTIONS (pre-filtered and ranked by relevance):
{context}

INSTRUCTIONS:
1. Synthesize a clear, direct answer to the user's query based ONLY on captions that genuinely match.
2. Reference specific cameras and timestamps.
3. If the query asks about specific attributes (e.g., clothing color, object type), only cite captions that explicitly mention those attributes.
4. If the query asks for counts, provide the best estimate from available data.
5. Highlight any safety concerns or anomalies if relevant.

FORMAT:
- Start with a 1-2 sentence direct answer stating how many relevant matches were found.
- Follow with supporting details referencing specific clips.
- Keep it concise. No disclaimers about being an AI."""


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
