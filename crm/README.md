# CRM — pipeline tracker (Agent 5)

Single-file local CRM: `crm.py` + SQLite (`pipeline.db`). No web server, no
cloud, no AI calls. Optional `pip install tabulate` for prettier tables —
everything works without it.

## Daily/weekly usage

```bash
# After each prospector run (niche/area tags feed the weekly conversion stats)
python crm.py import ../prospector/leads_scored_2026-07-07.csv --niche "auto detailing" --area "Kanata"

# Working a lead
python crm.py demo "Bill's" https://demo-bills.pages.dev   # stage -> demo_built
python crm.py set "Bill's" template_used T1
python crm.py move "Bill's" contacted                      # stamps date, follow-up due +5 days
python crm.py note "Bill's" "owner's name is Bill, prefers text"

# Every day
python crm.py due          # follow-ups due + calls booked

# Every Monday
python crm.py weekly       # sent/replies/closes, conversion by template & niche, MRR, next 5 actions

# Compliance & hygiene
python crm.py unsubscribe "Bill's"   # permanent flag + appended to prospector/contacted.csv (CASL)
python crm.py export                 # full CSV backup
```

Leads are matched by name fragment (case-insensitive) or exact `place_id`;
ambiguous fragments are rejected with the candidate list.

## Stages

`new → demo_built → contacted → followed_up → replied → call_booked →
closed_won / closed_lost / unsubscribed`

Auto-stamping: `contacted` sets `date_contacted` and `date_followup_due`
(+5 days) · `replied` sets `date_replied` · `closed_*` set `date_closed` ·
`unsubscribed` also appends name + place_id to the prospector's
`contacted.csv` so they are never surfaced again.

## Guarantees

- `import` upserts by `place_id` and **never overwrites manual fields**
  (stage, dates, notes, fees, email, demo_url, template_used). Re-importing
  the same CSV is always safe.
- Unsubscribed leads are skipped entirely on re-import.
- Manual fields are edited only via `set` / `note` / `move` / `demo`.

Run tests: `python -m pytest tests/ -q`
