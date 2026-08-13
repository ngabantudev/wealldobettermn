// src/lib/layers.ts
//
// AGENTS.md §2.1 Registry Pattern — "the layer registry is the single
// source of truth. One registry entry drives the map, legend, filters,
// detail panels, sources page, downloads, and address-search results."
//
// This is the first concrete file at that path. The layers this app
// already ships (wards, mayors, commissioners, state legislature) predate
// it and are not retrofitted here in this change — each is wired up
// directly in its own page/component today, which is exactly the
// under-specification §2.1 warns about ("if a component needs to know a
// layer exists, the registry is under-specified — fix the registry").
// Retrofitting those is a separate, larger change; out of scope for the
// Phase 3 Minneapolis LIMS scaffold this file was added for. New layers,
// starting with this one, register here.
//
// Adding a layer per §2.1 is exactly two files: a fetch/ingest script
// under scripts/ that emits the shared schema to public/, and one entry
// in this registry. Do not wire a new layer into page or component files
// directly.

export interface LayerRegistryEntry {
  id: string;
  label: string;
  description: string;
  // Relative to the repo root.
  ingestScript: string;
  // Path under public/ this layer's data is served from — always present
  // and always valid JSON, even before real data exists (an honest empty
  // state per AGENTS.md §3.1, never a missing file and never fabricated
  // content).
  publicDataPath: string;
  // "empty": public data file exists with zero records — ingest not yet
  //   run against a live key/credential, or (per ECONOMIC_INTEREST_LAYER)
  //   blocked on a currently-empty manually-curated allowlist. See the
  //   layer's own coverage/knownGaps for which applies.
  // "partial": some records present, known coverage gaps remain (see
  //   knownGaps).
  // "live": fully wired for its documented coverage.
  status: "empty" | "partial" | "live";
  // AGENTS.md §3.3 Coverage Honesty — what this layer structurally cannot
  // see, in plain language, so CoverageNotice-style UI can render it
  // without a maintainer having to remember to update prose by hand.
  coverage: string;
  primarySourceUrl: string;
  sourceAgency: string;
  knownGaps: string[];
}

// FEATURES.md Phase 3 — Minneapolis (LIMS API). scripts/ingest/
// lims-minneapolis.mjs's first PR (#102/#160) shipped meetings and
// agenda items over a rolling 14-days-back/90-days-ahead window (not the
// full 2014+ historical backfill FEATURES.md's original Phase 3 sketch
// described — that's still a real gap, tracked below). A follow-up in
// the same phase (scripts/lib/limsRecentVotes.mjs) resolves the
// per-member roll call LIMS embeds on each agenda item into
// RepProperties.recentVotes for every Minneapolis councilmember,
// surname-matched the same way scripts/lib/legistarRecentVotes.mjs
// already does for St. Paul/Hennepin — real per-councilmember vote data
// reaches WardModal.tsx, just not yet resolved into this site's
// canonical models.ts Holding/Vote shape (see knownGaps).
//
// status is "partial": scripts/ingest/lims-minneapolis.mjs requires
// LIMS_API_KEY (a free, registered key — AGENTS.md §3.2 keyed-API
// pattern) and exits cleanly, writing the honest empty state, whenever
// that key is absent — but a real key has now been provisioned and the
// live feed is wired.
export const MINNEAPOLIS_MEETINGS_VOTES_LAYER: LayerRegistryEntry = {
  id: "minneapolis-meetings-votes",
  label: "Minneapolis Council Meetings & Votes",
  description:
    "Meetings and agenda items for Minneapolis City Council and its committees/boards, sourced from the city's LIMS API — a rolling 14-days-back/90-days-ahead window, same as St. Paul and Hennepin County's Legistar feeds.",
  ingestScript: "scripts/ingest/lims-minneapolis.mjs",
  publicDataPath: "/lims/minneapolis-meetings.json",
  status: "partial",
  coverage:
    "Minneapolis City Council, its committees/subcommittees, and boards/commissions LIMS's meetingCalendar returns. No meeting data for St. Paul, any suburb, any county board, or the state legislature (those are separate layers). Per-councilmember roll-call votes ARE resolved into WardModal.tsx's recentVotes (scripts/lib/limsRecentVotes.mjs, surname-matched — same convention St. Paul/Hennepin's own recentVotes use), but not yet into this site's canonical models.ts Holding/Vote shape; that fuller resolution is the outstanding gap versus the Legistar-sourced layers. No consent-agenda flagging — LIMS has no field equivalent to Legistar's EventItemConsent.",
  primarySourceUrl: "https://lims.minneapolismn.gov/",
  sourceAgency: "City of Minneapolis, Office of the City Clerk",
  knownGaps: [
    "Per-councilmember votes reach WardModal.tsx's recentVotes (surname-matched, scripts/lib/limsRecentVotes.mjs) but aren't resolved into this site's canonical Holding/Vote model (models.ts) yet — see scripts/ingest/lims-minneapolis.mjs's file header.",
    "No consent-agenda flagging — every agenda item ships isConsent: false rather than a guess (LIMS has no field structurally equivalent to Legistar's EventItemConsent).",
  ],
};

