// scripts/lib/geoSimplify.mjs
//
// Shared ingest-time geometry simplification + coordinate-precision
// rounding for the polygon layers this app's fetch-*.mjs scripts write —
// see issue #67 Finding 1. Raw ArcGIS/county output ships 14+ decimal
// places (sub-millimeter) on district polygons rendered at web-map zoom
// levels, where 5-6 decimal places (sub-meter) is already more precision
// than the pixel grid can show, and every one of those extra digits is
// pure bytes with no visual effect. state-legislature.geojson grew to
// 15.2MB raw off this exact problem the day it went statewide (#61) —
// wards.geojson and commissioners.geojson are the same shape of problem
// at smaller scale.
//
// Deterministic (AGENTS.md §2.2): Douglas-Peucker simplification
// (@turf/simplify) is a pure function of the input geometry and
// tolerance, and coordinate rounding is a pure math operation — same
// input always produces the same output, no timestamps or randomness
// involved, so a re-run against unchanged upstream data writes an
// unchanged file.
//
// Not every polygon layer in this app routes through here:
// at-large-boundaries.geojson is small enough already (848 coordinate
// pairs for Woodbury alone — see that script's own comment) and
// mayors.geojson is Point geometry, which simplify()/rounding both no-op
// on harmlessly but there's no reason to pay the pass for it.

import { simplify } from "@turf/simplify";

// Tolerance is in the same units as the coordinates (WGS84 degrees), not
// meters — deliberately different per layer rather than one shared
// constant, since the two are viewed at different zoom levels: wards and
// commissioner districts are city/county-scale, seen zoomed in close;
// state legislative districts are seen statewide, mostly zoomed out. A
// tolerance tuned for the statewide case would visibly chip corners off
// a zoomed-in ward; a tolerance tuned for a ward would barely trim the
// state layer's byte count at all. `highQuality: true` (below) uses
// Douglas-Peucker's slower, more accurate variant — an ingest-time
// script has no per-request latency budget to protect, so there's no
// reason to take the faster/cruder option.
export const SIMPLIFY_TOLERANCE = {
  // ~3-4m at Minnesota's latitude — city ward boundaries, viewed zoomed
  // in on a single ward or a handful of them at once.
  wards: 0.00003,
  // ~5-6m — county commissioner districts, viewed at a wider zoom than
  // wards but still one metro county at a time, not the whole state.
  commissioners: 0.00005,
  // ~15-18m — MN House/Senate districts, 201 of them statewide, mostly
  // viewed zoomed out far enough that this is still sub-pixel.
  stateLegislature: 0.00015,
  // ~11m — statewide city-limits backdrop layer (~906 cities), viewed
  // both zoomed way out (whole state) and zoomed in on a single city.
  cityBoundaries: 0.0001,
};

// 6 decimal places ≈ 11cm at the equator, tighter everywhere in
// Minnesota — comfortably past what any web-map pixel grid can show,
// while still leaving normal-looking coordinates (not 14+ digits of
// noise) in the committed output.
const DEFAULT_COORDINATE_PRECISION = 6;

function roundCoordinates(coordinates, decimals) {
  const factor = 10 ** decimals;
  if (typeof coordinates[0] === "number") {
    return coordinates.map((n) => Math.round(n * factor) / factor);
  }
  return coordinates.map((c) => roundCoordinates(c, decimals));
}

function countCoordinatePairs(geometry) {
  if (!geometry) return 0;
  switch (geometry.type) {
    case "Point":
      return 1;
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates.length;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
    case "MultiPolygon":
      return geometry.coordinates.reduce((sum, poly) => sum + poly.reduce((s, ring) => s + ring.length, 0), 0);
    default:
      return 0;
  }
}

// Simplifies every feature's geometry and rounds its coordinates to
// `precision` decimal places, returning a new FeatureCollection —
// `featureCollection` and its features are never mutated (`mutate:
// false` below), so a caller that still needs the untouched original
// (none currently do, but the next one shouldn't have to relearn this)
// gets to keep it. `label`, when passed, logs a before/after coordinate
// count so a re-run of the owning script reports what this pass
// actually did, the same way every other step in these scripts logs its
// own counts.
export function simplifyAndRound(featureCollection, { tolerance, precision = DEFAULT_COORDINATE_PRECISION, label }) {
  const before = label ? featureCollection.features.reduce((sum, f) => sum + countCoordinatePairs(f.geometry), 0) : 0;

  const simplified = simplify(featureCollection, { tolerance, highQuality: true, mutate: false });
  const rounded = {
    ...simplified,
    features: simplified.features.map((feature) => {
      if (!feature.geometry) return feature;
      return { ...feature, geometry: { ...feature.geometry, coordinates: roundCoordinates(feature.geometry.coordinates, precision) } };
    }),
  };

  if (label) {
    const after = rounded.features.reduce((sum, f) => sum + countCoordinatePairs(f.geometry), 0);
    const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    console.log(
      `[${label}] simplified ${before} -> ${after} coordinate pair(s) (${pct}% fewer), rounded to ${precision} decimal place(s)`,
    );
  }

  return rounded;
}
