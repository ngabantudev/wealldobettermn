// src/lib/electionConfig.ts
//
// The invalidation-event config AGENTS.md §3.2 asks for: "Build fails,
// loudly, if any record's verifiedAt predates the most recent general
// election date recorded in config. Elections are the known invalidation
// event; encode them rather than remembering them." One constant per
// level this repo tracks a roster for, so a state legislature record
// isn't invalidated by a city election and vice versa.
//
// Update these dates by hand after each general election — there is no
// API this repo trusts enough to auto-derive an election date from (see
// AGENTS.md §0.8, "any upstream API is assumed to die"). The MN
// Secretary of State's own results archive is this constant's citation.

/**
 * Most recent Minnesota STATE general election (even-year, all MN House
 * seats + half the Senate on the ballot). Source:
 * https://www.sos.state.mn.us/elections-voting/election-results/
 *
 * Next general election for the state legislature is expected Nov 2026 —
 * update this constant the day after that election certifies, not before
 * (results aren't final on election night).
 */
export const MN_STATE_GENERAL_ELECTION_DATE = "2024-11-05";

/**
 * A `verifiedAt` older than this many days renders a visible staleness
 * notice in the UI (AGENTS.md §3.2), independent of the harder
 * election-date failure below. Kept short deliberately: a roster is
 * cheap to re-verify and a stale contact record actively misleads a
 * resident who relies on it.
 */
export const STALENESS_THRESHOLD_DAYS = 180;

/**
 * Throws if `verifiedAt` predates the most recent general election for
 * the given level — the hard, build-failing check AGENTS.md §3.2
 * requires, not just the soft staleness notice above. Callers are
 * expected to run this over every officeholder-sourced record they emit
 * and let it propagate: a fatal build failure here is the intended
 * behavior, not a bug to catch.
 */
export function assertVerifiedSinceLastGeneralElection(
  verifiedAt: string,
  generalElectionDate: string,
  context: string,
): void {
  if (verifiedAt < generalElectionDate) {
    throw new Error(
      `[stale-verification] ${context}: verifiedAt (${verifiedAt}) predates the most recent ` +
        `general election (${generalElectionDate}). Re-verify against a current source before ` +
        `shipping this record — see AGENTS.md §3.2 and src/lib/electionConfig.ts.`,
    );
  }
}

/** Whether a `verifiedAt` date is old enough to need a staleness notice. */
export function isStale(verifiedAt: string, asOf: Date = new Date()): boolean {
  const verifiedMs = Date.parse(verifiedAt);
  if (Number.isNaN(verifiedMs)) return true; // unparseable is never "fresh"
  const ageDays = (asOf.getTime() - verifiedMs) / (1000 * 60 * 60 * 24);
  return ageDays > STALENESS_THRESHOLD_DAYS;
}
