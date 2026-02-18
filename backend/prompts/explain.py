"""Alert explanation prompt — sends alert context to Cosmos VLM for structured reasoning."""


def explain_alert_prompt(rule_text: str, confidence: str = "MEDIUM") -> str:
    """Build the alert explanation prompt for Cosmos VLM.

    Args:
        rule_text: The detection rule that triggered the alert.
        confidence: The confidence level from the original detection.
    """
    return f"""ROLE: Senior security analyst reviewing an automated alert.

ALERT DETAILS:
- Detection rule: "{rule_text}"
- Original confidence: {confidence}

TASK: Provide a thorough explanation of this alert for a human operator. Analyze the image and determine:

1. VERIFICATION: Is the alert a TRUE POSITIVE or FALSE POSITIVE? Re-examine the evidence independently.
2. DESCRIPTION: What exactly do you see in this frame? Be specific about people, objects, positions, actions.
3. EVIDENCE: What visual evidence supports or contradicts the alert condition?
4. CONTEXT: Are there environmental factors (lighting, angle, occlusion) that could affect accuracy?
5. RECOMMENDATION: What action should the operator take?

FORMAT your response as:

VERDICT: TRUE POSITIVE / FALSE POSITIVE / INCONCLUSIVE
CONFIDENCE: HIGH / MEDIUM / LOW

DESCRIPTION:
[2-3 sentences describing what you see]

EVIDENCE FOR ALERT:
- [bullet points of supporting evidence]

EVIDENCE AGAINST ALERT:
- [bullet points of contradicting evidence, or "None observed"]

ENVIRONMENTAL FACTORS:
- [any relevant context about image quality, angle, lighting]

RECOMMENDATION:
[1-2 sentences with specific action items]

Be direct, analytical, and evidence-based. No disclaimers."""


def explain_with_context_prompt(
    rule_text: str,
    confidence: str,
    scene_context: str = "",
    previous_captions: list[str] | None = None,
) -> str:
    """Extended explanation prompt with historical context.

    Args:
        rule_text: The detection rule.
        confidence: Original confidence level.
        scene_context: Scene description for the camera.
        previous_captions: Recent captions from the same camera for temporal context.
    """
    base = explain_alert_prompt(rule_text, confidence)

    additions = []
    if scene_context:
        additions.append(f"\nSCENE CONTEXT: {scene_context}")
    if previous_captions:
        history = "\n".join(f"  - {c}" for c in previous_captions[-5:])
        additions.append(f"\nRECENT ACTIVITY ON THIS CAMERA:\n{history}")

    if additions:
        return base + "\n\nADDITIONAL CONTEXT:" + "\n".join(additions)
    return base
