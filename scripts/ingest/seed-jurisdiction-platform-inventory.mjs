#!/usr/bin/env node
// scripts/ingest/seed-jurisdiction-platform-inventory.mjs
//
// FEATURES.md Phase 7, step 1: "inventory first — build a
// jurisdiction_platform table recording what system each of the 180
// metro cities runs; this is a research task, the right first
// deliverable, not an engineering task." This writes the honest starting
// state of that table: every metro city this app already maps
// (src/lib/cities.ts's CITIES), each recorded as `platform: "unknown"`,
// `probedAt: null` — "not yet determined," never a guessed value.
// scripts/ingest/probe-legistar.mjs is the only thing allowed to move a
// record off "unknown," and only for cities it actually gets a live hit
// for (AGENTS.md §3.3 Coverage Honesty).
//
// No .ts import here — same reason every other scripts/*.mjs file hand-
// mirrors cities.ts's list in a comment instead of importing it (plain
// Node ESM has no TypeScript loader in this repo). METRO_CITIES below
// must be kept in sync by hand with src/lib/cities.ts's CITIES; this
// covers only the ~10 cities this app currently has ward/roster data for
// — the ~180-city metro-wide inventory FEATURES.md Phase 7 describes is
// future work, extending this same seeded array.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../../public/jurisdiction-platform-inventory.json");

// Mirrors src/lib/cities.ts's CITIES exactly — update both together.
const METRO_CITIES = [
  "Minneapolis",
  "St. Paul",
  "Bloomington",
  "Plymouth",
  "Minnetonka",
  "St. Louis Park",
  "Richfield",
  "Blaine",
  "Brooklyn Park",
  "Coon Rapids",
];

// Mirrors src/lib/jurisdictionPlatform.ts's toJurisdictionId() — keep the
// two in sync. Duplicated rather than imported for the same TS/mjs
// boundary reason as METRO_CITIES above.
function toJurisdictionId(city) {
  const slug = city
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `ocd-division/country:us/state:mn/place:${slug}`;
}

async function main() {
  const jurisdictions = METRO_CITIES.map((city) => ({
    jurisdictionId: toJurisdictionId(city),
    city,
    platform: "unknown",
    probedAt: null,
    sourceUrl: null,
    coverageTier: "C",
  }));

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    jurisdictions,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`[done] seeded ${jurisdictions.length} jurisdiction(s) (all "unknown") to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[seed-jurisdiction-platform-inventory] failed:", err);
  process.exitCode = 1;
});
