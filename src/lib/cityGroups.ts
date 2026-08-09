// src/lib/cityGroups.ts
//
// Pure, framework-free grouping/matching logic for the area-filter
// sidebar (issue: "Area-filter sidebar: search, county grouping, scoped
// bulk toggles") — no React/DOM import, same shape as addressSearch.ts,
// so it can run under plain `node --test` (see cityGroups.test.mjs) and
// be exercised without mounting WardMap.tsx at all.
//
// Two responsibilities:
//   1. Group a list of cities by county (buildCityGroups), county-name
//      sorted, cities alphabetical within each group, driven by
//      COUNTY_CITIES (src/lib/countyCities.generated.ts) rather than a
//      second hand-maintained mapping.
//   2. Match a free-text filter-list query against a city name
//      (matchesCityQuery) — case- and punctuation-insensitive substring
//      match, no network, nothing address-search-shaped: this is a plain
//      "narrow this on-screen checklist" filter, not the on-device
//      address gazetteer AGENTS.md §2.5 governs.

import { COUNTY_CITIES, type City, type County } from "./cities.ts";

export interface CityGroup {
  county: County;
  cities: City[];
}

/**
 * Groups `cities` (already filtered to whichever set a caller wants
 * grouped — e.g. MODE_VISIBLE_CITIES[layerMode]) by county, using
 * COUNTY_CITIES to decide membership. A city that isn't in any county's
 * list for these purposes is dropped rather than silently omitted from
 * every group — see the "every CITIES entry appears in its county
 * group(s)" test, which is what actually guards against that.
 *
 * Groups are sorted alphabetically by county name; cities are sorted
 * alphabetically within each group. A county with no matching cities is
 * omitted from the result entirely (never an empty group).
 */
export function buildCityGroups(cities: readonly City[]): CityGroup[] {
  const allowed = new Set(cities);
  const groups: CityGroup[] = [];
  const counties = Object.keys(COUNTY_CITIES) as County[];
  for (const county of [...counties].sort((a, b) => a.localeCompare(b))) {
    const inCounty = COUNTY_CITIES[county].filter((city) => allowed.has(city));
    if (inCounty.length === 0) continue;
    groups.push({ county, cities: [...inCounty].sort((a, b) => a.localeCompare(b)) });
  }
  return groups;
}

// Same fold shape as addressSearch.ts's own `fold()` / build-county-
// cities.mjs's own `fold()` — case- and punctuation-insensitive, plus the
// same "SAINT"->"ST" whole-word substitution those two use. This *was*
// dropped here on the theory that a plain substring match didn't need it
// ("st" is already a substring of "st paul"), but that reasoning missed
// COUNTY_CITIES's own "Saint Louis" county group (countyCities.generated.ts
// — the CTU dataset spells it out in full, unlike CITIES's abbreviated "St.
// ___" cities): "st" is NOT a substring of "saint" as typed, so a resident
// filtering the county list by "st" never found it. Folding both sides to
// the same "st" form fixes that the same way it already fixes SearchBar.tsx.
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if `query` (free-text, as typed into the filter-list search input)
 * is a substring of `text`, ignoring case and punctuation. An
 * empty/whitespace-only query matches everything — the "no query typed
 * yet" resting state. `text` is typed as plain `string` (not `City`) so a
 * caller can match against a mode-specific display label (e.g. a
 * commissioner-mode "Hennepin County" override) rather than only the raw
 * city name — every `City` value is itself a valid `string` argument too.
 */
export function matchesCityQuery(query: string, text: string): boolean {
  const q = fold(query);
  if (q.length === 0) return true;
  return fold(text).includes(q);
}