// FEATURES.md Phase 8 — MN Campaign Finance Board bulk data (candidate
// committee receipts). AGENTS.md §1b: individual natural-person donors
// are filtered out at ingest (scripts/ingest/mn-campaign-finance.mjs) and
// never appear in this layer's output at any resolution; only per-cycle
// aggregates and named-entity (PAC/party unit/lobbyist principal/
// corporate/candidate-committee) contributions are published.
//
// publicDataPath points at the small upfront index; per-candidate detail
// files live under /campaign-finance/candidates/<id>.json and are fetched
// lazily by whatever UI opens a candidate's record, per AGENTS.md §0.7 —
// this is the layer's chunked-output entry point, not its whole dataset.
export const CAMPAIGN_FINANCE_LAYER: LayerRegistryEntry = {
  id: "campaign-finance",
  label: "Campaign Finance Receipts",
  description:
    "Candidate committee campaign contributions from the Minnesota Campaign Finance Board's bulk data. Individual small-donor names are never published — only per-cycle totals, contribution-size-band counts, and named PAC/party-unit/lobbyist-principal/corporate/candidate-committee contributions, per AGENTS.md §1b.",
  ingestScript: "scripts/ingest/mn-campaign-finance.mjs",
  publicDataPath: "/campaign-finance/index.json",
  status: "partial",
  coverage:
    "State-level candidate committees only, itemized contributions over the MN CFB's $200-per-cycle threshold — every registered state candidate committee statewide, not a single-official lookup. No party-unit or PAC recipient filings yet (same schema, not yet ingested). No local (city/county) filings — those are largely PDF-only. No federal (OpenFEC) receipts. No individual small-donor names, ever, by design.",
  primarySourceUrl: "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/",
  sourceAgency: "Minnesota Campaign Finance and Public Disclosure Board",
  knownGaps: [
    "Local (city/county) candidate filings are largely PDF-only and are not covered by this importer yet — FEATURES.md Phase 8.",
    "Federal receipts (OpenFEC) are not merged into this layer — see AGENTS.md §3.2's 'Campaign finance (federal)' row (OpenFEC is the source evaluated specifically for this gap; the table's Congress.gov and Bioguide rows are for legislative activity and bio/term data respectively, not receipts).",
    "Only the 'Candidates' recipient-type bulk file is ingested — Party unit and PAC recipient files are not yet included.",
    "'Self' (candidate self-funding) and 'Other' Contrib-type rows are counted in aggregates but never surfaced as named records — a deliberate fail-closed default pending a human policy call.",
    "Statements of Economic Interest (stock holdings, outside income, real property, and government-agency interests) are a separate MN CFB dataset and now have their own registry entry — see ECONOMIC_INTEREST_LAYER below — rather than being folded into this one.",
    "cfb.mn.gov/robots.txt contains two contradictory back-to-back `User-agent: *` blocks (first a blanket `Disallow: /`) — unresolved with CFB as of 2026-08-09; a question is drafted for CFB outreach (held outside this repo, not yet sent) asking which block governs automated access, per AGENTS.md §2.2's 'respect robots.txt' rule.",
  ],
};

