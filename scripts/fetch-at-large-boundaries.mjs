#!/usr/bin/env node
// scripts/fetch-at-large-boundaries.mjs
//
// Writes public/at-large-boundaries.geojson — one polygon per city whose
// council is elected entirely at-large (citywide), not by ward. These
// cities have no entry in wards.geojson at all (there's no ward to draw),
// so WardMap fills this city-outline polygon with the city's own accent
// color instead, and places every at-large official's pin (mayors.geojson)
// inside it, fanned out from the shared City Hall coordinate the same way
// a multi-member ward's pins already fan out — see WardMap.tsx's
// groupFeaturesByCity and the generalized wardPinConnectorLines.
//
// Confirm at-large status against the city's own site before adding an
// entry here — don't assume "no ward GIS layer found" means at-large;
// it might just mean the source hasn't been found yet (see issue #65).

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/at-large-boundaries.geojson");

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// --- Woodbury (Washington County) ------------------------------------------
//
// Washington County's own "Municipalities" open-data layer — exterior
// boundary per minor civil division, county-maintained (not simplified for
// web display; 848 coordinate pairs for Woodbury alone, small enough not to
// need the simplification pass issue #67 tracks for the much larger
// district layers). MUNI_NAME is uppercase in the source; not the value
// this app displays anywhere, so no casing fix needed.
const WOODBURY_BOUNDARY_URL =
  "https://services1.arcgis.com/3fjYPqJf7qalQMlb/arcgis/rest/services/Municipalities/FeatureServer/0/query?where=MUNI_NAME%3D%27WOODBURY%27&outFields=MUNI_NAME&f=geojson";

// One entry per at-large city — { city, url } — so adding the next one
// (per issue #65, several of the remaining 7 are likely also at-large) is
// a data addition here, not a code change below.
const AT_LARGE_CITIES = [{ city: "Woodbury", url: WOODBURY_BOUNDARY_URL }];

async function main() {
  const features = [];
  for (const { city, url } of AT_LARGE_CITIES) {
    console.log(`[at-large-boundaries] fetching ${city}...`);
    const geojson = await fetchJson(url);
    if (!geojson.features || geojson.features.length !== 1) {
      throw new Error(`[at-large-boundaries] expected exactly 1 boundary feature for ${city}, got ${geojson.features?.length ?? 0}`);
    }
    features.push({
      type: "Feature",
      geometry: geojson.features[0].geometry,
      // Deliberately minimal — this is a backdrop/click-target polygon,
      // not an office record. Officials live in mayors.geojson, joined at
      // render/resolution time purely by this same `city` name (see
      // src/lib/officials.ts's resolveOfficialsAtPoint).
      properties: { city },
    });
  }

  const featureCollection = { type: "FeatureCollection", features };
  const output = JSON.stringify(featureCollection);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  await updateDataManifest(path.basename(OUTPUT_PATH), output);
  console.log(`[done] wrote ${featureCollection.features.length} at-large city boundary feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
