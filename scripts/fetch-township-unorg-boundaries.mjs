#!/usr/bin/env node
// scripts/fetch-township-unorg-boundaries.mjs
//
// Writes public/township-unorg-boundaries.geojson — the corporate/legal
// boundary of every Minnesota township and unorganized territory area,
// statewide (~1,837 features as of this writing). Sibling to
// scripts/fetch-city-boundaries.mjs (same source, same conventions),
// covering exactly the CTU_CLASS values that script deliberately
// excludes: "TOWNSHIP" and "UNORGANIZED TERRITORY".
//
// Why this exists: the civic-participation-turnout choropleth (city-level
// only, per src/lib/turnoutJoin.ts and public/turnout/city/2024.json's
// knownGaps) has no per-city turnout figure to show for land outside an
// incorporated city — that's not a data gap to paper over silently, it's
// a real fact about Minnesota's government structure. A township or
// unorganized-territory resident has no city government at all; county
// and state layers are what apply to them. WardMap.tsx renders this
// layer as a distinct neutral/hatched class in "participation" mode with
// the label "no city government here — county and state layers apply"
// rather than leaving that land blank or silently folding it into the
// city choropleth's own scale.
//
// Source: MnDOT/MnGeo's "City, Township, and Unorganized Territory in
// Minnesota" — Tier 1, government primary, published weekly. Same
// FeatureServer as fetch-city-boundaries.mjs, different CTU_CLASS filter.
// Landing page: https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg
//
// CTU_CLASS values confirmed live against the FeatureServer at time of
// writing (returnDistinctValues=true query): "CITY", "TOWNSHIP",
// "UNORGANIZED TERRITORY", and null. This script selects everything
// that is NOT "CITY" and NOT null — i.e. CTU_CLASS IN ('TOWNSHIP',
// 'UNORGANIZED TERRITORY') — rather than a blanket "<> 'CITY'", so a
// small number of null-CTU_CLASS rows in the upstream service (an
// upstream data-quality artifact, not a third governance category) don't
// silently end up in this layer as unlabeled polygons.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simplifyAndRound, SIMPLIFY_TOLERANCE } from "./lib/geoSimplify.mjs";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/township-unorg-boundaries.geojson");

const PRIMARY_SOURCE_URL = "https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg";
const FEATURE_SERVER_URL =
  "https://webgis.dot.state.mn.us/65agsf1/rest/services/sdw_govnt/CITY_TOWNSHIP_UNORG_TERR/FeatureServer/0/query";
const WHERE_CLAUSE = "CTU_CLASS IN ('TOWNSHIP', 'UNORGANIZED TERRITORY')";
const QUERY_URL =
  `${FEATURE_SERVER_URL}?where=${encodeURIComponent(WHERE_CLAUSE)}` +
  `&outFields=FEATURE_NAME,COUNTY_NAME,COUNTY_CODE,GNIS_FEATURE_ID,POPULATION,CTU_CLASS&f=geojson`;

// Same licence text as fetch-city-boundaries.mjs — same dataset, quoted
// verbatim from the dataset's own metadata (Use Constraints) per
// AGENTS.md §3.3.
const LICENCE_TEXT =
  "In obtaining this data from MnDOT and MnGeo, it is understood that you and/or your organization have the right to use it for any purpose. This dataset is best suited for general reference only — it is not suitable for precise land measurements or ground surveys.";

// Sanity floor — 1,837 features (1,775 townships + 62 unorganized
// territory areas) confirmed live via a returnCountOnly query at time of
// writing. Well below that means the upstream schema or filter changed
// out from under this script rather than Minnesota having lost
// townships. Fail loudly, same guard style as fetch-city-boundaries.mjs.
const MIN_EXPECTED_FEATURES = 1600;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1 (contact: steveyang.dev@proton.me)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  console.log("[fetch-township-unorg-boundaries] fetching MnDOT/MnGeo township/unorganized-territory boundaries...");
  const geojson = await fetchJson(QUERY_URL);
  const rawFeatures = geojson.features ?? [];

  if (rawFeatures.length < MIN_EXPECTED_FEATURES) {
    throw new Error(
      `Expected at least ${MIN_EXPECTED_FEATURES} MN township/unorganized-territory features, got ${rawFeatures.length} — upstream schema or filter may have changed.`,
    );
  }

  const features = rawFeatures.map((feature) => {
    const props = feature.properties ?? {};
    const rawPopulation = props.POPULATION;
    const population =
      rawPopulation === null || rawPopulation === undefined || rawPopulation === "" ? null : Number(rawPopulation);
    const ctuClass = props.CTU_CLASS ?? null;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        name: props.FEATURE_NAME ?? null,
        county: props.COUNTY_NAME ?? null,
        population: population !== null && Number.isFinite(population) ? population : null,
        gnisId: props.GNIS_FEATURE_ID ?? null,
        // "TOWNSHIP" or "UNORGANIZED TERRITORY" — kept on every feature
        // (unlike city-boundaries.geojson, which has only one class) so a
        // future UI could distinguish them if it ever wants to; the
        // current WardMap.tsx "participation" mode legend treats both the
        // same ("no city government here").
        ctuClass,
      },
    };
  });

  const featureCollection = { type: "FeatureCollection", features };

  // Ingest-time geometry simplification — see scripts/lib/geoSimplify.mjs.
  // Reuses the cityBoundaries tolerance: same statewide backdrop use case
  // (viewed both zoomed way out and zoomed in on one township), same
  // FeatureServer, same coordinate precision needs.
  const simplified = simplifyAndRound(featureCollection, {
    tolerance: SIMPLIFY_TOLERANCE.cityBoundaries,
    label: "township-unorg-boundaries",
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
  console.log(`[done] wrote ${simplified.features.length} township/unorganized-territory feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
