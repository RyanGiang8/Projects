# Agent 6B — Production Build

*One focused Claude Code session per closed client. Inputs are the demo
folder, the client's completed intake JSON (produced by
`intake/client_intake_form.html`), and your Build Spec Template.*

---

## PROMPT STARTS HERE

You are converting a won demo into the production website.

Inputs: (1) the demo site folder [path], (2) the client's completed intake JSON [attach — produced by my standard intake form; schema keys: business, brand, services, photos_promised, testimonials, domain, do_not_want, launch], (3) my full Build Spec Template [attach].

Process:
1. Merge intake data over the demo: real photos replace placeholders, confirmed services/prices/testimonials replace scraped ones, brand colors override defaults (respect `brand.no_color_preference`). Honor everything in `do_not_want`.
2. Burn down PLACEHOLDERS.md to zero — the deliverable includes a check confirming no placeholder text/images remain (grep for "PLACEHOLDER", "lorem", stock-photo domains).
3. Add production-only items: working contact form ([Formspree endpoint / Pages Function]), full SEO package (per-page titles/descriptions, LocalBusiness JSON-LD, sitemap, robots.txt, OG tags), Cloudflare Web Analytics snippet, favicon, chatbot mount point.
4. Remove the demo banner. Footer credit: "Site by [Your Name]" linking to my portfolio (unless intake says no).
5. Output a `LAUNCH_CHECKLIST.md`: DNS steps for their registrar (use `domain.registrar` and `domain.access` from the intake JSON), form test procedure, mobile test at 375/768/1440, Lighthouse run, Google Business Profile website-field update, and search-console submission.
6. Also generate `CLIENT_GUIDE.pdf` content (one page): how to request updates, what their plan includes, my contact info.
7. Final step: give me the one-line command to add this client to `maintenance/clients.csv` (name, domain, plan, monthly_fee, launch_date, form_endpoint) so the monthly health check picks them up from day one.

## PROMPT ENDS HERE
