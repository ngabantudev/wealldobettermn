// src/lib/campaignFinanceConfig.mjs
//
// The one place the MN campaign-finance donor-privacy threshold lives.
// Plain ESM (not .ts) so the exact same constants run in two contexts
// that can't share a TypeScript build step — scripts/ingest/mn-campaign-
// finance.mjs (plain `node`, no ts-node) at ingest time, and any TS code
// that needs to reason about the same figure at type-check/render time
// (via tsconfig's `allowJs: true`), the same split-file pattern
// streetNormalize.mjs uses for the address matcher. One file, imported
// both ways, is what keeps the ingest-time filter and anything downstream
// that displays or explains it from ever drifting apart.
//
// AGENTS.md §1b: "Individual natural-person donors below the itemization
// threshold that matters — a documented figure recorded in config — are
// never enumerated, never mapped, never made searchable by name."
//
// IMPORTANT — this threshold is a legal fact, not a design choice: verify
// it against the current statute text (link below) before pointing the
// ingest script at real MN Campaign Finance Board data. It is recorded
// here, once, specifically so nobody has to remember it or re-derive it
// from a filing form.
//
// Source (Tier 2, state regulation): Minn. Stat. § 10A.20, subd. 3(g) —
// a candidate or committee's report must itemize (name, address, and
// employer/occupation) each contributor whose contributions from a single
// source exceed this amount within the reporting period.
export const ITEMIZATION_THRESHOLD_USD = 200;
export const ITEMIZATION_THRESHOLD_SOURCE_URL = "https://www.revisor.mn.gov/statutes/cite/10A.20";
export const ITEMIZATION_THRESHOLD_VERIFIED_AT = null; // set to an ISO date once a human has re-checked the statute against this constant

// Contribution-size bands the aggregate output (never a per-donor record)
// is bucketed into. Deliberately coarse, and the top band stops exactly at
// the itemization threshold rather than crossing it — a band boundary is
// never a route to inferring one small donor's exact amount. Any
// contribution at or above the threshold is a "large" contribution and, if
// from a natural person, still never becomes a named per-person record
// (see NAMED_ENTITY_DONOR_TYPES below) — it only ever affects the cycle
// total and the largest band's count.
export const CONTRIBUTION_SIZE_BANDS = [
  { label: `$1–$50`, min: 1, max: 50 },
  { label: `$51–$100`, min: 51, max: 100 },
  { label: `$101–$${ITEMIZATION_THRESHOLD_USD}`, min: 101, max: ITEMIZATION_THRESHOLD_USD },
];

// Donor types AGENTS.md §1a/§1d permit as a *named* record. This is the
// entire allowlist — anything not in this set (which, per the upstream MN
// CFB schema, is effectively just "individual") is a private natural
// person and never gets a named per-record output, regardless of amount.
// This mirrors §1d's discriminated-union rule at the ingest boundary: the
// TS types in campaignFinanceTypes.ts don't even have a variant for an
// individual donor, so this set is the runtime half of the same rule.
export const NAMED_ENTITY_DONOR_TYPES = new Set([
  "pac",
  "party_unit",
  "lobbyist_principal",
  "corporate_entity",
  "corporate_officer",
  "candidate_committee",
]);

/**
 * Which size band a contribution amount falls into, for aggregate counts
 * only. Returns null for amounts outside every configured band (e.g. 0 or
 * negative — a malformed upstream record, not a band to file it under).
 * @param {number} amountUsd
 */
export function bandForAmount(amountUsd) {
  return CONTRIBUTION_SIZE_BANDS.find((band) => amountUsd >= band.min && amountUsd <= band.max) ?? null;
}

/**
 * The structural donor-privacy filter itself. True only for contributions
 * that AGENTS.md permits to become a *named* record. Never true for a
 * natural-person donor, at any amount — individual donors are represented
 * only through the aggregate counts/totals this config's bands and the
 * ingest script's cycle totals produce, never as a named row.
 * @param {{ donorType?: string }} contribution
 */
export function isNamedEntityDonor(contribution) {
  return Boolean(contribution && NAMED_ENTITY_DONOR_TYPES.has(contribution.donorType));
}
