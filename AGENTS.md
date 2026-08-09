# AGENTS.md — wealldobettermn: Repository Architecture & AI Behavior Rules

A map-first civic transparency platform for Minnesota local, county, and state politics.
Next.js + TypeScript, MapLibre GL JS (OpenFreeMap "Liberty"), Tailwind CSS, deployed to
Cloudflare Workers via OpenNext. These rules govern all code generation, refactoring, and
data ingestion.

`CLAUDE.md` is a pointer to this file. Edit here.
`LESSONS.md` tracks operational gotchas across sessions. Read it alongside this file.

## What this project answers

Four questions, in this order. Every feature earns its place by serving one of them.

1. **Who represents me?** — city, county, and state, from one address search.
2. **What do they vote for?** — roll calls, sponsorships, agenda items, attendance.
3. **Where does their money come from?** — campaign finance receipts, economic interest
   statements, lobbying disclosures.
4. **How do I contact them?** — official channels, next meeting, when comment opens.

## Role in the wider project

This repository is the **canonical officials and jurisdictions layer** for the whole
family of Minnesota transparency sites. Sister projects covering surveillance
infrastructure and data center siting both need to answer "which body approved this, and
who voted for it." That question is answered here, once, and consumed downstream. See
§2.4 — being an upstream dependency imposes obligations that a standalone site wouldn't
have.

The subject of this site is **public power**: who holds an office, what jurisdiction it
covers, what decisions are pending before it, who funds the officeholder, and how a
resident reaches them. Never the residents themselves.

---

## Part 0: Guiding Principles

These are load-bearing. When a design decision is ambiguous, resolve it toward these.

**0.1 — Connection is the product.** A ward is a representative is a committee seat is a
donor is a pending ordinance is a hearing date is a vote. A map of colored polygons fails
the mission even when every boundary is correct. Model **relations as first-class
objects**: `address → district → officeholder → body → committee → agenda item → vote`,
and `officeholder → committee → contributor`. Every detail panel answers "what is this
connected to, and what is it about to decide?" before it answers "what is this?"

**0.2 — Receipts, not rhetoric.** Every published claim resolves to a citable primary
record — the city's own open-data portal, the clerk's agenda packet, a roll call, a
statute, a campaign finance filing. This site's credibility is its only asset, and it is
spent the first time someone finds a fact with no source behind it. That asset is now
shared: a bad record here propagates to every downstream site.

**0.3 — No placeholder data ships as fact.** See §3.1. This is currently the largest
correctness risk in the repository.

**0.4 — Make the routine visible.** Local government advances through consent agendas,
unanimous voice votes, and four-page staff reports nobody reads. Design bias runs toward
surfacing the boring and unopposed: flag items passed on consent, with no discussion, or
with no public comment. What slipped through quietly is the story.

**0.5 — Show change over time.** A snapshot hides the mechanism. Ingests are versioned and
diffed; the site exposes a time axis — redistricting history, term turnover, how a body
voted last time it saw this issue, how a member's funding profile changed between cycles.
Terms end, wards get redrawn, and a map that silently overwrites its own history is worse
than no map.

**0.6 — Every record ends in an action.** A user who finds their ward must immediately see
what can be done: the next meeting date and how to attend, when public comment opens, how
to testify, how to file a data practices request, official contact channels, and how to
export or share the record. Transparency that terminates in a phone number nobody answers
is a failure state.

**0.7 — Build for the people it's about.** Fast on old phones and bad connections, fully
usable by screen reader, no login, no paywall, no tracking, no fingerprinting, plain-
language summaries beside every technical field, and bulk export under a permissive
licence. The residents least served by their council are the least likely to be on a fast
laptop.

**0.8 — Outlive the author.** Assume no maintainer. Reproducible builds, no proprietary
API keys in the critical path, mirrored and hashed source documents, dependency-light ETL,
and a `RUNBOOK.md` that lets a stranger rebuild everything from scratch. Every technical
choice is evaluated on whether it still works in ten years with nobody watching.
Cloudflare is a deployment target, not a dependency: the app must remain buildable and
hostable elsewhere. **Any upstream API is assumed to die** — see §3.2.

