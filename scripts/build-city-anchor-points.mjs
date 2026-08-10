#!/usr/bin/env node
// scripts/build-city-anchor-points.mjs
//
// Writes public/city-anchor-points.json — a precomputed, guaranteed-
// interior anchor point for every statewide municipality in
// public/city-boundaries.geojson (906 features as of 2026-08, MnDOT/MnGeo's
// CTU FeatureServer — Tier 1, licence recorded in scripts/fetch-city-
// boundaries.mjs). Not a new fetch: purely offline, same shape as
// scripts/build-county-cities.mjs (reads an already-fetched file, joins/
// derives, writes a small artifact).
//
// Why this needs to exist (AGENTS.md §2.6, Community Contribution
// Pipeline): every city currently on the map got its marker point from
// hand research (scripts/fetch-mayors.mjs's per-city `coordinates`
// literal) — that doesn't scale to an arbitrary community-submitted city.
// A bare polygon centroid isn't good enough either: it can land outside a
// concave shape (a lake city, a river bend). `@turf/point-on-feature`
// guarantees a point that's actually ON the surface, not just
// mathematically central — see its own docs. Both the (future) submission
// API route and the graduation script consult this small precomputed file
// rather than loading the full 906-feature source at request time.
//
// The actual read/derive/write logic lives in scripts/lib/buildAnchorPoints.mjs,
// shared with build-county-anchor-points.mjs — this file is just that
// shared logic's city-shaped configuration.
//
// Run via `npm run data:city-anchor-points`, after
// `npm run data:city-boundaries` in the data:all chain (this script only
// reads that file, never fetches it itself).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnchorPointsFile } from "./lib/buildAnchorPoints.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same sanity floor as build-county-cities.mjs's MIN_EXPECTED_FEATURES —
// a file well below this count is corrupt/truncated, not a real
// statewide CTU snapshot.
const MIN_EXPECTED_FEATURES = 800;

buildAnchorPointsFile({
  entityNoun: "city",
  boundariesFilename: "city-boundaries.geojson",
  boundariesPath: path.join(__dirname, "../public/city-boundaries.geojson"),
  outputPath: path.join(__dirname, "../public/city-anchor-points.json"),
  outputFilename: "city-anchor-points.json",
  minExpectedFeatures: MIN_EXPECTED_FEATURES,
  refetchHint: "Run `npm run data:city-boundaries` first.",
  // A handful of MN place names are legitimately reused across counties
  // (see build-county-cities.mjs's own Blaine handling) — expected, not
  // a data-quality signal, unlike a duplicate county name would be.
  duplicatesExpected: true,
}).catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
