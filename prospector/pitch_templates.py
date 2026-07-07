"""Deterministic pitch angles — no AI, no API key.

Picks the lead's strongest problem (in sales-impact order) and formats a
one-line pitch from the evidence the pipeline already collected.
"""

# Highest-impact problem first; the first match wins the headline.
PRIORITY = [
    "no_website",
    "unreachable",
    "social_only",
    "no_viewport",
    "dated_platform",
    "dated_footer",
    "no_https",
    "slow_heavy",
    "bad_title",
]

TEMPLATES = {
    "no_website": "{name} has no website at all — {proof}customers searching {area} can't find or book them online.",
    "unreachable": "{name}'s website is dead — {proof}every search click currently lands on an error page.",
    "social_only": "{name} runs on Facebook/Linktree only — {proof}they're invisible in Google results a real site would win.",
    "no_viewport": "{name}'s site fails on mobile — {proof}most local searches happen on a phone and theirs doesn't render.",
    "dated_platform": "{name} is on a dated free-tier site builder — {proof}an easy visual upgrade pitch with a demo build.",
    "dated_footer": "{name}'s site was last touched years ago ({detail}) — {proof}it reads as closed-down to new customers.",
    "no_https": "{name}'s site has no HTTPS — {proof}browsers flag it 'Not secure' to every visitor.",
    "slow_heavy": "{name}'s site is painfully slow to load — {proof}visitors bounce before it renders.",
    "bad_title": "{name}'s site has no real page title — {proof}Google has nothing to rank them with.",
}

FALLBACK = "{name} is established in {area} but their web presence is underperforming — worth a quick demo build."


def _proof(lead: dict) -> str:
    """Short revenue/credibility clause from whatever evidence exists."""
    rating = lead.get("rating")
    reviews = lead.get("review_count") or 0
    if rating and reviews >= 10:
        return f"{reviews} reviews at {rating} stars prove the demand, yet "
    if lead.get("phone") and lead.get("has_hours"):
        return "an active listing with phone and posted hours proves they're real, yet "
    if lead.get("phone"):
        return "they're taking calls, yet "
    return ""


def build_pitch(lead: dict, issue_codes: list[str], area: str) -> str:
    detail = ""
    for note_source in ("dated_footer",):
        if note_source in issue_codes:
            detail = "outdated copyright year"
    codes = list(issue_codes)
    if not lead.get("website"):
        codes.insert(0, "no_website")
    for code in PRIORITY:
        if code in codes:
            return TEMPLATES[code].format(
                name=lead["name"], area=area, proof=_proof(lead), detail=detail
            )
    return FALLBACK.format(name=lead["name"], area=area)


def generate_pitches_offline(leads: list[dict], area: str) -> dict[str, str]:
    """Return {place_id: pitch} for every lead — instant, free, deterministic."""
    return {
        lead["place_id"]: build_pitch(lead, lead.get("_issue_codes", []), area)
        for lead in leads
    }
