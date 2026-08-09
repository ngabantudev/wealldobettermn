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
// Deterministic and re-runnable (AGENTS.md §2.2): same
// city-boundaries.geojson bytes in, byte-identical output out — no
// generated-at timestamp, no random IDs, same convention as
// build-county-cities.mjs's own output.
//
// Run via `npm run data:city-anchor-points`, after
// `npm run data:city-boundaries` in the data:all chain (this script only
// reads that file, never fetches it itself).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pointOnFeature } from "@turf/point-on-feature";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOUNDARIES_PATH = path.join(__dirname, "../public/city-boundaries.geojson");
const OUTPUT_PATH = path.join(__dirname, "../public/city-anchor-points.json");
const OUTPUT_FILENAME = "city-anchor-points.json";

const REFETCH_HINT = "Run `npm run data:city-boundaries` first.";

// Same sanity floor as build-county-cities.mjs's MIN_EXPECTED_FEATURES —
// a file well below this count is corrupt/truncated, not a real
// statewide CTU snapshot.
const MIN_EXPECTED_FEATURES = 800;

const SCHEMA_VERSION = 1;

async function loadBoundaries() {
  let raw;
  try {
    raw = await readFile(BOUNDARIES_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`public/city-boundaries.geojson not found. ${REFETCH_HINT}`);
    }
    throw err;
  }

  let geojson;
  try {
    geojson = JSON.parse(raw);
  } catch {
    throw new Error(`public/city-boundaries.geojson is not valid JSON (corrupt/truncated write?). ${REFETCH_HINT}`);
  }

  const features = geojson.features ?? [];
  if (features.length < MIN_EXPECTED_FEATURES) {
    throw new Error(
      `public/city-boundaries.geojson only has ${features.length} feature(s), expected at least ${MIN_EXPECTED_FEATURES} — looks stale or truncated. ${REFETCH_HINT}`,
    );
  }
  return features;
}

/**
 * One anchor point per feature. Throws on any feature this can't place —
 * a silently-skipped city here is a silent coverage gap in the
 * Community Contribution Pipeline's plausibility gate later (a
 * legitimately-submitted city could be wrongly rejected as
 * "not recognized"), so a bad input feature fails the whole build rather
 * than producing an incomplete file (AGENTS.md §3.1 "never fabricate or
 * silently drop").
 */
function buildAnchorPoints(features) {
  /** @type {Record<string, { gnisId: number | null, lng: number, lat: number }>} */
  const points = {};
  const duplicates = [];

  for (const feature of features) {
    const props = feature.properties ?? {};
    const name = props.name;
    if (!name) {
      throw new Error(`A city-boundaries.geojson feature is missing its "name" property (gnisId: ${props.gnisId ?? "unknown"}).`);
    }
    if (Object.prototype.hasOwnProperty.call(points, name)) {
      // A handful of MN place names are legitimately reused across
      // counties (see build-county-cities.mjs's own Blaine handling) —
      // recorded, not silently overwritten, so a human can see the
      // collision rather than one of the two anchor points vanishing.
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
      `[build-city-anchor-points] ${duplicates.length} duplicate city name(s) kept only their first occurrence: ${duplicates.join(", ")}. ` +
        `Community submissions matching one of these names will resolve to whichever occurrence was listed first in city-boundaries.geojson.`,
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
  console.log(`[build-city-anchor-points] wrote ${Object.keys(points).length} anchor points to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