// Statewide city-limits backdrop — every incorporated Minnesota city's
// corporate boundary, sourced from MnDOT/MnGeo's weekly-published CTU
// dataset. Purely boundary geometry, not an officeholder record: no
// per-feature verifiedAt/verifiedAgainst (AGENTS.md §3.2's staleness rule
// is scoped to officeholder-joined records) and no roster data of its own
// — WardMap.tsx renders it as a low-opacity fill underneath every other
// tier so a resident outside this app's covered cities still sees their
// city's own outline instead of nothing. See AGENTS.md §0.1 and §3.3.
export const CITY_BOUNDARIES_LAYER: LayerRegistryEntry = {
  id: "city-boundaries",
  label: "City Limits (statewide)",
  description:
    "Corporate boundary of every incorporated Minnesota city, statewide — a plain outline backdrop, not a roster. Rendered under every other tier so a city with no ward/council data mapped here still shows on the map.",
  ingestScript: "scripts/fetch-city-boundaries.mjs",
  publicDataPath: "/city-boundaries.geojson",
  status: "live",
  coverage:
    "Every incorporated Minnesota city's corporate boundary, statewide. Boundary only — no roster, vote, or contact data of its own. Only the cities in src/lib/cities.ts's CITIES have ward/mayor data layered on top of this backdrop.",
  primarySourceUrl: "https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg",
  sourceAgency: "Minnesota Department of Transportation / MnGeo",
  knownGaps: [
    "Townships and unorganized territory are intentionally excluded (CTU_CLASS='CITY' filter only) — this layer is incorporated cities only.",
    "This dataset spells city names out in full (e.g. \"Saint Paul\", \"Saint Louis Park\") rather than src/lib/cities.ts's abbreviated forms (\"St. Paul\", \"St. Louis Park\"). This is now resolved for the county/city filter crosswalk (scripts/build-county-cities.mjs normalizes both sides before joining — see src/lib/countyCities.generated.ts), but the map layers themselves still render a covered city's ward data and its city-boundaries backdrop as two separate, visually undistinguished layers rather than one merged feature.",
  ],
};

// Bio-page enrichment for the MN House + Senate roster that
// scripts/fetch-state-legislature.mjs already writes to
// public/state-legislature.geojson — leadership title, Capitol office
// room, legislative assistant contact, committee chair/co-chair role
// (not just membership), term number, elected-years, and district
// map/demographics links. None of this is exposed by Open States (the
// roster layer's own source); it only exists on senate.mn and
// house.mn.gov's own member pages, hence a second, unkeyed ingest script
// against those two sites rather than a field the roster fetch itself
// could add. Needs no API key at all — unlike the roster layer above it,
// this one's own refresh workflow carries no secret requirement.
//
// publicDataPath points at the same file the roster layer writes
// (public/state-legislature.geojson) rather than a second file: this is
// an enrichment pass over that layer's own output, not an independent
// dataset with its own join to perform at render time. See
// scripts/fetch-state-legislature-bio.mjs's own header for why that's a
// deliberate choice over a separate joined file.
export const STATE_LEGISLATURE_BIO_LAYER: LayerRegistryEntry = {
  id: "state-legislature-bio",
  label: "MN Legislature Bio Details",
  description:
    "Leadership titles, Capitol office rooms, legislative assistant contacts, committee chair/co-chair roles, term counts, and district map/demographics links for MN House and Senate members — sourced from senate.mn and house.mn.gov directly, since Open States (the roster layer's own source) doesn't carry any of these fields.",
  ingestScript: "scripts/fetch-state-legislature-bio.mjs",
  publicDataPath: "/state-legislature.geojson",
  status: "live",
  coverage:
    "Every currently-seated MN House and Senate member with a resolvable senate.mn/house.mn bio page. A vacant seat, or a member this scraper's district crosswalk can't match, is skipped rather than guessed at — see the script's own enriched/skipped counts in its run log.",
  primarySourceUrl: "https://www.senate.mn/members ; https://www.house.mn.gov/members/list",
  sourceAgency: "Minnesota Senate; Minnesota House of Representatives",
  knownGaps: [
    "No stable per-legislator crosswalk file is checked in — mem_id (Senate) and legid (House) are re-derived from each site's own bulk member list every run, joined by district string against the roster this layer enriches. A mismatched or renumbered district would show up as a skipped record, not a silently wrong join.",
    "Regex-based HTML parsing against two government sites' own markup, not a documented API — a template change on either site can silently stop matching a field until the next maintainer notices the enriched/skipped counts change.",
    "electedYears is kept as each source's own free-text sequence, not parsed into a structured year list.",
  ],
};

