#!/usr/bin/env node
// scripts/fetch-places.mjs
//
// Builds public/mn-places.json — the name of every incorporated city and
// every county in Minnesota. This is what lets SearchBar (see
// src/components/SearchBar.tsx) auto-populate suggestions for *any* MN
// city or county, not just the handful this app has ward/commissioner
// data for (src/lib/cities.ts's much smaller CITIES/COUNTIES). Typing an
// uncovered name (e.g. "Duluth") still resolves honestly — see
// addressSearch.ts's "uncovered-place" ParsedQuery and "not-covered"
// SearchOutcome — never silently, per AGENTS.md §3.3 Coverage Honesty.
// This file is only what lets the search bar *recognize* the name at all,
// instead of it falling through to "we didn't understand that."
//
// Source: the U.S. Census Bureau's Gazetteer Files — free, public domain,
// no API key, bulk download, same class of source fetch-addresses.mjs
// already uses and preferred over a keyed API per AGENTS.md §0.8/§3.2.
// Minnesota's roster of cities and counties changes only on incorporation
// (rare) or, for counties, essentially never (Minnesota has held 87
// counties since 1922) — this only needs a rerun when that happens, no
// cron required.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iter } from "but-unzip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/mn-places.json");

const GAZETTEER_YEAR = "2024";
const PLACES_URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${GAZETTEER_YEAR}_Gazetteer/${GAZETTEER_YEAR}_Gaz_place_national.zip`;
const COUNTIES_URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${GAZETTEER_YEAR}_Gazetteer/${GAZETTEER_YEAR}_Gaz_counties_national.zip`;
const PRIMARY_SOURCE_URL = "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html";

// Census's own LSAD code for "city" in the Places gazetteer — the only
// designation Minnesota's incorporated municipalities carry (unlike most
// states, Minnesota has no separate "town" or "village" class; townships
// are a distinct kind of minor civil division and are *not* Census
// "places" at all, so no extra filtering is needed to exclude them).
const CITY_LSAD = "25";

async function fetchZip(url) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1 (github.com/mn-civic-watch)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  // Belt-and-suspenders: confirm we actually got zip bytes (PK magic
  // number) rather than an error page slipping through as a 200.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(`Response for ${url} doesn't look like a zip file (got ${buffer.length} byte(s))`);
  }
  return buffer;
}

// Each Gazetteer zip holds exactly one fixed-width, tab-separated .txt
// file — grab whichever single entry is in there rather than hardcoding
// its name (Census renames these per release year).
async function readSoleEntry(zipBytes, url) {
  const entries = [...iter(zipBytes)];
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one file inside ${url}, found ${entries.length}`);
  }
  const bytes = await entries[0].read();
  return new TextDecoder("utf-8").decode(bytes);
}

// Parses a Gazetteer file's tab-separated rows into objects keyed by its
// header row — columns are fixed-width padded with trailing spaces, so
// every field gets trimmed.
function parseRows(text) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? "").trim()]));
  });
}

async function main() {
  console.log("[fetch-places] downloading Census Gazetteer places file...");
  const placesText = await readSoleEntry(await fetchZip(PLACES_URL), PLACES_URL);
  console.log("[fetch-places] downloading Census Gazetteer counties file...");
  const countiesText = await readSoleEntry(await fetchZip(COUNTIES_URL), COUNTIES_URL);

  const placeRows = parseRows(placesText).filter((r) => r.USPS === "MN" && r.LSAD === CITY_LSAD);
  const countyRows = parseRows(countiesText).filter((r) => r.USPS === "MN");

  // Strip Census's own " city"/" County" suffix so these match the
  // no-suffix style src/lib/cities.ts's CITIES/COUNTIES already use
  // (SearchBar appends "County" back on for display where it needs to).
  const cities = [...new Set(placeRows.map((r) => r.NAME.replace(/ city$/, "")))].sort();
  const counties = [...new Set(countyRows.map((r) => r.NAME.replace(/ County$/, "")))].sort();

  // Sanity checks against well-known, extremely stable facts — fail
  // loudly rather than silently shipping a truncated or empty list if
  // Census ever changes this file's shape out from under us. Minnesota's
  // county count hasn't changed since 1922, so that one's an exact match;
  // its city count grows slowly via incorporation, so that's a floor.
  if (counties.length !== 87) {
    throw new Error(`Expected exactly 87 MN counties, got ${counties.length} — Census file shape may have changed.`);
  }
  if (cities.length < 800) {
    throw new Error(`Expected at least 800 MN cities, got ${cities.length} — Census file shape may have changed.`);
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      sourceAgency: "U.S. Census Bureau",
      documentType: `${GAZETTEER_YEAR} Gazetteer Files`,
      primarySourceUrl: PRIMARY_SOURCE_URL,
      placesUrl: PLACES_URL,
      countiesUrl: COUNTIES_URL,
      licence: "U.S. Government Work — public domain",
    },
    counties,
    cities,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`[done] wrote ${cities.length} cit(y/ies) and ${counties.length} count(y/ies) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fetch-places] failed:", err);
  process.exitCode = 1;
});
