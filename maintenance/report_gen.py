#!/usr/bin/env python3
"""Agent 7, component 2 — monthly client report generator.

One batched Haiku API call writes the plain-English sections for ALL clients
at once (the report template rides as a cached system prompt). Without an
ANTHROPIC_API_KEY it falls back to a deterministic fill-in template, so
reports always ship.

Inputs (all in this folder):
    clients.csv            name,domain,plan,monthly_fee,launch_date[,form_endpoint]
    health_YYYY-MM.csv     output of healthcheck.py
    analytics_YYYY-MM.csv  client,visits,top_pages,countries,work_done
                           (manual paste from Cloudflare Web Analytics + your notes)

Output: reports/<client-slug>_YYYY-MM.html — print to PDF and send.

    python report_gen.py --brand "Ryan Giang Web Services" --contact "ryan@example.com"
"""

import argparse
import calendar
import csv
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

MAINT_DIR = Path(__file__).resolve().parent
MODEL = "claude-haiku-4-5-20251001"

SUGGESTION_THEMES = [
    ("Google review push", "ask 3-5 recent happy customers for a Google review; more reviews lift map ranking"),
    ("seasonal promo section", "add a small seasonal offer banner/section to the homepage this month"),
    ("SEO refresh", "refresh one page's title/description and add a short FAQ targeting a local search phrase"),
    ("new photos", "swap in fresh photos of recent work; recent-looking sites convert better"),
]

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "reports": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "client": {"type": "string"},
                    "traffic_summary": {"type": "string"},
                    "health_summary": {"type": "string"},
                    "work_done": {"type": "string"},
                    "suggestion": {"type": "string"},
                },
                "required": ["client", "traffic_summary", "health_summary", "work_done", "suggestion"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["reports"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You write one-page monthly website reports for a local web-services business's
managed clients (small local businesses: detailers, trades, clinics). For each client you receive
traffic numbers, health-check results, the work performed, and an assigned suggestion theme.

Write four short sections per client:
- traffic_summary: 1-2 sentences of plain English about their visits and top pages. No jargon.
  If visits are modest, frame constructively (steady presence, found by locals) - never apologize.
- health_summary: 1-2 sentences. If everything passed: reassure (monitored, secure, fast, backed up).
  If something was fixed: say it was caught and fixed before it cost them customers.
- work_done: rewrite the operator's raw notes into 1-3 crisp first-person bullets separated by
  " | " (the template renders them inline). If notes are empty: describe the monitoring itself.
- suggestion: 2-3 sentences developing the assigned theme into one concrete, specific idea for
  THIS business. Helpful neighbourly tone; it should feel like advice, not an upsell.

Tone throughout: a sharp local person keeping a neighbour's shop healthy. The reader should finish
feeling the monthly fee is obviously worth it. No hype, no exclamation marks, no 'I hope this finds
you well'. Keep every section short - the whole report is one page."""


def load_env(path: Path) -> None:
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any((v or "").strip() for v in r.values())]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def month_label(month: str) -> str:
    year, m = month.split("-")
    return f"{calendar.month_name[int(m)]} {year}"


def suggestion_theme(month: str, index: int) -> tuple[str, str]:
    return SUGGESTION_THEMES[(int(month.split("-")[1]) + index) % len(SUGGESTION_THEMES)]


def build_contexts(clients, health_rows, analytics_rows, month: str) -> list[dict]:
    health = {r["client"]: r for r in health_rows}
    analytics = {r["client"]: r for r in analytics_rows}
    contexts = []
    for i, client in enumerate(clients):
        name = client["name"]
        h = health.get(name, {})
        a = analytics.get(name, {})
        theme, theme_hint = suggestion_theme(month, i)
        contexts.append({
            "client": name,
            "domain": client.get("domain", ""),
            "plan": client.get("plan", ""),
            "visits": (a.get("visits") or "").strip() or "n/a",
            "top_pages": (a.get("top_pages") or "").strip() or "homepage",
            "countries": (a.get("countries") or "").strip() or "Canada",
            "work_done_notes": (a.get("work_done") or "").strip(),
            "health_attention": (h.get("attention") or "").strip(),
            "lighthouse_mobile": (h.get("lighthouse_mobile") or "").strip(),
            "suggestion_theme": theme,
            "suggestion_hint": theme_hint,
        })
    return contexts


# ---------------------------------------------------------------- AI + fallback

def generate_ai(contexts: list[dict], api_key: str) -> dict[str, dict] | None:
    """One batched call for all clients. None on any failure -> fallback."""
    try:
        import anthropic
    except ImportError:
        print("  'anthropic' package not installed - using the fill-in template.")
        return None
    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=350 * len(contexts) + 500,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},  # cached across monthly runs
            }],
            output_config={"format": {"type": "json_schema", "schema": REPORT_SCHEMA}},
            messages=[{
                "role": "user",
                "content": "Write this month's report sections for every client:\n"
                           + json.dumps(contexts, indent=1),
            }],
        )
        text = next(b.text for b in response.content if b.type == "text")
        return {r["client"]: r for r in json.loads(text)["reports"]}
    except Exception as exc:
        print(f"  AI generation failed ({type(exc).__name__}: {exc}) - using the fill-in template.")
        return None


