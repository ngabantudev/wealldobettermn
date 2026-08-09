// src/lib/economicInterestTypes.ts
//
// Output types for scripts/ingest/mn-economic-interest.mjs. Answers the
// question 3 case AGENTS.md §1a explicitly names ("does she hold stock,
// what's her outside income") that campaignFinanceTypes.ts does not cover —
// the MN Campaign Finance Board's Statement of Economic Interest (SEI) is a
// separate dataset from campaign contributions, one HTML page per official,
// confirmed live by direct fetch on 2026-08-09.
//
// This file is Tier 1 primary-record data about an official acting in
// their official capacity (§1a), never a private individual — every
// interface below requires officialCfbId + sourceUrl + a recordType that is
// one of the disclosure categories the SEI form itself uses. There is no
// "spouse income" or "family member" field: MN's SEI form asks the official
// to disclose their own interests only, and this schema mirrors that scope
// rather than widening it.

export interface EconomicInterestProvenance {
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string; // "Statement of Economic Interest"
  fetchedAt: string;
  licence: string;
}

// One official's SEI record. Mirrors the fields actually observed on live
// CFB official pages (occupation/employer, income-source relationships,
// real property, securities holdings, government agency interests) — see
// the ingest script's header comment for the two example pages this was
// verified against (Billy Menz id 14965, Wayne Skoe id 12529, 2026-08-09).
export interface EconomicInterestRecord {
  schemaVersion: 1;
  // The CFB's own numeric official id — the join key back to the source
  // page. Not an OCD id: CFB has no notion of one. A future join to this
  // repo's own Holding.id (per AGENTS.md §1d) happens in the officials
  // layer, not here, once a name-matching strategy is confirmed reliable
  // enough to publish (see knownGaps).
  officialCfbId: string;
  officialName: string;
  sourceUrl: string;
  lastUpdated: string | null; // ISO date, as published on the source page
  occupation: string | null;
  employer: string | null;
  // Securities/stock holdings as reported. Deliberately a plain string list
  // of what the form discloses (issuer name, as filed) rather than a
  // structured ticker/valuation field — the SEI form does not ask for a
  // dollar value, and this schema does not infer or estimate one (AGENTS.md
  // §3.3 "never fabricate or infer").
  securitiesHoldings: string[];
  // Real property the official has an interest in, as filed — county and
  // approximate acreage/description only, never street-address-level
  // detail per AGENTS.md §1b "anything at household resolution."
  realProperty: { county: string; description: string }[];
  incomeSources: string[];
  governmentAgencyInterests: string[];
  provenance: EconomicInterestProvenance;
}

export interface EconomicInterestIndex {
  schemaVersion: 1;
  generatedAt: string;
  provenance: EconomicInterestProvenance;
  officials: { officialCfbId: string; officialName: string; dataPath: string }[];
  knownGaps: string[];
}
