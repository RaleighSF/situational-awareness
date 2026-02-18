"""RAG search synthesis prompt — Gemini takes retrieved captions and synthesizes an answer."""


def search_synthesis_prompt(user_query: str, captions: list[dict], mode: str = "grid") -> str:
    """Build the RAG synthesis prompt.

    Args:
        user_query: The user's natural language search query.
        captions: List of dicts with keys: camera_name, video_time_seconds, caption, similarity.
        mode: "grid" (searching across all cameras) or "single" (searching one camera).
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

    if mode == "single":
        # Single camera view — focus on moments/timestamps within one feed
        mode_instructions = """CONTEXT: The user is viewing a single camera feed and wants to find specific moments within it.

INSTRUCTIONS:
1. State how many distinct moments matched within this camera's footage.
2. List the matching moments chronologically by timestamp.
3. For each moment, describe what was observed and at what time.
4. If the query asks about specific attributes (e.g., clothing color, action), only cite moments that explicitly show those attributes.
5. Highlight any safety concerns or anomalies if relevant.

FORMAT:
- Start with a 1-2 sentence summary stating how many moments were found.
- Follow with the moments listed by timestamp (e.g., "At 0:15 — ...").
- Keep it concise. No disclaimers about being an AI."""
    else:
        # Grid view — focus on which cameras have matches, one best result per camera
        mode_instructions = """CONTEXT: The user is viewing all cameras in a grid and wants to know which cameras have matching footage.

INSTRUCTIONS:
1. State how many distinct cameras have matching footage.
2. For each matching camera, briefly describe the best matching moment found.
3. Reference the camera name and timestamp for each match.
4. If the query asks about specific attributes (e.g., clothing color, action), only cite cameras where the footage explicitly shows those attributes.
5. Highlight any safety concerns or anomalies if relevant.

FORMAT:
- Start with a 1-2 sentence summary stating how many cameras have matches.
- Follow with one bullet per camera describing what was found and when.
- Keep it concise. No disclaimers about being an AI."""

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
