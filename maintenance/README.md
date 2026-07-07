# Maintenance & reporting toolkit (Agent 7)

Monthly loop for managed clients. Two components: a keyless health checker
and a report generator that uses **one** cheap batched AI call for all
clients (with a no-key fallback, so reports always ship).

## Monthly routine (~20 min total)

```bash
cd maintenance
cp clients.csv.example clients.csv        # once; keep it updated as you close clients

# 1. Health check - no AI, no keys
python healthcheck.py                     # writes health_YYYY-MM.csv, prints attention items

# 2. Paste analytics - copy numbers from each client's Cloudflare Web Analytics
#    into analytics_YYYY-MM.csv (see analytics_example.csv for the columns:
#    client,visits,top_pages,countries,work_done)

# 3. Generate all reports - ONE Haiku call for every client, pennies
python report_gen.py --brand "Your Name Web Services" --contact "you@example.com"

# 4. Open reports/<client>_YYYY-MM.html, print to PDF, email with the invoice
```

## What healthcheck.py checks per domain

- HTTP status + response time (flags ≥400 and >4 s)
- SSL certificate expiry (warns under 30 days)
- Contact form endpoint alive (optional `form_endpoint` column)
- Homepage content diff vs last month's snapshot (`cache/snapshots/`) —
  flags unexpected changes (similarity < 0.90)
- Lighthouse mobile score via the free PageSpeed Insights API
  (`--no-psi` to skip; `--psi-key` if you hit keyless rate limits)

## Report generator details

- Model: `claude-haiku-4-5-20251001`, one batched request, the instruction
  block rides as a cached system prompt — cost is pennies per month and it
  runs on the API, never your subscription limits.
- Reads `ANTHROPIC_API_KEY` from `maintenance/.env` or reuses
  `prospector/.env`. Missing key or any API failure → deterministic
  fill-in template (still personalized with their numbers).
- Each report: traffic in plain English, health status badge, what you did
  this month, and ONE rotating suggestion (review push → seasonal promo →
  SEO refresh → new photos) — helpful tone, plants the upsell seed.
- Branding placeholders: `--brand` and `--contact` flags.

Run tests: `python -m pytest tests/ -q` (13 tests, no network).
