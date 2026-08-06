# LESSONS.md — mn-civic-watch

Operational gotchas Claude Code would otherwise rediscover the hard way. These are too
specific and perishable for AGENTS.md but important enough to carry across sessions.

Add an entry when something broke, rate-limited, behaved unexpectedly, or cost
significant rework to fix. Mark `[resolved]` if a permanent fix landed — but keep the
entry so the pattern is visible.

Format: `YYYY-MM-DD — [area] — what happened and how to avoid it`

---

## APIs & Data Sources

<!-- Example format:
- 2025-06-01 — [legistar] — Minneapolis Legistar rate-limits at 100 req/min. Batch
  requests and add a 700ms delay between pages or fetches will start returning 429s
  silently (no error body). Add explicit retry-with-backoff before this bites you.
-->

- **[legistar]** — Minneapolis and St. Paul run separate Legistar instances with
  different base URLs. Confirm the correct base URL for each city before writing any
  fetch script. Do not assume they share an instance.

- **[google civic API — DEAD]** — The Google Civic Information API Representatives
  endpoint was shut down April 30, 2025. Do not use it, do not copy tutorials that
  reference it. See AGENTS.md §3.2 for approved alternatives.

- **[open states]** — Prefer bulk file downloads over the keyed API per AGENTS.md §0.8.
  The keyed API has stricter rate limits and the bulk files are more complete for
  historical roll calls.

---

## Build & Tooling

<!-- Add entries when the build behaves unexpectedly, deps conflict, or Cloudflare
Workers edge cases surface. -->

- **[cloudflare]** — Cloudflare is a deployment target, not a dependency. The build must
  remain hostable elsewhere. Do not use Workers-specific APIs in the core app logic —
  keep them in the adapter layer only.

---

## Data & Privacy

- **[donor ingest]** — The §1b donor privacy rules must be enforced at ingest time, not
  at render time. If donor filtering happens in a component, unpublished individual donor
  records are still present in the JSON and can leak via export or a careless API route.
  Filter before writing to `public/`.

- **[address search]** — Never add a network request inside the address search flow, even
  as a fallback for edge cases. The on-device guarantee is what makes the privacy claim
  verifiable. A silent fetch added as a "bug fix" destroys the guarantee. See AGENTS.md
  §2.5.

- **[synthetic data]** — `src/lib/hearings.ts` generates fake hearing data. Do not
  extend it, do not import it in new components, do not use it as a reference pattern.
  It is a known violation pending deletion. See AGENTS.md §3.1.
  **2026-08-06 correction:** confirmed absent from the working tree and from full git
  history as of the `feature/phase3-minneapolis-lims` scaffold — there is nothing left to
  delete. AGENTS.md §3.1 still describes the file as if it exists; that section needs a
  human edit to match reality (either "not currently present" or removal of the
  violation notice), separate from this entry. Do not assume the file exists just because
  AGENTS.md or this line says so — check the tree first.

---

## Downstream Compatibility

- **[schema changes]** — flockoffmn.org and mndatacenter.org consume the static JSON
  this repo emits. Any change to field names, ID formats, or file paths is a breaking
  change for those sites. Bump `schemaVersion` and keep the prior version served.
  Do not rename fields without checking downstream consumers first. See AGENTS.md §2.4.