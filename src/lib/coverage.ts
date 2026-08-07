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

// Mirrors scripts/fetch-commissioners.mjs's own RAMSEY_DISTRICTS_URL /
// HENNEPIN_DISTRICTS_URL pair — that script only ever fetches these two
// counties' commissioner districts, never Anoka's (Anoka's mapped cities,
// Blaine and Coon Rapids, get city-council data but no county-commissioner
// layer at all). Update this if that script's county list ever changes.
export const COMMISSIONER_COUNTIES = ["Hennepin", "Ramsey"] as const;

// Mirrors scripts/fetch-state-legislature.mjs's own TWIN_CITIES_BOUNDS: a
// bounding box roughly covering Hennepin + Ramsey (with a buffer), used to
// keep only the House/Senate districts that reach Minneapolis or St. Paul
// out of Minnesota's full, statewide set of districts. It's a display
// filter, not an administrative boundary — some districts included this
// way extend into neighboring counties, and there's no guarantee every
// address in, say, Anoka or Dakota County falls inside a kept district.
// Update this if that script's bounding box ever changes.
export const STATE_LEGISLATURE_NOTE =
  "MN House & Senate districts reaching the Twin Cities core — not every Minnesota district, and not a guarantee every address nearby is included.";

// Empty-state copy for WardModal's multi-tier (city/county/state) panel —
// what to say when resolveOfficialsAtPoint (src/lib/officials.ts) comes
// back with no hit for a given tier at the point the user hovered, clicked,
// or tapped. Composed from the same ground-truth values above rather than
// separately hand-typed, so this copy can't drift from what the map layers
// actually cover (AGENTS.md §3.3 Coverage Honesty). Human-reviewed strings
// per AGENTS.md §3.4 — this is user-facing copy, drafted with AI assistance.
export const CITY_TIER_EMPTY_NOTE = `This location is outside every city this map has ward data for (${WARD_CITIES.join(", ")}).`;

export const COUNTY_TIER_EMPTY_NOTE = `County commissioner districts are only mapped for ${COMMISSIONER_COUNTIES.join(" and ")} County.`;

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
  "Meeting and hearing schedules",
  ...(BILLS_INGEST_STATUS === "live" ? [] : [BILLS_COVERAGE_NOTE]),
];
