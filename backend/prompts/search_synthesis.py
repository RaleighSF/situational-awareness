"""RAG search synthesis prompt — Gemini takes retrieved captions and synthesizes an answer."""


def search_synthesis_prompt(user_query: str, captions: list[dict], mode: str = "grid") -> str:
    """Build the RAG synthesis prompt.

    Args:
        user_query: The user's natural language search query.
        captions: List of dicts with keys: camera_name, video_time_seconds, caption, similarity.
        mode: "grid" (searching across all cameras) or "single" (searching one camera).
    """
    context_lines = []
    for i, cap in enumerate(captions, 1):
        time_str = _format_time(cap.get("video_time_seconds", 0))
        camera = cap.get("camera_name", "Unknown Camera")
        # Truncate caption — synthesis only needs enough to understand the scene
        text = cap.get("caption", "")[:150]
        score = cap.get("similarity", 0)
        context_lines.append(f"[{i}] {camera} @ {time_str} ({score:.0%}): {text}")

    context = "\n".join(context_lines)

    if mode == "single":
        # Single camera view — focus on moments/timestamps within one feed
        mode_instructions = """CONTEXT: User is viewing a single camera feed, looking for specific moments.

Instructions: List matching moments chronologically. For each: time and brief description of what was observed. Keep it very concise — 2-3 sentences max total.

FORMATTING: Write in plain text only. Do NOT use any markdown — no asterisks, no bold (**), no italic (*), no bullet points, no headers. Just clean sentences."""
    else:
        # Grid view — focus on which cameras have matches, one best result per camera
        mode_instructions = """CONTEXT: User is viewing all cameras in a grid, looking for which cameras have matches.

Instructions: For each matching camera, state the camera name, timestamp, and one sentence describing what was found. Lead with a brief summary of how many cameras matched. Keep it very concise.

FORMATTING: Write in plain text only. Do NOT use any markdown — no asterisks, no bold (**), no italic (*), no bullet points, no headers. Just clean sentences separated by line breaks."""

    return f"""You are an AI video analytics assistant. A user is searching through indexed video surveillance footage. These results have already been filtered for relevance.

SEARCH QUERY: "{user_query}"

MATCHING VIDEO CAPTIONS (pre-filtered and ranked by relevance):
{context}

{mode_instructions}"""


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
