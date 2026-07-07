"""Step 5 — CSV output and terminal summary."""

import csv
from datetime import date
from pathlib import Path

CSV_COLUMNS = [
    "score",
    "name",
    "phone",
    "address",
    "website",
    "issues_found",
    "rating",
    "review_count",
    "pitch_angle",
    "maps_url",
    "place_id",
]


def write_csv(leads: list[dict], out_dir: Path) -> Path:
    """Write leads (already scored) sorted by score descending."""
    out_path = out_dir / f"leads_scored_{date.today().isoformat()}.csv"
    ordered = sorted(leads, key=lambda l: l.get("score") or 0, reverse=True)
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for lead in ordered:
            writer.writerow({col: lead.get(col, "") for col in CSV_COLUMNS})
    return out_path


def print_summary(
    found: int,
    excluded: int,
    disqualified: int,
    leads: list[dict],
    min_score: int,
    csv_path: Path,
    api_requests: int,
) -> None:
    qualifying = [l for l in leads if (l.get("score") or 0) >= min_score]
    top5 = sorted(leads, key=lambda l: l.get("score") or 0, reverse=True)[:5]

    print()
    print("=" * 60)
    print(f"  {found} businesses found")
    print(f"  {excluded} excluded (already in contacted.csv)")
    if disqualified:
        print(f"  {disqualified} disqualified (not operational)")
    print(f"  {len(qualifying)} scored >= {min_score}")
    print(f"  {api_requests} Google Places API request(s) used this run")
    print("-" * 60)
    print("  Top 5 by score:")
    for lead in top5:
        rating = f"{lead.get('rating')}★ x{lead.get('review_count')}" if lead.get("rating") else "no reviews"
        print(f"   [{lead.get('score')}] {lead['name']} ({rating})")
        if lead.get("issues_found"):
            print(f"        {lead['issues_found']}")
    print("-" * 60)
    print(f"  Wrote {csv_path}")
    print("=" * 60)
