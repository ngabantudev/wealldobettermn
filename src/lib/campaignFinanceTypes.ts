// src/lib/campaignFinanceTypes.ts
//
// Output types for scripts/ingest/mn-campaign-finance.mjs. AGENTS.md §1b
// / §1d: campaign finance data is published as aggregates and named
// entities only. There is deliberately no type here for an individual
// natural-person contribution or donor — not "a type with the name
// hidden," no type *at all* — so a per-person record can't be constructed,
// let alone rendered, without a maintainer adding a whole new interface
// against this file's own stated purpose. That's the "no variant for a
// private individual, by construction" rule from §1d applied to campaign
// finance specifically, the same way RepProperties in types.ts has no
// variant for a non-supervisory employee or a private resident.
//
// The filter that keeps individual donors out of this shape entirely runs
// at ingest time in campaignFinanceConfig.mjs / mn-campaign-finance.mjs —
// by the time a record reaches these types, an individual donor's
// identity has already been discarded, not merely omitted from display.
//
// --- Chunked output (§0.7 budget) -------------------------------------
//
// The importer used to emit a single ~41MB public/campaign-finance.json,
// which blows the "usable on a throttled 3G connection on a five-year-old
// phone" budget in AGENTS.md §0.7/§4. It now emits a small manifest
// (CampaignFinanceIndex) plus one small detail file per candidate
// committee (CampaignFinanceCandidateDetail), following the per-file
// chunking convention public/legistar/*.json already uses for per-client
// data. Provenance moved from being repeated on every one of ~48k
// individual aggregate/named-contribution records to appearing once per
// file (CampaignFinanceProvenance) — same facts, no per-record
// duplication. This is a reshaping of output layout only; it does not
// change which fields are ever populated, and it does not touch the
// donor-privacy filter in campaignFinanceConfig.mjs.

// Provenance record, AGENTS.md §2.2/§3.3. Appears once per emitted file
// (the index and each per-candidate detail file) rather than once per
// record.
export interface CampaignFinanceProvenance {
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  documentId: string | null;
  issuedDate: string | null;
  fetchedAt: string;
  licence: string;
  contentHash: string;
}

export interface ContributionSizeBand {
  label: string;
  min: number;
  max: number;
}

// The sentinel published in place of a real count/amount that fell below
// MIN_AGGREGATE_CELL_SIZE (campaignFinanceConfig.mjs) — AGENTS.md §1d:
// "Aggregates must be checked for re-identification risk before
// publication; suppress cells below a documented threshold." A dedicated
// literal type, not `null` and not `0`, so a consumer of this JSON can
// tell apart three genuinely different facts: a verified zero (nobody
// gave in this band — safe, no re-identification risk, never suppressed),
// a real count/amount at or above the threshold (safe to publish exactly),
// and a real-but-small nonzero pool suppressed for privacy. Collapsing the
// third case into `0` would fabricate a false "nobody gave" (AGENTS.md
// §3.1); collapsing it into `null` would read as "not collected," which is
// also false — the count was collected, it's just not being published.
// This mirrors campaignFinanceConfig.mjs's SUPPRESSED_CELL constant; kept
// as a string literal type here (not re-imported) because this file is
// pure `.ts` with no runtime import from the `.mjs` config module.
export type SuppressedCell = "suppressed";

// Per-committee, per-cycle totals. No donor names anywhere in this shape —
// "aggregate" means aggregate, not "a list with names redacted."
export interface ContributionAggregate {
  schemaVersion: 1;
  // The committee the money went *to* — never a donor. e.g. "Friends of
  // Jane Doe" or an OCD-style committee id, once one exists upstream.
  recipientCommittee: string;
  cycle: string; // e.g. "2024"
  // Suppressed (not published as an exact figure) whenever the count of
  // underlying natural-person contributions behind it is itself below
  // MIN_AGGREGATE_CELL_SIZE — see suppressTotalReceipts() in
  // campaignFinanceConfig.mjs. Without this, a fully-suppressed set of
  // band counts below could still be defeated by subtracting every
  // published named-entity contribution's amount from this total and
  // recovering the exact sum given by a handful of individuals.
  totalReceiptsUsd: number | SuppressedCell;
  // Count of natural-person contributions per size band — see
  // CONTRIBUTION_SIZE_BANDS in campaignFinanceConfig.mjs. This is the
  // *entire* representation of small individual donors on this site: a
  // count, in a band, with no name attached, ever. `count` is suppressed
  // (see SuppressedCell above) whenever it is nonzero but below
  // MIN_AGGREGATE_CELL_SIZE; a verified 0 is always published as 0.
  contributionCountsByBand: { band: ContributionSizeBand; count: number | SuppressedCell }[];
}