**0.9 — Translate the jargon.** Ordinance, resolution, consent agenda, first reading, CUP,
TIF, EAW, interim ordinance, committee of the whole, independent expenditure — every term
of art gets a glossary entry rendered inline in plain language. Institutional language is
a wall; the site's job is a door.

**0.10 — The floor.** §1b does not move. It will at some point be tactically expensive to
hold — after something awful happens, when publishing one person's details would feel not
just justified but obligatory. That moment is foreseeable, so it is decided here, in
advance, rather than at 2am by whoever is at the keyboard. Anyone reading this later,
including a future maintainer or a future version of the original author: this is a rule,
not a judgment call. The floor is what makes everything above it legitimate.

**0.11 — No masks.** Every argument on the site is bylined and accountable. No anonymous
collective voice, no hero framing, no borrowed insurgent iconography. The project's power
comes from being more accurate and more boring than its opposition — agenda item numbers,
roll calls, term dates — not from being more theatrical.

**0.12 — The user's address is not ours.** A resident typing where they live in order to
find their council member has told us something they should not have to trust us with.
The architecture ensures they don't: address resolution happens on-device, and nothing
about it is transmitted, logged, or retained. See §2.5. This is the one principle a
visitor can verify by opening the network tab, which makes it the one most worth getting
right.

**0.13 — AI-assisted, human-accountable.** Code, data pipelines, and prose in this
project are developed with AI coding assistance (Claude Code / Anthropic). Every output
is reviewed, edited, and owned by a human maintainer before it ships. AI tooling is a
drafting aid; the ethical guardrails in this document — especially §0.10, §1b, and §1c —
are not delegated to it. This file is the instruction set given to the AI; publishing it
is itself a transparency act. Anyone auditing how this project was built should read it as
such. Errors introduced by AI-assisted development are the maintainer's responsibility,
not a caveat that limits that responsibility.

---

## Part 1: Ethical Guardrails

### 1. The Core Policy: Privacy & Compliance

**Transparency for power; privacy for people.** Scrutiny scales with authority. The line
is **whether the person is exercising public power or spending public money.**

**1a. Named, in their official capacity.** Councilmembers, mayors, county commissioners,
legislators, sheriffs, county attorneys, school board members, appointed commissioners and
board members of public and quasi-public bodies. Also registered lobbyists and their
principals, and corporate officers named in filings, in their corporate role.

Publishable, sourced: name, office, ward or district, party affiliation as filed, term
start and end, official portrait as published by the office, official contact information
as published by the office, committee assignments, votes and vote dates, sponsorships,
motions, recusals, attendance, public statements made in official settings, campaign
finance receipts (MN Campaign Finance Board; FEC for federal), Statements of Economic
Interest, and lobbying disclosures.

**1b. Out of scope, permanently.** (See §0.10.)

* **Private residents.** Constituents who commented, testified, petitioned, complained, or
  appear in a public record incidentally. Aggregate counts only, never enumerated —
  including supportive ones. Never build a search index over the names of people who spoke
  at a public meeting.
* **Individual small donors.** Campaign finance filings contain the names, employers, and
  home cities of ordinary people who gave $50 to a school board candidate. That the data
  is technically public does not make republishing it as a searchable index defensible.
  Publish **aggregates and named entities**: totals by cycle, counts by contribution size
  band, PAC and party unit and lobbyist-principal and corporate contributions by name.
  Individual natural-person donors below the itemization threshold that matters — a
  documented figure recorded in config — are never enumerated, never mapped, never made
  searchable by name. Never geocode a donor address.
* **Non-supervisory public employees.** Clerks, inspectors, permit techs, line staff,
  patrol officers. They implement; they do not decide. Record the office, never the person.
* **Private life of officials.** Home address, personal phone or email, personal social
  accounts, vehicle, family members, children, health, religion, immigration status,
  sexual orientation, private conduct. Never named, never mapped, never counted. Only the
  official portrait published by the office itself — never a scraped image.
* **Anything at household resolution.** No feature, layer, filter, or export resolves to
  an individual address or parcel occupant. Ward, precinct, and block group are the finest
  geographies the site publishes.
* **Visitor data.** No account, no profile, no saved searches tied to an identity, no
  behavioural logging, no address retention. A resident looking up who represents them
  leaves no trace.