// MN Campaign Finance Board Statements of Economic Interest — stock
// holdings, outside income, real property, and government-agency interests
// per official. A separate CFB dataset from CAMPAIGN_FINANCE_LAYER's
// contributions (different pages, different form). status is "empty":
// scripts/ingest/mn-economic-interest.mjs's fetch/parse logic is real and
// verified live against three officials' pages (2026-08-09), but no public
// bulk/name-search endpoint for the full official roster has been found —
// see the script's own header comment for what was checked. Populating
// KNOWN_OFFICIAL_IDS by hand is the documented manual workflow (AGENTS.md
// §2.2) until that's solved; no id is ever guessed.
//
// A multi-dimension live-verified review (2026-08-09) found this shipped
// with two confirmed privacy bugs — a street-address redaction regex that
// missed Minneapolis/St. Paul's own numbered-street convention, and
// unredacted family-member names in income-source/agency-interest rows.
// Neither had reached public/ (the allowlist was still empty when found),
// but both are fixed in the ingest script, with a runtime backstop
// assertion added so a future regression is refused at ingest rather than
// discovered live again. See the script's own header comment for detail.
export const ECONOMIC_INTEREST_LAYER: LayerRegistryEntry = {
  id: "economic-interest",
  label: "Officials' Economic Interest",
  description:
    "Stock/securities holdings, outside income sources, real property, and government-agency interests as self-disclosed by officials on Statements of Economic Interest filed with the Minnesota Campaign Finance Board.",
  ingestScript: "scripts/ingest/mn-economic-interest.mjs",
  publicDataPath: "/economic-interest/index.json",
  status: "empty",
  coverage:
    "Nothing yet, structurally: only officials whose CFB id has been manually verified and added to the ingest script's allowlist are covered — this is not 'all officials' and does not scale on its own. No bulk/name-search endpoint for the CFB's official roster has been found (see the ingest script's header for what was checked). No dollar valuation of holdings is ever published — the source form itself doesn't require one.",
  primarySourceUrl: "https://cfb.mn.gov/reports-and-data/officials-financial-disclosure/official/",
  sourceAgency: "Minnesota Campaign Finance and Public Disclosure Board",
  knownGaps: [
    "No public bulk or name-search endpoint has been found for the CFB's official roster — ingestion is manual-allowlist-only until this is solved. See scripts/ingest/mn-economic-interest.mjs's header comment.",
    "The 'Securities' section's positive case is confirmed (official 14898 holds one security, \"OAANX\") — every documented field's parsing is now verified against a real populated example.",
    "Dollar values for securities holdings are never published: the SEI form doesn't require the official to disclose one.",
    "Real property street addresses are redacted at ingest pending a maintainer policy call on the §1a/§1b tension (see redactIfStreetAddress() in the ingest script) — research (2026-08-09) found the Board's own policy carves out SEI real-property addresses specifically as potentially public unless the filer designated them private (Minn. Stat. § 10A.09, subd. 5(b)/5b(d)), which isn't yet reconciled with this script's blanket redaction.",
    "Income sources and government agency interests are redacted for explicit family-relationship markers ('(spouse)', etc.) but not for a private individual's bare name with no marker — see the ingest script's knownGaps. Human review is required before adding any official whose disclosures might name a private individual this way.",
    "cfb.mn.gov/robots.txt contains two contradictory back-to-back `User-agent: *` blocks (first a blanket `Disallow: /`) — unresolved with CFB as of 2026-08-09; a question is drafted for CFB outreach (held outside this repo, not yet sent) asking which block governs automated access, per AGENTS.md §2.2's 'respect robots.txt' rule.",
  ],
};

// Statewide township/unorganized-territory backdrop — the CTU_CLASS
// complement of CITY_BOUNDARIES_LAYER above, from the same MnDOT/MnGeo
// FeatureServer and dataset (scripts/fetch-township-unorg-boundaries.mjs
// is a sibling script to fetch-city-boundaries.mjs). Exists specifically
// so the civic-participation-turnout choropleth (TURNOUT_LAYER below) has
// a real, non-blank class to render for land outside every incorporated
// city — "no city government here, county and state layers apply" is a
// fact about Minnesota's government structure, not a coverage gap to
// paper over with an empty map area.
export const TOWNSHIP_UNORG_BOUNDARIES_LAYER: LayerRegistryEntry = {
  id: "township-unorg-boundaries",
  label: "Townships & Unorganized Territory (statewide)",
  description:
    "Boundary of every Minnesota township and unorganized-territory area, statewide — a plain outline backdrop (like CITY_BOUNDARIES_LAYER, but the complementary CTU_CLASS values) marking land with no city government, not a roster.",
  ingestScript: "scripts/fetch-township-unorg-boundaries.mjs",
  publicDataPath: "/township-unorg-boundaries.geojson",
  status: "live",
  coverage:
    "Every Minnesota township and unorganized-territory area's corporate/legal boundary, statewide (1,837 features at time of writing: 1,775 townships + 62 unorganized-territory areas). Boundary only — no township board roster, meeting, or contact data of any kind; townships have no ward/council layer on this site at all.",
  primarySourceUrl: "https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg",
  sourceAgency: "Minnesota Department of Transportation / MnGeo",
  knownGaps: [
    "No township board officeholder data of any kind — this is boundary geometry only, same posture as CITY_BOUNDARIES_LAYER.",
    "A small number of upstream CTU_CLASS rows are null (an upstream data-quality artifact, not a third governance category) and are deliberately excluded from this layer rather than guessed at — see the ingest script's own WHERE_CLAUSE comment.",
  ],
};

