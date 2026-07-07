# Master Walkthrough — Zero to First Client (and Beyond)

**Repo edition — updated to match what's already built.** The agent pipeline
now lives in this repository:

| Agent | Where | Status |
|---|---|---|
| 1 — Prospector | `prospector/prospect.py` (Google) + `prospector/prospect_free.py` (**keyless**) | ✅ built + tested |
| 2 — Lead Review | `prompts/Agent2_Lead_Review.md` (Claude Project) | ✅ prompt ready |
| 3 — Demo Builder | `prompts/Agent3_Demo_Builder.md` (per-demo session) | ✅ prompt ready |
| 4 — Pitch Writer | `prompts/Agent4_Pitch_Writer.md` (Claude Project) | ✅ prompt ready |
| 5 — CRM | `crm/crm.py` | ✅ built + tested |
| 6A — Intake form | `intake/client_intake_form.html` | ✅ built |
| 6B — Production build | `prompts/Agent6B_Production_Build.md` (per-client session) | ✅ prompt ready |
| 7 — Maintenance | `maintenance/healthcheck.py` + `report_gen.py` | ✅ built + tested |

Each step notes its Claude usage load: 🟢 none/trivial · 🟡 moderate · 🔴 heavy
(plan around your weekly limit). **Because agents 1, 5, 6A, and 7 are already
built, the original "build the machine" Claude sessions are no longer needed —
Phase 1 is now mostly configuration.**

---

## Phase 0 — Setup (this week, ~3–4 hours)

**Step 1. Clear the Deloitte conflict check.** 🟢
Before anything public exists, check your employment agreement / firm policy for outside business activity disclosure. File the form if required. Do this first — everything else is wasted if this blocks you.

**Step 2. Register the business basics.** 🟢
- Ontario sole prop name registration (~$60, online, same-day)
- Business email on your existing domain (e.g., hello@yourdomain) — never send outreach from Gmail
- Simple bookkeeping from day 1: a sheet or your Excel tracker pattern. Track every expense for T2125.

**Step 3. Pick your niche and area.** 🟢
One niche, one part of Ottawa. Recommendation: auto shops/detailers/mechanics (your credibility) in [Kanata/Nepean/Orleans — pick one]. Write down 2 backup niches (trades, clinics) in case Step 6 shows the pool is too small.

**Step 4. Set up infrastructure.** 🟢
- Cloudflare account (you have one) + install `wrangler` CLI, test a hello-world Pages deploy
- `pip install -r prospector/requirements.txt`
- **Google Cloud key is now optional on day one** — `prospect_free.py` runs on
  OpenStreetMap with zero keys. Get the Places key when you want denser
  coverage + review counts (they make pitches noticeably stronger).
- `prospector/contacted.csv` already exists (empty); create a `clients/` folder with backups

---

## Phase 1 — Configure the machine (now ~1 hour, was 1–2 weeks)

**Step 5. Smoke-test the CRM.** 🟢 *(was a build session — already built)*
`python crm/crm.py --help`, import a prospector CSV, move a lead through
stages, run `crm.py weekly`. See `crm/README.md`.

**Step 6. Run the Prospector — the decision gate.** 🟢 *(already built)*
```bash
# $0, no keys, run it right now:
python prospector/prospect_free.py --niche "auto detailing" --area "Kanata, Ottawa"
# or with your Places key for ratings + denser coverage:
python prospector/prospect.py --niche "auto detailing" --area "Kanata, Ottawa"
```
**Decision gate:** if fewer than ~10 leads score ≥6, your niche/area pool is
thin — rerun with a backup niche before proceeding. This 5-minute, zero-cost
test validates the whole business. (Keyless caveat: "no website" means none
listed on OSM — spot-check the top few before betting demos on them.)

**Step 7. Set up Agents 2 & 4 as Claude Projects.** 🟢 15 min, no code
Two Projects with `prompts/Agent2_Lead_Review.md` and
`prompts/Agent4_Pitch_Writer.md` as instructions. Attach
Cold_Outreach_Emails.md to the Pitch Writer project (project knowledge is
cached — cheap to reuse).

**Step 8. Import your first lead list.** 🟢
`python crm/crm.py import prospector/leads_scored_[date].csv --niche "auto detailing" --area "Kanata"`
(the niche/area tags power the weekly conversion report). Paste
`crm.py list --stage new` output into the Agent 2 Project, pick 3 demo targets.

---

## Phase 2 — First outreach cycle (week 2–3)

**Step 9. Build 3 demo sites.** 🔴 heaviest recurring Claude usage
One Agent 3 (`prompts/Agent3_Demo_Builder.md`) session per demo. Rules to protect your limits:
- One demo per session, on different days if possible (see limits section below)
- Fill the lead data into the prompt COMPLETELY before starting — `crm.py show "<lead>"` prints everything in one shot
- Sonnet-class model, no extended thinking needed for static sites
- Deploy each with `wrangler pages deploy` (free, no Claude usage), then `crm.py demo "<lead>" <url>`
- Your 5-minute human QA: name spelling, phone number, nothing embarrassing

