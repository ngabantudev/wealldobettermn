#!/usr/bin/env node
// scripts/build-county-anchor-points.mjs
//
// Writes public/county-anchor-points.json — a precomputed, guaranteed-
// interior anchor point for every one of Minnesota's 87 counties in
// public/county-boundaries.geojson (MnGeo's Minnesota Counties dataset —
// Tier 1, licence recorded in scripts/fetch-county-boundaries.mjs).
//
// Why this needs to exist: countyMatch.ts needs the same "is this even a
// real Minnesota county" recognition check cityMatch.ts already has via
// city-anchor-points.json — checking a submitted county name against
// COUNTIES (11 counties with real commissioner data today) alone would
// wrongly reject every one of the other 76 counties as "not recognized"
// rather than "recognized, but no data yet," which is the actual,
// AGENTS.md §2.6-scoped distinction this pipeline needs to draw.
//
// The actual read/derive/write logic lives in scripts/lib/buildAnchorPoints.mjs,
// shared with build-city-anchor-points.mjs — this file is just that
// shared logic's county-shaped configuration.
//
// Run via `npm run data:county-anchor-points`, after
// `npm run data:county-boundaries` in the data:all chain (this script
// only reads that file, never fetches it itself).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnchorPointsFile } from "./lib/buildAnchorPoints.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minnesota has 87 counties; a safety margin below that, same reasoning
// as build-city-anchor-points.mjs's MIN_EXPECTED_FEATURES.
const MIN_EXPECTED_FEATURES = 80;

buildAnchorPointsFile({
  entityNoun: "county",
  boundariesFilename: "county-boundaries.geojson",
  boundariesPath: path.join(__dirname, "../public/county-boundaries.geojson"),
  outputPath: path.join(__dirname, "../public/county-anchor-points.json"),
  outputFilename: "county-anchor-points.json",
  minExpectedFeatures: MIN_EXPECTED_FEATURES,
  refetchHint: "Run `npm run data:county-boundaries` first.",
  // Unlike cities, every MN county name is unique — a duplicate here
  // would mean an upstream data quirk, not a normal collision.
  duplicatesExpected: false,
}).catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
