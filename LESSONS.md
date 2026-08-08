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
  historical roll calls. **Still not live-verified as of 2026-08-06** — a research pass
  confirmed the root URL/auth from docs, but nobody has hit the real API with real calls
  the way Legistar and MN CFB have been. Don't assume the scaffold's shape is correct
  until that happens.

- 2026-08-06 — **[legistar]** — St. Paul (`stpaul`) and Hennepin County (`hennepinmn`)
  clients are both reachable with **zero auth token**, confirmed live (an earlier report
  of a 403 didn't reproduce). When a token *is* required, Legistar returns `403 "Key or
  Token is required"`, not `401` — treat both as the same "needs a token" signal, don't
  special-case on status code. The vote-lookup path has a real field-name trap: the
  history-row id field is `MatterHistoryId`, **not** `.Id` — confirmed live that
  `MatterHistoryId` and the corresponding `EventItemId` are the same value, so no extra
  correlation query is needed once you read the right field (fixed in #31, was silently
  wrong before that — no error, just an empty/undefined lookup). `EventItems` must be
  fetched per-event (`/Events/{id}/EventItems`), never as a top-level collection.

- 2026-08-06 — **[mn campaign finance board]** — Bulk CSV confirmed live at
  `https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-2026985457`
  — stable, session-less, safe to `curl` cold. Real `Contrib type` distribution is ~82%
  "Individual." **The $200 itemization line is a per-cycle cumulative total, not a
  per-transaction one** — a $125 gift showed up itemized once its donor's running total
  for that cycle crossed $200. This confirms the donor-privacy filter (AGENTS.md §1b) must
  key off donor *type*, never dollar amount — a per-transaction amount check would have
  been wrong. "Self" (candidate self-funding) and "Other" `Contrib type` values are
  deliberately left unmapped/aggregate-only pending a human policy call, not defaulted.

- 2026-08-06 — **[minneapolis lims]** — `lims.minneapolismn.gov` sits entirely behind a
  Cloudflare JS bot-challenge that blocks `curl`/`WebFetch` on every path *except* one:
  the **`/api/v1/` path prefix bypasses the challenge** and hits the real backend
  directly. Confirmed live (as 400s, not 404s — i.e. real, existing, just token-gated)
  that `referenceList/CouncilMembers`, `MeetingBodies`, `FileItemStatus`, `FileTypes` all
  exist under that prefix; `CouncilTerm` (singular) is the real endpoint name —
  `CouncilTerms` (plural) 404s. Still blocked on the user's registered API key being
  approved before the response shapes can actually be confirmed. No other Twin Cities
  metro city uses this DataNet/LIMS vendor (confirmed via search), so this is a
  one-off integration, not a pattern to replicate elsewhere.

---

## Build & Tooling

<!-- Add entries when the build behaves unexpectedly, deps conflict, or Cloudflare
Workers edge cases surface. -->

- **[cloudflare]** — Cloudflare is a deployment target, not a dependency. The build must
  remain hostable elsewhere. Do not use Workers-specific APIs in the core app logic —
  keep them in the adapter layer only.

- 2026-08-07 — **[cloudflare workers builds]** — Real deploys are **not** GitHub Actions.
  `.github/workflows/ci.yml` runs lint/tests/build/smoke-test only and explicitly deploys
  nothing. The actual deploy is Cloudflare Workers Builds' own dashboard-configured git
  integration, triggered directly by a push, running fully async — a preview URL for a
  given commit doesn't exist yet the instant `git push` returns. `workers_dev` and
  `preview_urls` are forced on in `wrangler.jsonc` specifically so Workers Builds' per-
  branch/per-commit `.workers.dev` preview links keep working (see the comment above
  those two keys). To find a live preview link after pushing: `npx wrangler deployments
  list --name mn-civic-watch`, or the Workers Builds tab in the Cloudflare dashboard.

- 2026-08-06 — **[node]** — `rows.push(...parseRawRows(raw))` in the MN CFB ingest script
  blew V8's call stack spreading ~268k array elements as individual call arguments. Any
  ingest script touching a real-scale civic dataset (campaign finance, statewide rosters)
  should append large arrays with a plain loop or `push.apply`/`concat`, never spread —
  this only shows up at production data volume, not in a small local test.

- 2026-08-06 — **[cloudflare workers / node:fs — SITE-DOWN INCIDENT]** — A `node:fs`
  read of a `public/` file (`readFileSync`), anywhere it can end up bundled into an
  `src/app` or `src/components` module, is a live production outage waiting to happen —
  not a style nit. `next build` succeeding locally proves nothing about this: `public/`
  is real disk during `next build` (a plain Node process), but OpenNext bundles page/
  component modules into the deployed Cloudflare Worker too, and the Worker's runtime
  has no filesystem at all — `public/` is served via the `ASSETS` binding, not `node:fs`.
  **Real incident:** `src/app/page.tsx` called `loadAndValidateStateLegislatureData()`
  (in `src/lib/stateLegislatureData.ts`) at **module scope** — a side effect that must
  execute unconditionally on import per JS semantics, so it could never be tree-shaken
  out of the Worker bundle. It threw `ENOENT '/bundle/public/state-legislature.geojson'`
  on every single cold start, taking down **every route**, not just the home page — a
  full site-wide 500 (`wrangler tail` is what found it; `next build` gave zero signal).
  Fixed in #43 by moving the read into `next.config.ts`, gated on
  `PHASE_PRODUCTION_BUILD` — a genuinely build-time-only execution context (real Node
  process during `next build`) that never gets compiled into the Worker's route bundle.
  A sibling case in `src/app/bills/page.tsx` used the same `readFileSync` pattern but
  **function-scoped** inside a try/catch, not at module scope — it didn't crash (a JS
  engine only executes function bodies when called, and a fully-static route with no
  `revalidate`/`dynamic` export currently gets tree-shaken out of the Worker bundle
  entirely, confirmed empirically: grep `.open-next/worker.js` for `readFileSync` — zero
  hits, either before or after the fix), but it was one `export const revalidate = ...`
  away from silently swapping real, live data for an empty state instead of crashing —
  quieter and arguably worse. Fixed in #44 by switching to a bundler-resolved static
  JSON import (`import data from "../../../public/foo.json"`), which the bundler inlines
  into the compiled output at build time — no disk read left for the Worker to ever
  depend on, regardless of future rendering-mode changes. **Rule going forward:** never
  `readFileSync`/`writeFileSync`/`readdirSync`/`existsSync` a `public/` (or any) file
  from anything under `src/app` or `src/components`, even guarded. Use a build-time-only
  context (`next.config.ts`, gated on `PHASE_PRODUCTION_BUILD`) for validation-only
  reads, or a bundler-resolved static/dynamic `import` for data that actually needs to
  render — never `node:fs` in either case. A CI workflow (`.github/workflows/ci.yml`,
  added same day) now builds the actual OpenNext/Cloudflare Worker bundle and
  smoke-tests it in a real `wrangler dev` (workerd) sandbox on every PR specifically to
  catch this class of bug before merge — `next build` alone was exactly the blind spot
  both incidents shipped through.

