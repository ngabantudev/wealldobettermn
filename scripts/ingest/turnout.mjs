#!/usr/bin/env node
// scripts/ingest/turnout.mjs
//
// civic-participation-turnout, PR A: 2024 general election, city-level
// only. Pure data pipeline — no UI, no map, no new page (see FEATURES.md).
//
// Dependency-free Node, same convention as every other scripts/*.mjs in
// this repo: built-in fetch + node:fs/node:zlib only, no npm dependency
// added for zip, dbf, or CSV parsing (see readZipEntry()/parseDbf()/
// splitCsvLine() below — the same "write the small parser instead of
// adding a dependency" choice mn-campaign-finance.mjs makes for CSV).
//
// --- What this fetches, and why these two sources ------------------------
//
// 1. MN Secretary of State 2024 general election precinct-level results,
//    fetched from the Minnesota Geospatial Commons (a state open-data
//    mirror), not from sos.mn.gov directly. That's not a style choice —
//    sos.mn.gov (and its electionresults.sos.mn.gov subdomain) sits behind
//    Radware Bot Manager, which returns an HTTP 302 to a JavaScript
//    validation challenge for every plain HTTP client, confirmed 2026-08-12
//    against multiple sos.mn.gov paths including direct /media/*.xlsx
//    asset URLs (302/502 from a cold curl and from Node's fetch with a
//    descriptive User-Agent, no cookie, no referrer). AGENTS.md §2.2 is
//    explicit that this script must not attempt to solve that challenge or
//    spoof a browser to get past it ("no block evasion") — a source that
//    cannot be fetched politely gets a documented gap and a manual/
//    alternate route, not a workaround.
//
//    The Minnesota Geospatial Commons (gisdata.mn.gov, files served from
//    resources.gisdata.mn.gov) publishes the identical underlying data:
//    "Minnesota General Election Results, 2022-2030"
//    (https://gisdata.mn.gov/dataset/bdry-electionresults-2022-2030),
//    originated by the Office of the Minnesota Secretary of State itself
//    (see metadata "Originator" field), combining voting-precinct
//    boundaries with official results certified by the State and County
//    Canvassing Boards. This is still a Tier 1 SOS primary record per
//    AGENTS.md §3.3 — it is the same certified data, mirrored on a
//    different, unprotected state file server — not a downgrade to a
//    secondary source. Confirmed live 2026-08-12: a plain `curl`/Node
//    fetch against resources.gisdata.mn.gov returns HTTP 200 with no bot
//    challenge.
//
//    The file itself is a zipped shapefile (geometry + a .dbf attribute
//    table). This script only reads the .dbf (a simple, fully-documented
//    fixed-width binary table format — see parseDbf() below) and discards
//    the geometry; PR A has no map surface, so there is nothing to draw.
//
// 2. US Census Bureau Citizen Voting Age Population (CVAP) 2019-2023 ACS
//    5-year special tabulation, Place geography, bulk CSV
//    (https://www.census.gov/data/datasets/2023/dec/rdo/2019-2023-CVAP.html).
//    Keyless, no api.census.gov registration needed — a bulk file, per
//    AGENTS.md §0.8's "prefer bulk files over the keyed API."
//
// --- The join -------------------------------------------------------------
//
// AGENTS.md's own sourcing discipline (echoed in this feature's brief):
// "precinct NAME is not a safe join key, only ID." The SOS precinct file's
// MCDFIPS field (the city's Census-standard place FIPS code, e.g. "58000"
// for St. Paul) is exactly the CVAP file's own join key: a CVAP Place row's
// geoid is literally `1600000US27` + a 5-digit place FIPS. Confirmed
// 2026-08-12 by direct inspection: St. Paul's SOS MCDFIPS ("58000") matches
// CVAP geoid 1600000US2758000 exactly, same for Minneapolis ("43000") and
// Coon Rapids ("13114"). This is a stronger join than the reference-table
// approach originally scoped — the FIPS code ships on the precinct file
// itself, so no separate "Voting Precincts" name-matched reference table is
// needed to resolve a precinct's city. See buildCityRecords() for the two
// cases this join can't resolve cleanly (ambiguous multi-FIPS city, no CVAP
// match at all) and how each is flagged rather than guessed.
//
// --- Not wired into `npm run data:all` ------------------------------------
//
// Same caution as mn-campaign-finance.mjs's own header: this script pulls
// two multi-megabyte upstream archives (a ~13MB shapefile zip, a ~55MB
// CVAP zip) on every run and isn't yet proven safe to run unattended in a
// build. Run it explicitly via `npm run data:turnout`.

