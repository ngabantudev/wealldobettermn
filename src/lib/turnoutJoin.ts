// src/lib/turnoutJoin.ts
//
// Pure join functions between two datasets with different city-naming
// conventions that both describe the same real places:
//
//   - public/city-boundaries.geojson (scripts/fetch-city-boundaries.mjs) —
//     polygon per city, `properties.name` spelled out in full ("Saint
//     Paul", "Saint Anthony"), `properties.county` a single county name
//     (a city split across counties gets one polygon feature per county
//     it touches, all sharing the same `gnisId`).
//   - public/turnout/city/<year>.json (scripts/ingest/turnout.mjs) —
//     one record per city, `cityId` a lowercase slug, `cityName` in
//     abbreviated form ("St. Paul", "St. Anthony"), `counties` an array
//     (every county the city's precincts fall in).
//
// A plain name-slug join is not safe: Minnesota has more than one city
// sharing a name in different counties. The real, confirmed case in the
// live 2024 turnout data (scripts/ingest/turnout.mjs's own
// disambiguation comment, "the second one encountered in sorted order
// gets 'st-anthony-2'") is St. Anthony — a Hennepin/Ramsey-straddling
// city of ~9,000 people, and an unrelated ~91-person St. Anthony
// Township-adjacent city in Stearns County. city-boundaries.geojson
// carries both as separate "Saint Anthony" features (one per county),
// and turnout/city/2024.json carries both as separate cityId records
// (st-anthony: counties ["Hennepin","Ramsey"]; st-anthony-2: counties
// ["Stearns"]). Joining on normalized name alone would non-deterministically
// pick one turnout record for both boundary polygons. This module cross-
// checks county before accepting a match — see joinCityBoundaryToTurnout.
//
// AGENTS.md §0.1: a mis-joined polygon is exactly the kind of silent,
// undetectable wrong-answer this project's guiding principles rule out
// (§2.5's "silently choosing the wrong district is the worst failure
// this site can produce" — the same logic applies to a wrong turnout
// figure attached to the wrong city). A boundary polygon with no
// resolvable, unambiguous turnout match returns `null`, never a guess —
// the polygon itself is still rendered (as the below-threshold/no-data
// class), per this file's own callers in WardMap.tsx.

// One named upstream document behind a turnout year file — the shape
// public/turnout/city/<year>.json's own top-level `provenance.sos` and
// `provenance.cvap` entries actually carry today (scripts/ingest/turnout.mjs).
// Only the fields the "Original Source" citation (ParticipationLegend.tsx)
// renders are declared here — documentId/fetchedAt/licence/contentHash exist
// in the real file too but have no UI consumer yet, so they're left off
// rather than typed and unused. Every field but the URL/agency pair is
// optional so a differently-shaped future year file (or a hand-authored
// fixture) degrades instead of failing to type-check.
export interface TurnoutProvenanceSource {
  primarySourceUrl: string;
  landingPageUrl?: string;
  sourceAgency: string;
  documentType?: string;
  issuedDate?: string | null;
}

// public/turnout/city/<year>.json's own top-level `provenance` field. Per
// AGENTS.md §3.3, this is the *actual* data-source citation (SOS precinct
// results + Census CVAP) — distinct from ParticipationLegend's separate
// "See Also" prior-art callout. Absent entirely on a turnout year file that
// predates this field (see turnoutJoin.ts callers for the fallback), and
// `sos`/`cvap` are each independently optional in case a future ingest run
// only has one of the two ready.
export interface TurnoutProvenance {
  sos?: TurnoutProvenanceSource;
  cvap?: TurnoutProvenanceSource;
}

/** The subset of a public/turnout/city/<year>.json city record this join needs. */
export interface TurnoutCityRecord {
  cityId: string;
  cityName: string;
  counties: readonly string[];
  turnoutOfRegistered: number | null;
  turnoutOfCVAP: number | null;
  belowThreshold: boolean;
  ballotsCast: number;
  registeredAt7am: number;
  electionDayRegistrations: number;
}

/** The subset of a public/city-boundaries.geojson (or
 * public/township-unorg-boundaries.geojson) feature's `properties` this
 * join needs. */
export interface CityBoundaryProperties {
  name: string | null;
  county: string | null;
}

export type TurnoutJoinResult =
  | { turnout: TurnoutCityRecord; matchReason: "unique-name" | "name-and-county" }
  | { turnout: null; reason: "no-name-match" | "ambiguous-no-county" | "ambiguous-county-mismatch" };

