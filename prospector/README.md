# Prospector — find local businesses that need a (better) website

Finds businesses in a niche + area via the Google Places API, runs deterministic
website health checks, scores each lead 0–10, and writes a CSV sorted by score.
AI is used for exactly one thing: a single batched call that writes a one-line
pitch angle per qualifying lead. Everything else is plain code, so re-runs are
free and results are reproducible.

```
Step 1  Google Places text search (cached to cache/, ~3 API calls per run)
Step 2  Website health checks (requests + BeautifulSoup, robots.txt respected)
Step 3  Deterministic 0-10 scoring
Step 4  One batched Anthropic call for pitch angles (leads scoring >= 6 only)
Step 5  leads_scored_YYYY-MM-DD.csv + terminal summary
```

## Setup

1. **Install dependencies** (Python 3.10+):

   ```bash
   cd prospector
   pip install -r requirements.txt
   ```

2. **Get a Google Places API key:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/), create a project.
   - Enable **"Places API (New)"** (APIs & Services → Library). Note: this tool
     uses the *New* Places API — the legacy Places API is closed to new keys.
   - Create an API key (APIs & Services → Credentials) and restrict it to
     Places API (New).
   - Billing must be enabled, but usage here stays well inside the monthly
     free allowance (see "API cost" below).

3. **Create `.env`** (never committed — it's in `.gitignore`):

   ```bash
   cp .env.example .env
   # then edit .env and paste your keys
   ```

   `ANTHROPIC_API_KEY` is optional — without it the pitch_angle column is left
   blank and everything else still works.

## Usage

```bash
# Estimate API calls first - spends no quota
python prospect.py --niche "auto detailing" --area "Kanata, Ottawa" --dry-run

# Real run
python prospect.py --niche "auto detailing" --area "Kanata, Ottawa"

# Verify the whole pipeline with bundled fake data - no keys, no network
python prospect.py --niche "auto detailing" --area "Kanata, Ottawa" --mock
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--max-results` | 60 | Max businesses to fetch per niche/area |
| `--min-score` | 6 | Threshold for generating a pitch angle |
| `--dry-run` | | Print the API-call estimate and exit |
| `--mock` | | Run on `mock_data/` fixtures, fully offline |
| `--refresh` | | Ignore the 7-day search cache and refetch |
| `--contacted` | `contacted.csv` | Exclusion file |

Output: `leads_scored_YYYY-MM-DD.csv` with columns
`score, name, phone, address, website, issues_found, rating, review_count,
pitch_angle, maps_url, place_id`, sorted by score descending.

## Scoring

| Signal | Points |
|---|---|
| No website at all | 4 |
| Site unreachable or Facebook/Linktree-only | 4 |
| No HTTPS / invalid certificate | 2 |
| No `<meta name="viewport">` (not mobile-responsive) | 3 |
| Page > 5 MB or load > 8 s | 2 |
| Copyright year ≤ 2021 **or** dated/free platform (Wix free, GoDaddy builder, old WordPress themes, Flash) | 2 |
| 25+ reviews at ≥ 4.0 rating (proves real revenue) | +2 |
| Business status not OPERATIONAL | disqualified |

Capped at 10. A missing/domain-only title tag is recorded in `issues_found`
as extra pitch evidence but carries no points.

## API cost

- **Google Places:** one text-search request per 20 results — **3 requests for
  a full 60-lead run**, and **0** on re-runs within 7 days (results are cached
  in `cache/` keyed by niche+area and place_id). The New Places API returns
  phone/website/rating in the search response, so there are no Place Details
  calls at all. At ~1 run/week this is a few dozen requests per month, far
  inside the free monthly allowance. `--dry-run` prints the exact count before
  spending anything.
- **Anthropic:** at most **1 request per run** (model `claude-haiku-4-5-20251001`),
  batching all qualifying leads. Skipped automatically if the key is missing.

> **Design note:** the original spec called for legacy Text Search + Place
> Details per place (~63 calls/run). Since March 2025 Google only issues keys
> for Places API (New), whose text search returns the same fields directly —
> so this implementation needs ~3 calls/run and stays comfortably free-tier.

Scraping etiquette: 10-second timeout, ~1.5 s delay between site checks, an
honest User-Agent, robots.txt respected (blocked sites are simply not
inspected). Raw API responses are cached locally for our own re-runs only —
no bulk redistribution.

## Error messages

- **Auth (401/403):** check the key in `.env` and that "Places API (New)" is
  enabled for the key's project.
- **Quota (429):** wait for the quota window or check Cloud Console quotas.
- Both abort the run with a clear message; nothing is half-written.

## Tests

```bash
cd prospector
python -m pytest tests/ -v
```

Covers scoring weights, every website check against canned HTML, and an
end-to-end run over `mock_data/` (7 fake businesses covering: no website,
dated GoDaddy site, Facebook redirect, healthy modern site, dead domain,
permanently closed, and an already-contacted shop).

## Weekly workflow

1. Monday: `python prospect.py --niche X --area Y` (~2 min)
2. Review the top 10 in the CSV, pick 3–5 for demo builds
3. Append everyone you contact to `contacted.csv`
4. Rotate niches/areas weekly so you never re-hit the same pool
