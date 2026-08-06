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

export interface ContributionSizeBand {
  label: string;
  min: number;
  max: number;
}

// Per-committee, per-cycle totals. No donor names anywhere in this shape —
// "aggregate" means aggregate, not "a list with names redacted."
export interface ContributionAggregate {
  schemaVersion: 1;
  // The committee the money went *to* — never a donor. e.g. "Friends of
  // Jane Doe" or an OCD-style committee id, once one exists upstream.
  recipientCommittee: string;
  cycle: string; // e.g. "2024"
  totalReceiptsUsd: number;
  // Count of natural-person contributions per size band — see
  // CONTRIBUTION_SIZE_BANDS in campaignFinanceConfig.mjs. This is the
  // *entire* representation of small individual donors on this site: a
  // count, in a band, with no name attached, ever.
  contributionCountsByBand: { band: ContributionSizeBand; count: number }[];
  // Provenance, per AGENTS.md §2.2.
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  documentId: string | null;
  issuedDate: string | null;
  fetchedAt: string;
  licence: string;
  contentHash: string;
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
  // Provenance, per AGENTS.md §2.2.
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  documentId: string | null;
  issuedDate: string | null;
  fetchedAt: string;
  licence: string;
  contentHash: string;
}

// The full emitted file shape for a jurisdiction/cycle run of the
// campaign-finance importer.
export interface CampaignFinanceExport {
  schemaVersion: 1;
  generatedAt: string;
  // Mirrors ITEMIZATION_THRESHOLD_USD in campaignFinanceConfig.mjs at the
  // time this file was generated — carried as data (not re-imported as a
  // type) so a downstream consumer of the exported JSON can see which
  // threshold produced these bands without needing the ingest script.
  itemizationThresholdUsd: number;
  itemizationThresholdSourceUrl: string;
  aggregates: ContributionAggregate[];
  namedEntityContributions: NamedEntityContribution[];
  // Per AGENTS.md §3.3 Coverage Honesty — what this run structurally
  // couldn't see (e.g. county-level filings that are PDF-only per
  // FEATURES.md Phase 8).
  knownGaps: string[];
}