import { writeFile, mkdir } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  MIN_REGISTERED_THRESHOLD,
  TURNOUT_OF_REGISTERED_DENOMINATOR,
  isBelowRegisteredThreshold,
} from "../../src/lib/turnoutConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirname, "../../public/turnout");
const CITY_DIR = path.join(OUTPUT_DIR, "city");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots/turnout");

const USER_AGENT =
  "wealldobettermn-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pipeline)";

const SELF_TEST = process.argv.includes("--self-test");

// --- Source URLs, verified live 2026-08-12 --------------------------------

const SOS_PRECINCT_RESULTS_ZIP_URL =
  "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/shp_bdry_electionresults_2022_2030.zip";
const SOS_PRECINCT_RESULTS_DBF_ENTRY = "general_election_results_by_precinct_2024.dbf";
const SOS_METADATA_URL =
  "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/metadata/metadata.html";
const SOS_DATASET_LANDING_URL = "https://gisdata.mn.gov/dataset/bdry-electionresults-2022-2030";

const CVAP_ZIP_URL =
  "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2023/2023-cvap/CVAP_2019-2023_ACS_csv_files.zip";
const CVAP_CSV_ENTRY = "Place.csv";
const CVAP_DATASET_LANDING_URL = "https://www.census.gov/data/datasets/2023/dec/rdo/2019-2023-CVAP.html";

// The SOS's own certified statewide total for the 2024 general election
// ("results are as of December 2, 2024, incorporating all recounts" —
// metadata "Currentness Reference"), independently confirmed by summing
// TOTVOTING across all 4,103 precinct rows (every CTU_TYPE — city,
// township, and unorganized territory — not just the city rows this PR
// publishes) in the real downloaded file on 2026-08-12: the sum was
// exactly 3,272,414, matching both this figure and the Secretary of
// State's own publicly reported 2024 general-election turnout figure.
// assertStatewideReconciliation() re-checks this on every run — see its
// own comment for why an exact match is required rather than a tolerance.
const KNOWN_STATEWIDE_BALLOTS_CAST_2024 = 3_272_414;
const KNOWN_STATEWIDE_BALLOTS_CAST_SOURCE_URL =
  "https://www.sos.mn.gov/elections-voting/election-results/2024/2024-general-election-results/2024-election-statistics/";

// --- Minimal dependency-free ZIP reader ------------------------------------
//
// Both upstream files are ordinary, non-encrypted, non-zip64 archives (well
// under the 4GB/65535-entry limits that format needs zip64 for) — confirmed
// by inspecting both downloads directly. This reader only supports exactly
// what those files use (stored or DEFLATE entries, standard ZIP local/
// central-directory records) and is not a general-purpose zip library; it
// exists so this script doesn't add an npm dependency just to pull one
// named entry out of a known-shape archive.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/**
 * Extracts one named entry's decompressed bytes from a ZIP archive buffer.
 * @param {Buffer} zipBuffer
 * @param {string} entryName
 * @returns {Buffer}
 */
function readZipEntry(zipBuffer, entryName) {
  // The End Of Central Directory record is a fixed 22 bytes plus a
  // variable-length comment (at most 65535 bytes) — search backward from
  // the end for its signature rather than assuming zero comment length.
  let eocdOffset = -1;
  const searchFloor = Math.max(0, zipBuffer.length - 22 - 65535);
  for (let i = zipBuffer.length - 22; i >= searchFloor; i--) {
    if (zipBuffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("[turnout] not a valid zip file: End Of Central Directory record not found");
  }

  const centralDirEntryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let offset = centralDirOffset;
  for (let i = 0; i < centralDirEntryCount; i++) {
    if (zipBuffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`[turnout] malformed zip central directory entry at offset ${offset}`);
    }
    const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    if (name === entryName) {
      return extractLocalEntry(zipBuffer, localHeaderOffset, compressionMethod, compressedSize);
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`[turnout] entry "${entryName}" not found in zip archive`);
}

function extractLocalEntry(zipBuffer, localHeaderOffset, compressionMethod, compressedSize) {
  if (zipBuffer.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`[turnout] malformed zip local file header at offset ${localHeaderOffset}`);
  }
  const fileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return Buffer.from(compressed); // stored, no compression
  if (compressionMethod === 8) return inflateRawSync(compressed); // DEFLATE
  throw new Error(`[turnout] unsupported zip compression method ${compressionMethod}`);
}

