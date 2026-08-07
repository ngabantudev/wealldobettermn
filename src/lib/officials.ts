// Resolves "who represents this point on the map" across all three tiers
// (city, county, state) at once — the data behind the multi-tier detail
// panel WardModal.tsx renders on hover/click/tap.
//
// Why this exists: WardMap.tsx's LayerMode toggle ("wards" | "commissioners"
// | "state-legislature") only ever shows ONE tier's fill layer visible at a
// time, and MapLibre's queryRenderedFeatures never hit-tests a hidden layer
// — so before this file, only the currently-visible tier was ever reachable
// by hover or click, even though all three tiers' GeoJSON is always loaded.
// This runs a plain on-device point-in-polygon test against each tier's raw
// (untiled) FeatureCollection independently, so the result never depends on
// which layer happens to be visible right now. Same "resolve locally,
// nothing leaves the device" spirit as AGENTS.md §2.5's address search,
// applied to map interaction instead of the search box.
//
// Per AGENTS.md §0.1 ("model relations as first-class objects"), this is
// kept as a pure, framework-free function — no JSX, no MapLibre types —
// so it's usable and testable independent of the map component. See
// officials.test.mjs.

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import type { RepProperties } from "./types";

export interface AreaOfficials {
  city: RepProperties[]; // 0–N: Mayor + one Council Member per seat a ward elects (usually 1, sometimes 2+ — see officialIdentity)
  county: RepProperties[]; // 0–1: County Commissioner
  state: RepProperties[]; // 0–2: State Representative + State Senator
}

// The FeatureCollections WardMap.tsx fetches in fetchCivicData(). Mayors is
// a point layer (one feature per official, no polygon of its own — see
// resolveOfficialsAtPoint's mayor-matching step below); wards/commissioners/
// stateLeg/atLargeBoundaries are Polygon/MultiPolygon layers.
// atLargeBoundaries is optional (older callers/tests that only care about
// ward-electing cities can omit it) — it exists purely to extend the same
// city-name match mayors already gets, for a city with no ward polygon at
// all to point-in-polygon against otherwise (see AreaOfficials.city below).
export interface CivicGeometrySources {
  wards: FeatureCollection | null;
  mayors: FeatureCollection | null;
  commissioners: FeatureCollection | null;
  stateLeg: FeatureCollection | null;
  atLargeBoundaries?: FeatureCollection | null;
}

// Display order within a tier — more senior/citywide office first. Ties
// (there's only ever one commissioner per tier) don't matter.
const ROLE_ORDER: Record<RepProperties["role"], number> = {
  Mayor: 0,
  "Council Member": 1,
  "County Commissioner": 0,
  "State Senator": 0,
  "State Representative": 1,
};

function tierForRole(role: RepProperties["role"]): keyof AreaOfficials {
  if (role === "Mayor" || role === "Council Member") return "city";
  if (role === "County Commissioner") return "county";
  return "state";
}

// A stable identity per office — used to de-dupe a seeded `known` official
// (see resolveOfficialsAtPoint) against whatever point-in-polygon
// independently finds for the same office, and to de-dupe PIP hits against
// each other at a shared boundary vertex. Keyed on the same fields that
// already distinguish one office from another in RepProperties (role plus
// whichever locator field that role actually populates — see
// RepProperties's own field comments in types.ts) rather than repName,
// since a name isn't guaranteed unique or even present ("Vacant / TBD").
// Also used as WardModal's React list key, so a collision doesn't just
// merge two records — it can render the wrong card.
export function officialIdentity(rep: RepProperties): string {
  switch (rep.role) {
    case "Mayor":
    case "Council Member":
      // A ward's locator alone (city+ward) doesn't uniquely identify a
      // *seat* — Blaine's and Brooklyn Park's wards each currently elect
      // two council members off one shared ward polygon, with no seat
      // number of their own in the source data. repName is the only
      // field that tells those two seats apart. This deliberately
      // differs from the County Commissioner/State Senator/State
      // Representative cases below, where identity ignores name on
      // purpose (one seat per district, so a name change there means
      // "same office, new occupant" — see the "stable regardless of
      // name" test in officials.test.mjs). Here, a ward with two
      // same-named vacancies would still collide; that's the same
      // "name isn't guaranteed unique" caveat this file already
      // documents elsewhere, not a new risk.
      return `${rep.role}:${rep.city}:${rep.ward ?? "at-large"}:${rep.repName ?? "vacant"}`;
    case "County Commissioner":
      return `${rep.role}:${rep.county ?? rep.city}:${rep.district ?? ""}`;
    case "State Representative":
    case "State Senator":
      return `${rep.role}:${rep.chamber ?? ""}:${rep.stateDistrict ?? ""}`;
    default:
      // `role` comes from fetched JSON, not a runtime-validated schema
      // (AGENTS.md §3.2's hand-maintained-roster risk applies here too) —
      // an unrecognized value falls through TypeScript's exhaustiveness
      // check at runtime. Composite of every locator field (plus the name
      // as a last resort) so a malformed record still gets a
      // near-certainly-unique key instead of silently colliding every
      // other malformed record onto one identity and losing the rest.
      return `${rep.role}:${rep.city}:${rep.county ?? ""}:${rep.ward ?? ""}:${rep.district ?? ""}:${rep.stateDistrict ?? ""}:${rep.chamber ?? ""}:${rep.repName ?? ""}`;
  }
}

function dedupeByIdentity(reps: RepProperties[]): RepProperties[] {
  const seen = new Set<string>();
  const out: RepProperties[] = [];
  for (const rep of reps) {
    const id = officialIdentity(rep);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(rep);
  }
  return out;
}