**1c. Assertion discipline.** Record the vote. Record the contribution. Record the date of
each. Place them adjacent and let the reader do the arithmetic. **Do not compute, publish,
or imply a causal claim.** No corruption scores, no "bought by" labels, no derived
influence rankings, no auto-generated accusations, no ideological scoring of individual
members.

This rule binds hardest on question 3. Putting "voted yes on the data center TIF" and
"received $X from the developer's PAC" on the same screen is legitimate and devastating.
Adding a computed field that asserts the second caused the first is defamation exposure
and makes the story about you instead of them. Show both facts, show both dates, stop.

Editorial argument lives in clearly bylined prose, marked as opinion, physically separate
from the data layer, citing the same documents.

**1d. Structural enforcement.**

* Person types live in a discriminated union — `elected`, `appointed_senior`, `lobbyist`,
  `corporate_officer`. There is no variant for a private individual, **by construction**.
  If an upstream feed mixes private individuals into systemic data, ingest the systemic
  attributes and drop the rest. Campaign finance importers must filter donors against this
  rule at ingest, not at render — unpublished-but-present data is a leak waiting for a
  careless export.
* Every person record requires `officeHeld`, `jurisdiction`, `termStart`, `termEnd`, and a
  `sourceUrl` per attributed act. A person with no attributed official act gets no record.
* Officials leave the active layer when they leave office; their acts remain, dated and
  attributed to the office they held. Never delete history to reflect a new roster.
* Aggregates must be checked for re-identification risk before publication; suppress cells
  below a documented threshold.
* When in doubt, leave it out.

---

## Part 2: Architecture

### 2.1 Registry Pattern

The layer registry is the single source of truth. One registry entry drives the map,
legend, filters, detail panels, sources page, downloads, and address-search results.

* **Two-File Additions:** Adding a layer requires **exactly two files**:
  1. A fetch/ingest script in `scripts/` that emits the shared schema to `public/`.
  2. One entry in the layer registry under `src/lib/`.
  * *Do NOT edit page or component files directly to add a layer.* If a component needs to
    know a layer exists, the registry is under-specified — fix the registry.
* **Relations Are Registry Entries Too:** Per §0.1, edges between features carry their own
  provenance rather than being ad-hoc joins buried in components. An undocumented edge is
  a bug.
* **Build-Time Reads:** Static outputs are read at build time so UI counts and dates never
  drift from generated JSON. Counts rendered in copy are derived, never hand-typed.
* **Server Boundary:** Prefer static generation and edge-cached responses. Any dynamic
  route must justify itself against §0.7, §0.8, and §0.12 — a route that can be a static
  file should be a static file, and a route that would receive a user's address should not
  exist at all.

### 2.2 Ingestion

* **Provenance Record (required per feature):** `primarySourceUrl`, `sourceAgency`,
  `documentType`, `documentId`, `issuedDate`, `fetchedAt`, `licence`, `contentHash`.
* **Deterministic and Re-runnable:** Scripts produce identical output from identical
  upstream input. No timestamps in output beyond recorded fetch metadata, no random IDs.
* **Good-Citizen Fetcher:** Scheduled fetchers identify themselves with a descriptive
  User-Agent and contact address, respect robots.txt and rate limits, and back off on
  error. ArcGIS and Legistar endpoints are queried with explicit field lists and paging,
  not unbounded requests. No internal or private API scraping, no block evasion, no
  credentialed-portal automation. A source that cannot be fetched politely gets a
  `knownGaps` entry and a manual workflow, not a workaround.
* **Snapshot, Don't Overwrite:** Per §0.5, each run writes a dated snapshot and a diff
  against the prior run. Boundary changes and roster changes are events worth showing.

### 2.3 Third-Party Surface — Documented, Not Denied

This app is not a zero-dependency static site, and the rules should say so honestly rather
than aspire to a purity the deployment doesn't have.

* **Permitted, each listed on a public `/privacy` page in plain language:** the basemap
  tile provider (OpenFreeMap), the hosting/edge provider (Cloudflare), and upstream
  government or civic APIs called **at build time only**.
* **Forbidden:** analytics of any kind, third-party fonts, ad or marketing pixels, session
  or behavioural tracking, embedded social widgets, and **any runtime third-party request
  triggered by user input** — see §2.5.
