#!/usr/bin/env python3
"""Agent 7, component 1 — monthly client health checker. No AI.

Reads clients.csv (name,domain,plan,monthly_fee,launch_date[,form_endpoint]),
checks every domain, writes health_YYYY-MM.csv, and prints anything needing
attention.

    python healthcheck.py                 # uses clients.csv next to this file
    python healthcheck.py --no-psi        # skip Lighthouse/PageSpeed
"""

import argparse
import csv
import difflib
import json
import re
import socket
import ssl
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import requests

MAINT_DIR = Path(__file__).resolve().parent
SNAPSHOT_DIR = MAINT_DIR / "cache" / "snapshots"
USER_AGENT = "ClientHealthCheck/1.0 (site maintenance monitoring)"
TIMEOUT = 15
SSL_WARN_DAYS = 30
CONTENT_CHANGE_THRESHOLD = 0.90  # similarity below this = unexpected change
PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

CSV_COLUMNS = [
    "client", "domain", "plan", "http_status", "response_ms", "ssl_days_left",
    "form_ok", "content_similarity", "lighthouse_mobile", "attention",
]


def check_http(session, domain: str) -> tuple[int, int, str]:
    """Return (status, elapsed_ms, html)."""
    start = time.monotonic()
    resp = session.get(f"https://{domain}", timeout=TIMEOUT,
                       headers={"User-Agent": USER_AGENT})
    return resp.status_code, int((time.monotonic() - start) * 1000), resp.text


def check_ssl_days(domain: str) -> int:
    """Days until the certificate expires."""
    ctx = ssl.create_default_context()
    with socket.create_connection((domain, 443), timeout=TIMEOUT) as sock:
        with ctx.wrap_socket(sock, server_hostname=domain) as tls:
            cert = tls.getpeercert()
    expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    return (expires - datetime.now(timezone.utc)).days


def check_form(session, endpoint: str) -> bool:
    resp = session.get(endpoint, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
    return resp.status_code < 500


def visible_text(html: str) -> str:
    """Strip tags/scripts for a stable content diff."""
    html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def content_similarity(domain: str, html: str, snapshot_dir: Path) -> float | None:
    """Compare against last month's snapshot; None on first run. Updates snapshot."""
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    snap = snapshot_dir / f"{domain}.txt"
    current = visible_text(html)
    previous = snap.read_text(encoding="utf-8") if snap.exists() else None
    snap.write_text(current, encoding="utf-8")
    if previous is None:
        return None
    return difflib.SequenceMatcher(None, previous, current).ratio()


def check_lighthouse(session, domain: str, api_key: str | None) -> int | None:
    """Mobile performance score 0-100 via PageSpeed Insights (free)."""
    params = {"url": f"https://{domain}", "category": "performance", "strategy": "mobile"}
    if api_key:
        params["key"] = api_key
    resp = session.get(PSI_URL, params=params, timeout=90)
    if resp.status_code != 200:
        return None
    score = resp.json().get("lighthouseResult", {}).get("categories", {}) \
                       .get("performance", {}).get("score")
    return round(score * 100) if score is not None else None


def build_attention(row: dict) -> str:
    """Pure function: derive the semicolon-separated attention flags."""
    flags = []
    status = row.get("http_status")
    if status is None or status == "" or (isinstance(status, int) and status >= 400):
        flags.append(f"SITE DOWN (HTTP {status or 'unreachable'})")
    ssl_days = row.get("ssl_days_left")
    if isinstance(ssl_days, int) and ssl_days < SSL_WARN_DAYS:
        flags.append(f"SSL expires in {ssl_days} days")
    if row.get("form_ok") is False:
        flags.append("contact form endpoint failing")
    sim = row.get("content_similarity")
    if isinstance(sim, float) and sim < CONTENT_CHANGE_THRESHOLD:
        flags.append(f"unexpected content change (similarity {sim:.2f})")
    ms = row.get("response_ms")
    if isinstance(ms, int) and ms > 4000:
        flags.append(f"slow response ({ms} ms)")
    lh = row.get("lighthouse_mobile")
    if isinstance(lh, int) and lh < 60:
        flags.append(f"Lighthouse mobile {lh}/100")
    return "; ".join(flags)


def check_client(session, client: dict, snapshot_dir: Path, psi: bool, psi_key: str | None) -> dict:
    domain = client["domain"].strip().removeprefix("https://").removeprefix("http://").strip("/")
    row = {"client": client["name"], "domain": domain, "plan": client.get("plan", ""),
           "http_status": None, "response_ms": None, "ssl_days_left": None,
           "form_ok": None, "content_similarity": None, "lighthouse_mobile": None}
    try:
        row["http_status"], row["response_ms"], html = check_http(session, domain)
        if row["http_status"] < 400:
            row["content_similarity"] = content_similarity(domain, html, snapshot_dir)
    except requests.RequestException:
        html = None
    try:
        row["ssl_days_left"] = check_ssl_days(domain)
    except (OSError, ssl.SSLError, ValueError):
        pass
    endpoint = (client.get("form_endpoint") or "").strip()
    if endpoint:
        try:
            row["form_ok"] = check_form(session, endpoint)
        except requests.RequestException:
            row["form_ok"] = False
    if psi and html is not None:
        try:
            row["lighthouse_mobile"] = check_lighthouse(session, domain, psi_key)
        except requests.RequestException:
            pass
    row["attention"] = build_attention(row)
    return row


def load_clients(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(f"Clients file not found: {path}\n"
                 f"Copy clients.csv.example to clients.csv and fill it in.")
    with path.open(encoding="utf-8") as fh:
        clients = [r for r in csv.DictReader(fh) if (r.get("name") or "").strip()]
    if not clients:
        sys.exit(f"{path} has no client rows.")
    return clients


def main() -> int:
    parser = argparse.ArgumentParser(description="Monthly health check for managed client sites.")
    parser.add_argument("--clients", default=str(MAINT_DIR / "clients.csv"))
    parser.add_argument("--no-psi", action="store_true", help="skip PageSpeed/Lighthouse")
    parser.add_argument("--psi-key", default=None,
                        help="PageSpeed Insights API key (optional; keyless works at low volume)")
    args = parser.parse_args()

    clients = load_clients(Path(args.clients))
    session = requests.Session()
    rows = []
    print(f"Checking {len(clients)} client site(s)...")
    for i, client in enumerate(clients):
        row = check_client(session, client, SNAPSHOT_DIR, psi=not args.no_psi, psi_key=args.psi_key)
        rows.append(row)
        state = "NEEDS ATTENTION" if row["attention"] else "ok"
        print(f"  {row['client']:30} {state}")
        if i < len(clients) - 1:
            time.sleep(1)

    out_path = MAINT_DIR / f"health_{date.today().strftime('%Y-%m')}.csv"
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in CSV_COLUMNS})

    print(f"\nWrote {out_path}")
    problems = [r for r in rows if r["attention"]]
    if problems:
        print("\nNEEDS ATTENTION:")
        for row in problems:
            print(f"  {row['client']} ({row['domain']}): {row['attention']}")
    else:
        print("All clients green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
