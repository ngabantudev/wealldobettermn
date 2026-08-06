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

export const LAYER_REGISTRY: readonly LayerRegistryEntry[] = [
  MINNEAPOLIS_MEETINGS_VOTES_LAYER,
  CAMPAIGN_FINANCE_LAYER,
];