// --- Minimal dependency-free DBF (dBASE table) reader ----------------------
//
// The .dbf half of a shapefile is a plain, fully-documented fixed-width
// binary table: a 32-byte header, a field-descriptor array (32 bytes each,
// terminated by 0x0D), then one fixed-length record per row (a 1-byte
// deletion flag followed by each field's fixed-width ASCII text). No
// geometry is touched — the paired .shp file is never fetched.

/**
 * @param {Buffer} buffer
 * @returns {Record<string, string>[]}
 */
function parseDbf(buffer) {
  const numRecords = buffer.readUInt32LE(4);
  const headerSize = buffer.readUInt16LE(8);
  const recordSize = buffer.readUInt16LE(10);

  const fields = [];
  let fieldOffset = 32;
  while (buffer[fieldOffset] !== 0x0d) {
    const rawName = buffer.toString("ascii", fieldOffset, fieldOffset + 11);
    const name = rawName.slice(0, rawName.indexOf("\0") === -1 ? undefined : rawName.indexOf("\0"));
    const length = buffer[fieldOffset + 16];
    fields.push({ name, length });
    fieldOffset += 32;
  }

  const records = [];
  let recordOffset = headerSize;
  for (let i = 0; i < numRecords; i++) {
    const isDeleted = buffer[recordOffset] === 0x2a; // '*'
    let fieldPos = recordOffset + 1;
    const row = {};
    for (const field of fields) {
      row[field.name] = buffer.toString("ascii", fieldPos, fieldPos + field.length).trim();
      fieldPos += field.length;
    }
    if (!isDeleted) records.push(row);
    recordOffset += recordSize;
  }
  return records;
}

// --- Minimal CSV line splitter ----------------------------------------------
//
// Same RFC-4180-ish approach as mn-campaign-finance.mjs's splitCsvLine():
// handles double-quoted fields containing commas (the CVAP file's geoname
// column, e.g. `"St. Anthony city (Hennepin and Ramsey Counties), Minnesota"`)
// and escaped `""` quotes. Duplicated here rather than imported from that
// script, matching this repo's convention of self-contained ingest scripts.
function splitCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Parses the CVAP Place.csv into a map keyed by 5-digit MN place FIPS code
 * (the last 5 digits of the file's own `1600000US27#####` geoid), Total row
 * (lnnumber "1") only — the per-race/ethnicity breakdown rows in this file
 * are not needed for a citywide turnout-of-CVAP figure.
 *
 * Decoded as latin1, not utf8: the real file contains non-ASCII bytes in
 * place names elsewhere in the country (confirmed 2026-08-12 — a strict
 * utf8 decode throws on at least one byte in the full national file) and
 * latin1 decoding never throws regardless of byte value, which is all this
 * function needs since every MN row of interest is ASCII.
 * @param {Buffer} buffer
 * @returns {Map<string, { cvapEst: number, cvapMoe: number, geoname: string }>}
 */
function parseCvapPlaceRows(buffer) {
  const raw = buffer.toString("latin1");
  const lines = raw.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return new Map();

  const header = splitCsvLine(lines[0]);
  const col = (name) => {
    const idx = header.indexOf(name);
    if (idx === -1) {
      throw new Error(
        `[turnout] expected CVAP column "${name}" not found. Upstream schema may have changed — ` +
          `re-verify against a fresh download before trusting this parse.`,
      );
    }
    return idx;
  };
  const idx = {
    geoname: col("geoname"),
    geoid: col("geoid"),
    lnnumber: col("lnnumber"),
    cvap_est: col("cvap_est"),
    cvap_moe: col("cvap_moe"),
  };

  const byFips = new Map();
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const geoid = fields[idx.geoid];
    if (!geoid || !geoid.startsWith("1600000US27")) continue; // MN places only
    if (fields[idx.lnnumber] !== "1") continue; // "Total" line only
    const fips = geoid.slice(-5);
    const cvapEst = Number(fields[idx.cvap_est]);
    const cvapMoe = Number(fields[idx.cvap_moe]);
    if (!Number.isFinite(cvapEst) || !Number.isFinite(cvapMoe)) continue; // malformed row — skip, never guess
    byFips.set(fips, { cvapEst, cvapMoe, geoname: fields[idx.geoname] });
  }
  return byFips;
}

