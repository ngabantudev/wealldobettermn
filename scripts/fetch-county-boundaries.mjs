#!/usr/bin/env node
// scripts/fetch-county-boundaries.mjs
//
// Writes public/county-boundaries.geojson — the administrative boundary
// of every Minnesota county, all 87, statewide. Two consumers, per the
// AGENTS.md §2.6 county community-contribution build:
//   1. WardMap's own statewide backdrop layer under the County tier,
//      mirroring city-boundaries.geojson's role for cities (AGENTS.md
//      §0.1 "show the boundary, not nothing" / §3.3 Coverage Honesty) —
//      a resident outside this app's 11 covered counties still sees
//      their county's own outline, and can click it to reach the
//      community-contribution flow (flow 2 of the two entry points the
//      maintainer asked for: click the map layer directly, which opens
//      the same panel flow 1's "Add officials" button does).
//   2. scripts/build-county-anchor-points.mjs, which derives a real,
//      guaranteed-interior point per county for countyMatch.ts's
//      recognition check — the same two-step pattern
//      build-city-anchor-points.mjs already established for cities.
//
// Source, verified directly against the live service before writing this
// script (never assumed/copy-pasted from the city dataset's own — the two
// turned out to have different licence text despite sharing a publisher):
//   Landing page: https://gis.data.mn.gov/datasets/minnesota::minnesota-counties-1/about
//   Publisher: MnGeo (Minnesota Geospatial Information Office), via the
//   Commons' own automated publishing account — "developed... using
//   existing county boundary datasets from the Minnesota Department of
//   Transportation, Minnesota Department of Natural Resources,
//   Metropolitan Council, and International Boundary Commission."
//   Tier 1, government primary, part of the same Minnesota Geospatial
//   Commons family as city-boundaries.geojson's CTU source.
//
// FeatureServer field names (co_name/co_gnis/co_fips/co_code) confirmed
// live against the service's own schema endpoint, not guessed from the
// city dataset's differently-named fields (FEATURE_NAME/GNIS_FEATURE_ID
// there vs. co_name/co_gnis here — two different upstream schemas even
// though both are MnGeo-published).

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simplifyAndRound, SIMPLIFY_TOLERANCE } from "./lib/geoSimplify.mjs";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/county-boundaries.geojson");

const PRIMARY_SOURCE_URL = "https://gis.data.mn.gov/datasets/minnesota::minnesota-counties-1/about";
const FEATURE_SERVER_URL =
  "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/bdry_counties_minnesota/FeatureServer/0/query";
const QUERY_URL = `${FEATURE_SERVER_URL}?where=1%3D1&outFields=co_name,co_gnis,co_fips,co_code&f=geojson`;

// Exact "licenseInfo" text from the dataset's own ArcGIS item metadata
// (fetched and confirmed live, not paraphrased) — per AGENTS.md §3.3's
// licence-recording rule. Deliberately NOT the same text as
// fetch-city-boundaries.mjs's LICENCE_TEXT: that one includes an
// explicit "you... have the right to use it for any purpose" grant this
// dataset's own metadata does not state. Recorded honestly as the
// thinner text it actually is, not padded to match the city one.
const LICENCE_TEXT =
  "This dataset is best suited for general reference only. It is not suitable for precise land measurements or ground surveys.";

// 87 counties confirmed (Minnesota has had 87 counties since 1922); a
// safety margin below that, same reasoning as fetch-city-boundaries.mjs's
// MIN_EXPECTED_CITIES — well below 87 means the upstream service broke or
// changed shape, not that Minnesota lost counties.
const MIN_EXPECTED_COUNTIES = 80;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "wealldobettermn-etl/0.1 (contact: steveyang.dev@proton.me)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  console.log("[fetch-county-boundaries] fetching MnGeo county boundaries...");
  const geojson = await fetchJson(QUERY_URL);
  const rawFeatures = geojson.features ?? [];

  if (rawFeatures.length < MIN_EXPECTED_COUNTIES) {
    throw new Error(
      `Expected at least ${MIN_EXPECTED_COUNTIES} MN county boundary features, got ${rawFeatures.length} — upstream schema or filter may have changed.`,
    );
  }

  const features = rawFeatures.map((feature) => {
    const props = feature.properties ?? {};
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        name: props.co_name ?? null,
        gnisId: props.co_gnis ?? null,
        fipsCode: props.co_fips ?? null,
        countyCode: props.co_code ?? null,
      },
    };
  });

  const featureCollection = { type: "FeatureCollection", features };

  // Ingest-time geometry simplification — see scripts/lib/geoSimplify.mjs.
  // Same "statewide backdrop, viewed both zoomed way out and zoomed in on
  // one" reasoning as cityBoundaries.
  const simplified = simplifyAndRound(featureCollection, {
    tolerance: SIMPLIFY_TOLERANCE.countyBoundaries,
    label: "county-boundaries",
  });

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      sourceAgency: "Minnesota Geospatial Information Office (MnGeo)",
      documentType: "Minnesota Counties",
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
  console.log(`[done] wrote ${simplified.features.length} county boundary feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
