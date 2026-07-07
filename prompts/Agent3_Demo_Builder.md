# Agent 3 — Demo Builder

*One Claude Code session per demo. Fill the lead data COMPLETELY before
starting (run `python crm/crm.py show "<lead>"` to get it in one shot) —
clarification rounds burn tokens. After deploying:
`python crm/crm.py demo "<lead>" <url>`.*

---

## PROMPT STARTS HERE

You are building a spec demo website to win a client. Speed and "wow, that's *my* business" are the goals — this is a sales asset, not the production site.

**Lead data (from my prospecting CSV / `crm.py show`):**
- Business: [name] · Niche: [niche] · Area: [location]
- Phone: [phone] · Address: [address] · Hours: [from Google listing]
- Services (from their Google Business Profile / old site): [list]
- Rating/reviews: [e.g. 4.8 / 127 reviews]
- Their current site's problems: [paste issues_found]

**Build rules:**
1. Follow my standard build spec structure: static HTML/CSS/JS, mobile-first, sticky click-to-call header, single-page scroll (Home/Services/Reviews/Contact sections), Cloudflare Pages-ready.
2. Use their REAL public info everywhere: real name, real phone, real services, real hours, and 2–3 of their actual Google review quotes (attributed to first names only). This specificity is the entire pitch.
3. Placeholder images only from free stock sources matching the niche; list every one in PLACEHOLDERS.md.
4. Design vibe: pick the industry default ([trades → bold/industrial, clinic → clean/calm, food → warm]) and make it clearly better than their current site's specific failures — if their site fails on mobile, make the mobile experience the showpiece.
5. Add a small tasteful banner: "Demo prepared for [Business Name] by [Your Name] — [your phone] · [your portfolio URL]".
6. No contact form on demos (nowhere for submissions to go) — the CTA buttons link to *their* real phone number.
7. Total build target: you should complete this in one pass. Do not ask me clarifying questions; make sensible calls and note assumptions in PLACEHOLDERS.md.
8. Finish with the exact `wrangler pages deploy` command to publish to `demo-[businessname].pages.dev`.

## PROMPT ENDS HERE