// City-level general-election turnout choropleth — WardMap.tsx's
// "participation" LayerMode. Sourced from scripts/ingest/turnout.mjs
// (public/turnout/city/<year>.json, public/turnout/manifest.json); this
// registry entry is the map/legend/coverage-notice wiring per §2.1, not a
// second copy of that ingest script's own provenance (see
// public/turnout/city/2024.json's own `provenance` field for the SOS/CVAP
// source records each city's figures trace to).
//
// AGENTS.md §1c applies directly here: this layer shows a fact (ballots
// cast over a denominator, per city, per year) and nothing else — no
// ranked "highest/lowest turnout" list, no computed score, no causal
// claim about why a city's turnout is what it is. See
// src/lib/turnoutColors.ts's own header for why the choropleth's color
// ramp is deliberately never red/blue.
export const TURNOUT_LAYER: LayerRegistryEntry = {
  id: "turnout",
  label: "Election Turnout by City",
  description:
    "Ballots cast as a share of registered voters (and, where resolvable, citizen voting-age population) per Minnesota city, per general election. City-level only; joined at render time against city-boundaries.geojson via src/lib/turnoutJoin.ts.",
  ingestScript: "scripts/ingest/turnout.mjs",
  publicDataPath: "/turnout/manifest.json",
  status: "partial",
  coverage:
    "853-855 of Minnesota's statutory cities (the count varies slightly by year) have a turnout record for each of seven general elections: 2012, 2014, 2016, 2018, 2020, 2022, and 2024, selectable via the map's own year slider. County-level aggregation is not built yet, and no special or primary election is covered — general elections only. Townships and unorganized territory have no turnout record to join against at all (they have no city government — see TOWNSHIP_UNORG_BOUNDARIES_LAYER above, rendered as its own distinct map class rather than left blank). turnoutOfCVAP is null for at least one city per year (documented per year in that year's own knownGaps) where the join to Census CVAP data failed to resolve.",
  primarySourceUrl: "https://www.sos.state.mn.us/",
  sourceAgency: "Office of the Minnesota Secretary of State; US Census Bureau (CVAP)",
  knownGaps: [
    "County-level aggregation is not built yet — city-level only.",
    "Only general elections are covered (2012, 2014, 2016, 2018, 2020, 2022, 2024) — primaries and special elections are a follow-up.",
    "turnoutOfCVAP denominator (Census CVAP, a 5-year modeled estimate with its own margin of error) is not interchangeable with turnoutOfRegistered's denominator — see src/lib/turnoutConfig.mjs's TURNOUT_OF_REGISTERED_DENOMINATOR for why, and cvapMarginOfError per city for the estimate's own uncertainty.",
    "Cities with fewer than 200 registered voters (turnoutConfig.mjs's MIN_REGISTERED_THRESHOLD) render their percentage as belowThreshold — 'too small to shade reliably' on the map — rather than a falsely precise figure; the underlying raw counts are still published in full.",
    "The city-boundaries <-> turnout join (src/lib/turnoutJoin.ts) can fail to resolve a boundary polygon to a turnout record (a name/county mismatch) — an unresolved polygon renders as a distinct 'no data' class on the map rather than silently guessing which turnout record it belongs to; see that module's own header for the real St. Anthony/Saint Anthony same-name-different-county collision it exists to handle correctly.",
  ],
};

export const LAYER_REGISTRY: readonly LayerRegistryEntry[] = [
  MINNEAPOLIS_MEETINGS_VOTES_LAYER,
  CAMPAIGN_FINANCE_LAYER,
  ECONOMIC_INTEREST_LAYER,
  CITY_BOUNDARIES_LAYER,
  STATE_LEGISLATURE_BIO_LAYER,
  TOWNSHIP_UNORG_BOUNDARIES_LAYER,
  TURNOUT_LAYER,
];
