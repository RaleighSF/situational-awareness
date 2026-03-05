"""Caption generation prompt for the indexer — adapted from proc-assist P_QA."""


def caption_prompt(scene_context: str = "") -> str:
    """Generate a scene captioning prompt for Cosmos VLM.

    This produces a rich, searchable description of a video frame
    that will be embedded and stored for semantic search.

    Args:
        scene_context: Optional camera scene description (e.g. "Loading dock area,
            industrial warehouse"). When provided, the model can produce more
            relevant, camera-specific captions that improve search quality.
    """
    context_block = ""
    if scene_context and scene_context.strip():
        context_block = f"SCENE: {scene_context.strip()}\n\n"

    return (
        f"{context_block}"
        "ROLE: Expert visual analyst for a video surveillance and workplace intelligence system.\n\n"
        "TASK: Describe this frame precisely for a searchable index. Prioritize the three dimensions below.\n\n"
        "PRIORITY 1 — CLOTHING & APPEARANCE (always describe first if people are present):\n"
        "  - Exact clothing colors and types: shirt color, pants color, jacket, uniform, vest, hat\n"
        "  - PPE: hard hat (color), safety vest (color), gloves, goggles, steel-toed boots\n"
        "  - Any identifying features: logos, high-visibility stripes, badges\n\n"
        "PRIORITY 2 — ACTIONS & BEHAVIOR:\n"
        "  - What each person is doing: walking, carrying, operating, inspecting, sitting, running\n"
        "  - Task context: loading/unloading, assembling, monitoring, picking, sorting, driving\n"
        "  - Interaction patterns: working alone, collaborating, supervising, idle\n\n"
        "PRIORITY 3 — PRODUCTIVITY & SAFETY:\n"
        "  - Workflow state: active work, idle, bottleneck, equipment in use or idle\n"
        "  - Safety compliance: PPE present/absent, hazardous conditions, spills, fire/smoke\n"
        "  - Anomalies: unusual behavior, blocked pathways, unauthorized access areas, falls\n\n"
        "ALSO INCLUDE if visible:\n"
        "  - People count and positions\n"
        "  - Vehicles/equipment (use precise terms: forklift, conveyor belt, pallet jack)\n"
        "  - Environment: indoor/outdoor, lighting conditions\n\n"
        "Write 3-5 sentences. Be factual and specific. Use exact color names.\n"
        "No disclaimers. No metadata."
    )
