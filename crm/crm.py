#!/usr/bin/env python3
"""Agent 5 — lightweight local CRM for a cold-outreach web-services business.

Single file, SQLite-backed, stdlib only (tabulate used if installed).
No web server, no cloud, no AI calls.

    python crm.py import leads_scored_2026-07-07.csv --niche "auto detailing" --area "Kanata"
    python crm.py move "Bill's Mobile" contacted
    python crm.py due
    python crm.py weekly
"""

import argparse
import csv
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

CRM_DIR = Path(__file__).resolve().parent
DEFAULT_DB = CRM_DIR / "pipeline.db"

STAGES = [
    "new", "demo_built", "contacted", "followed_up", "replied",
    "call_booked", "closed_won", "closed_lost", "unsubscribed",
]
FOLLOWUP_DAYS = 5

# Fields refreshed on re-import (only when the CSV has a value).
AUTO_FIELDS = ["name", "phone", "niche", "area", "score", "website", "issues_found", "pitch_angle"]
# Fields only ever set by hand — import never touches these.
SETTABLE_FIELDS = ["email", "demo_url", "template_used", "monthly_fee", "build_fee", "phone", "niche", "area"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    place_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    niche TEXT DEFAULT '',
    area TEXT DEFAULT '',
    score INTEGER,
    website TEXT DEFAULT '',
    issues_found TEXT DEFAULT '',
    pitch_angle TEXT DEFAULT '',
    demo_url TEXT DEFAULT '',
    stage TEXT DEFAULT 'new',
    template_used TEXT DEFAULT '',
    date_added TEXT,
    date_contacted TEXT,
    date_followup_due TEXT,
    date_replied TEXT,
    date_closed TEXT,
    monthly_fee REAL,
    build_fee REAL,
    notes TEXT DEFAULT ''
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    return conn


def today() -> str:
    return date.today().isoformat()


def render_table(rows: list[dict], headers: list[str]) -> str:
    data = [[r.get(h, "") for h in headers] for r in rows]
    try:
        from tabulate import tabulate
        return tabulate(data, headers=headers, tablefmt="simple")
    except ImportError:
        widths = [max(len(str(h)), *(len(str(row[i])) for row in data)) if data else len(h)
                  for i, h in enumerate(headers)]
        lines = ["  ".join(str(h).ljust(w) for h, w in zip(headers, widths))]
        lines.append("  ".join("-" * w for w in widths))
        lines += ["  ".join(str(c).ljust(w) for c, w in zip(row, widths)) for row in data]
        return "\n".join(lines)


def find_lead(conn: sqlite3.Connection, ident: str) -> sqlite3.Row:
    """Match by exact place_id, else case-insensitive name substring."""
    row = conn.execute("SELECT * FROM leads WHERE place_id = ?", (ident,)).fetchone()
    if row:
        return row
    matches = conn.execute(
        "SELECT * FROM leads WHERE lower(name) LIKE ? ORDER BY name", (f"%{ident.lower()}%",)
    ).fetchall()
    if not matches:
        sys.exit(f"No lead matches '{ident}'.")
    if len(matches) > 1:
        exact = [m for m in matches if m["name"].lower() == ident.lower()]
        if len(exact) == 1:
            return exact[0]
        names = "\n  ".join(f"{m['name']}  ({m['place_id']})" for m in matches[:10])
        sys.exit(f"'{ident}' is ambiguous — matches:\n  {names}\nUse the place_id instead.")
    return matches[0]


# --------------------------------------------------------------------------- commands

def cmd_import(conn, args):
    path = Path(args.csv_file)
    if not path.exists():
        sys.exit(f"File not found: {path}")
    added = updated = skipped = 0
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            pid = (row.get("place_id") or "").strip()
            name = (row.get("name") or "").strip()
            if not pid or not name:
                skipped += 1
                continue
            incoming = {
                "name": name,
                "phone": (row.get("phone") or "").strip(),
                "niche": args.niche or "",
                "area": args.area or "",
                "score": int(row["score"]) if (row.get("score") or "").strip().isdigit() else None,
                "website": (row.get("website") or "").strip(),
                "issues_found": (row.get("issues_found") or "").strip(),
                "pitch_angle": (row.get("pitch_angle") or "").strip(),
            }
            existing = conn.execute("SELECT * FROM leads WHERE place_id = ?", (pid,)).fetchone()
            if existing is None:
                conn.execute(
                    "INSERT INTO leads (place_id, name, phone, niche, area, score, website,"
                    " issues_found, pitch_angle, stage, date_added)"
                    " VALUES (?,?,?,?,?,?,?,?,?, 'new', ?)",
                    (pid, *[incoming[f] for f in AUTO_FIELDS], today()),
                )
                added += 1
            else:
                if existing["stage"] == "unsubscribed":
                    skipped += 1
                    continue
                sets, vals = [], []
                for f in AUTO_FIELDS:
                    if incoming[f] not in (None, ""):
                        sets.append(f"{f} = ?")
                        vals.append(incoming[f])
                if sets:
                    conn.execute(f"UPDATE leads SET {', '.join(sets)} WHERE place_id = ?", (*vals, pid))
                updated += 1
    conn.commit()
    print(f"Imported {path.name}: {added} added, {updated} updated"
          + (f", {skipped} skipped" if skipped else "")
          + ". Manual fields (stage, notes, fees, demo_url...) untouched.")


def _append_contacted_csv(lead, contacted_path: Path):
    contacted_path.parent.mkdir(parents=True, exist_ok=True)
    with contacted_path.open("a", encoding="utf-8") as fh:
        fh.write(f"{lead['name']}\n{lead['place_id']}\n")


def default_contacted_path() -> Path:
    candidate = CRM_DIR.parent / "prospector" / "contacted.csv"
    return candidate if candidate.parent.exists() else CRM_DIR / "contacted.csv"


def cmd_move(conn, args):
    stage = args.stage.lower()
    if stage not in STAGES:
        sys.exit(f"Unknown stage '{args.stage}'. Valid: {', '.join(STAGES)}")
    lead = find_lead(conn, args.lead)
    stamps = {"stage": stage}
    if stage == "contacted":
        stamps["date_contacted"] = today()
        stamps["date_followup_due"] = (date.today() + timedelta(days=FOLLOWUP_DAYS)).isoformat()
    elif stage in ("followed_up", "replied", "call_booked"):
        stamps["date_followup_due"] = None
        if stage == "replied":
            stamps["date_replied"] = today()
    elif stage in ("closed_won", "closed_lost"):
        stamps["date_closed"] = today()
        stamps["date_followup_due"] = None
    elif stage == "unsubscribed":
        stamps["date_followup_due"] = None
        _append_contacted_csv(lead, Path(args.contacted_file) if args.contacted_file else default_contacted_path())
    sets = ", ".join(f"{k} = ?" for k in stamps)
    conn.execute(f"UPDATE leads SET {sets} WHERE place_id = ?", (*stamps.values(), lead["place_id"]))
    conn.commit()
    extra = ""
    if stage == "contacted":
        extra = f" (follow-up due {stamps['date_followup_due']})"
    if stage == "unsubscribed":
        extra = " (added to contacted.csv — prospector will never surface them again)"
    print(f"{lead['name']}: {lead['stage']} -> {stage}{extra}")


def cmd_due(conn, args):
    t = today()
    followups = conn.execute(
        "SELECT * FROM leads WHERE stage = 'contacted' AND date_followup_due IS NOT NULL"
        " AND date_followup_due <= ? ORDER BY date_followup_due", (t,)
    ).fetchall()
    calls = conn.execute("SELECT * FROM leads WHERE stage = 'call_booked' ORDER BY name").fetchall()
    if not followups and not calls:
        print("Nothing due today. Go prospect or build a demo.")
        return
    if followups:
        print(f"Follow-ups due ({len(followups)}):")
        print(render_table(
            [{"name": r["name"], "phone": r["phone"], "due": r["date_followup_due"],
              "demo": r["demo_url"], "contacted": r["date_contacted"]} for r in followups],
            ["name", "phone", "due", "demo", "contacted"]))
        print("  After sending: crm.py move <lead> followed_up")
    if calls:
        print(f"\nCalls booked ({len(calls)}):")
        print(render_table(
            [{"name": r["name"], "phone": r["phone"], "notes": (r["notes"] or "")[-60:]} for r in calls],
            ["name", "phone", "notes"]))


def cmd_note(conn, args):
    lead = find_lead(conn, args.lead)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    new_notes = (lead["notes"] + "\n" if lead["notes"] else "") + f"[{stamp}] {args.text}"
    conn.execute("UPDATE leads SET notes = ? WHERE place_id = ?", (new_notes, lead["place_id"]))
    conn.commit()
    print(f"Noted on {lead['name']}.")


def cmd_demo(conn, args):
    lead = find_lead(conn, args.lead)
    conn.execute(
        "UPDATE leads SET demo_url = ?, stage = CASE WHEN stage = 'new' THEN 'demo_built' ELSE stage END"
        " WHERE place_id = ?", (args.url, lead["place_id"]))
    conn.commit()
    print(f"{lead['name']}: demo_url set to {args.url}")


def cmd_set(conn, args):
    if args.field not in SETTABLE_FIELDS:
        sys.exit(f"Field '{args.field}' is not settable. Choose from: {', '.join(SETTABLE_FIELDS)}")
    lead = find_lead(conn, args.lead)
    value = args.value
    if args.field in ("monthly_fee", "build_fee"):
        try:
            value = float(value)
        except ValueError:
            sys.exit(f"{args.field} must be a number.")
    conn.execute(f"UPDATE leads SET {args.field} = ? WHERE place_id = ?", (value, lead["place_id"]))
    conn.commit()
    print(f"{lead['name']}: {args.field} = {value}")


def cmd_show(conn, args):
    lead = find_lead(conn, args.lead)
    for key in lead.keys():
        val = lead[key]
        if val not in (None, ""):
            print(f"{key:18} {val}")


def _rate(part: int, whole: int) -> str:
    return f"{100 * part / whole:.0f}%" if whole else "-"


def cmd_weekly(conn, args):
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    q = lambda sql, *p: conn.execute(sql, p).fetchone()[0]
    sent = q("SELECT COUNT(*) FROM leads WHERE date_contacted >= ?", week_ago)
    replies = q("SELECT COUNT(*) FROM leads WHERE date_replied >= ?", week_ago)
    calls = q("SELECT COUNT(*) FROM leads WHERE stage = 'call_booked'")
    won = q("SELECT COUNT(*) FROM leads WHERE stage = 'closed_won' AND date_closed >= ?", week_ago)
    lost = q("SELECT COUNT(*) FROM leads WHERE stage = 'closed_lost' AND date_closed >= ?", week_ago)
    mrr = q("SELECT COALESCE(SUM(monthly_fee), 0) FROM leads WHERE stage = 'closed_won'")

    print("=" * 62)
    print(f"  WEEKLY REPORT - {today()}  (last 7 days)")
    print("=" * 62)
    print(f"  Pitches sent: {sent}   Replies: {replies} ({_rate(replies, sent)})   "
          f"Calls booked: {calls}   Won: {won}   Lost: {lost}")
    print(f"  Current MRR from closed_won: ${mrr:,.0f}/mo")

    for dim in ("template_used", "niche"):
        rows = conn.execute(
            f"SELECT {dim} AS k, COUNT(date_contacted) AS sent,"
            f" COUNT(date_replied) AS replied,"
            f" SUM(CASE WHEN stage = 'closed_won' THEN 1 ELSE 0 END) AS won"
            f" FROM leads WHERE {dim} != '' AND date_contacted IS NOT NULL GROUP BY {dim}"
        ).fetchall()
        if rows:
            print(f"\n  Conversion by {dim.replace('_used', '')}:")
            print("  " + render_table(
                [{"value": r["k"], "sent": r["sent"], "replied": r["replied"],
                  "reply_rate": _rate(r["replied"], r["sent"]), "won": r["won"]} for r in rows],
                ["value", "sent", "replied", "reply_rate", "won"]).replace("\n", "\n  "))

    actions = []
    t = today()
    for r in conn.execute(
        "SELECT name, date_followup_due FROM leads WHERE stage = 'contacted'"
        " AND date_followup_due <= ? ORDER BY date_followup_due", (t,)):
        actions.append(f"Send follow-up to {r['name']} (due {r['date_followup_due']})")
    for r in conn.execute("SELECT name FROM leads WHERE stage = 'call_booked'"):
        actions.append(f"Prep and hold the call with {r['name']}")
    for r in conn.execute(
        "SELECT name FROM leads WHERE stage = 'demo_built' AND date_contacted IS NULL ORDER BY score DESC"):
        actions.append(f"Send the pitch to {r['name']} (demo is ready)")
    for r in conn.execute(
        "SELECT name, score FROM leads WHERE stage = 'new' AND score >= 6 ORDER BY score DESC"):
        actions.append(f"Build a demo for {r['name']} (score {r['score']})")
    print("\n  Next 5 actions:")
    for i, a in enumerate(actions[:5], 1):
        print(f"   {i}. {a}")
    if not actions:
        print("   Pipeline is empty - run the prospector on a fresh niche/area.")
    print("=" * 62)


def cmd_unsubscribe(conn, args):
    args.stage = "unsubscribed"
    cmd_move(conn, args)


def cmd_export(conn, args):
    out = Path(args.out) if args.out else CRM_DIR / f"pipeline_export_{today()}.csv"
    rows = conn.execute("SELECT * FROM leads ORDER BY stage, score DESC").fetchall()
    if not rows:
        print("Nothing to export - the pipeline is empty.")
        return
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(dict(r) for r in rows)
    print(f"Exported {len(rows)} leads to {out}")


def cmd_list(conn, args):
    where, params = "", ()
    if args.stage:
        if args.stage not in STAGES:
            sys.exit(f"Unknown stage '{args.stage}'. Valid: {', '.join(STAGES)}")
        where, params = " WHERE stage = ?", (args.stage,)
    rows = conn.execute(f"SELECT * FROM leads{where} ORDER BY score DESC, name", params).fetchall()
    if not rows:
        print("No leads" + (f" in stage '{args.stage}'" if args.stage else "") + ".")
        return
    print(render_table(
        [{"score": r["score"], "name": r["name"], "stage": r["stage"], "phone": r["phone"],
          "demo": r["demo_url"], "niche": r["niche"]} for r in rows],
        ["score", "name", "stage", "phone", "demo", "niche"]))


# --------------------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="crm.py", description="Local pipeline tracker: SQLite, no cloud, no AI.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="database path (default pipeline.db)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("import", help="upsert leads from a prospector CSV (never overwrites manual fields)")
    p.add_argument("csv_file")
    p.add_argument("--niche", help="tag imported leads with a niche (for weekly conversion stats)")
    p.add_argument("--area", help="tag imported leads with an area")
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("move", help="move a lead to a new stage (auto-stamps dates)")
    p.add_argument("lead", help="name fragment or place_id")
    p.add_argument("stage", help=f"one of: {', '.join(STAGES)}")
    p.add_argument("--contacted-file", help="path to prospector contacted.csv (unsubscribe only)")
    p.set_defaults(func=cmd_move)

    p = sub.add_parser("due", help="everything needing action today")
    p.set_defaults(func=cmd_due)

    p = sub.add_parser("note", help="add a timestamped note to a lead")
    p.add_argument("lead")
    p.add_argument("text")
    p.set_defaults(func=cmd_note)

    p = sub.add_parser("demo", help="record a demo URL for a lead (stage -> demo_built)")
    p.add_argument("lead")
    p.add_argument("url")
    p.set_defaults(func=cmd_demo)

    p = sub.add_parser("set", help=f"set a manual field: {', '.join(SETTABLE_FIELDS)}")
    p.add_argument("lead")
    p.add_argument("field")
    p.add_argument("value")
    p.set_defaults(func=cmd_set)

    p = sub.add_parser("show", help="print every non-empty field of one lead")
    p.add_argument("lead")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("weekly", help="Monday report: sent/replies/closes, conversion, MRR, next actions")
    p.set_defaults(func=cmd_weekly)

    p = sub.add_parser("unsubscribe", help="permanent do-not-contact (CASL) + append to contacted.csv")
    p.add_argument("lead")
    p.add_argument("--contacted-file", help="path to prospector contacted.csv")
    p.set_defaults(func=cmd_unsubscribe)

    p = sub.add_parser("export", help="full CSV backup of the pipeline")
    p.add_argument("--out", help="output path (default pipeline_export_DATE.csv)")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("list", help="list leads, optionally by stage")
    p.add_argument("--stage", help=f"filter: {', '.join(STAGES)}")
    p.set_defaults(func=cmd_list)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    conn = connect(Path(args.db))
    try:
        args.func(conn, args)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
