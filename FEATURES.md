# wealldobettermn.org — Features & Data Sources

Public transparency site for Minnesota elected officials. For each politician:
**who they are**, **what meetings they attended**, **how they voted**.

Scope: seven-county metro first, statewide later.

This doc is ordered **easiest → hardest**. Each phase is independently
shippable. Don't start a phase until the one above it is in production.

---

## Core principles

1. **Model office-holdings, not people.** A vote attaches to a *holding*
   (person + seat + date range), never directly to a person. This is what
   makes term changes non-destructive.
2. **Label coverage honestly.** Every jurisdiction gets a coverage tier
   badge. Never imply we have votes for a city where we only have a roster.
3. **Cite everything.** Every fact stores `source_url`, `fetched_at`, and a
   content hash. Inferences are labeled as inferences.
4. **Ingest is dependency-free Node in `scripts/ingest/`.** Same pattern as
   the sister projects. Raw payloads are snapshotted before parsing.
5. **Good-citizen fetching.** Real User-Agent with contact URL, respect
   robots.txt, conservative rate limits, no proxy rotation, no ToS evasion.

---

## Data model (build this first — everything else depends on it)

Entities (identifying attributes of an office-*holder*, not a private
person): jurisdiction, office, person (officeholder identity — name,
slug, photo of the office's public portrait), holding (person + office +
term dates), body, meeting, agenda_item, vote_event, vote, bill,
source_record (url, hash, fetched_at, raw_blob).

`end_date IS NULL` means currently serving. Never delete a holding.

**Coverage tiers:**
- **A** — full votes + meetings + agendas
- **B** — meetings + agendas, no structured votes
- **C** — roster + contact info only

---

## Phase 1 — State legislature roster & profiles

*Easiest. Statewide from day one. No scraping.*

**Source:** Open States v3 (`/people?jurisdiction=Minnesota`). Free API key,
JSON, `X-API-KEY` header. Also `openstates/people` on GitHub — YAML per
legislator, version controlled.

**Ship:** all 201 legislators with name, district, party, chamber, contact,
photo; profile page per legislator, slugged and stable; district boundaries
from MnGeo; map view of districts (MapLibre).

**Notes:** free tier is ~30 req/min, sleep 2.2s between calls. Seed from
the bulk download, not the API — use the API for deltas only. Store the
Open States id as an external key on `person`.

**Done when:** every sitting MN legislator has a profile page with a
correct district and a working "who represents me" lookup.

---

## Phase 2 — State bills & roll-call votes

**Sources:** Open States v3 `/bills` (votes/sponsorships resolved inline,
`updated_since` for delta polling); Open States bulk JSON/CSV per session
for backfill; LegiScan (free key, MN session archives) as a cross-check.

**Ship:** bill pages (identifier, title, session, sponsors, action history,
status); "bills voted on" tab on every legislator profile; vote detail with
full yea/nay roster per vote event.

**Notes:** attach votes to `holding`, not `person` — resolve by (person,
date). Where Open States and LegiScan disagree on a tally, store both and
flag; never silently pick one.

**Done when:** clicking a legislator shows every recorded floor vote with a
link to the bill, and every bill shows its full roll call.

---

## Phase 3 — Minneapolis (LIMS API)

**Source:** `lims.minneapolismn.gov` LIMS API v1, free registered key,
JSON, base path `/api/v1` (lowercase — see LESSONS.md's 2026-08-11 entry
for the routing/auth gotchas the first live key surfaced). Confirmed live
endpoints: `referenceList/{CouncilMembers,CouncilTerm,MeetingBodies,
FileItemStatus,FileTypes}` (GET — note singular `CouncilTerm`, not
`CouncilTerms`); `search/{meetingCalendar,FileItemSearch,
CouncilMemberVotingRecord,OrdinancesIntroductions,LatestEnactedOrdinances}`
(**POST** with a JSON body, year-scoped via `CalendarYear` where
applicable, 2014+ for `FileItemSearch`/`CouncilMemberVotingRecord`).