// Normalizes a city name for comparison across the two datasets'
// spelling conventions: "Saint Paul" (city-boundaries.geojson) and
// "St. Paul" (turnout's cityName) both normalize to "st paul".
// - lowercase
// - "saint" (whole word, standalone or as a prefix like "St." after
//   punctuation stripping) -> "st"
// - strip periods/commas/apostrophes
// - collapse whitespace, trim
export function normalizeCityKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalizes a county name for comparison — same punctuation/whitespace
// handling as normalizeCityKey, applied to county strings from both
// datasets (city-boundaries.geojson's single `county` string and
// turnout's `counties` array entries).
export function normalizeCountyKey(county: string): string {
  return county
    .toLowerCase()
    .replace(/[.,'']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Joins one city-boundaries (or township-unorg-boundaries) polygon
 * feature's properties against the full list of turnout city records for
 * a year, returning the single unambiguous match or a typed reason for
 * why none was found. Never guesses: a boundary feature whose name
 * matches more than one turnout record, with no county field to
 * disambiguate by (or a county that matches more than one, or none of
 * the candidates), returns `{ turnout: null, ... }` rather than picking
 * arbitrarily.
 */
export function joinCityBoundaryToTurnout(
  boundary: CityBoundaryProperties,
  turnoutCities: readonly TurnoutCityRecord[],
): TurnoutJoinResult {
  if (!boundary.name) {
    return { turnout: null, reason: "no-name-match" };
  }

  const nameKey = normalizeCityKey(boundary.name);
  const nameMatches = turnoutCities.filter((city) => normalizeCityKey(city.cityName) === nameKey);

  if (nameMatches.length === 0) {
    return { turnout: null, reason: "no-name-match" };
  }

  if (nameMatches.length === 1) {
    return { turnout: nameMatches[0], matchReason: "unique-name" };
  }

  // More than one turnout record shares this normalized name (the St.
  // Anthony case) — county is required to disambiguate.
  if (!boundary.county) {
    return { turnout: null, reason: "ambiguous-no-county" };
  }

  const countyKey = normalizeCountyKey(boundary.county);
  const countyMatches = nameMatches.filter((city) =>
    city.counties.some((c) => normalizeCountyKey(c) === countyKey),
  );

  if (countyMatches.length === 1) {
    return { turnout: countyMatches[0], matchReason: "name-and-county" };
  }

  // Either no candidate's counties list contains this boundary's county,
  // or (shouldn't happen with real data, but not assumed away) more than
  // one still does — both are genuine ambiguity, not resolvable here.
  return { turnout: null, reason: "ambiguous-county-mismatch" };
}

/**
 * Batch form of joinCityBoundaryToTurnout — joins every feature in a
 * city-boundaries-shaped FeatureCollection against a turnout city list,
 * returning a Map keyed by a stable per-feature key (gnisId if present,
 * else the feature's array index) so callers can look up a feature's
 * turnout result without re-running the join per render. Every boundary
 * feature gets an entry, matched or not — per this module's own header,
 * an unmatched feature is flagged, never dropped.
 */
export function joinAllCityBoundaries<
  P extends CityBoundaryProperties,
>(
  features: readonly { properties: P }[],
  turnoutCities: readonly TurnoutCityRecord[],
): TurnoutJoinResult[] {
  return features.map((feature) => joinCityBoundaryToTurnout(feature.properties, turnoutCities));
}

// One feature per city-boundaries.geojson polygon (every incorporated
// city, statewide), enriched with that city's joined turnout record where
// one resolves. Shared by WardMap.tsx (the map source) and
// ParticipationRecordList.tsx (the accessible DOM list — AGENTS.md §4's
// "DOM record list beside the map... must stay perfectly in sync with
// drawn features"), which is why this lives here rather than as a
// component-local type: both need the exact same shape from the exact
// same join, never two independently-derived copies that could drift.
export interface ParticipationCityProperties {
  // Display name — turnout's own cityName (abbreviated "St. ___" spelling,
  // matching the rest of this app's convention) when a join resolved,
  // else city-boundaries' own full-spelled name, so an unmatched city
  // still has a real, readable label.
  name: string;
  // The SPECIFIC boundary polygon's own single county — every polygon in
  // city-boundaries.geojson has exactly one (a multi-county city gets one
  // polygon feature per county it touches, per this file's own header).
  // Kept single-valued and untouched by the multi-county fix below
  // because the map's own per-polygon rendering, hover, and click-to-pin
  // behavior all key off "which specific polygon is this," which is
  // still genuinely one county each.
  county: string | null;
  // The city's FULL county list when matched (turnout's own `counties`
  // array — every county the city's precincts fall in, e.g. Mankato:
  // ["Blue Earth", "Nicollet", "Le Sueur"]), vs. this one polygon's own
  // single `county` above. Consumers that describe "this city" as a whole
  // (ParticipationRecordList's deduped rows, the pinned panel) should
  // show `counties`, not `county` — showing only the polygon-of-the-
  // moment's single county for a multi-county city undercounts it.
  // Falls back to `[county]` (or `[]`) when unmatched, since there's no
  // turnout record to source a full list from.
  counties: readonly string[];
  cityId: string | null;
  matched: boolean;
  belowThreshold: boolean;
  turnoutOfRegistered: number | null;
  turnoutOfCVAP: number | null;
  ballotsCast: number | null;
  registeredAt7am: number | null;
  electionDayRegistrations: number | null;
  population: number | null;
}

/** A minimal, geometry-agnostic city-boundaries feature — just enough for deriveParticipationBoundaries to read `properties` off. */
export interface CityBoundaryFeatureLike<G> {
  type: "Feature";
  geometry: G;
  properties: { name?: string; county?: string; population?: number } | null;
}

/**
 * Joins every feature in a city-boundaries-shaped FeatureCollection
 * against a turnout year's city list, returning a same-shaped
 * FeatureCollection whose features all carry ParticipationCityProperties.
 * Never drops a feature — a boundary polygon with no resolvable turnout
 * record still renders, flagged `matched: false`, per this module's own
 * header ("never guess, never go missing").
 */
export function deriveParticipationBoundaries<G>(
  cityBoundaries: { type: "FeatureCollection"; features: readonly CityBoundaryFeatureLike<G>[] },
  turnoutCities: readonly TurnoutCityRecord[],
): { type: "FeatureCollection"; features: { type: "Feature"; geometry: G; properties: ParticipationCityProperties }[] } {
  return {
    type: "FeatureCollection",
    features: cityBoundaries.features.map((f) => {
      const props = f.properties ?? {};
      const result = joinCityBoundaryToTurnout({ name: props.name ?? null, county: props.county ?? null }, turnoutCities);
      const turnout = result.turnout;
      const properties: ParticipationCityProperties = {
        name: turnout?.cityName ?? props.name ?? "",
        county: props.county ?? null,
        counties: turnout ? turnout.counties : props.county ? [props.county] : [],
        cityId: turnout?.cityId ?? null,
        matched: turnout !== null,
        belowThreshold: turnout?.belowThreshold ?? false,
        turnoutOfRegistered: turnout?.turnoutOfRegistered ?? null,
        turnoutOfCVAP: turnout?.turnoutOfCVAP ?? null,
        ballotsCast: turnout?.ballotsCast ?? null,
        registeredAt7am: turnout?.registeredAt7am ?? null,
        electionDayRegistrations: turnout?.electionDayRegistrations ?? null,
        population: typeof props.population === "number" ? props.population : null,
      };
      return { type: "Feature" as const, geometry: f.geometry, properties };
    }),
  };
}

// deriveParticipationBoundaries above returns one feature per city-
// boundaries.geojson POLYGON (906 statewide) — correct for the map's own
// choropleth fill, since every polygon of a multi-county city (48 real
// Minnesota cities span more than one county — Mankato: Blue Earth,
// Nicollet, Le Sueur, three polygons, one turnout record) should shade
// the same. It is NOT correct for a consumer describing "the list of
// cities" rather than "the list of polygons" — WardMap.tsx's
// ParticipationRecordList feed and its selectParticipationCity bounds
// lookup both need one row per real city, not one per polygon (a
// resident picking "Mankato" from an alphabetical list shouldn't see it
// three times with identical numbers under three different single-county
// labels). This is that dedup step: matched cities collapse to one row
// per cityId (they're identical across polygons — same turnout record,
// only `county`/geometry differ per polygon); unmatched features have no
// cityId to group by and are left exactly as deriveParticipationBoundaries
// produced them, one row per unresolved polygon — each is a genuinely
// distinct boundary that failed its own join, not a duplicate, so
// deduping by name+county here is a no-op for them, not a fix.
export function deriveParticipationCities(
  data: { features: readonly { properties: ParticipationCityProperties }[] } | null | undefined,
): ParticipationCityProperties[] {
  if (!data) return [];
  const seen = new Set<string>();
  const result: ParticipationCityProperties[] = [];
  for (const feature of data.features) {
    const props = feature.properties;
    const key = props.matched && props.cityId ? `city:${props.cityId}` : `polygon:${props.name}:${props.county ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(props);
  }
  return result;
}
