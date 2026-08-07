#!/usr/bin/env node
// scripts/fetch-city-boundaries.mjs
//
// Writes public/city-boundaries.geojson — the corporate boundary of every
// incorporated Minnesota city, statewide (~906 today), not just the 17
// cities src/lib/cities.ts's CITIES has ward/mayor data for. WardMap draws
// this as a low-opacity backdrop layer under every other tier, so a
// resident outside this app's covered cities still sees their city's own
// outline instead of a blank map — AGENTS.md §0.1 (show the boundary, not
// nothing) and §3.3 Coverage Honesty (an uncovered city now reads as "a
// plain outline, no ward/council data on top" instead of invisible).
//
// Source: MnDOT/MnGeo's "City, Township, and Unorganized Territory in
// Minnesota" — Tier 1, government primary, published weekly.
// Landing page: https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg
//
// CTU_CLASS='CITY' filters out townships and unorganized territory, which
// this layer deliberately does not cover — see the registry entry's
// knownGaps in src/lib/layers.ts.
//
// This dataset spells city names out in full ("Saint Paul", "Saint Louis
// Park"), not cities.ts's abbreviated forms ("St. Paul", "St. Louis
// Park"). Deliberately not cross-referenced against cities.ts here — every
// polygon renders uniformly regardless of whether the city also has ward
// data layered on top elsewhere on the map.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simplifyAndRound, SIMPLIFY_TOLERANCE } from "./lib/geoSimplify.mjs";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/city-boundaries.geojson");

const PRIMARY_SOURCE_URL = "https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg";
const FEATURE_SERVER_URL =
  "https://webgis.dot.state.mn.us/65agsf1/rest/services/sdw_govnt/CITY_TOWNSHIP_UNORG_TERR/FeatureServer/0/query";
const QUERY_URL =
  `${FEATURE_SERVER_URL}?where=CTU_CLASS%3D%27CITY%27&outFields=FEATURE_NAME,COUNTY_NAME,COUNTY_CODE,GNIS_FEATURE_ID,POPULATION&f=geojson`;

// Exact text from the dataset's own metadata (Use Constraints) — quoted
// verbatim, not paraphrased, per AGENTS.md §3.3's licence-recording rule.
const LICENCE_TEXT =
  "In obtaining this data from MnDOT and MnGeo, it is understood that you and/or your organization have the right to use it for any purpose. This dataset is best suited for general reference only — it is not suitable for precise land measurements or ground surveys.";

// Sanity floor — 906 CTU_CLASS='CITY' features confirmed live at time of
// writing; well below that means the upstream schema or filter changed out
// from under this script rather than Minnesota having lost cities. Fail
// loudly (same guard style as fetch-places.mjs's county/city count
// checks) rather than silently shipping a truncated file.
const MIN_EXPECTED_CITIES = 800;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  console.log("[fetch-city-boundaries] fetching MnDOT/MnGeo city boundaries...");
  const geojson = await fetchJson(QUERY_URL);
  const rawFeatures = geojson.features ?? [];

  if (rawFeatures.length < MIN_EXPECTED_CITIES) {
    throw new Error(
      `Expected at least ${MIN_EXPECTED_CITIES} MN city boundary features, got ${rawFeatures.length} — upstream schema or filter may have changed.`,
    );
  }

  const features = rawFeatures.map((feature) => {
    const props = feature.properties ?? {};
    // POPULATION comes back as an empty string/undefined for a small
    // number of features in the upstream service — null, never fabricated
    // as 0, per AGENTS.md §3.1.
    const rawPopulation = props.POPULATION;
    const population = rawPopulation === null || rawPopulation === undefined || rawPopulation === "" ? null : Number(rawPopulation);
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        name: props.FEATURE_NAME ?? null,
        county: props.COUNTY_NAME ?? null,
        population: population !== null && Number.isFinite(population) ? population : null,
        gnisId: props.GNIS_FEATURE_ID ?? null,
      },
    };
  });

  const featureCollection = { type: "FeatureCollection", features };

  // Ingest-time geometry simplification — see scripts/lib/geoSimplify.mjs.
  // A statewide backdrop layer, viewed both zoomed out (whole state) and
  // zoomed in (single city) — see that file's cityBoundaries tolerance
  // comment.
  const simplified = simplifyAndRound(featureCollection, {
    tolerance: SIMPLIFY_TOLERANCE.cityBoundaries,
    label: "city-boundaries",
  });

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      sourceAgency: "Minnesota Department of Transportation / MnGeo",
      documentType: "City, Township, and Unorganized Territory in Minnesota",
      primarySourceUrl: PRIMARY_SOURCE_URL,
      licence: LICENCE_TEXT,
    },
    type: simplified.type,
    features: simplified.features,
  };

  const written = JSON.stringify(output);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, written);
  await updateDataManifest(path.basename(OUTPUT_PATH), written);
  console.log(`[done] wrote ${simplified.features.length} city boundary feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