* **Tile Independence:** Basemap style and glyph URLs are configurable in one place. The
  app must degrade to a plain background with boundaries drawn if the tile provider
  disappears — the data is the point, the basemap is decoration.
* **Log Posture:** Document what the edge provider logs, what retention applies, and what
  the project cannot control. Do not claim a privacy property the deployment doesn't
  deliver.

### 2.4 Canonical Officials Registry (Upstream Obligations)

Sister projects consume this data. That changes the contract.

* **Stable Identifiers.** Every jurisdiction, office, and officeholder carries a stable ID
  that survives roster changes, redistricting, and re-ingests. Use **Open Civic Data
  identifiers** (`ocd-division/country:us/state:mn/place:minneapolis/ward:3`) as the
  primary key for divisions. OCD IDs are the interchange standard the civic-data ecosystem
  already speaks, which makes downstream joins and future data imports free.
* **Never Recycle An ID.** A ward number reused after redistricting is a different
  division. IDs are versioned by effective date, not overwritten.
* **Published Contract.** Officials, offices, and divisions are emitted as versioned
  static JSON under a stable public path with a documented schema and a `schemaVersion`
  field. Breaking changes bump the version and keep the prior version served — downstream
  sites are not required to redeploy on our schedule.
* **Machine-Readable Provenance Travels With The Data.** Every exported record carries its
  own `sourceUrl` and `verifiedAt`. A downstream site must be able to cite the original
  record without calling back here.
* **No Downstream Callbacks.** Consumers fetch static files at their build time. This repo
  never becomes a runtime dependency of another site — that would make our uptime their
  correctness problem and our logs their users' exposure.
* **Bulk Export Is A Feature, Not A Courtesy.** Full dataset download under a permissive
  licence, linked from the UI, per §0.7.

### 2.5 Address Search — On-Device Only

The search bar lets a resident pinpoint their location to find their city, county, and
state representatives. It is the most privacy-sensitive surface in the application, and
the design is constrained accordingly.

**Hard rules:**

* **No geocoding request ever leaves the device.** Not to a third party, not to our own
  Worker, not "anonymised," not for the "hard cases." Address → district resolution runs
  entirely client-side against a static index shipped with the app.
* **No typeahead network calls.** Per-keystroke autocomplete against a remote service
  leaks every prefix of an address and is the single most common way apps like this leak.
  Debouncing is not a fix. The fix is that the index is local, so there is no request to
  debounce.
* **No logging or retention.** The query string is never written to any log, error report,
  analytics sink, URL query parameter, browser history entry, or persisted storage. Errors
  thrown during resolution must not include the input.
* **No URL leakage.** A shareable result URL contains the resolved division ID, never the
  address. `/ward/minneapolis-3`, never `?q=123+Main+St`.

**Implementation approach:**

* Build-time generation of a compact client-side gazetteer: TIGER/Line address ranges for
  the covered geography, plus point-in-polygon indexes for each district layer. House
  number interpolation along street segments happens locally. Ship as compact binary
  (typed arrays or PMTiles), lazily loaded, chunked geographically so a user downloads
  only their region.
* **Progressive precision.** Most lookups don't need a full street address. City name, ZIP,
  or intersection narrows to a small candidate set with no address parsing at all. Ask for
  the least precise input that answers the question, and say so in the UI.
* **Ambiguity is surfaced, never silently resolved.** ZIP codes cross district boundaries
  routinely. If an input maps to multiple districts, show all of them and say why — never
  pick one and present it as certain. Silently choosing the wrong district is the worst
  failure this site can produce, because the user has no way to detect it.
* **Optional browser geolocation** is a separate, explicitly-requested action, resolved
  against the same local index, and equally never transmitted.
* **If a remote geocoder is ever genuinely unavoidable** for some edge case, it requires:
  an explicit interstitial naming the third party and what will be sent, opt-in per use,
  a documented entry on `/privacy`, and a fully functional local path for users who
  decline. Default is always local. This escape hatch is documented so nobody quietly
  adds a fetch call and calls it a bug fix.

---

## Part 3: Data Provenance & Correctness

### 3.1 Placeholder Data — Standing Rule (Prior Violation Resolved)

