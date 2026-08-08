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
  // "empty": public data file exists with zero records, ingest not yet
  //   run against a live key/credential.
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

// FEATURES.md Phase 3 — Minneapolis (LIMS API). Meeting attendance and
// full voting record for the 13 Minneapolis councilmembers + mayor, back
// to 2014, sourced from lims.minneapolismn.gov's LIMS API v1.
//
// status is "empty": scripts/ingest/lims-minneapolis.mjs requires
// LIMS_API_KEY (a free, registered key — AGENTS.md §3.2 keyed-API
// pattern) and exits cleanly, writing the honest empty state below,
// whenever that key is absent. No councilmember, meeting, or vote record
// ships until a real key is provisioned and the script is run against it.
export const MINNEAPOLIS_MEETINGS_VOTES_LAYER: LayerRegistryEntry = {
  id: "minneapolis-meetings-votes",
  label: "Minneapolis Council Meetings & Votes",
  description:
    "Meeting attendance and full voting record for Minneapolis's 13 councilmembers and the mayor, sourced from the city's LIMS API. Records begin in 2014 — the LIMS API's own history does not extend earlier.",
  ingestScript: "scripts/ingest/lims-minneapolis.mjs",
  publicDataPath: "/minneapolis-meetings.json",
  status: "empty",
  coverage:
    "Minneapolis City Council and mayor only. No meeting or voting data for St. Paul, any suburb, any county board, or the state legislature. Nothing before 2014.",
  primarySourceUrl: "https://lims.minneapolismn.gov/",
  sourceAgency: "City of Minneapolis, Office of the City Clerk",
  knownGaps: [
    "No LIMS_API_KEY has been provisioned yet — public/minneapolis-meetings.json is a deliberate empty state (AGENTS.md §3.1), not fabricated data.",
    "Data starts in 2014 per the LIMS API's own history; nothing earlier will ever be available from this source.",
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
    "State-level candidate committees only, itemized contributions over the MN CFB's $200-per-cycle threshold. No party-unit or PAC recipient filings yet (same schema, not yet ingested). No local (city/county) filings — those are largely PDF-only. No federal (OpenFEC) receipts. No individual small-donor names, ever, by design.",
  primarySourceUrl: "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/",
  sourceAgency: "Minnesota Campaign Finance and Public Disclosure Board",
  knownGaps: [
    "Local (city/county) candidate filings are largely PDF-only and are not covered by this importer yet — FEATURES.md Phase 8.",
    "Federal receipts (OpenFEC) are not merged into this layer.",
    "Only the 'Candidates' recipient-type bulk file is ingested — Party unit and PAC recipient files are not yet included.",
    "'Self' (candidate self-funding) and 'Other' Contrib-type rows are counted in aggregates but never surfaced as named records — a deliberate fail-closed default pending a human policy call.",
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
    "This dataset spells city names out in full (e.g. \"Saint Paul\", \"Saint Louis Park\") — it is not cross-referenced against src/lib/cities.ts's abbreviated forms (\"St. Paul\", \"St. Louis Park\"), so a covered city's ward data and its city-boundaries backdrop are not visually distinguished from an uncovered city's outline.",
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

export const LAYER_REGISTRY: readonly LayerRegistryEntry[] = [
  MINNEAPOLIS_MEETINGS_VOTES_LAYER,
  CAMPAIGN_FINANCE_LAYER,
  CITY_BOUNDARIES_LAYER,
  STATE_LEGISLATURE_BIO_LAYER,
];
