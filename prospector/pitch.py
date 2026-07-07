"""Step 4 — pitch angles via one batched Anthropic API call (the only AI step).

Sends every qualifying lead's evidence in a single request and asks for one
pitch line per lead as JSON. If ANTHROPIC_API_KEY is missing or the call
fails, returns {} and the pipeline continues with blank pitch columns.
"""

import json

MODEL = "claude-haiku-4-5-20251001"

PITCH_SCHEMA = {
    "type": "object",
    "properties": {
        "pitches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "place_id": {"type": "string"},
                    "pitch": {"type": "string"},
                },
                "required": ["place_id", "pitch"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["pitches"],
    "additionalProperties": False,
}


def _lead_evidence(lead: dict) -> dict:
    return {
        "place_id": lead["place_id"],
        "name": lead["name"],
        "rating": lead.get("rating"),
        "review_count": lead.get("review_count"),
        "website": lead.get("website") or "(none)",
        "issues": lead.get("issues_found", ""),
        "score": lead.get("score"),
    }


def generate_pitches(leads: list[dict], api_key: str | None, niche: str, area: str) -> dict[str, str]:
    """Return {place_id: pitch_line}. Empty dict if no key or on any failure."""
    if not leads:
        return {}
    if not api_key:
        print("  ANTHROPIC_API_KEY not set - skipping pitch angles (column left blank).")
        return {}
    try:
        import anthropic
    except ImportError:
        print("  'anthropic' package not installed - skipping pitch angles.")
        return {}

    evidence = [_lead_evidence(lead) for lead in leads]
    prompt = (
        f"You write one-line sales pitch angles for a local web-services business.\n"
        f"Below are {len(evidence)} local '{niche}' businesses in {area} whose websites "
        f"failed automated health checks (or who have no website).\n\n"
        f"For EACH business, write ONE punchy pitch line (under 30 words) that ties their "
        f"strongest proof of revenue (reviews/rating) to their specific website problem — "
        f'e.g. "127 reviews at 4.8 stars but the site fails on mobile — losing Google '
        f'traffic to competitors ranking above them."\n\n'
        f"Evidence:\n{json.dumps(evidence, indent=1)}\n\n"
        f"Return one pitch per place_id."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=100 * len(evidence) + 500,
            output_config={"format": {"type": "json_schema", "schema": PITCH_SCHEMA}},
            messages=[{"role": "user", "content": prompt}],
        )
        text = next(b.text for b in response.content if b.type == "text")
        data = json.loads(text)
        return {p["place_id"]: p["pitch"].strip() for p in data.get("pitches", [])}
    except anthropic.AuthenticationError:
        print("  Anthropic API key invalid - skipping pitch angles.")
    except anthropic.RateLimitError:
        print("  Anthropic API rate-limited - skipping pitch angles this run.")
    except Exception as exc:  # never let the AI step break the deterministic pipeline
        print(f"  Pitch generation failed ({type(exc).__name__}: {exc}) - skipping.")
    return {}