/**
 * @typedef {Object} PrecinctRow
 * @property {string} vtdid
 * @property {string} cityName - SOS MCDNAME
 * @property {string} mcdFips - SOS MCDFIPS (Census place FIPS, no state prefix)
 * @property {string} countyName
 * @property {string} ctuType - "city" | "township" | "unorganized territory"
 * @property {boolean} mailOnly - MAILBALLOT === "YES"
 * @property {number} ballotsCast - TOTVOTING
 * @property {number} registeredAt7am - REG7AM
 * @property {number} electionDayRegistrations - EDR
 */

/**
 * @param {Record<string, string>[]} dbfRows
 * @returns {PrecinctRow[]}
 */
function normalizePrecinctRows(dbfRows) {
  return dbfRows.map((row) => {
    const ballotsCast = Number.parseFloat(row.TOTVOTING);
    const registeredAt7am = Number.parseFloat(row.REG7AM);
    const electionDayRegistrations = Number.parseFloat(row.EDR);
    if (!Number.isFinite(ballotsCast) || !Number.isFinite(registeredAt7am) || !Number.isFinite(electionDayRegistrations)) {
      throw new Error(
        `[turnout] precinct ${row.VTDID || "(unknown VTDID)"} has a non-numeric voting-statistic field. ` +
          `Upstream schema may have changed — refusing to guess a value.`,
      );
    }
    return {
      vtdid: row.VTDID,
      cityName: row.MCDNAME,
      mcdFips: row.MCDFIPS,
      countyName: row.COUNTYNAME,
      ctuType: row.CTU_TYPE,
      mailOnly: row.MAILBALLOT === "YES",
      ballotsCast,
      registeredAt7am,
      electionDayRegistrations,
    };
  });
}

// --- Fetch + snapshot -------------------------------------------------------

