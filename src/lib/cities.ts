// Canonical list of cities this app maps. Lives here (not in WardMap.tsx,
// where it originated) because src/lib/addressSearch.ts also needs it —
// a "use client" component file shouldn't be the thing a framework-free
// lib module imports from.
export const CITIES = [
  "Minneapolis",
  "St. Paul",
  "Bloomington",
  "Plymouth",
  "Minnetonka",
  "St. Louis Park",
  "Richfield",
  "Blaine",
  "Brooklyn Park",
  "Coon Rapids",
] as const;
export type City = (typeof CITIES)[number];

export const COUNTIES = ["Hennepin", "Ramsey", "Anoka"] as const;
export type County = (typeof COUNTIES)[number];

// wards.geojson carries no county field at all (every feature's `county`
// is null — county only ever shows up on the separate commissioners
// layer), so "search by county" has no source data to look up against.
// Every mapped city sits within exactly one of these three counties for
// this app's purposes, so a small hardcoded table stands in. Blaine has a
// sliver technically in Ramsey County, but its ward data (and the rest of
// its footprint) is sourced and displayed as Anoka County territory here
// — this table only decides which county *name* search surfaces a city,
// never which ward an address resolves to, so the sliver doesn't matter.
export const COUNTY_CITIES: Record<County, City[]> = {
  Hennepin: ["Minneapolis", "Bloomington", "Plymouth", "Minnetonka", "St. Louis Park", "Richfield", "Brooklyn Park"],
  Ramsey: ["St. Paul"],
  Anoka: ["Blaine", "Coon Rapids"],
};