**Step 10. Write and send pitches.** 🟢
Pitch Writer project drafts each email (trivial usage). YOU send them from your business email, CASL footer included. After each send:
`crm.py move "<lead>" contacted` and `crm.py set "<lead>" template_used T1`.

**Step 11. Run the weekly rhythm.** 🟢
Every Monday: run the prospector on a fresh area (~2 min, no Claude) → import → triage → queue this week's demos. Every day: `crm.py due` → send follow-ups (`crm.py move "<lead>" followed_up` after). Cap: 3–5 demos/week, one follow-up per lead, then move on.

**Step 12. Handle replies.**
- Reply → `crm.py move "<lead>" replied`, phone call within 24h (`call_booked`). Script: walk them through the demo on their phone, quote managed tier ($800–1,200 build + $100/mo) vs build-only ($1,800+), send agreement same day.
- "Not interested" / silence after follow-up → `crm.py move "<lead>" closed_lost`. Volume math says this is most of them; that's fine.
- "Unsubscribe" → `crm.py unsubscribe "<lead>"` (CASL: also blocks future prospecting).

---

## Phase 3 — First close → delivery (whenever it lands)

**Step 13. Sign and invoice.** 🟢
Website_Service_Agreement.docx filled in → e-signature (client can sign a printout photo; keep it simple) → 50% deposit via e-transfer before work starts. `crm.py move "<lead>" closed_won` + `crm.py set "<lead>" monthly_fee 100`.

**Step 14. Onboard.** 🟢 *(was a build session — the form is already built)*
Send `intake/client_intake_form.html` — pre-fill their basics via URL params
(see `intake/README.md`). Chase the completed JSON and their photos. Late
client content = paused clock (your agreement covers this).

**Step 15. Production build.** 🔴 one focused Claude Code session
`prompts/Agent6B_Production_Build.md` with demo folder + intake JSON. Run the LAUNCH_CHECKLIST: DNS, form test, mobile test, Lighthouse. Collect final 50%, then launch. Add them to `maintenance/clients.csv`. Ask for the Google review within a week of launch, and one referral within a month.

**Step 16. Start the monthly loop.** 🟢 *(was a build session — already built)*
Monthly per client: `python maintenance/healthcheck.py` (no AI) → paste
Cloudflare Analytics numbers into `analytics_YYYY-MM.csv` → 
`python maintenance/report_gen.py` (ONE batched Haiku call for all clients,
pennies; works with no key too) → print to PDF, send with invoice → apply
capped content updates (~20 min). See `maintenance/README.md`.

---

## Phase 4 — Compound (month 2+)

- Portfolio page on your domain updated with every launch
- `crm.py weekly` tells you which niche/template converts — double down there
- Referrals gradually replace cold volume; keep prospecting until MRR ≥ $500
- At 5+ managed clients: raise build prices; at 10+: consider the premium tier ($200–300/mo) and revisit HST registration timing
- Revisit hard-won lessons quarterly: which agent needs a v2, what to stop doing

---

## Managing your Claude usage limits

Reality check: yes, chat and Claude Code share one usage pool (5-hour session windows + a weekly cap), so an undisciplined build week can throttle you. But this plan is shaped to stay well inside Pro limits — **and with agents 1, 5, 6A, and 7 pre-built in this repo, the one-time build sessions are already paid for.**

**Structural protections already in the plan:**
1. **Agents are built once, run forever free.** Agents 1, 5, and 7's healthcheck are Python — running them costs zero Claude usage. The "run all the agents" mental model is wrong: only demo/production builds recur.
2. **Recurring load is small.** Steady state = 3–5 demo builds/week (each a modest single-session static-site build) + trivial Project chats. That's short-burst usage, which the session/weekly structure handles well — it's sustained agentic loops that kill Pro plans.
3. **Client-facing AI (chatbots, monthly reports) runs on the API, not your subscription** — metered pennies, billed into your margins, never touching your limits.

**Habits that stretch the limit further:**
- One demo per session; start each in a FRESH chat/Claude Code instance (long context = faster burn)
- Front-load complete specs (`crm.py show` gives you the whole lead in one paste); every clarification round re-reads the whole context
- Keep any CLAUDE.md files short; don't leave Claude Code looping unattended
- Check Settings > Usage (or `/usage` in Claude Code) before starting a heavy session — if the weekly bar is high, demos wait a day
- Do builds on weekends when your co-op-week chat usage is low

**Escalation path (a good problem):**
- Hitting weekly caps with real demos waiting = demand signal. Options: enable usage credits (pay-as-you-go overflow for just that week), or upgrade to Max — and note the math: if limits are blocking you, you have ~5+ demos/week in flight, which means the business is generating enough pipeline that a plan upgrade pays for itself with a fraction of one build fee.
- Rule: upgrade the second time a cap blocks paid work, not before.
