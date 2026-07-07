# Client intake form (Agent 6A)

`client_intake_form.html` — a single self-contained file. No server, no
tracking, works offline. Build once, reuse for every client.

## How to use per client

1. Optionally pre-fill their basics via URL parameters:
   `client_intake_form.html?business=Bill's%20Detailing&phone=(613)%20555-0102&address=88%20March%20Rd`
   (works from a `file://` open too, or host it on your portfolio domain).
2. Email the file (or hosted link) to the newly signed client.
3. They fill it in — progress bar, everything skippable except **phone** and
   **at least one service** — and hit *Finish*. The page downloads
   `intake_<business>_<date>.json` locally; nothing is transmitted anywhere.
4. They email you the JSON (plus logo/photos, which the form reminds them of).
5. Feed that JSON into the Agent 6B production-build session
   (`prompts/Agent6B_Production_Build.md`).

Security notes baked in: the form tells clients never to enter passwords, and
the domain section only collects registrar *names* and access notes.