function sortByRole(reps: RepProperties[]): RepProperties[] {
  return [...reps].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

function isPolygonal(geometry: Geometry | null): geometry is Polygon | MultiPolygon {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

// Every feature in `collection` whose polygon contains `point`. No bbox
// pre-filter: an earlier version of this function cached a hand-rolled
// bounding box per feature to reject candidates before the exact test, but
// that only shaved a constant factor off each of O(n) feature visits per
// call — it didn't change the fact that a hover-driven caller re-scans the
// full collection on every event. WardMap.tsx's handleHoverMove is what
// actually addresses that cost, by skipping the whole resolve when the
// cursor is still over the same feature it was on the last event — see its
// own comment. That fixes the real bottleneck (re-resolving on every pixel
// of movement within one polygon); a bbox micro-optimization here wouldn't
// have.
//
// Turf's booleanPointInPolygon treats a point exactly on a shared
// boundary/vertex as inside both neighboring polygons — an intentional,
// tested (see officials.test.mjs) convention here, not a bug: it's more
// honest to show both districts than to arbitrarily pick one at a seam.
function featuresContainingPoint(collection: FeatureCollection | null, point: Position): RepProperties[] {
  if (!collection) return [];
  const hits: RepProperties[] = [];
  for (const feature of collection.features) {
    if (!isPolygonal(feature.geometry)) continue;
    if (booleanPointInPolygon(point, feature as Feature<Polygon | MultiPolygon>)) {
      hits.push(feature.properties as unknown as RepProperties);
    }
  }
  return hits;
}

// Resolves every applicable official at one map point, across all three
// tiers, independent of which LayerMode is currently visible on the map.
//
// `known`, when passed, is the caller's own already-certain answer for ONE
// office at this point — e.g. the exact RepProperties a clicked pin closes
// over, or the full feature a fill-layer click already resolved for
// fitBounds accuracy. It's force-included into its tier ahead of (and
// de-duped against) whatever point-in-polygon independently finds, so a
// user who clicks directly on a pin or a district always sees that exact
// office represented — never a substitute some other feature's polygon
// happened to also claim at that precise point (an oddly-shaped/concave
// district's label point can, in principle, sit fractionally outside its
// own polygon). PIP still runs for `known`'s own tier too, to fill the
// sibling slot the seed doesn't cover — e.g. seeding a House pin still
// needs PIP to find the overlapping Senate district at the same point.
export function resolveOfficialsAtPoint(
  point: Position,
  sources: CivicGeometrySources,
  known?: RepProperties,
): AreaOfficials {
  const wardHits = featuresContainingPoint(sources.wards, point);
  const commissionerHits = featuresContainingPoint(sources.commissioners, point);
  const stateHits = featuresContainingPoint(sources.stateLeg, point);

  // Mayors carry no polygon of their own — matched by city name against the
  // ward hit(s), plus `known`'s own city when `known` is itself a Mayor or
  // Council Member (covers a mayor pin clicked a hair outside its own
  // city's ward polygons, the same boundary-precision case `known` exists
  // for generally). This is a plain string join, not a stable-ID relation
  // (AGENTS.md §0.1) — acceptable here only because both wards.geojson and
  // mayors.geojson are generated from the same CITIES list in
  // src/lib/cities.ts (scripts/fetch-wards.mjs, scripts/fetch-mayors.mjs),
  // so "Minneapolis" can't spell itself two different ways between the two
  // files without both scripts being edited out of sync.
  //
  // atLargeBoundaries extends the same join for a wardless city (Woodbury):
  // it has zero wardHits by construction (no ward polygon exists), so
  // without this its mayor/council pins would only ever resolve when
  // `known` was seeded by clicking the pin directly — clicking anywhere
  // else inside the city (its own boundary fill, not a ward) would show
  // nothing. Its features carry only `{ city }` (see
  // fetch-at-large-boundaries.mjs), never enough to stand in as a
  // RepProperties itself, so only the city name is pulled out of a hit
  // here — the actual officials still come from mayorHits below, same as
  // every other city.
  const cityNames = new Set(wardHits.map((rep) => rep.city));
  for (const feature of sources.atLargeBoundaries?.features ?? []) {
    if (!isPolygonal(feature.geometry)) continue;
    if (booleanPointInPolygon(point, feature as Feature<Polygon | MultiPolygon>)) {
      cityNames.add((feature.properties as { city: RepProperties["city"] }).city);
    }
  }
  if (known && (known.role === "Mayor" || known.role === "Council Member")) cityNames.add(known.city);
  const mayorHits = (sources.mayors?.features ?? [])
    .map((feature) => feature.properties as unknown as RepProperties)
    .filter((mayor) => cityNames.has(mayor.city));

  const officials: AreaOfficials = {
    city: dedupeByIdentity([...mayorHits, ...wardHits]),
    county: dedupeByIdentity(commissionerHits),
    state: dedupeByIdentity(stateHits),
  };

  if (known) {
    const tier = tierForRole(known.role);
    officials[tier] = dedupeByIdentity([known, ...officials[tier]]);
  }

  // Adding a fourth tier only ever means extending this array — dedupe and
  // sort are applied uniformly instead of being hand-repeated per tier
  // name, so a new tier can't end up processed by one step and not the
  // other.
  for (const tier of Object.keys(officials) as (keyof AreaOfficials)[]) {
    officials[tier] = sortByRole(officials[tier]);
  }
  return officials;
}