export type NamedEntityDonorType =
  | "pac"
  | "party_unit"
  | "lobbyist_principal"
  | "corporate_entity"
  | "corporate_officer"
  | "candidate_committee";

// A named contribution record. The `donorType` union above is the
// allowlist itself (mirrors NAMED_ENTITY_DONOR_TYPES in
// campaignFinanceConfig.mjs) — there is no "individual" member, so this
// interface cannot represent a private person's contribution even if a
// caller wanted it to.
export interface NamedEntityContribution {
  schemaVersion: 1;
  donorName: string;
  donorType: NamedEntityDonorType;
  recipientCommittee: string;
  cycle: string;
  amountUsd: number;
  date: string; // ISO
}

// One entry in the index's candidate list — cheap to load upfront
// (AGENTS.md §0.7 "progressive precision"/§4 budget). Just enough to
// render a candidate list/search and decide whether to fetch the detail
// file.
export interface CampaignFinanceCandidateSummary {
  // Deterministic slug of recipientCommittee, stable across re-runs given
  // the same input roster (AGENTS.md §2.2) — see scripts/lib/slugify.mjs,
  // called from the ingest script.
  id: string;
  recipientCommittee: string;
  cycles: string[];
  // Suppressed whenever any one of this candidate's per-cycle
  // ContributionAggregate.totalReceiptsUsd values was itself suppressed —
  // see the ingest script's buildTotalReceiptsAllCycles(). Summing the
  // *known* cycle totals and silently treating a suppressed cycle as 0
  // would both understate the true figure and, worse, let a reader back
  // out a bound on the suppressed cycle's amount from the published
  // all-cycles total minus the known cycles — the same subtraction attack
  // suppressTotalReceipts() in campaignFinanceConfig.mjs exists to close
  // at the single-cycle level. Suppressing the roll-up too is the
  // conservative propagation of that same rule one level up.
  totalReceiptsUsdAllCycles: number | SuppressedCell;
  // Path under public/ this candidate's detail file is served from,
  // relative to the site root — fetched lazily only when a user opens
  // this candidate's record, per AGENTS.md §0.7/§2.5's "nobody downloads
  // the whole state to find one record" principle.
  dataPath: string;
}

// public/campaign-finance/index.json — the one file loaded upfront.
export interface CampaignFinanceIndex {
  schemaVersion: 1;
  generatedAt: string;
  // Mirrors ITEMIZATION_THRESHOLD_USD in campaignFinanceConfig.mjs at the
  // time this file was generated — carried as data (not re-imported as a
  // type) so a downstream consumer of the exported JSON can see which
  // threshold produced these bands without needing the ingest script.
  itemizationThresholdUsd: number;
  itemizationThresholdSourceUrl: string;
  // Mirrors MIN_AGGREGATE_CELL_SIZE in campaignFinanceConfig.mjs at
  // generation time — carried as data for the same reason
  // itemizationThresholdUsd is above: a downstream consumer needs to know
  // what "suppressed" means (a real, nonzero count/amount below this
  // figure) without re-importing the ingest script's config module.
  minAggregateCellSize: number;
  provenance: CampaignFinanceProvenance;
  cycles: string[];
  candidates: CampaignFinanceCandidateSummary[];
  // Per AGENTS.md §3.3 Coverage Honesty — what this run structurally
  // couldn't see (e.g. county-level filings that are PDF-only per
  // FEATURES.md Phase 8).
  knownGaps: string[];
}

// public/campaign-finance/candidates/<id>.json — fetched lazily, one per
// candidate committee, only when a user opens that candidate's record.
export interface CampaignFinanceCandidateDetail {
  schemaVersion: 1;
  id: string;
  recipientCommittee: string;
  provenance: CampaignFinanceProvenance;
  aggregates: ContributionAggregate[];
  namedEntityContributions: NamedEntityContribution[];
}
