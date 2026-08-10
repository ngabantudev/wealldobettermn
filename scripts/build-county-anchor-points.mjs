#!/usr/bin/env node
// scripts/build-county-anchor-points.mjs
//
// Writes public/county-anchor-points.json — a precomputed, guaranteed-
// interior anchor point for every one of Minnesota's 87 counties in
// public/county-boundaries.geojson (MnGeo's Minnesota Counties dataset —
// Tier 1, licence recorded in scripts/fetch-county-boundaries.mjs). Not a
// new fetch: purely offline, same shape as build-city-anchor-points.mjs
// (reads an already-fetched file, derives, writes a small artifact) —
// this file mirrors that one directly, county-shaped rather than
// city-shaped, per the AGENTS.md §2.6 county community-contribution
// build.
//
// Why this needs to exist: countyMatch.ts needs the same "is this even a
// real Minnesota county" recognition check cityMatch.ts already has via
// city-anchor-points.json — checking a submitted county name against
// COUNTIES (11 counties with real commissioner data today) alone would
// wrongly reject every one of the other 76 counties as "not recognized"
// rather than "recognized, but no data yet," which is the actual,
// AGENTS.md §2.6-scoped distinction this pipeline needs to draw.
// `@turf/point-on-feature` guarantees a point that's actually ON the
// county's surface, not just a centroid that could land outside a
// concave shape (a lake county, a river-bend county).
//
// Deterministic and re-runnable (AGENTS.md §2.2): same
// county-boundaries.geojson bytes in, byte-identical output out — no
// generated-at timestamp, no random IDs.
//
// Run via `npm run data:county-anchor-points`, after
// `npm run data:county-boundaries` in the data:all chain (this script
// only reads that file, never fetches it itself).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pointOnFeature } from "@turf/point-on-feature";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOUNDARIES_PATH = path.join(__dirname, "../public/county-boundaries.geojson");
const OUTPUT_PATH = path.join(__dirname, "../public/county-anchor-points.json");
const OUTPUT_FILENAME = "county-anchor-points.json";

const REFETCH_HINT = "Run `npm run data:county-boundaries` first.";

// Minnesota has 87 counties; a safety margin below that, same reasoning
// as build-city-anchor-points.mjs's MIN_EXPECTED_FEATURES.
const MIN_EXPECTED_FEATURES = 80;

const SCHEMA_VERSION = 1;

async function loadBoundaries() {
  let raw;
  try {
    raw = await readFile(BOUNDARIES_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`public/county-boundaries.geojson not found. ${REFETCH_HINT}`);
    }
    throw err;
  }

  let geojson;
  try {
    geojson = JSON.parse(raw);
  } catch {
    throw new Error(`public/county-boundaries.geojson is not valid JSON (corrupt/truncated write?). ${REFETCH_HINT}`);
  }

  const features = geojson.features ?? [];
  if (features.length < MIN_EXPECTED_FEATURES) {
    throw new Error(
      `public/county-boundaries.geojson only has ${features.length} feature(s), expected at least ${MIN_EXPECTED_FEATURES} — looks stale or truncated. ${REFETCH_HINT}`,
    );
  }
  return features;
}

/**
 * One anchor point per feature. Throws on any feature this can't place —
 * same reasoning as build-city-anchor-points.mjs's own
 * buildAnchorPoints: a silently-skipped county here is a silent coverage
 * gap in the pipeline's plausibility gate later.
 */
function buildAnchorPoints(features) {
  /** @type {Record<string, { gnisId: number | null, lng: number, lat: number }>} */
  const points = {};
  const duplicates = [];

  for (const feature of features) {
    const props = feature.properties ?? {};
    const name = props.name;
    if (!name) {
      throw new Error(`A county-boundaries.geojson feature is missing its "name" property (gnisId: ${props.gnisId ?? "unknown"}).`);
    }
    if (Object.prototype.hasOwnProperty.call(points, name)) {
      // Every MN county name is unique (unlike cities, which can repeat
      // across counties) — recorded rather than silently overwritten
      // anyway, so an upstream data quirk shows up rather than vanishing.
      duplicates.push(name);
      continue;
    }

    let anchor;
    try {
      anchor = pointOnFeature(feature);
    } catch (err) {
      throw new Error(`Could not compute an anchor point for "${name}" (gnisId: ${props.gnisId ?? "unknown"}): ${err.message}`);
    }
    const [lng, lat] = anchor.geometry.coordinates;
    points[name] = { gnisId: props.gnisId ?? null, lng, lat };
  }

  if (duplicates.length > 0) {
    console.warn(
      `[build-county-anchor-points] ${duplicates.length} duplicate county name(s) kept only their first occurrence: ${duplicates.join(", ")}.`,
    );
  }

  // Sorted keys: deterministic, diff-friendly output regardless of the
  // source file's own feature order.
  return Object.fromEntries(Object.keys(points).sort().map((name) => [name, points[name]]));
}

async function main() {
  const features = await loadBoundaries();
  const points = buildAnchorPoints(features);
  const output = { schemaVersion: SCHEMA_VERSION, points };
  const contents = JSON.stringify(output, null, 2) + "\n";
  await writeFile(OUTPUT_PATH, contents);
  await updateDataManifest(OUTPUT_FILENAME, contents);
  console.log(`[build-county-anchor-points] wrote ${Object.keys(points).length} anchor points to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
