// Ground truth for the coverage disclosure CoverageNotice.tsx renders —
// the implementation of AGENTS.md §3.3's "the site renders a persistent,
// plain-language 'What this map can't see' section." The point of this
// file existing separately from the component is the same reason
// hearings.ts and addressSearch.ts are split from their components: pure
// data/derivation with no JSX, so the numbers below can't quietly drift
// from what the rest of the app actually resolves.
//
// WARD_CITIES and its derived count come straight from cities.ts's own
// CITIES — never hand-retyped here, so adding a city there (the two-file
// registry-adjacent change this app's ward layer actually requires today)
// automatically updates every count and list this disclosure renders.
// COMMISSIONER_COUNTIES and STATE_LEGISLATURE_NOTE below can't be derived
// the same way: neither scripts/fetch-commissioners.mjs nor
// scripts/fetch-state-legislature.mjs expresses its own geographic scope
// as shared, importable data (there's no registry yet for that — see
// AGENTS.md §2.1's aspirational Registry Pattern). They're hand-authored
// here instead, each commented with exactly which script's own hardcoded
// scope it has to stay in sync with by hand.

import { CITIES, type City } from "./cities";
import { BILLS_COVERAGE_NOTE, BILLS_INGEST_STATUS } from "./billsRegistry";
import { JURISDICTIONS } from "./jurisdictions";
import { MEETINGS_COVERAGE_NOTE } from "./meetingsRegistry";

export const WARD_CITIES: readonly City[] = CITIES;

// Cross-reference only — src/lib/models.ts's CoverageTier (A/B/C, keyed
// per `jurisdiction`, structured) is a distinct concept from this file's
// narrative "what this map can't see" disclosure and is never merged into
// it. Re-exported here purely so a future CoverageNotice.tsx can show
// both without importing jurisdictions.ts directly; nothing else in this
// file reads from or depends on it.
export const JURISDICTION_COVERAGE_TIERS = JURISDICTIONS.map((j) => ({
  id: j.id,
  name: j.name,
  coverage_tier: j.coverage_tier,
}));

// Mirrors scripts/fetch-commissioners.mjs's own county fetch functions —
// that script only ever fetches these seven counties' commissioner
// districts, never Anoka's (Anoka's mapped cities, Blaine and Coon Rapids,
// get city-council data but no county-commissioner layer at all). Update
// this if that script's county list ever changes. Display spelling here
// intentionally differs from cities.ts's COUNTIES key ("St. Louis," not
// the CTU dataset's "Saint Louis") — see that file's own comment on why
// the two spellings diverge.
export const COMMISSIONER_COUNTIES = ["Hennepin", "Ramsey", "Olmsted", "St. Louis", "Stearns", "Sherburne", "Benton"] as const;

// scripts/fetch-state-legislature.mjs used to filter its output down to a
// Twin Cities bounding box (TWIN_CITIES_BOUNDS, removed as part of #61,
// #15's first follow-up); it now emits every MN House and Senate district
// statewide. This note is kept even though the geographic caveat is gone,
// since party-unity scores and recent votes still come from a sample of
// roll calls, not a full archive — some legislators won't have a score
// yet purely because none of their qualifying votes have landed in the
// sample. That sample now accumulates across scheduled runs instead of
// resetting every time (scripts/cache/state-legislature-votes.json, #15's
// second follow-up — see that script's header comment for why a single
// run's sample used to skew almost entirely toward one chamber), so this
// gap should shrink over successive weekly/monthly refreshes rather than
// stay fixed at whatever one run's sample found. WardModal handles the
// gap per-record (partyUnityPercent/recentVotes render nothing when
// absent, rather than a fabricated zero), so this is disclosure, not a
// blocker.
export const STATE_LEGISLATURE_NOTE =
  "MN House & Senate districts statewide. Party-unity scores and recent votes come from an accumulating sample of recent roll calls, so not every legislator has one yet.";

// Mirrors src/lib/layers.ts's CITY_BOUNDARIES_LAYER coverage field — that
// registry entry is the ground truth this note has to stay in sync with by
// hand, same relationship COMMISSIONER_COUNTIES/STATE_LEGISLATURE_NOTE
// above have with their own fetch scripts. WARD_CITIES.length (not a
// hand-typed "17") so this drifts along with cities.ts automatically.
export const CITY_BOUNDARIES_NOTE = `All incorporated Minnesota cities are outlined on the map; only ${WARD_CITIES.length} have ward or council data mapped on top.`;

// Empty-state copy for WardModal's multi-tier (city/county/state) panel —
// what to say when resolveOfficialsAtPoint (src/lib/officials.ts) comes
// back with no hit for a given tier at the point the user hovered, clicked,
// or tapped. Composed from the same ground-truth values above rather than
// separately hand-typed, so this copy can't drift from what the map layers
// actually cover (AGENTS.md §3.3 Coverage Honesty). Human-reviewed strings
// per AGENTS.md §3.4 — this is user-facing copy, drafted with AI assistance.
export const CITY_TIER_EMPTY_NOTE = `This location is outside every city this map has ward data for (${WARD_CITIES.join(", ")}).`;