async function fetchAndSnapshot(url, snapshotFilename) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`[turnout] HTTP ${res.status} ${res.statusText} for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(path.join(SNAPSHOT_DIR, snapshotFilename), buffer);
  return buffer;
}

async function fetchPrecinctRows() {
  const zipBuffer = await fetchAndSnapshot(SOS_PRECINCT_RESULTS_ZIP_URL, "shp_bdry_electionresults_2022_2030.zip");
  const dbfBuffer = readZipEntry(zipBuffer, SOS_PRECINCT_RESULTS_DBF_ENTRY);
  const contentHash = createHash("sha256").update(dbfBuffer).digest("hex");
  return { rows: normalizePrecinctRows(parseDbf(dbfBuffer)), contentHash };
}

async function fetchCvapByFips() {
  const zipBuffer = await fetchAndSnapshot(CVAP_ZIP_URL, "CVAP_2019-2023_ACS_csv_files.zip");
  const csvBuffer = readZipEntry(zipBuffer, CVAP_CSV_ENTRY);
  const contentHash = createHash("sha256").update(csvBuffer).digest("hex");
  return { byFips: parseCvapPlaceRows(csvBuffer), contentHash };
}

// --- Join / aggregate --------------------------------------------------------

/**
 * Deterministic filename-safe slug for a city name — this feature's
 * `cityId`. No existing city-slug convention was found elsewhere in this
 * repo (src/lib/cities.ts stores plain display names, no ids) — this
 * establishes one, following the same lowercase/hyphen-separated shape
 * scripts/ingest/legistar.mjs's slugify() already uses for office titles.
 * @param {string} name
 * @returns {string}
 */
export function slugifyCityName(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Joins precinct-level rows into one record per incorporated city
 * (CTU_TYPE === "city"; townships and unorganized territory are out of
 * scope for this PR per FEATURES.md — county-level aggregation, which
 * would need them, is a follow-up). Never drops a city silently: every
 * incorporated city in the source data gets a record, with
 * turnoutOfCVAP/cvapSource/cvapMarginOfError left null and a knownGaps
 * entry when the CVAP join can't be resolved, per AGENTS.md §3.3 ("if a
 * precinct's city field is ambiguous or missing, flag it rather than
 * guessing").
 *
 * Grouped by MCDFIPS, not by city NAME — confirmed live in the real 2024
 * data that this distinction matters: Minnesota has two entirely
 * different, unrelated cities both named "St. Anthony" (one in Hennepin/
 * Ramsey counties, FIPS 56680; a separate one in Stearns County, FIPS
 * 56698). Grouping by name alone silently merges their precincts into one
 * false combined record — exactly the "precinct NAME is not a safe join
 * key" risk this feature's brief calls out, and it applies to grouping
 * precincts into cities, not just to the CVAP join. Grouping by FIPS
 * instead was verified against the full real dataset to produce zero FIPS
 * groups with an inconsistent city name (i.e., FIPS is a clean 1:1 key for
 * "true city" in this data), so the two St. Anthonys correctly become two
 * separate records with disambiguated cityIds — see slug collision
 * handling below.
 * @param {PrecinctRow[]} precinctRows
 * @param {Map<string, { cvapEst: number, cvapMoe: number, geoname: string }>} cvapByFips
 * @returns {{ records: object[], knownGaps: string[] }}
 */
export function buildCityRecords(precinctRows, cvapByFips) {
  /** @type {Map<string, { cityName: string, precincts: PrecinctRow[], countySet: Set<string> }>} */
  const byFips = new Map();
  for (const row of precinctRows) {
    if (row.ctuType !== "city") continue;
    if (!byFips.has(row.mcdFips)) {
      byFips.set(row.mcdFips, { cityName: row.cityName, precincts: [], countySet: new Set() });
    }
    const bucket = byFips.get(row.mcdFips);
    bucket.precincts.push(row);
    bucket.countySet.add(row.countyName);
  }

  const knownGaps = [];
  const records = [];

  // Sorted (by city name, then FIPS as a tiebreaker for name collisions
  // like the two St. Anthonys) iteration keeps output deterministic/
  // re-runnable per AGENTS.md §2.2, and keeps slug-collision suffix
  // assignment below stable across runs.
  const fipsCodes = Array.from(byFips.keys()).sort((a, b) => {
    const nameCompare = byFips.get(a).cityName.localeCompare(byFips.get(b).cityName);
    return nameCompare !== 0 ? nameCompare : a.localeCompare(b);
  });

  const usedSlugs = new Set();

  for (const fips of fipsCodes) {
    const bucket = byFips.get(fips);
    const cityName = bucket.cityName;
    const ballotsCast = bucket.precincts.reduce((sum, p) => sum + p.ballotsCast, 0);
    const registeredAt7am = bucket.precincts.reduce((sum, p) => sum + p.registeredAt7am, 0);
    const electionDayRegistrations = bucket.precincts.reduce((sum, p) => sum + p.electionDayRegistrations, 0);
    const mailOnlyPrecincts = bucket.precincts.filter((p) => p.mailOnly).length;

    const registeredTotal = registeredAt7am + electionDayRegistrations;
    const turnoutOfRegistered = registeredTotal > 0 ? ballotsCast / registeredTotal : null;
    const belowThreshold = isBelowRegisteredThreshold(registeredAt7am, electionDayRegistrations);

    let turnoutOfCVAP = null;
    let cvapSource = null;
    let cvapMarginOfError = null;

    const cvap = cvapByFips.get(fips);
    if (cvap) {
      turnoutOfCVAP = cvap.cvapEst > 0 ? ballotsCast / cvap.cvapEst : null;
      cvapSource = CVAP_DATASET_LANDING_URL;
      cvapMarginOfError = cvap.cvapMoe;
    } else {
      knownGaps.push(
        `${cityName} (MCDFIPS ${fips}): no matching Census CVAP Place record found — turnoutOfCVAP is null for this city. ` +
          `Possible causes: recent incorporation not yet reflected in the 2019-2023 ACS 5-year vintage, or a place-name/ ` +
          `FIPS mismatch between SOS and Census that needs manual review.`,
      );
    }

    // Deterministic slug collision handling — same numeric-suffix approach
    // scripts/ingest/mn-campaign-finance.mjs's slugifyCommitteeName() uses
    // for committee-name collisions. Needed live for the two St. Anthonys:
    // the second one encountered in sorted order gets "st-anthony-2".
    const baseSlug = slugifyCityName(cityName);
    let cityId = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(cityId)) {
      cityId = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(cityId);

    records.push({
      cityId,
      cityName,
      counties: Array.from(bucket.countySet).sort((a, b) => a.localeCompare(b)),
      precincts: bucket.precincts.length,
      mailOnlyPrecincts,
      ballotsCast,
      registeredAt7am,
      electionDayRegistrations,
      turnoutOfRegistered,
      turnoutOfCVAP,
      cvapSource,
      cvapMarginOfError,
      belowThreshold,
      sourceUrl: SOS_METADATA_URL,
      fetchedAt: null, // filled in by main() with the actual run's fetchedAt
    });
  }

  return { records, knownGaps };
}

/**
 * The final guard before any write. Sums TOTVOTING/ballotsCast across
 * EVERY precinct row (all CTU_TYPEs — city, township, unorganized
 * territory — not just the city rows this PR publishes) and requires an
 * EXACT match against the SOS's own certified statewide figure, per
 * AGENTS.md §2.2's "final assertion before writing output that guards
 * against known bad states."
 *
 * Exact match, not a tolerance band: this dataset is a single official
 * canvassed snapshot (metadata: "results are as of December 2, 2024,
 * incorporating all recounts"), not a live/rolling feed where small
 * transient discrepancies are expected. Any difference at all means
 * either the upstream file changed shape/content in a way this script's
 * column mapping no longer matches, or a row was dropped/double-counted
 * by a bug here — both are "refuse to write output and investigate"
 * conditions, not "close enough."
 * @param {PrecinctRow[]} allPrecinctRows
 */
function assertStatewideReconciliation(allPrecinctRows) {
  const total = allPrecinctRows.reduce((sum, row) => sum + row.ballotsCast, 0);
  assert.equal(
    total,
    KNOWN_STATEWIDE_BALLOTS_CAST_2024,
    `[turnout] statewide reconciliation failed: summed ballotsCast across all ${allPrecinctRows.length} precinct ` +
      `rows is ${total}, expected exactly ${KNOWN_STATEWIDE_BALLOTS_CAST_2024} (the Secretary of State's own ` +
      `certified 2024 general-election statewide total, ${KNOWN_STATEWIDE_BALLOTS_CAST_SOURCE_URL}). Refusing to ` +
      `write output — this usually means the upstream file's shape changed or a row was mis-parsed.`,
  );
}

