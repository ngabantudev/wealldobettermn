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

// AGENTS.md §1d: "Aggregates must be checked for re-identification risk
// before publication; suppress cells below a documented threshold." This
// constant is that documented threshold.
//
// IMPORTANT — unlike ITEMIZATION_THRESHOLD_USD above, this is NOT a legal
// figure and there is no statute to cite for it. It is a privacy-
// engineering judgment call: a published aggregate cell (a contribution-
// size-band count, or a cycle total standing in for one) that resolves to
// a handful of people is a de facto named record for anyone who already
// knows, or can plausibly guess, who gave to a small-race committee — a
// school-board or city-council candidate with a handful of itemized
// contributions in some band. A count of "1" or "2" in a band is not an
// aggregate in any meaningful privacy sense; it is a lookup table with the
// name filed off. Suppressing cells below a floor is standard statistical-
// disclosure-control practice for exactly this reason (peer civic-data and
// public-health reporting projects commonly use small floors in the same
// single-digit range for the same reason) — that convention is cited here
// only as corroborating context for the shape of the number, not as the
// justification itself. The justification is the re-identification risk on
// *this* dataset, reasoned through above.
//
// 5 was chosen because it is large enough that no single contribution can
// be isolated by elimination (even if a reader knows of one or two donors
// to a race, a band of 5 still has three or more unaccounted-for), while
// staying small enough not to blank out real signal on the small-committee
// races this site exists to cover. There is no formula that derives this
// number; a future maintainer is free to raise it (never lower it) if a
// concrete re-identification case shows 5 isn't enough headroom — see
// LESSONS.md for how to record that if it happens.
export const MIN_AGGREGATE_CELL_SIZE = 5;

// The sentinel published in place of an exact count/amount that falls
// below MIN_AGGREGATE_CELL_SIZE. A string, not `null` or `0`: `null` reads
// as "no data collected" and `0` reads as "verified zero, nobody gave in
// this band" — both are false statements that AGENTS.md §3.1 forbids
// ("no placeholder data ships as fact... never floor it to 0, which
// fabricates a false 'nobody gave'"). "suppressed" is an honest, distinct,
// third state a consumer can render as its own explicit case rather than
// silently coercing to falsy.
export const SUPPRESSED_CELL = "suppressed";

/**
 * Applies the cell-suppression rule to a single aggregate count (a band
 * count, or a total-receipts figure standing in for a small pool of
 * underlying contributors — see suppressTotalReceipts below). A count of
 * exactly 0 carries no re-identification risk (there is no one to
 * re-identify) and is never suppressed, per AGENTS.md §1d/§3.1. A count at
 * or above the threshold is large enough to publish as-is. Only the open
 * interval (0, MIN_AGGREGATE_CELL_SIZE) — a real, small, nonzero pool of
 * people — is suppressed.
 * @param {number} count
 * @returns {number | typeof SUPPRESSED_CELL}
 */
export function suppressSmallCount(count) {
  if (count > 0 && count < MIN_AGGREGATE_CELL_SIZE) return SUPPRESSED_CELL;
  return count;
}

/**
 * The total-receipts half of the same re-identification check. A
 * per-band count of "suppressed" everywhere doesn't, by itself, protect a
 * committee's `totalReceiptsUsd`: if only a handful of natural-person
 * (individual) contributions make up that committee/cycle's activity at
 * all, the *total* — published in full regardless of banding, and
 * additive with every named-entity contribution which IS published by
 * name and exact amount — lets a reader subtract the known named-entity
 * amounts from the total and recover the exact combined amount given by
 * that handful of individuals. With only 1–4 people behind that residual
 * figure, the total is exactly as re-identifying as an unsuppressed band
 * count would have been, just laundered through arithmetic instead of a
 * band label.
 *
 * `individualContributionCount` must be the count of natural-person
 * (non-named-entity) contribution rows folded into this total — the same
 * population the per-band counts are drawn from, not the row count for
 * named-entity contributions (those are separately, individually, already
 * public by name and amount, so they add no incremental risk to the
 * total).
 * @param {number} totalReceiptsUsd
 * @param {number} individualContributionCount
 * @returns {number | typeof SUPPRESSED_CELL}
 */
export function suppressTotalReceipts(totalReceiptsUsd, individualContributionCount) {
  if (individualContributionCount > 0 && individualContributionCount < MIN_AGGREGATE_CELL_SIZE) {
    return SUPPRESSED_CELL;
  }
  return totalReceiptsUsd;
}

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
