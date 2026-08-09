#!/usr/bin/env node
// scripts/build-county-cities.mjs
//
// Writes src/lib/countyCities.generated.ts — the county → covered-cities
// crosswalk the area-filter sidebar groups cities by. Not a new fetch: it
// reads the already-fetched public/city-boundaries.geojson (MnDOT/MnGeo's
// CTU FeatureServer — Tier 1, licence already recorded by
// scripts/fetch-city-boundaries.mjs) and joins it against src/lib/cities.ts's
// CITIES, purely offline. Deterministic and re-runnable (AGENTS.md §2.2):
// same CITIES + same city-boundaries.geojson bytes in, byte-identical
// output out — no timestamps, no fetch, no network of its own.
//
// This is a *build artifact*, not a published civic dataset: it ships
// under src/lib/, never public/, and downstream sites (§2.4) never see it.
//
// Run via `npm run data:county-cities`, after `npm run data:city-boundaries`
// in the data:all chain (this script only reads that file, never fetches
// it itself).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, COUNTIES } from "../src/lib/cities.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOUNDARIES_PATH = path.join(__dirname, "../public/city-boundaries.geojson");
const OUTPUT_PATH = path.join(__dirname, "../src/lib/countyCities.generated.ts");

const REFETCH_HINT = "Run `npm run data:city-boundaries` first.";

// Sanity floor mirroring fetch-city-boundaries.mjs's own MIN_EXPECTED_CITIES
// — a file well below this count is corrupt/truncated ("stale" in the sense
// that matters here), not a real statewide CTU snapshot.
const MIN_EXPECTED_FEATURES = 800;

// The CTU dataset spells city names out in full ("Saint Paul", "Saint
// Louis Park"); src/lib/cities.ts's CITIES uses the abbreviated "St."
// forms residents actually type. Fold both sides to a common form —
// same normalization shape as addressSearch.ts's own `fold()`, kept as a
// separate small copy here rather than a shared import: this script
// folds *dataset* names (always spelled "Saint"), addressSearch.ts folds
// arbitrary *user input* (which can spell it either way) — different
// enough inputs that a shared implementation would need its own set of
// caveats for each caller anyway.
function fold(name) {
  return name
    .toUpperCase()
    .replace(/\bSAINT\b/g, "ST")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

function buildCrosswalk(features) {
  // folded CTU name -> [{ name, county }] (a name can appear more than
  // once — see Blaine, which straddles Anoka and Ramsey County).
  const byFoldedName = new Map();
  for (const feature of features) {
    const props = feature.properties ?? {};
    if (!props.name || !props.county) continue;
    const key = fold(props.name);
    const list = byFoldedName.get(key) ?? [];
    list.push({ name: props.name, county: props.county });
    byFoldedName.set(key, list);
  }

  const countySet = new Set(COUNTIES);
  /** @type {Record<string, Set<string>>} */
  const countyCities = Object.fromEntries(COUNTIES.map((county) => [county, new Set()]));
  const unmatched = [];
  const uncoveredCounties = new Set();

  for (const city of CITIES) {
    const matches = byFoldedName.get(fold(city));
    if (!matches || matches.length === 0) {
      unmatched.push(city);
      continue;
    }
    for (const match of matches) {
      if (!countySet.has(match.county)) {
        // A covered city touches a county src/lib/cities.ts's COUNTIES
        // doesn't yet list — per the resolved scope decision, COUNTIES
        // only widens to counties that actually contain a covered city,
        // so this needs a human to add it there, not a silent drop.
        uncoveredCounties.add(`${city} → ${match.county}`);
        continue;
      }
      countyCities[match.county].add(city);
    }
  }

  if (unmatched.length > 0) {
    throw new Error(
      `No CTU (city-boundaries.geojson) match for ${unmatched.length} CITIES entr${unmatched.length === 1 ? "y" : "ies"}: ${unmatched.join(", ")}. ` +
        `Check spelling/normalization against the CTU dataset's own name for the city, or re-run \`npm run data:city-boundaries\` if it's simply out of date.`,
    );
  }
  if (uncoveredCounties.size > 0) {
    throw new Error(
      `Covered ${uncoveredCounties.size === 1 ? "city touches" : "cities touch"} a county not listed in src/lib/cities.ts's COUNTIES: ${[...uncoveredCounties].join(", ")}. ` +
        `Add the county to COUNTIES by hand before re-running this script.`,
    );
  }

  /** @type {Record<string, string[]>} */
  const sorted = {};
  for (const county of [...COUNTIES].sort((a, b) => a.localeCompare(b))) {
    sorted[county] = [...countyCities[county]].sort((a, b) => a.localeCompare(b));
  }
  return sorted;
}

function renderModule(countyCities) {
  const entries = Object.entries(countyCities)
    .map(([county, cities]) => `  ${JSON.stringify(county)}: [${cities.map((c) => JSON.stringify(c)).join(", ")}],`)
    .join("\n");

  return `// GENERATED — do not hand-edit, run \`npm run data:county-cities\`
//
// County → covered-cities crosswalk, built by scripts/build-county-cities.mjs
// from public/city-boundaries.geojson (MnDOT/MnGeo's CTU FeatureServer —
// Tier 1, licence recorded in scripts/fetch-city-boundaries.mjs) joined
// against src/lib/cities.ts's CITIES. See that script's own header comment
// for the join/normalization rules.
//
// A city that straddles more than one county (e.g. Blaine — Anoka and a
// small Ramsey County sliver) is listed under every county it touches:
// checking it in one county's group checks it everywhere, per AGENTS.md
// §2.5's "ambiguity is surfaced, never silently resolved."
//
// src/lib/cities.ts re-exports COUNTY_CITIES from here rather than
// hand-maintaining it.

import type { City, County } from "./cities.ts";

export const COUNTY_CITIES: Record<County, City[]> = {
${entries}
};
`;
}

async function main() {
  const features = await loadBoundaries();
  const countyCities = buildCrosswalk(features);
  const moduleSource = renderModule(countyCities);
  await writeFile(OUTPUT_PATH, moduleSource);
  const total = Object.values(countyCities).reduce((sum, cities) => sum + cities.length, 0);
  console.log(`[build-county-cities] wrote ${Object.keys(countyCities).length} counties, ${total} city memberships, to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
