// src/lib/turnoutConfig.mjs
//
// The one place the civic-participation-turnout feature's denominator
// methodology and small-city noise threshold live. Plain ESM (not .ts),
// same split-file pattern as src/lib/campaignFinanceConfig.mjs and
// src/lib/streetNormalize.mjs — one file, imported both by
// scripts/ingest/turnout.mjs (plain `node`, no build step) and any future
// TS/UI code that needs to reason about the same figures at render time
// (via tsconfig's `allowJs: true`), so the ingest-time math and whatever
// explains it in copy can never quietly drift apart.
//
// AGENTS.md §3.3: "Coverage Honesty... claiming completeness we cannot
// back is the fastest way to lose the argument." The constants and their
// justifications below exist so a percentage on the page always comes
// with a documented, reviewable definition of what it's a percentage OF.

// --- Denominator methodology for turnoutOfRegistered --------------------
//
// MN Secretary of State precinct data reports two different "registered"
// figures: REG7AM (voters pre-registered as of 7am on election day) and
// EDR (voters who registered when they showed up to vote — Election Day
// Registration, which Minnesota has allowed statewide since 1974). A
// same-day registrant is counted in TOTVOTING (they did cast a ballot) but
// NOT in REG7AM (they weren't registered yet at 7am) — so a denominator of
// REG7AM alone systematically overstates turnout, and in a precinct with
// heavy EDR activity can even push the ratio past 100%, which is not a
// coherent statement about "how many registered voters turned out."
//
// TURNOUT_OF_REGISTERED_DENOMINATOR names the fix: the denominator is
// REG7AM + EDR — everyone who was a registered voter by the time polls
// closed, which is also the population TOTVOTING is actually drawn from.
// This is a documented methodology choice, not a figure with its own
// citation the way ITEMIZATION_THRESHOLD_USD has one in
// campaignFinanceConfig.mjs — record it here once so the ingest script and
// any future UI copy describe the same math.
export const TURNOUT_OF_REGISTERED_DENOMINATOR =
  "registeredAt7am + electionDayRegistrations (everyone registered to vote by the time polls closed, " +
  "which is also the population ballotsCast is drawn from)";

// --- Small-city noise threshold -------------------------------------------
//
// Unlike MIN_AGGREGATE_CELL_SIZE in campaignFinanceConfig.mjs, this is NOT
// a privacy control — turnout percentages carry no re-identification risk.
// It exists because Minnesota has several hundred statutory cities small
// enough that a handful of voters swings the percentage by double digits:
// the smallest 2024 general-election city in the real SOS data had 6 total
// registered voters and 5 ballots cast (83.3%); the next few range from
// 10-24 registered voters. A single additional or missing voter at that
// scale moves the published percentage by 4-15 points — noise, not signal.
//
// The raw counts (ballotsCast, registeredAt7am, electionDayRegistrations)
// are still published in full for every city regardless of size — nothing
// is suppressed, unlike the campaign-finance donor-privacy case. Only the
// derived turnoutOfRegistered/turnoutOfCVAP percentages are flagged
// low-confidence via belowThreshold, so a future UI can render the raw
// numbers plainly while adding a caveat (or omitting a misleadingly
// precise percentage) for the roughly 260 of Minnesota's ~854 statutory
// cities that fall under this line in the real 2024 data.
//
// 200 was chosen as a round number comfortably above where the smallest
// cities cluster (the sub-25-registered-voter tier above) while still
// being small enough that most of Minnesota's genuinely tiny cities (many
// with populations in the dozens to low hundreds) get flagged rather than
// silently presented with a false-precision percentage. There is no
// statistical formula that derives this exact number — a future
// maintainer with a concrete case for a different cut point should update
// this comment alongside the constant, same as MIN_AGGREGATE_CELL_SIZE.
export const MIN_REGISTERED_THRESHOLD = 200;

/**
 * Whether a city's registered-voter base is small enough that its turnout
 * percentages should render as low-confidence rather than a precise
 * figure. Uses the same registered-voter population the turnoutOfRegistered
 * denominator uses (see TURNOUT_OF_REGISTERED_DENOMINATOR above), not just
 * REG7AM alone, so the flag and the percentage it qualifies are always
 * talking about the same population.
 * @param {number} registeredAt7am
 * @param {number} electionDayRegistrations
 * @returns {boolean}
 */
export function isBelowRegisteredThreshold(registeredAt7am, electionDayRegistrations) {
  return registeredAt7am + electionDayRegistrations < MIN_REGISTERED_THRESHOLD;
}