**Shipped (issue #102, this phase's first PR):** `meetingCalendar` +
`FileItemSearch` wired into `scripts/ingest/lims-minneapolis.mjs`, feeding
`src/lib/meetingsRegistry.ts`'s `MEETINGS_JURISDICTIONS` the same way
St. Paul/Hennepin's Legistar feed does — meetings, agenda items with
item-level pass/fail results, a rolling 14-days-back/90-days-ahead
window, a WardModal.tsx next-meeting teaser. Reference lists
(CouncilMembers, CouncilTerm, MeetingBodies, FileItemStatus, FileTypes)
are fetched and written alongside the meetings feed but not yet mapped
into canonical `Holding` rows — see `toHoldings()`'s removal note in that
script's git history and `MINNEAPOLIS_MEETINGS_VOTES_LAYER`'s knownGaps
in `src/lib/layers.ts`.

**Not yet shipped:** per-councilmember roll-call vote resolution (mapping
`FileItemSearch`'s embedded `LegislativeHistory[].VotingInformation.Votes`
— or a per-member `CouncilMemberVotingRecord` pull — into this site's
canonical Holding/Vote model, the way `scripts/ingest/legistar.mjs`'s
`buildVotesForWindow()` does for St. Paul/Hennepin); consent-agenda
flagging (LIMS has no field structurally equivalent to Legistar's
`EventItemConsent`); diff-on-refresh (AGENTS.md §0.5); 13 councilmembers +
mayor profile pages / wards-on-map parity with Phase 1+2.

**Notes:** CouncilMembers + CouncilTerm give real `holding` rows for free
— reference implementation for the churn model, once mapped. Actions
publish within ~2 hours of a meeting ending, nightly poll is plenty. Data
starts 2014, say so on the page. `FileItemSearch`'s `FileNumber` is not a
unique key across the response array — see LESSONS.md.

**Done when:** Minneapolis matches Phase 1+2 feature parity at city level.

---

## Phase 4 — Legistar jurisdictions (St. Paul, Hennepin County)

**Source:** `webapi.legistar.com/v1/{client}`, free, HTTPS, OData query
params. Known MN clients: `stpaul`, `hennepinmn`. Probe for others.

Endpoints: `/persons`, `/bodies`, `/officerecords` (start/end dates per
person per body), `/events` (meetings), `/eventitems`, `/matters` (agenda
items/legislation), `/matters/{id}/histories` (actions taken),
`/eventitems/{id}/votes` (the tally).

**The vote path is two hops:** filter `matters/{id}/histories` where
`MatterHistoryPassedFlag ne null` and `MatterHistoryActionBodyName eq
'<body>'`, take the returned `Id`, then hit `eventitems/{Id}/votes`.

**Notes:** responses cap at 1000 rows, page with `$top`/`$skip`. Date
filtering via `$filter=EventDate ge datetime'2024-01-01' and EventDate lt
datetime'2025-01-01'`. Some clients require `?token=...` — if read-only
GETs 401, that's why. Only records marked public on InSite come back;
absence is not evidence. `/officerecords` is authoritative for
`holding.start_date`/`end_date` on Legistar jurisdictions. Field names
ignore any label customization the jurisdiction did on their own site.

**Ship:** St. Paul city council + Hennepin County board at Tier A.

**Milestone:** after Phase 4 you have ~80% of metro population coverage
with 100% structured data and zero scraping. Good place to launch publicly.

---

## Phase 5 — Roster churn detection

There is no push notification for office turnover anywhere; detect it by
**diffing rosters on a schedule**.

**Design:** nightly, per jurisdiction, pull the current roster; normalize
to `[{office_ocd_id, person_external_id, name}]`, sort, hash; compare to
the previous snapshot hash, unchanged → stop; changed → compute the diff,
write `holding` mutations, emit a `roster_change` event with before/after
and source URL. Never auto-delete — set `end_date`, keep the row, keep the
votes. Surface changes in an admin review queue before publishing.

**Corroborating sources:** MN Secretary of State candidate filings and
official election results (ground truth for who won, covers every city
and county including ones with no meeting API); `openstates/people` git
history (the commit log is the change log for state legislators);
Minneapolis LIMS CouncilTerm; Legistar `/officerecords`.

**Edge cases to handle explicitly:** mid-term resignation, appointed
replacement, special election, redistricting (office identity changes,
not just the holder — new office id, not overwritten), name changes, two
different officeholders sharing a name (disambiguate by external id).

**Explicitly do NOT use:** Google Civic Information Representatives API —
both `representativeInfoByAddress` and `representativeInfoByDivision` were
turned down in April 2025. The Divisions API OCD-ID lookup still works and
is still the right join key; get the people from elsewhere.

---

## Phase 6 — Meeting documents & agenda ingestion

For jurisdictions with an API this is mostly free (agenda/minutes URLs
come back in the payload). The work: fetch and store PDFs with hashes;
extract text, chunk, index for search; link extracted text back to
`agenda_item`; handle amended agendas — keep both versions, diff them,
show what changed. Reuse the pipeline/fetcher/storage discipline from the
sister project's agenda-fetcher work; same politeness rules.

---

## Phase 7 — Suburban and outstate coverage

~180 cities in the metro, ~850 cities and 87 counties statewide. Most run
CivicPlus, Granicus Media Manager, iCompass, or Municode, or just post a
PDF — no API, no structured votes, sometimes no machine-readable minutes.

**Do not attempt uniform coverage.** Instead: (1) inventory first — build
a `jurisdiction_platform` table recording what system each of the 180
metro cities runs; this is a research task, the right first deliverable,
not an engineering task. (2) Probe for Legistar —
`webapi.legistar.com/v1/{guess}/bodies` is cheap to test, any hit promotes
that city straight to Tier A; do this before writing a single scraper.
(3) Tier C by default — roster + contact info from the city website is
achievable everywhere. (4) Tier B for CivicPlus/Granicus via per-platform
adapters, not per-city scrapers — write ~5 adapters, not ~180.
(5) Accept permanent gaps — some cities will never be better than Tier C;
the coverage badge makes that honest rather than embarrassing.

---

## Phase 8 — Optional / later

Campaign finance (MN Campaign Finance Board for state-level; local
candidate filings are county-level and mostly PDF, expect manual work).
Attendance rates, vote-with-majority stats, and similar derived metrics —
these are *inferences*, label them, show the method, let people see the
underlying rows. Watchlists/alerts on a topic (not on an individual
resident). Cross-linking to sister projects' layers where a body votes on
something in scope.

---

## Anti-goals

No tracking, profiling, or aggregation of private individuals — elected
officials in their official capacity only. No personal details or
anything outside the public record of office. No editorializing in the
data layer — opinion belongs on the about page, clearly marked, citing
the same documents. No paid data sources in the critical path.

---

## AI disclosure

Per project convention: human-led, AI-assisted, open to correction. Any
AI-derived field (summaries, classifications) is stored in a separate
column, labeled in the UI, and never overwrites source data.
