// GENERATED — do not hand-edit, run `npm run data:county-cities`
//
// County → covered-cities crosswalk, built by scripts/build-county-cities.mjs
// from public/city-boundaries.geojson (MnDOT/MnGeo's CTU FeatureServer —
// Tier 1, licence recorded in scripts/fetch-city-boundaries.mjs) joined
// against src/lib/cities.ts's CITIES. See that script's own header comment
// for the join/normalization rules.
//
// A city that straddles more than one county (e.g. Blaine — Anoka and a
// small Ramsey County sliver) is listed under every county it touches:
// checking it in one county's group checks it everywhere, per AGENTS.md
// §2.5's "ambiguity is surfaced, never silently resolved."
//
// src/lib/cities.ts re-exports COUNTY_CITIES from here rather than
// hand-maintaining it.

import type { City, County } from "./cities.ts";

export const COUNTY_CITIES: Record<County, City[]> = {
  "Anoka": ["Blaine", "Columbia Heights", "Coon Rapids", "Fridley", "Hilltop", "Ramsey"],
  "Benton": ["St. Cloud"],
  "Dakota": ["Apple Valley", "Burnsville", "Eagan", "Lakeville"],
  "Hennepin": ["Bloomington", "Brooklyn Center", "Brooklyn Park", "Champlin", "Corcoran", "Crystal", "Dayton", "Deephaven", "Eden Prairie", "Edina", "Golden Valley", "Hopkins", "Loretto", "Maple Grove", "Medina", "Minneapolis", "Minnetonka", "New Hope", "Plymouth", "Richfield", "Robbinsdale", "St. Louis Park", "Wayzata", "Woodland"],
  "Olmsted": ["Rochester"],
  "Ramsey": ["Blaine", "St. Paul"],
  "Saint Louis": ["Duluth"],
  "Sherburne": ["St. Cloud"],
  "Stearns": ["St. Cloud"],
  "Washington": ["Woodbury"],
  "Wright": ["Dayton"],
};