`src/lib/hearings.ts` used to generate mocked, deterministic hearing and meeting data per
ward because no combined Minneapolis + St. Paul meetings feed was wired up yet. **That
file was deleted** (`git log` — commit `2bd0d1a`, "Remove fabricated hearing/meeting
data"; landed as PR `fix/remove-fabricated-hearings`) and the site now renders an honest
empty state for meetings coverage instead. This section previously described that mock as
a live, highest-priority violation — it no longer exists in the working tree or is
reachable from any route. The rule below is kept in force as a standing constraint, not
because the violation is current.

**Fabricated civic data on a civic transparency site is the worst class of correctness
failure this project can ship.** A resident who misses a real hearing because this site
invented a fake one has been harmed by the project, and one such incident ends its
credibility permanently. It also propagates: downstream sites consuming this repo would
inherit the fabrication. See §2.4.

**Default resolution for any missing feed: render an honest empty state** — "no meetings
feed connected yet for this city," with a link to the city's own calendar. An empty state
is a known gap; fake data is a lie the user cannot detect. Ship the empty state.

If a mock must ever exist temporarily (e.g. for a script's own self-test, per
`scripts/fetch-state-legislature.mjs --self-test`'s fixture), all three are required:

1. Every synthetic record carries `synthetic: true` in the type system — a field, not a
   comment, so the compiler enforces handling.
2. The UI renders synthetic records with an unmissable, non-dismissible label. Not a
   footnote. Not a tooltip.
3. Synthetic records never appear in exports, feeds, search results, counts, "upcoming"
   summaries, the public JSON contract in §2.4, or anything screenshot-able without the
   label attached — and never in `public/`, ever, regardless of label.

Once a real feed is connected, delete the mock rather than leaving it as a fallback. A
silent fallback to fabricated data is worse than an outage.

### 3.2 Officials Data — API-Sourced, Never Hand-Maintained Silently

Hand-maintaining a roster (currently the Minneapolis names in `scripts/fetch-wards.mjs`)
goes stale silently, and stale representation data is actively misleading: it tells a
resident to contact someone who no longer holds the office. Move to APIs where they exist.

**Known sources, by level:**

| Level | Source | Notes |
|---|---|---|
| City council (Mpls, St. Paul) | **Legistar / Granicus Web API** per city — `/persons`, `/bodies`, `/events`, `/matters`, `/votes` | Answers questions 1, 2, and 4 at once. Highest-value integration in the project; replaces the hearings mock too |
| City boundaries & rosters | Minneapolis and St. Paul ArcGIS open-data portals | Already wired for wards; boundaries are authoritative here |
| State legislature | **Open States API v3** and their bulk downloads | OCD IDs native. Prefer bulk files over the keyed API per §0.8 |
| State roll calls | MN House and Senate journals; Revisor | Recorded votes only; voice votes recorded as "no recorded vote," itself a finding |
| County & school boards | County/district sites; some use Legistar | Largest coverage gap; expect manual until proven otherwise |
| Campaign finance (state/local) | **MN Campaign Finance Board** bulk data | Question 3. Subject to the donor rule in §1b |
| Economic interest (stock, outside income, real property) | **MN Campaign Finance Board** — Statements of Economic Interest, per-official page | Question 3. Structured HTML per official, not a scanned PDF — confirmed by direct fetch. No bulk/name-search endpoint found yet; enumerating "all officials" requires the board's own official/agency index page as an ID source, not sequential ID guessing (§2.2 "no unbounded requests") |
| Campaign finance (federal) | **OpenFEC API** | Free, keyed, well-documented. `/candidates` and `/committees` are natively bulk/paginated — covers all federal candidates without a per-official crawl |
| Federal legislative activity (bills, sponsorships, roll calls) | **Congress.gov** | Official record, Tier 1. Covers MN's federal House/Senate delegation only — not state or local |
| Federal officeholder bio/term data | **Bioguide** | Official congressional biographical directory. Office dates, committee assignments; source for federal `verifiedAt`/term data |
| Candidates & election results | MN Secretary of State | Authoritative for terms and turnover |

**Evaluated and rejected (2026-08-09).** GovTrack's raw bill/cosponsorship/vote data would be
Tier 3 (redundant with Congress.gov's Tier 1 record of the same facts) — never use its
**ideology score**, a computed left-right ranking of a member's political position, which is
exactly the "no ideological scoring of individual members" ban in §1c. OpenSecrets' public API
was discontinued April 2025; current access is a paid custom arrangement, which fails §0.8.
TrackAIPAC.com is Tier 4 advocacy with a self-described contested donor-attribution methodology
(bundler/network inference, not primary-source records) — the kind of derived-influence claim
§1c prohibits, so it doesn't even qualify as a Tier 4 lead here. keep-dc-honest.com (Influence
Registry) is a Tier 3/4 secondary aggregator sitting on top of the (now-dead) OpenSecrets API,
with no MN state or local coverage — useful only as design reference for disclaiming causal
claims, not as a data source.

**Deprecated — do not use.** The Google Civic Information API's Representatives endpoint,
long the default for address-to-official lookup, was announced for turndown in April 2025
and was shut down as of April 30, 2025. Do not build against it or copy tutorials that
assume it. Commercial replacements exist (Cicero, Ballotpedia, USgeocoder) but all require
paid keys and fail §0.8; treat them as a last resort for coverage gaps, never as the
backbone.

**Evaluated and rejected (2026-08-09) — Cicero and Ballotpedia, checked in depth against a
peer civic-data project's actual dependence on both.** Prompted by seeing a comparable
platform (Live Democracy, livedemocracy.us) use both in production, each was vetted past
the one-line dismissal above, including for narrower build-time-only uses that don't touch
§2.5's address-search path. Neither earns an exception.

*Cicero* fails on redistribution rights, not just price: its Terms of Use grant a license
over data *you* submit to Cicero, but no license to cache or republish data Cicero *returns*
to you — exactly what §2.4's public, versioned static-JSON contract requires. A separate,
quote-only "Licensing" page for bulk/redistribution needs is the vendor's own tacit
admission the standard API terms don't cover it. Cicero has also changed corporate owners
twice in thirteen months (Azavea → Element 84, Feb 2023; Cicero specifically carved out and
resold to Melissa, a CRM/data-quality vendor, Mar 2024) — §0.8's "any upstream API is
assumed to die" observed directly, not hypothesized. No public source confirms it actually
covers Minnesota's county boards or school boards, the coverage gap this evaluation was
nominally chasing. Verdict: ruled out even as a build-time enrichment source; the only
surviving use is an unpublished, human-run cross-check lead, never cached or cited.

*Ballotpedia*'s developer Terms of Use state plainly: "No right or license is being conveyed
to Licensee to use or share the full data sets provided by Ballotpedia with any other
company or individual" — in direct tension with §2.4. Pricing is sales-gated and
unpublished (one unconfirmed secondary report puts API access at "thousands of dollars per
month"), which fails §0.8's "a stranger can rebuild this from RUNBOOK.md" bar regardless of
Ballotpedia's own nonprofit standing. Its own published `/officeholders` example response
returns a county and a school district with `"offices": null` — Ballotpedia's own
documentation shows the gap, not just silence about it; its officeholder coverage is
documented as the top 100 cities by population, with full school-board coverage a separate,
additional sales product. Verdict: ruled out as a backbone or bulk source. One narrow use
survives every constraint here and in §3.3's Tier 4 rule: a human editor citing one
specific, already-published Ballotpedia page URL as a `corroborated`-tier secondary source
next to a primary record — manual citation of a public page, never API ingestion, never
paid, never the sole basis for a published fact.

**Rules for any API-sourced roster:**

* **Cache the response, commit the derived output.** The build must succeed with every
  upstream API unreachable. An API is a refresh mechanism, not a runtime dependency.
* **Every record carries `verifiedAt` and `verifiedAgainst`** (the source URL), whether it
  came from an API or a human. The UI surfaces the verification date wherever a name or
  contact appears.
* **A record older than a configured threshold renders a visible staleness notice.**
* **Build fails, loudly, if any record's `verifiedAt` predates the most recent general
  election date recorded in config.** Elections are the known invalidation event; encode
  them rather than remembering them. This applies to API-sourced records too — upstream
  providers are often slower to update than the election is to happen.
* **Diff on refresh.** A roster change is an event (§0.5), not a silent overwrite. Surface
  who left, who arrived, and when.

### 3.3 Citation Rules

* **Source Tiering:** Tier 1 = government primary records (city and county open-data
  portals, clerk agendas and minutes, Legistar votes, roll calls, MGDPA responses, CFB and
  FEC filings, Secretary of State records). Tier 2 = state and federal records and
  regulated filings. Tier 3 = first-party non-governmental (Open States and similar civic
  aggregators of primary data). Tier 4 = journalism, advocacy trackers, commercial
  aggregators — **lead lists only**, never the sole basis of a published feature.
* **Confidence Enum:** `confirmed` (Tier 1/2 document states it directly), `corroborated`
  (two independent lower-tier sources agree), `reported` (credible secondary reporting, not
  yet documented), `lead` (unresolved — not rendered).
* **Missing Sources:** Never fabricate or infer. If an upstream field or link does not
  exist, leave it `null`, state `"No source found"` in the UI link field, and record the
  gap in `knownGaps`.
* **Document Retention:** Mirror source documents under `public/` with content hashes where
  licensing permits. A citation that 404s in eighteen months is not a citation.
* **Redaction Is Data:** When a records response withholds material, record `redacted: true`
  with the claimed statutory basis and date. That a figure was withheld is publishable and
  is often the most useful thing on the page.
* **Coverage Honesty:** Every registry entry carries a `coverage` field describing what the
  layer structurally cannot see. Currently: only Minneapolis and St. Paul wards are mapped;
  suburban, township, county, and school district boundaries are absent; no meetings feed
  is connected; no campaign finance layer exists yet. The site renders a persistent,
  plain-language **"What this map can't see"** section derived from those fields. Claiming
  completeness we cannot back is the fastest way to lose the argument — and downstream
  sites inherit our gaps whether or not we document them.
* **Upstream licences** must be checked and recorded with attribution text before a source
  is added.

### 3.4 AI-Generated Content — Provenance & Review

* **No AI-generated data ships as fact.** AI tooling may draft ingest scripts, schema
  definitions, and UI copy. It does not produce source records. Every published data point
  must trace to a Tier 1–3 source per §3.3 regardless of how the pipeline that fetches it
  was written.
* **AI-generated copy is human-reviewed before render.** Plain-language glossary entries,
  empty-state messages, and "what this map can't see" descriptions may be drafted with AI
  assistance. A human reads and approves every string that reaches a user.
* **The AGENTS.md is the AI instruction record.** Substantive changes to how AI tooling is
  used in this project are reflected here, not in commit messages or READMEs alone. The
  file's git history is the audit trail.
* **Public disclosure.** The project's `/about` page states plainly that the codebase was
  developed with AI assistance, that all data and editorial decisions are human-reviewed,
  and that errors can be reported via the issue tracker. The framing is capability, not
  disclaimer — this is a human-led project that uses modern tools.

---

## Part 4: Client Constraints & Accessibility

* **Accessibility Sync:** The DOM record list beside the MapLibre canvas is the primary
  screen-reader interface and must stay perfectly in sync with drawn features. A ward must
  be selectable, and its representative readable, without ever touching the map. Respect
  `prefers-reduced-motion` and label all controls.
* **Search Is The Primary Interface, Not The Map.** Many users will never interact with the
  canvas. Address search, results, and the full representative record must be complete and
  usable with the map absent, failed, or never loaded.
* **Keyboard Complete:** Every map interaction has a keyboard equivalent. Wards are
  reachable by tab order and by name search.
* **Colour Is Never The Only Signal:** Party, status, and category carry text or pattern in
  addition to hue. Check ward fills against colour-vision deficiency simulation.
* **Plain Language:** Per §0.9, every jargon term renders with an inline gloss from the
  glossary. No unexplained acronyms in user-facing copy.
* **Budget:** The ward map must be usable on a throttled 3G connection on a five-year-old
  phone. GeoJSON is simplified per zoom level; the address index is chunked and lazily
  loaded so nobody downloads the whole state to find one ward.

---

## Part 5: Commands & Workflow

```bash
npm install
npm run dev             # Next.js dev server — http://localhost:3000
npm run data:wards      # Ward boundaries + roster; writes public/wards.geojson
npm run data:officials  # Refresh officeholders from upstream APIs; diffs against prior run
npm run data:index      # Build the on-device address/district gazetteer
npm run lint            # ESLint — MUST STAY AT 0 ERRORS
npm run build           # Production build; fails on stale verifiedAt (§3.2)
```