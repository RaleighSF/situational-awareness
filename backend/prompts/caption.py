"""Caption generation prompt for the indexer — adapted from proc-assist P_QA."""


def caption_prompt() -> str:
    """Generate a scene captioning prompt for Cosmos VLM.

    This produces a rich, searchable description of a video frame
    that will be embedded and stored for semantic search.
    """
    return (
        "ROLE: Expert visual scene descriptor for a video surveillance system.\n\n"
        "TASK: Describe this frame comprehensively for a searchable index.\n\n"
        "Include ALL of the following if visible:\n"
        "1. PEOPLE: count, positions, actions, clothing, interactions, body language\n"
        "2. VEHICLES: types, colors, positions, movement direction, license plates if visible\n"
        "3. OBJECTS: notable items, packages, equipment, tools, signage\n"
        "4. ENVIRONMENT: indoor/outdoor, lighting, weather conditions, time of day cues\n"
        "5. ACTIVITY: what is happening, workflow state, any anomalies\n"
        "6. SAFETY: PPE compliance, hazards, blocked exits, spills, fire/smoke\n\n"
        "Write 3-5 sentences. Be factual, specific, and detailed.\n"
        "Use precise terms (e.g., 'forklift' not 'vehicle', 'hard hat' not 'headgear').\n"
        "Do NOT speculate about intent or make assumptions beyond what is visible.\n"
        "No disclaimers. No metadata."
    )