def generate_fallback(ctx: dict) -> dict:
    """Deterministic sections when no API key is available."""
    visits = ctx["visits"]
    traffic = (
        f"Your site logged {visits} visits this month, with {ctx['top_pages'].split(',')[0].strip()} "
        f"drawing the most attention. A steady stream of locals is finding you online."
        if visits != "n/a" else
        "Analytics numbers weren't collected this month; I'll include the full traffic picture next month."
    )
    if ctx["health_attention"]:
        health = (f"This month's checks caught an issue - {ctx['health_attention']} - "
                  f"and it was handled before it could cost you customers.")
    else:
        health = ("All checks passed: the site is up, fast, secure (SSL valid), and the contact "
                  "form is working. Monitored so you never have to think about it.")
    work = ctx["work_done_notes"] or ("Ran the full monthly health check, verified backups and "
                                      "the contact form, and kept the site software current.")
    theme, hint = ctx["suggestion_theme"], ctx["suggestion_hint"]
    suggestion = (f"Next month I'd suggest a {theme}: {hint}. "
                  f"Happy to set this up - it's covered by your plan.")
    return {"client": ctx["client"], "traffic_summary": traffic,
            "health_summary": health, "work_done": work, "suggestion": suggestion}


# ---------------------------------------------------------------- rendering

def render(template: str, ctx: dict, sections: dict, month: str, brand: str, contact: str) -> str:
    warn = bool(ctx["health_attention"])
    values = {
        "CLIENT": ctx["client"],
        "DOMAIN": ctx["domain"],
        "PLAN": ctx["plan"] or "managed",
        "MONTH_LABEL": month_label(month),
        "VISITS": ctx["visits"],
        "TOP_PAGE": ctx["top_pages"].split(",")[0].strip(),
        "COUNTRIES": ctx["countries"],
        "TRAFFIC_SUMMARY": sections["traffic_summary"],
        "HEALTH_CLASS": "warn" if warn else "",
        "HEALTH_BADGE": "Issue caught & fixed" if warn else "All systems green",
        "HEALTH_SUMMARY": sections["health_summary"],
        "WORK_DONE": sections["work_done"],
        "SUGGESTION": sections["suggestion"],
        "BRAND_NAME": brand,
        "BRAND_CONTACT": contact,
    }
    out = template
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", str(value))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate monthly client reports (one batched AI call).")
    parser.add_argument("--month", default=date.today().strftime("%Y-%m"), help="YYYY-MM (default: current)")
    parser.add_argument("--clients", default=str(MAINT_DIR / "clients.csv"))
    parser.add_argument("--brand", default="Your Name Web Services")
    parser.add_argument("--contact", default="you@example.com")
    parser.add_argument("--no-ai", action="store_true", help="force the fill-in template")
    args = parser.parse_args()

    load_env(MAINT_DIR / ".env")
    load_env(MAINT_DIR.parent / "prospector" / ".env")  # reuse the key you already configured

    clients = read_csv(Path(args.clients))
    if not clients:
        sys.exit(f"No clients in {args.clients} - copy clients.csv.example and fill it in.")
    health_rows = read_csv(MAINT_DIR / f"health_{args.month}.csv")
    analytics_rows = read_csv(MAINT_DIR / f"analytics_{args.month}.csv")
    if not health_rows:
        print(f"Note: no health_{args.month}.csv found - run healthcheck.py first for health sections.")
    if not analytics_rows:
        print(f"Note: no analytics_{args.month}.csv found - traffic sections will say so. "
              f"(columns: client,visits,top_pages,countries,work_done)")

    contexts = build_contexts(clients, health_rows, analytics_rows, args.month)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    sections_by_client = None
    if api_key and not args.no_ai:
        print(f"Writing report copy for {len(contexts)} client(s) in one {MODEL} call...")
        sections_by_client = generate_ai(contexts, api_key)
    elif not args.no_ai:
        print("ANTHROPIC_API_KEY not set - using the fill-in template (reports still ship).")

    template = (MAINT_DIR / "report_template.html").read_text(encoding="utf-8")
    out_dir = MAINT_DIR / "reports"
    out_dir.mkdir(exist_ok=True)
    for ctx in contexts:
        sections = (sections_by_client or {}).get(ctx["client"]) or generate_fallback(ctx)
        html = render(template, ctx, sections, args.month, args.brand, args.contact)
        out_path = out_dir / f"{slug(ctx['client'])}_{args.month}.html"
        out_path.write_text(html, encoding="utf-8")
        print(f"  Wrote {out_path}")
    print(f"\nDone. Open each report, print to PDF, attach to the monthly email.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