// join(" and ") + a hardcoded literal " County." suffix worked only while
// COMMISSIONER_COUNTIES had exactly two entries ("Hennepin and Ramsey
// County") — broke grammatically the moment a third county was added
// (2026-08 batch): "Hennepin and Ramsey and Olmsted ... County" reads as
// one endless list with a stray singular "County" tacked on. Oxford-comma
// join + "Counties" (plural) instead, still correct for the two-item case
// (`.slice(0, -1).join(", ")` on a 2-element array is just the first
// element, so this reduces to "Hennepin and Ramsey Counties" — plural,
// the one small wording change from before).
// Exported (not module-private) — CoverageNotice.tsx reuses this exact
// list for its own "County commissioner — ... counties only" line rather
// than joining COMMISSIONER_COUNTIES with its own separate "&"-join, which
// would drift from this wording the next time a county is added.
// Widened to `readonly string[]` for this computation only — COMMISSIONER_
// COUNTIES's own `as const` tuple type narrows `.length` to the literal 7,
// which makes a general "handle the 1-element case too" comparison a
// compile error (comparing literal type 7 to 1) even though the function
// itself is written to stay correct if the tuple's size ever changes.
const commissionerCountiesList: readonly string[] = COMMISSIONER_COUNTIES;
export const COMMISSIONER_COUNTIES_LIST: string =
  commissionerCountiesList.length === 1
    ? commissionerCountiesList[0]
    : `${commissionerCountiesList.slice(0, -1).join(", ")} and ${commissionerCountiesList[commissionerCountiesList.length - 1]}`;
export const COUNTY_TIER_EMPTY_NOTE = `County commissioner districts are only mapped for ${COMMISSIONER_COUNTIES_LIST} Counties.`;

export const STATE_TIER_EMPTY_NOTE = `No state legislative district mapped here. ${STATE_LEGISLATURE_NOTE}`;

// Things this app has no data for on any layer, anywhere in the state —
// listed here (rather than only in AGENTS.md prose) so CoverageNotice.tsx
// can render it instead of a maintainer needing to remember to. The bills
// line is derived from billsRegistry.ts rather than hand-typed, so it
// disappears from this list automatically once BILLS_INGEST_STATUS flips
// to "live" instead of needing someone to remember to edit this array too.
export const NOT_COVERED_ANYWHERE: readonly string[] = [
  "Every Minnesota city and county not listed above",
  "County attorney, sheriff, and school board races",
  "Campaign finance, lobbying, and economic-interest disclosures",
  ...(BILLS_INGEST_STATUS === "live" ? [] : [BILLS_COVERAGE_NOTE]),
];

// Meeting/agenda coverage (issue #58, extended to Minneapolis by #102) —
// separated out from the blanket "Meeting and hearing schedules" line
// NOT_COVERED_ANYWHERE used to carry unconditionally. That line is gone
// now that St. Paul City Council, the Hennepin County Board, and
// Minneapolis City Council each have a real, wired feed (Legistar for the
// first two via scripts/ingest/legistar.mjs, LIMS for Minneapolis via
// scripts/ingest/lims-minneapolis.mjs) — leaving it in place after real
// coverage landed would itself be a coverage-honesty violation in the
// other direction (claiming *less* than the site actually has).
// MEETINGS_COVERAGE_NOTE (meetingsRegistry.ts) is derived from
// MEETINGS_JURISDICTIONS, so this note updates itself as jurisdictions
// get wired rather than needing a hand edit here each time; every other
// mapped jurisdiction remains uncovered — see
// src/lib/meetingsRegistry.ts's UNWIRED_MEETINGS_JURISDICTIONS for the
// itemized list /meetings itself renders.
export const MEETINGS_NOTE = MEETINGS_COVERAGE_NOTE;

// Civic-participation-turnout layer (WardMap.tsx's "participation" mode) —
// mirrors src/lib/layers.ts's TURNOUT_LAYER.coverage/knownGaps, same
// hand-sync relationship COMMISSIONER_COUNTIES/CITY_BOUNDARIES_NOTE above
// have with their own registry entries. Kept as its own exported note
// (not folded into NOT_COVERED_ANYWHERE) since this layer is genuinely
// partial, not entirely absent — a blanket "not covered" line would
// itself be a Coverage Honesty violation once a real feed exists.
export const TURNOUT_NOTE =
  "Election turnout is mapped for 855 Minnesota cities, 2024 general election only — no other year or election type yet, and no county-level aggregation. Cities under 200 registered voters show a raw vote count but no percentage (too small to shade reliably). \"Turnout of CVAP\" is null for at least one city (Empire) where the join to Census citizen-voting-age-population data didn't resolve. Townships and unorganized territory have no city government and so no turnout figure to show — they're marked on the map as their own distinct class rather than left blank.";