- 2026-08-06 — **[git worktrees]** — Agent-tool runs with `isolation: "worktree"` can
  leave orphaned worktrees under `.claude/worktrees/` if a session ends without cleanup
  (8 accumulated from one batch of phase-scaffold PRs, untracked, invisible except as
  `?? .claude/worktrees/` in `git status`). Harmless to tracked source, but a plain
  `npm run lint` picks up each one's own stray `.next/types` build output — the repo's
  `globalIgnores(".next/**")` in `eslint.config.mjs` doesn't match that nested path — and
  reports thousands of false-positive errors. Run `npx eslint src` to check the real
  state instead of trusting a bare `npm run lint` count. Prune with `git worktree remove`
  once the branch merges (confirm `git status --short --branch` in the worktree is clean
  first).

---

## Map & Client Performance

<!-- Add entries when WardMap.tsx (or any other client-side data-heavy component)
regresses on payload size, load sequencing, or cache behavior. -->

- 2026-08-07 — **[geojson size]** — Raw ArcGIS/county GIS output ships 14+ decimal
  places of coordinate precision (sub-millimeter) with zero simplification — nobody
  upstream trims this before publishing it. Any new `fetch-*.mjs` script that writes a
  Polygon/MultiPolygon layer to `public/` should route its output through
  `scripts/lib/geoSimplify.mjs`'s `simplifyAndRound()` before `writeFile`, the same way
  `fetch-wards.mjs`/`fetch-commissioners.mjs`/`fetch-state-legislature.mjs` do — it's an
  80-90% byte reduction with no visible quality loss at this app's actual zoom range, and
  it costs one import + one function call. Skip it only for a layer small enough already
  that it isn't worth the pass (see `fetch-at-large-boundaries.mjs`'s own comment on
  Woodbury's 848 coordinate pairs) — don't skip it by default.