const KNOWN_GAPS_STATIC = [
  "County-level aggregation is not built yet — this is a city-level-only PR; see FEATURES.md.",
  "Only the 2024 general election is covered so far — other years are a follow-up PR.",
  "Townships and unorganized territory are excluded from this dataset entirely (not just uncounted toward a city) " +
    "— they have no city-level record to attach to, per this PR's city-level-only scope.",
  "CVAP figures are drawn from the 2019-2023 ACS 5-year special tabulation, the most recent vintage available at " +
    "ingest time — CVAP is always a modeled 5-year-average estimate with a margin of error (see cvapMarginOfError " +
    "per city), never an exact census-day count, and can lag recent incorporations or rapid growth.",
  "turnoutOfCVAP denominator is citywide CVAP; turnoutOfRegistered denominator is " +
    `${TURNOUT_OF_REGISTERED_DENOMINATOR} — see src/lib/turnoutConfig.mjs for why these differ and are not ` +
    "interchangeable.",
];

async function main() {
  const fetchedAt = new Date().toISOString();

  const [{ rows: allPrecinctRows, contentHash: sosContentHash }, { byFips: cvapByFips, contentHash: cvapContentHash }] =
    await Promise.all([fetchPrecinctRows(), fetchCvapByFips()]);

  assertStatewideReconciliation(allPrecinctRows);

  const { records, knownGaps: runtimeGaps } = buildCityRecords(allPrecinctRows, cvapByFips);
  for (const record of records) record.fetchedAt = fetchedAt;

  const knownGaps = [...KNOWN_GAPS_STATIC, ...runtimeGaps];

  await mkdir(CITY_DIR, { recursive: true });

  const cityFile = {
    schemaVersion: 1,
    year: "2024",
    generatedAt: fetchedAt,
    provenance: {
      sos: {
        primarySourceUrl: SOS_PRECINCT_RESULTS_ZIP_URL,
        landingPageUrl: SOS_DATASET_LANDING_URL,
        sourceAgency: "Office of the Minnesota Secretary of State",
        documentType: "precinct-level general election results (shapefile attribute table)",
        documentId: SOS_PRECINCT_RESULTS_DBF_ENTRY,
        issuedDate: "2024-12-02",
        fetchedAt,
        licence: "Public data; Minnesota Geospatial Commons — no separate licence terms found beyond standard public-record status.",
        contentHash: sosContentHash,
      },
      cvap: {
        primarySourceUrl: CVAP_ZIP_URL,
        landingPageUrl: CVAP_DATASET_LANDING_URL,
        sourceAgency: "US Census Bureau",
        documentType: "CVAP special tabulation bulk CSV (Place geography)",
        documentId: CVAP_CSV_ENTRY,
        issuedDate: null,
        fetchedAt,
        licence: "US Government Work — public domain.",
        contentHash: cvapContentHash,
      },
    },
    denominatorMethodology: {
      turnoutOfRegistered: TURNOUT_OF_REGISTERED_DENOMINATOR,
      turnoutOfCVAP: "citizen voting-age population (CVAP), 2019-2023 ACS 5-year estimate, citywide",
      minRegisteredThreshold: MIN_REGISTERED_THRESHOLD,
    },
    knownGaps,
    cities: records,
  };

  await writeFile(path.join(CITY_DIR, "2024.json"), JSON.stringify(cityFile));

  const manifest = {
    schemaVersion: 1,
    years: [
      {
        year: "2024",
        electionType: "general",
        dataPath: "/turnout/city/2024.json",
      },
    ],
    denominatorMethodologyNote:
      "\"Turnout of registered\" divides ballots cast by everyone registered to vote by the time polls closed " +
      "(pre-registered voters plus same-day registrants). \"Turnout of CVAP\" divides ballots cast by the " +
      "citywide citizen voting-age population, a Census Bureau 5-year survey estimate with its own margin of " +
      "error — it is not an exact count, and is null for a handful of cities the join could not resolve (see " +
      "knownGaps in /turnout/city/2024.json).",
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

  const withCvap = records.filter((r) => r.turnoutOfCVAP !== null).length;
  const belowThresholdCount = records.filter((r) => r.belowThreshold).length;
  console.log(
    `[done] ${records.length} city record(s) written to ${path.join(CITY_DIR, "2024.json")} ` +
      `(${withCvap} with a real turnoutOfCVAP, ${records.length - withCvap} null/flagged; ` +
      `${belowThresholdCount} below the ${MIN_REGISTERED_THRESHOLD}-registered-voter noise threshold); ` +
      `manifest written to ${MANIFEST_PATH}; ${runtimeGaps.length} runtime knownGaps entr(y/ies) recorded.`,
  );
}

// --- Self-test --------------------------------------------------------------
//
// Same pattern as scripts/fetch-state-legislature.mjs --self-test and
// scripts/ingest/state-bills.mjs --self-test: exercises the pure join/
// reconciliation logic against a small hand-built fixture, no network call.
// Every fixture row is synthetic and never touches public/ — see AGENTS.md
// §3.1's three-part rule for any script self-test fixture.
async function selfTest() {
  const fixturePrecinctRows = [
    // Two precincts of one ordinary city — clean CVAP match expected.
    {
      vtdid: "270000001",
      cityName: "Testville",
      mcdFips: "11111",
      countyName: "Test County",
      ctuType: "city",
      mailOnly: false,
      ballotsCast: 300,
      registeredAt7am: 350,
      electionDayRegistrations: 20,
    },
    {
      vtdid: "270000002",
      cityName: "Testville",
      mcdFips: "11111",
      countyName: "Test County",
      ctuType: "city",
      mailOnly: true,
      ballotsCast: 100,
      registeredAt7am: 120,
      electionDayRegistrations: 5,
    },
    // A tiny city, below MIN_REGISTERED_THRESHOLD.
    {
      vtdid: "270000003",
      cityName: "Smallburg",
      mcdFips: "22222",
      countyName: "Test County",
      ctuType: "city",
      mailOnly: false,
      ballotsCast: 8,
      registeredAt7am: 9,
      electionDayRegistrations: 1,
    },
    // A city with no CVAP match at all.
    {
      vtdid: "270000004",
      cityName: "Unmatched City",
      mcdFips: "33333",
      countyName: "Test County",
      ctuType: "city",
      mailOnly: false,
      ballotsCast: 50,
      registeredAt7am: 60,
      electionDayRegistrations: 2,
    },
    // Two DIFFERENT cities that happen to share a name (the real
    // St. Anthony/St. Anthony case) — same cityName, different MCDFIPS.
    // Must become two separate records with disambiguated cityIds, never
    // one merged/ambiguous record.
    {
      vtdid: "270000005",
      cityName: "Twinsburg",
      mcdFips: "44444",
      countyName: "Test County",
      ctuType: "city",
      mailOnly: false,
      ballotsCast: 40,
      registeredAt7am: 45,
      electionDayRegistrations: 1,
    },
    {
      vtdid: "270000006",
      cityName: "Twinsburg",
      mcdFips: "44445",
      countyName: "Other Test County",
      ctuType: "city",
      mailOnly: false,
      ballotsCast: 10,
      registeredAt7am: 12,
      electionDayRegistrations: 0,
    },
    // A township — must never appear in city output.
    {
      vtdid: "270000007",
      cityName: "Test Township",
      mcdFips: "55555",
      countyName: "Test County",
      ctuType: "township",
      mailOnly: false,
      ballotsCast: 15,
      registeredAt7am: 20,
      electionDayRegistrations: 0,
    },
  ];

  const fixtureCvapByFips = new Map([["11111", { cvapEst: 1000, cvapMoe: 50, geoname: "Testville city, Test State" }]]);

  console.log("[self-test] running assertStatewideReconciliation against a deliberately wrong total (must throw)...");
  try {
    assertStatewideReconciliation(fixturePrecinctRows);
    throw new Error("[self-test] assertStatewideReconciliation did not reject a mismatched total.");
  } catch (err) {
    if (!err.message.includes("statewide reconciliation failed")) throw err;
  }

  const { records, knownGaps } = buildCityRecords(fixturePrecinctRows, fixtureCvapByFips);

  assert.equal(records.length, 5, "[self-test] expected 5 city records (townships excluded, two Twinsburgs kept separate)");
  assert.ok(
    !records.some((r) => r.cityName === "Test Township"),
    "[self-test] a township leaked into city output",
  );

  const testville = records.find((r) => r.cityName === "Testville");
  assert.equal(testville.precincts, 2);
  assert.equal(testville.mailOnlyPrecincts, 1);
  assert.equal(testville.ballotsCast, 400);
  assert.equal(testville.turnoutOfCVAP, 400 / 1000);
  assert.equal(testville.belowThreshold, false);

  const smallburg = records.find((r) => r.cityName === "Smallburg");
  assert.equal(smallburg.belowThreshold, true);
  assert.equal(smallburg.turnoutOfCVAP, null, "[self-test] Smallburg has no CVAP fixture row and must ship null");

  const unmatched = records.find((r) => r.cityName === "Unmatched City");
  assert.equal(unmatched.turnoutOfCVAP, null);
  assert.ok(knownGaps.some((g) => g.includes("Unmatched City")));

  // Two different cities sharing a name must never merge into one record
  // (the real St. Anthony/St. Anthony case) — grouping is by MCDFIPS, not
  // by name, so both survive as distinct records with disambiguated ids.
  const twinsburgs = records.filter((r) => r.cityName === "Twinsburg");
  assert.equal(twinsburgs.length, 2, "[self-test] two same-named, different-FIPS cities must produce two records, not one merged record");
  const twinsburgIds = twinsburgs.map((r) => r.cityId).sort();
  assert.deepEqual(twinsburgIds, ["twinsburg", "twinsburg-2"], "[self-test] the second same-name city must get a disambiguated cityId");
  assert.equal(
    twinsburgs.reduce((sum, r) => sum + r.ballotsCast, 0),
    50,
    "[self-test] the two Twinsburgs' ballot counts must never be summed together",
  );

  console.log(`[self-test] PASS — ${records.length} city record(s) built, ${knownGaps.length} knownGaps entries`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (SELF_TEST) {
    selfTest().catch((err) => {
      console.error("[self-test fatal]", err.message);
      process.exit(1);
    });
  } else {
    main().catch((err) => {
      console.error("[fatal]", err.message);
      process.exit(1);
    });
  }
}
