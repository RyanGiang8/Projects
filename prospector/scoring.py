"""Deterministic lead scoring — no AI.

Points (capped at 10):
  no website at all ............ 4
  unreachable or social-only ... 4
  no HTTPS ..................... 2
  no viewport meta ............. 3
  slow or heavy page ........... 2
  dated footer or platform ..... 2
  25+ reviews at rating >= 4.0 . +2 (proves real revenue)
  business not OPERATIONAL ..... disqualified (score None)
"""

MAX_SCORE = 10
PROVEN_REVENUE_REVIEWS = 25
PROVEN_REVENUE_RATING = 4.0

ISSUE_LABELS = {
    "no_website": "no website",
    "unreachable": "site unreachable",
    "social_only": "Facebook/Linktree only",
    "no_https": "no HTTPS",
    "no_viewport": "not mobile-responsive (no viewport tag)",
    "slow_heavy": "slow or heavy page",
    "dated_footer": "outdated copyright year",
    "dated_platform": "dated/free website platform",
    "bad_title": "missing or generic title tag",
}


def score_lead(lead: dict, issues: list[str]) -> int | None:
    """Return 0-10, or None if the business is disqualified."""
    status = lead.get("business_status", "")
    if status and status != "OPERATIONAL":
        return None

    points = 0
    if not lead.get("website"):
        points += 4
    if "unreachable" in issues or "social_only" in issues:
        points += 4
    if "no_https" in issues:
        points += 2
    if "no_viewport" in issues:
        points += 3
    if "slow_heavy" in issues:
        points += 2
    if "dated_footer" in issues or "dated_platform" in issues:
        points += 2

    rating = lead.get("rating") or 0
    reviews = lead.get("review_count") or 0
    if reviews >= PROVEN_REVENUE_REVIEWS and rating >= PROVEN_REVENUE_RATING:
        points += 2

    return min(points, MAX_SCORE)


def score_lead_keyless(lead: dict, issues: list[str]) -> int | None:
    """Scoring for OSM-sourced leads (no ratings available).

    Same weights as score_lead, but the +2 'proves real revenue' bonus uses an
    OSM proxy instead of reviews: a phone number AND posted opening hours,
    i.e. an actively maintained listing.
    """
    base = score_lead(lead, issues)
    if base is None:
        return None
    reviews = lead.get("review_count") or 0
    rating = lead.get("rating") or 0
    already_bonused = reviews >= PROVEN_REVENUE_REVIEWS and rating >= PROVEN_REVENUE_RATING
    if not already_bonused and lead.get("phone") and lead.get("has_hours"):
        base += 2
    return min(base, MAX_SCORE)


def describe_issues(lead: dict, issues: list[str]) -> str:
    """Human-readable, semicolon-separated issue list for the CSV."""
    labels = []
    if not lead.get("website"):
        labels.append(ISSUE_LABELS["no_website"])
    labels.extend(ISSUE_LABELS[i] for i in issues if i in ISSUE_LABELS)
    return "; ".join(labels)