- 2026-08-07 — **[client fetch caching]** — `{ cache: "no-store" }` on a client-side
  `fetch()` for a `public/*.json`/`*.geojson` file defeats the browser's HTTP cache
  *entirely*, every page load, not just across deploys. If a stale cached response ever
  crashing the component on a missing field is the actual worry, fix it with a
  content-hash query param (see `WardMap.tsx`'s `dataUrl()` + `scripts/lib/
  dataManifest.mjs`) instead — that gets a guaranteed cache miss on real content changes
  *and* real caching everywhere else, rather than trading away the second to get the
  first. `public/_headers` still needs a real `Cache-Control` for the plain (non-`?v=`)
  path too, since a downstream consumer or the bulk-export link fetches that directly.
- 2026-08-07 — **[background-fetch vs. hidden-feature data]** — Before deferring or
  backgrounding a fetch for whichever LayerMode isn't currently visible, check whether
  something *other* than the visible layer already depends on that data — `WardMap.tsx`'s
  multi-tier hover/click panel (`src/lib/officials.ts`'s `resolveOfficialsAtPoint`)
  resolves city+county+state on every hover regardless of which single LayerMode is on
  screen, by design (PR #49). A naive "only fetch commissioners/state-legislature once
  the user switches to that mode" would have silently broken that panel for anyone who
  never switches modes — the fix that shipped instead (issue #67) still backgrounds the
  fetch (sequenced after the primary wards/mayors fetch, not gated on a mode switch) so
  the panel just fills in a moment later instead of going dark.

---

## Data & Privacy

- **[donor ingest]** — The §1b donor privacy rules must be enforced at ingest time, not
  at render time. If donor filtering happens in a component, unpublished individual donor
  records are still present in the JSON and can leak via export or a careless API route.
  Filter before writing to `public/`. **Confirmed against real MN CFB data (2026-08-06):**
  the filter must key off donor *type*, not dollar amount — see the CFB entry above. A
  natural-person donor stays unnamed at any contribution size, above or below the $200
  itemization line.

- **[address search]** — Never add a network request inside the address search flow, even
  as a fallback for edge cases. The on-device guarantee is what makes the privacy claim
  verifiable. A silent fetch added as a "bug fix" destroys the guarantee. See AGENTS.md
  §2.5.

- **[synthetic data — CORRECTED 2026-08-06]** — This entry previously said
  `src/lib/hearings.ts` generates fake hearing data and is a known violation pending
  deletion. **That's stale.** The file was already removed (`git log` shows commit
  `2bd0d1a "Remove fabricated hearing/meeting data"`) — confirmed absent from both the
  working tree and full git history, independently by both PR #27's and PR #28's
  investigations. AGENTS.md §3.1 still describes it as a present violation too and needs
  the same correction — that's a human edit to the binding instructions file, not one an
  AI session should make unilaterally; flagged, not applied. The underlying lesson stays
  valid: don't ship synthetic civic data as fact, and if a mock ever gets reintroduced,
  follow the `synthetic: true` / unmissable-label / never-in-exports rules AGENTS.md §3.1
  lays out.

---

## Downstream Compatibility

- **[schema changes]** — flockoffmn.org and mndatacenter.org consume the static JSON
  this repo emits. Any change to field names, ID formats, or file paths is a breaking
  change for those sites. Bump `schemaVersion` and keep the prior version served.
  Do not rename fields without checking downstream consumers first. See AGENTS.md §2.4.

---

## Process & Multi-PR Coordination

<!-- Lessons from running several branches/PRs off the same base in parallel. -->

- 2026-08-06 — **[parallel scaffolding]** — When multiple phase-scaffold PRs are cut from
  the same base at roughly the same time, a PR's own "no sibling branch/type exists yet"
  check is only true at scaffold time — it goes stale the moment *any* sibling merges
  first. Real example: #26, #28, and #30 each independently defined their own
  `Holding`-shaped type, each one's PR body correctly noting "no sibling branch exists on
  origin yet" — true when written, false by the time all three existed. Before merging
  the last PRs in a batch like this, re-check for type/schema overlap against current
  `main`, not against what existed when the branch was cut.

- 2026-08-06 — **[merge conflicts]** — `gh pr view --json mergeable` reporting
  `CONFLICTING`, or `git merge-tree` flagging a file as "changed in both," does not mean
  the actual diff conflicts — it can mean both sides made independent, non-overlapping
  additions to the same file (e.g. both appended a new type at the end). Open the real
  conflict before assuming a deep architectural fix is needed. Real example: PR #25
  showed as CONFLICTING; the only actual conflict was two `npm run data:*` script lines
  added at the same spot in `package.json` — a one-line-each fix, not the `Holding`-type
  reconciliation the batch's tracking memory had predicted for it.

- 2026-08-06 — **[worktree-local git ops]** — Running `gh pr merge --delete-branch` (or
  any command that does a local branch checkout/delete) while the shell's cwd is inside a
  `git worktree` for that same branch fails with `'main' is already used by worktree` —
  it's trying to switch the *worktree's* local branch pointer, not the main checkout's.
  The merge on GitHub still succeeds; only the local cleanup step errors. `cd` back to
  the primary repo root before running branch-deleting commands.