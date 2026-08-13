#!/usr/bin/env node
// scripts/ingest/turnout.mjs
//
// civic-participation-turnout: city-level general-election turnout,
// 2012-2024. Pure data pipeline — no UI, no map, no new page (see
// FEATURES.md). Dependency-free Node, same convention as every other
// scripts/*.mjs in this repo: built-in fetch + node:fs/node:zlib only, no
// npm dependency added for zip, dbf, or CSV parsing (see
// readZipEntry()/parseDbf()/splitCsvLine() below — the same "write the
// small parser instead of adding a dependency" choice mn-campaign-finance.mjs
// makes for CSV).
//
// --- History -----------------------------------------------------------
//
// PR A (civic-participation-turnout, 2024 only) built the join, the
// reconciliation guard, and the CVAP enrichment against a single election
// year. This PR (the historical backfill) extends the same pipeline across
// every MN general election from 2012 through 2024 by parameterizing what
// PR A hard-coded: which SOS precinct-attribute DBF entry to read, which
// VTD-id field name that year's file uses, which CVAP vintage to join
// against, and what the year's own certified statewide ballots-cast total
// is. See YEAR_CONFIGS below — that table is the entire diff in "what does
// this pipeline know about each year."
//
// --- What this fetches, and why these two sources ------------------------
//
// 1. MN Secretary of State precinct-level general-election results,
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
//    resources.gisdata.mn.gov) publishes the identical underlying data as
//    two dataset groups that together cover every year this script uses:
//      - "Minnesota General Election Results, 2012-2020"
//        (https://gisdata.mn.gov/dataset/bdry-electionresults-2012-2020) —
//        one zipped shapefile containing five per-year DBF attribute
//        tables (2012, 2014, 2016, 2018, 2020).
//      - "Minnesota General Election Results, 2022-2030"
//        (https://gisdata.mn.gov/dataset/bdry-electionresults-2022-2030) —
//        used by PR A for 2024, and confirmed 2026-08-12 to also contain a
//        2022 DBF entry.
//    Both are Tier 1 SOS primary records per AGENTS.md §3.3 — each
//    dataset's own metadata lists the Office of the Minnesota Secretary of
//    State as the originator ("Currentness Reference: Date the most recent
//    election was canvassed by the State Canvassing Board"), combining
//    voting-precinct boundaries with official results certified by the
//    State and County Canvassing Boards. This is the same certified data,
//    mirrored on a different, unprotected state file server — not a
//    downgrade to a secondary source. Confirmed live 2026-08-12: a plain
//    curl/Node fetch against resources.gisdata.mn.gov returns HTTP 200 with
//    no bot challenge, for both zips.
//
//    Each zip's .dbf half (a simple, fully-documented fixed-width binary
//    table format — see parseDbf() below) is read; the paired .shp geometry
//    is never fetched. This script has no map surface.
//
// 2. US Census Bureau Citizen Voting Age Population (CVAP) special
//    tabulations, Place geography, bulk CSV — one vintage per election
//    year, the closest 5-year ACS special tabulation available to that
//    year (2008-2012 for the 2012 election, 2010-2014 for 2014, and so on
//    through 2019-2023 for 2024). Every vintage's dataset landing page and
//    exact zip URL is recorded per-year in YEAR_CONFIGS below; all were
//    confirmed live (HTTP 200, no auth) 2026-08-12. Keyless, no
//    api.census.gov registration needed — a bulk file, per AGENTS.md §0.8's
//    "prefer bulk files over the keyed API."
//
//    CVAP vintage is a genuine, unavoidable format-drift point across a
//    decade of files, not just a version bump: column headers are
//    UPPERCASE in the 2008-2012 through 2012-2016 vintages and lowercase
//    from 2014-2018 onward, and the geoid's place-level prefix is the
//    7-character "16000US" in vintages through 2014-2018 but the
//    9-character "1600000US" from 2016-2020 onward (confirmed 2026-08-12 by
//    downloading and inspecting the header row and a real Minnesota row
//    from all seven vintages this script uses). parseCvapPlaceRows() below
//    handles both without a per-year branch: header lookup is
//    case-insensitive, and the geoid is matched by its trailing 7 digits
//    (2-digit state FIPS + 5-digit place FIPS) rather than a hardcoded
//    prefix, since that suffix is identical across every vintage checked.
//
// --- The join -------------------------------------------------------------
//
// AGENTS.md's own sourcing discipline (echoed in this feature's brief):
// "precinct NAME is not a safe join key, only ID." The SOS precinct file's
// MCDFIPS field (the city's Census-standard place FIPS code, e.g. "58000"
// for St. Paul) is exactly the CVAP file's own join key: a CVAP Place row's
// geoid ends in `<state FIPS><place FIPS>`. Confirmed 2026-08-12 by direct
// inspection across every year this script covers: St. Paul's SOS MCDFIPS
// ("58000") matches CVAP geoid state 27 + "58000" in both the oldest
// (2008-2012) and newest (2019-2023) vintages, same for Minneapolis
// ("43000") and Coon Rapids ("13114"). This is a stronger join than the
// reference-table approach originally scoped — the FIPS code ships on the
// precinct file itself, so no separate "Voting Precincts" name-matched
// reference table is needed to resolve a precinct's city. See
// buildCityRecords() for the two cases this join can't resolve cleanly
// (ambiguous multi-FIPS city, no CVAP match at all) and how each is flagged
// rather than guessed, per year — a city's join is only ever resolved
// against that same year's own SOS-published MCDFIPS/MCDNAME, never forced
// onto a later or earlier year's city boundary.
//
// --- Format drift across years, handled per-year, not with one universal
// parser --------------------------------------------------------------
//
// Confirmed live 2026-08-12 by downloading and field-inspecting all seven
// years' DBF tables:
//   - The VTD-id field is named "VTD" in the 2012 file only; every other
//     year (2014 through 2024) names it "VTDID". normalizePrecinctRows()
//     takes the field name as a parameter (see YEAR_CONFIGS.vtdIdField)
//     rather than assuming one name.
//   - REG7AM, EDR (election-day registrations), and TOTVOTING are present,
//     with real non-null values, in every one of the seven years' DBF
//     tables — despite this feature's own brief anticipating that older
//     years might not break out election-day registration the same way.
//     That turned out not to be true for MN's real data: this script does
//     not need to ship a null electionDayRegistrations for any covered
//     year.
//   - The numeric fields' DBF type marker varies (fixed "N" integer in
//     some years, floating "F" in others, both stored as fixed-width ASCII
//     text either way) and MAILBALLOT's field width varies (3 to 254
//     characters) — neither affects parseDbf() or normalizePrecinctRows(),
//     which read by field name and trim/parseFloat the ASCII text
//     regardless of the DBF type marker or declared width.
//   - CTU_TYPE's "city" value is lowercase and consistent in every year
//     (some years add extra non-city values like "town"/"unorganized" not
//     present in others, but the city filter is unaffected).
//
// --- Not wired into `npm run data:all` ------------------------------------
//
// Same caution as mn-campaign-finance.mjs's own header: this script pulls
// several multi-megabyte upstream archives per year (a combined ~35MB SOS
// shapefile zip for 2012-2020, a ~14MB SOS shapefile zip for 2022/2024, and
// a CVAP zip per year ranging from roughly 14MB to 55MB) on every run and
// isn't yet proven safe to run unattended in a build. Run it explicitly via
// `npm run data:turnout`, or a single year via `npm run data:turnout --
// --year=2016`.

import { writeFile, mkdir, readdir } from "node:fs/promises";
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
import { splitCsvLine } from "./lib/csv.mjs";
import { slugify } from "./legistar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirname, "../../public/turnout");
const CITY_DIR = path.join(OUTPUT_DIR, "city");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots/turnout");

const USER_AGENT =
  "wealldobettermn-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pipeline)";

const SELF_TEST = process.argv.includes("--self-test");
const YEAR_ARG = process.argv.find((a) => a.startsWith("--year="));
const YEAR_FILTER = YEAR_ARG ? YEAR_ARG.slice("--year=".length) : null;

// --- MN Secretary of State precinct-results source zips, verified live
// 2026-08-12 --------------------------------------------------------------
//
// Two dataset groups on the Minnesota Geospatial Commons cover all seven
// years: one combined zip for 2012/2014/2016/2018/2020, and the same zip PR
// A already used for 2024, which also contains 2022. Fetched once per
// group (not once per year) — see getSosZipBuffer() in main().

const SOS_ZIP_GROUPS = {
  "2012-2020": {
    zipUrl:
      "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2012_2020/shp_bdry_electionresults_2012_2020.zip",
    metadataUrl:
      "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2012_2020/metadata/metadata.html",
    landingUrl: "https://gisdata.mn.gov/dataset/bdry-electionresults-2012-2020",
    snapshotFilename: "shp_bdry_electionresults_2012_2020.zip",
  },
  "2022-2030": {
    zipUrl:
      "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/shp_bdry_electionresults_2022_2030.zip",
    metadataUrl:
      "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/metadata/metadata.html",
    landingUrl: "https://gisdata.mn.gov/dataset/bdry-electionresults-2022-2030",
    snapshotFilename: "shp_bdry_electionresults_2022_2030.zip",
  },
};

const CVAP_CSV_ENTRY = "Place.csv";

// The Secretary of State's own certified statewide general-election
// ballots-cast totals, 1950-2024 ("Table 2 Minnesota State General Election
// Statistics... Other data from election results certified by State
// Canvassing Boards"), fetched directly from sos.mn.gov's own media host
// (confirmed 2026-08-12: unlike electionresults.sos.mn.gov, this asset path
// is NOT behind the Radware bot challenge — a plain curl/fetch returns
// HTTP 200). assertStatewideReconciliation() re-checks every configured
// year against this table on every run — see its own comment for why an
// exact match is required rather than a tolerance.
const KNOWN_STATEWIDE_BALLOTS_CAST_SOURCE_URL =
  "https://www.sos.mn.gov/media/gevnwetp/minnesota-election-statistics-1950-to-2024.pdf";

// --- Per-year configuration -------------------------------------------------
//
// This table is the entire "what does the pipeline know about each year"
// surface. Every value below was independently confirmed against the real
// downloaded files on 2026-08-12 — see the module header for how.
const YEAR_CONFIGS = [
  {
    year: "2012",
    sosZipGroup: "2012-2020",
    sosDbfEntry: "general_election_results_by_precinct_2012.dbf",
    vtdIdField: "VTD",
    sosIssuedDate: null, // the 2012-2020 zip's metadata only records a Currentness Reference for the file's own most recent (2020) content — no independently confirmed per-election canvass date for 2012 was found; left null rather than guessed, per AGENTS.md §3.3.
    knownStatewideBallotsCast: 2_950_780,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2012/2012-cvap/CVAP_2008-2012_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/data/datasets/2012/dec/rdo/2012-cvap.html",
    cvapVintageLabel: "2008-2012 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2008-2012_ACS_csv_files.zip",
  },
  {
    year: "2014",
    sosZipGroup: "2012-2020",
    sosDbfEntry: "general_election_results_by_precinct_2014.dbf",
    vtdIdField: "VTDID",
    sosIssuedDate: null,
    knownStatewideBallotsCast: 1_992_566,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2014/2014-cvap/CVAP_2010-2014_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/data/datasets/2014/dec/rdo/2014-cvap.html",
    cvapVintageLabel: "2010-2014 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2010-2014_ACS_csv_files.zip",
  },
  {
    year: "2016",
    sosZipGroup: "2012-2020",
    sosDbfEntry: "general_election_results_by_precinct_2016.dbf",
    vtdIdField: "VTDID",
    sosIssuedDate: null,
    knownStatewideBallotsCast: 2_968_281,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2016/2016-cvap/CVAP_2012-2016_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/data/datasets/2016/dec/rdo/2012-2016-CVAP.html",
    cvapVintageLabel: "2012-2016 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2012-2016_ACS_csv_files.zip",
  },
  {
    year: "2018",
    sosZipGroup: "2012-2020",
    sosDbfEntry: "general_election_results_by_precinct_2018.dbf",
    vtdIdField: "VTDID",
    sosIssuedDate: null,
    knownStatewideBallotsCast: 2_611_365,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2018/2018-cvap/CVAP_2014-2018_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2014-2018-CVAP.html",
    cvapVintageLabel: "2014-2018 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2014-2018_ACS_csv_files.zip",
  },
  {
    year: "2020",
    sosZipGroup: "2012-2020",
    sosDbfEntry: "general_election_results_by_precinct_2020.dbf",
    vtdIdField: "VTDID",
    // The 2012-2020 zip's own metadata "Time Period of Content Date" is
    // 12/11/2020 with "Currentness Reference: Date the most recent
    // election was canvassed by the State Canvassing Board" — 2020 is that
    // file's most recent covered election, so this date is a direct,
    // documented citation for 2020 specifically (unlike 2012-2018, which
    // share the same file but aren't the "most recent" it describes).
    sosIssuedDate: "2020-12-11",
    knownStatewideBallotsCast: 3_292_997,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2020/2020-cvap/CVAP_2016-2020_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2016-2020-CVAP.html",
    cvapVintageLabel: "2016-2020 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2016-2020_ACS_csv_files.zip",
  },
  {
    year: "2022",
    sosZipGroup: "2022-2030",
    sosDbfEntry: "general_election_results_by_precinct_2022.dbf",
    vtdIdField: "VTDID",
    // The 2022-2030 zip's "Time Period of Content Date" (11/21/2024)
    // reflects the file's most recent covered election (2024), not 2022 —
    // no independently confirmed 2022-specific canvass date was found, so
    // this is left null rather than guessed.
    sosIssuedDate: null,
    knownStatewideBallotsCast: 2_525_873,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2022/2022-cvap/CVAP_2018-2022_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2018-2022-CVAP.html",
    cvapVintageLabel: "2018-2022 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2018-2022_ACS_csv_files.zip",
  },
  {
    year: "2024",
    sosZipGroup: "2022-2030",
    sosDbfEntry: "general_election_results_by_precinct_2024.dbf",
    vtdIdField: "VTDID",
    // As PR A found: SOS's own separate "2024 Election Statistics" page
    // states results are as of December 2, 2024, incorporating all
    // recounts — more specific than the shared zip's own 11/21/2024
    // "Time Period of Content Date", so that page is preferred here.
    sosIssuedDate: "2024-12-02",
    knownStatewideBallotsCast: 3_272_414,
    cvapZipUrl:
      "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2023/2023-cvap/CVAP_2019-2023_ACS_csv_files.zip",
    cvapLandingUrl: "https://www.census.gov/data/datasets/2023/dec/rdo/2019-2023-CVAP.html",
    cvapVintageLabel: "2019-2023 ACS 5-year",
    cvapSnapshotFilename: "CVAP_2019-2023_ACS_csv_files.zip",
  },
];

// --- Minimal dependency-free ZIP reader ------------------------------------
//
// Every upstream file used here is an ordinary, non-encrypted, non-zip64
// archive (well under the 4GB/65535-entry limits that format needs zip64
// for) — confirmed by inspecting each download directly. This reader only
// supports exactly what those files use (stored or DEFLATE entries,
// standard ZIP local/central-directory records) and is not a
// general-purpose zip library; it exists so this script doesn't add an npm
// dependency just to pull named entries out of known-shape archives.

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
// splitCsvLine (handles double-quoted fields containing commas — the
// CVAP file's geoname column, e.g. `"St. Anthony city (Hennepin and
// Ramsey Counties), Minnesota"` — and escaped `""` quotes) now lives in
// scripts/ingest/lib/csv.mjs, shared with mn-campaign-finance.mjs, which
// independently arrived at the same implementation — see that file's own
// header for why the extraction happened.

/**
 * Parses a CVAP Place.csv into a map keyed by 5-digit MN place FIPS code,
 * Total row (lnnumber "1") only — the per-race/ethnicity breakdown rows in
 * this file are not needed for a citywide turnout-of-CVAP figure.
 *
 * Handles two confirmed points of format drift across the seven CVAP
 * vintages this script uses (see module header for how each was verified):
 *   - Column headers are UPPERCASE in the 2008-2012 through 2012-2016
 *     vintages and lowercase from 2014-2018 onward — header lookup here is
 *     case-insensitive so no per-vintage branch is needed.
 *   - The geoid's place-level prefix is the 7-character "16000US" through
 *     the 2014-2018 vintage and the 9-character "1600000US" from 2016-2020
 *     onward, but the trailing 7 digits (2-digit state FIPS + 5-digit place
 *     FIPS) are identical either way — matched by suffix, not a hardcoded
 *     prefix, for the same reason.
 *
 * Decoded as latin1, not utf8: the real file contains non-ASCII bytes in
 * place names elsewhere in the country (confirmed 2026-08-12 — a strict
 * utf8 decode throws on at least one byte in the full national file) and
 * latin1 decoding never throws regardless of byte value, which is all this
 * function needs since every MN row of interest is ASCII.
 * @param {Buffer} buffer
 * @returns {Map<string, { cvapEst: number, cvapMoe: number, geoname: string }>}
 */
export function parseCvapPlaceRows(buffer) {
  const raw = buffer.toString("latin1");
  const lines = raw.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return new Map();

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
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
    const match = geoid && geoid.match(/US(\d{7})$/);
    if (!match) continue; // not a place-geography row in the expected shape — skip, never guess
    const stateAndPlaceFips = match[1];
    if (stateAndPlaceFips.slice(0, 2) !== "27") continue; // MN places only
    if (fields[idx.lnnumber] !== "1") continue; // "Total" line only
    const fips = stateAndPlaceFips.slice(2);
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
 * @property {string} ctuType - "city" | "township" | "unorganized territory" | (a small number of other non-city values in some years)
 * @property {boolean} mailOnly - MAILBALLOT === "YES"
 * @property {number} ballotsCast - TOTVOTING
 * @property {number} registeredAt7am - REG7AM
 * @property {number} electionDayRegistrations - EDR
 */

/**
 * @param {Record<string, string>[]} dbfRows
 * @param {string} vtdIdField - the DBF field name this year's file uses for
 *   the precinct id ("VTD" in 2012, "VTDID" in every other year — see
 *   module header).
 * @returns {PrecinctRow[]}
 */
export function normalizePrecinctRows(dbfRows, vtdIdField) {
  return dbfRows.map((row) => {
    const ballotsCast = Number.parseFloat(row.TOTVOTING);
    const registeredAt7am = Number.parseFloat(row.REG7AM);
    const electionDayRegistrations = Number.parseFloat(row.EDR);
    if (!Number.isFinite(ballotsCast) || !Number.isFinite(registeredAt7am) || !Number.isFinite(electionDayRegistrations)) {
      throw new Error(
        `[turnout] precinct ${row[vtdIdField] || "(unknown precinct id)"} has a non-numeric voting-statistic field. ` +
          `Upstream schema may have changed — refusing to guess a value.`,
      );
    }
    return {
      vtdid: row[vtdIdField],
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 429 backoff, honoring Retry-After — same shape as
// scripts/ingest/legistar.mjs's legistarGet and scripts/ingest/
// state-bills.mjs's fetchJson (both cite that convention explicitly).
// This script pulls several multi-megabyte archives per run from
// gisdata.mn.gov/census.gov (up to ~55MB each per this file's own
// header); a transient rate-limit response previously aborted the whole
// ingest with no retry, forcing a full manual re-run.
async function fetchAndSnapshot(url, snapshotFilename, attempt = 1) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (res.status === 429 && attempt <= 5) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
    console.log(`[turnout] rate limited fetching ${url}, waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`);
    await sleep(delayMs);
    return fetchAndSnapshot(url, snapshotFilename, attempt + 1);
  }

  if (!res.ok) throw new Error(`[turnout] HTTP ${res.status} ${res.statusText} for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  // Snapshot, don't overwrite (AGENTS.md §2.2/§0.5) — same convention as
  // scripts/ingest/legistar.mjs's snapshotRaw() and scripts/ingest/
  // state-bills.mjs's dated snapshot filenames. Every run's raw download
  // gets its own timestamped file rather than clobbering the prior run's
  // snapshot; a correction the SOS or Census republishes under the same
  // upstream filename is now a diffable event, not a silent loss.
  const fetchedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const datedFilename = snapshotFilename.replace(/(\.[^.]+)$/, `-${fetchedAt}$1`);
  await writeFile(path.join(SNAPSHOT_DIR, datedFilename), buffer);
  return buffer;
}

// --- Join / aggregate --------------------------------------------------------

/**
 * Deterministic filename-safe slug for a city name — this feature's
 * `cityId`. No existing city-slug convention was found elsewhere in this
 * repo (src/lib/cities.ts stores plain display names, no ids) — this
 * establishes one, composed from scripts/ingest/legistar.mjs's own
 * slugify() (already used for office titles) plus an NFKD diacritic-
 * strip pass legistar.mjs's own callers never needed. Confirmed
 * byte-identical to the previous standalone implementation against
 * every real committed public/turnout/city/<year>.json cityName across
 * all 7 years (5,975 records, 0 mismatches) before making this change —
 * a real cityId is a published part of this feature's public data
 * contract (AGENTS.md §2.4), so this was verified, not assumed.
 * @param {string} name
 * @returns {string}
 */
export function slugifyCityName(name) {
  return slugify(String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "")); // strip combining diacritics after NFKD decomposition
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
 * handling below. This same MCDFIPS-based join is what keeps each year
 * independent of every other year's city boundaries: a given year's
 * records are built only from that year's own SOS-published FIPS/name
 * pairs, never forced onto an earlier or later year's roster.
 * @param {PrecinctRow[]} precinctRows
 * @param {Map<string, { cvapEst: number, cvapMoe: number, geoname: string }>} cvapByFips
 * @param {{ sosSourceUrl?: string, cvapSourceUrl?: string }} [options]
 * @returns {{ records: object[], knownGaps: string[] }}
 */
export function buildCityRecords(precinctRows, cvapByFips, options = {}) {
  const { sosSourceUrl = null, cvapSourceUrl = null } = options;

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
      cvapSource = cvapSourceUrl;
      cvapMarginOfError = cvap.cvapMoe;
    } else {
      knownGaps.push(
        `${cityName} (MCDFIPS ${fips}): no matching Census CVAP Place record found — turnoutOfCVAP is null for this city. ` +
          `Possible causes: recent incorporation not yet reflected in this year's CVAP vintage, a precinct/city ` +
          `boundary change (annexation, incorporation, or renumbering) between this election and the CVAP vintage's ` +
          `reference date, or a place-name/FIPS mismatch between SOS and Census that needs manual review.`,
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
      sourceUrl: sosSourceUrl,
      fetchedAt: null, // filled in by main() with the actual run's fetchedAt
    });
  }

  return { records, knownGaps };
}

/**
 * The final guard before any write, for one year. Sums TOTVOTING/
 * ballotsCast across EVERY precinct row (all CTU_TYPEs — city, township,
 * unorganized territory, and any other non-city value present that year —
 * not just the city rows this feature publishes) and requires an EXACT
 * match against that year's own SOS-certified statewide figure, per
 * AGENTS.md §2.2's "final assertion before writing output that guards
 * against known bad states."
 *
 * Exact match, not a tolerance band: each year's dataset is a single
 * official canvassed snapshot, not a live/rolling feed where small
 * transient discrepancies are expected. Any difference at all means either
 * the upstream file changed shape/content in a way this script's column
 * mapping no longer matches, or a row was dropped/double-counted by a bug
 * here — both are "refuse to write output for this year and investigate"
 * conditions, not "close enough." A failure here causes main() to skip and
 * log this one year rather than guess — it does not block any other
 * configured year from being written, per this PR's "getting fewer years
 * exactly right beats getting all years partially wrong."
 * @param {PrecinctRow[]} allPrecinctRows
 * @param {string} year
 * @param {number} expectedTotal
 */
export function assertStatewideReconciliation(allPrecinctRows, year, expectedTotal) {
  const total = allPrecinctRows.reduce((sum, row) => sum + row.ballotsCast, 0);
  assert.equal(
    total,
    expectedTotal,
    `[turnout] ${year} statewide reconciliation failed: summed ballotsCast across all ${allPrecinctRows.length} ` +
      `precinct rows is ${total}, expected exactly ${expectedTotal} (the Secretary of State's own certified ${year} ` +
      `general-election statewide total, ${KNOWN_STATEWIDE_BALLOTS_CAST_SOURCE_URL}). Refusing to write output for ` +
      `${year} — this usually means the upstream file's shape changed or a row was mis-parsed.`,
  );
}

const KNOWN_GAPS_STATIC = [
  "County-level aggregation is not built yet — this is a city-level-only feature; see FEATURES.md.",
  "Only the November general election is covered for any year — primaries, special elections, and off-year " +
    "municipal elections are a follow-up.",
  "Townships and unorganized territory are excluded from this dataset entirely (not just uncounted toward a city) " +
    "— they have no city-level record to attach to, per this feature's city-level-only scope.",
  "Each year's turnoutOfCVAP is joined against the closest available Census CVAP 5-year ACS special tabulation " +
    "vintage to that election (see provenance.cvap.vintage in each year's own city/<year>.json) — CVAP is always a " +
    "modeled 5-year-average estimate with a margin of error (see cvapMarginOfError per city), never an exact " +
    "census-day count, is not necessarily concurrent with the election year itself, and can lag recent " +
    "incorporations, annexations, or rapid growth.",
  "turnoutOfCVAP denominator is citywide CVAP; turnoutOfRegistered denominator is " +
    `${TURNOUT_OF_REGISTERED_DENOMINATOR} — see src/lib/turnoutConfig.mjs for why these differ and are not ` +
    "interchangeable.",
  "A city's precinct/boundary join (MCDFIPS/MCDNAME) is resolved independently for each year against that year's " +
    "own SOS-published data — a city that was annexed, split, incorporated, or renamed between two covered " +
    "election years may appear under a different FIPS code, a different name, or not at all in one year's file; " +
    "no attempt is made to force an older or newer year's boundary onto another year.",
];

async function processYear(config, fetchedAt, getSosZipBuffer) {
  const zipBuffer = await getSosZipBuffer(config.sosZipGroup);
  const dbfBuffer = readZipEntry(zipBuffer, config.sosDbfEntry);
  const sosContentHash = createHash("sha256").update(dbfBuffer).digest("hex");
  const allPrecinctRows = normalizePrecinctRows(parseDbf(dbfBuffer), config.vtdIdField);

  assertStatewideReconciliation(allPrecinctRows, config.year, config.knownStatewideBallotsCast);

  const cvapZipBuffer = await fetchAndSnapshot(config.cvapZipUrl, config.cvapSnapshotFilename);
  const cvapCsvBuffer = readZipEntry(cvapZipBuffer, CVAP_CSV_ENTRY);
  const cvapContentHash = createHash("sha256").update(cvapCsvBuffer).digest("hex");
  const cvapByFips = parseCvapPlaceRows(cvapCsvBuffer);

  const group = SOS_ZIP_GROUPS[config.sosZipGroup];
  const { records, knownGaps: runtimeGaps } = buildCityRecords(allPrecinctRows, cvapByFips, {
    sosSourceUrl: group.metadataUrl,
    cvapSourceUrl: config.cvapLandingUrl,
  });
  for (const record of records) record.fetchedAt = fetchedAt;

  const knownGaps = [...KNOWN_GAPS_STATIC, ...runtimeGaps];

  const cityFile = {
    schemaVersion: 1,
    year: config.year,
    generatedAt: fetchedAt,
    provenance: {
      sos: {
        primarySourceUrl: group.zipUrl,
        landingPageUrl: group.landingUrl,
        sourceAgency: "Office of the Minnesota Secretary of State",
        documentType: "precinct-level general election results (shapefile attribute table)",
        documentId: config.sosDbfEntry,
        issuedDate: config.sosIssuedDate,
        fetchedAt,
        licence:
          "Public data; Minnesota Geospatial Commons — no separate licence terms found beyond standard public-record status.",
        contentHash: sosContentHash,
      },
      cvap: {
        primarySourceUrl: config.cvapZipUrl,
        landingPageUrl: config.cvapLandingUrl,
        sourceAgency: "US Census Bureau",
        documentType: "CVAP special tabulation bulk CSV (Place geography)",
        documentId: CVAP_CSV_ENTRY,
        issuedDate: null,
        fetchedAt,
        licence: "US Government Work — public domain.",
        contentHash: cvapContentHash,
        vintage: config.cvapVintageLabel,
      },
      statewideReconciliation: {
        expectedBallotsCast: config.knownStatewideBallotsCast,
        sourceUrl: KNOWN_STATEWIDE_BALLOTS_CAST_SOURCE_URL,
      },
    },
    denominatorMethodology: {
      turnoutOfRegistered: TURNOUT_OF_REGISTERED_DENOMINATOR,
      turnoutOfCVAP: `citizen voting-age population (CVAP), ${config.cvapVintageLabel} estimate, citywide`,
      minRegisteredThreshold: MIN_REGISTERED_THRESHOLD,
    },
    knownGaps,
    cities: records,
  };

  await writeFile(path.join(CITY_DIR, `${config.year}.json`), JSON.stringify(cityFile));

  return {
    year: config.year,
    cityCount: records.length,
    withCvap: records.filter((r) => r.turnoutOfCVAP !== null).length,
    belowThresholdCount: records.filter((r) => r.belowThreshold).length,
    runtimeGapsCount: runtimeGaps.length,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();

  const yearsToRun = YEAR_FILTER ? YEAR_CONFIGS.filter((c) => c.year === YEAR_FILTER) : YEAR_CONFIGS;
  if (YEAR_FILTER && yearsToRun.length === 0) {
    throw new Error(
      `[turnout] --year=${YEAR_FILTER} is not a configured election year. Configured years: ` +
        `${YEAR_CONFIGS.map((c) => c.year).join(", ")}.`,
    );
  }

  // SOS zip groups are fetched once and shared across every year in that
  // group (2012/2014/2016/2018/2020 share one zip; 2022/2024 share
  // another) — memoized by group key so a full run doesn't download either
  // zip more than once, and concurrent years in the same group await the
  // same in-flight fetch rather than racing two separate requests.
  const zipBufferPromises = new Map();
  const getSosZipBuffer = (groupKey) => {
    if (!zipBufferPromises.has(groupKey)) {
      const group = SOS_ZIP_GROUPS[groupKey];
      zipBufferPromises.set(groupKey, fetchAndSnapshot(group.zipUrl, group.snapshotFilename));
    }
    return zipBufferPromises.get(groupKey);
  };

  await mkdir(CITY_DIR, { recursive: true });

  // Years are processed sequentially, not in parallel — this run touches
  // several multi-year SOS zips plus a distinct multi-megabyte CVAP zip per
  // year (up to ~55MB each); sequential fetching is the more good-citizen
  // choice per AGENTS.md §2.2 and keeps per-year failures cleanly isolated
  // and readable in the console log, rather than interleaved.
  const succeeded = [];
  const skipped = [];
  for (const config of yearsToRun) {
    console.log(`[turnout] processing ${config.year}...`);
    try {
      const summary = await processYear(config, fetchedAt, getSosZipBuffer);
      succeeded.push(summary);
      console.log(
        `[done] ${config.year}: ${summary.cityCount} city record(s) (${summary.withCvap} with a real ` +
          `turnoutOfCVAP, ${summary.cityCount - summary.withCvap} null/flagged; ${summary.belowThresholdCount} ` +
          `below the ${MIN_REGISTERED_THRESHOLD}-registered-voter noise threshold; ${summary.runtimeGapsCount} ` +
          `runtime knownGaps entr(y/ies)).`,
      );
    } catch (err) {
      console.error(`[skip] ${config.year}: ${err.message}`);
      skipped.push({ year: config.year, reason: err.message });
    }
  }

  // The manifest reflects whatever year files actually exist on disk after
  // this run — not just the years this particular invocation processed —
  // so a filtered `--year=2016` rerun never wipes out other years' already
  // -written entries, and a partial/failed run never lists a year with no
  // backing file.
  const cityDirEntries = await readdir(CITY_DIR);
  const yearsOnDisk = cityDirEntries
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .sort();

  const manifest = {
    schemaVersion: 1,
    years: yearsOnDisk.map((year) => ({
      year,
      electionType: "general",
      dataPath: `/turnout/city/${year}.json`,
    })),
    // Plain-language rewrite (aimed at a 6th-grade reading level, per
    // AGENTS.md §0.9) — this is the one denominator explanation the
    // legend and record list actually show a reader, so it carries the
    // "not exact / some cities missing" caveats in words a resident
    // doesn't need a civics background to follow. The precise technical
    // trail (which Census vintage, which city's join failed and why)
    // still lives in provenance.cvap.vintage and knownGaps in each
    // year's own city file and in SOURCES.md — this note just tells a
    // reader those exist, not how to look them up.
    //
    // Three paragraphs, joined with a blank line (\n\n) rather than
    // shipped as separate array entries — this keeps the field's type a
    // plain string (no schemaVersion bump; a downstream consumer that
    // already treats this as opaque prose per §2.4's published contract
    // sees the same shape, just with paragraph breaks in it now).
    // ParticipationLegend.tsx splits on \n\n to render each as its own
    // <p> and bolds the literal words "Registered"/"CVAP" — see that
    // component's own comment for why the bolding lives in presentation,
    // not baked into this string as markup.
    denominatorMethodologyNote:
      "\"Registered\" represents how many people voted compared to how many people were signed up to vote — " +
      "including anyone who signed up right at their polling place, which Minnesota allows.\n\n" +
      "\"CVAP\" represents how many people voted compared to an estimate of how many adult U.S. citizens live " +
      "in that city. That estimate comes from a U.S. Census Bureau survey, not an exact count, so it has a " +
      "small margin of error.\n\n" +
      "For a few cities each year, we don't have this estimate at all — instead of guessing, we leave it blank.",
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

  console.log(
    `[turnout] run complete: ${succeeded.length}/${yearsToRun.length} configured year(s) written ` +
      `(${succeeded.map((s) => s.year).join(", ") || "none"}); ${skipped.length} skipped ` +
      `(${skipped.map((s) => s.year).join(", ") || "none"}); manifest now lists ${yearsOnDisk.length} year(s) ` +
      `on disk (${yearsOnDisk.join(", ")}).`,
  );

  if (skipped.length > 0) {
    console.log("[turnout] skip reasons:");
    for (const s of skipped) console.log(`  - ${s.year}: ${s.reason}`);
  }
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
    assertStatewideReconciliation(fixturePrecinctRows, "2099", 999999);
    throw new Error("[self-test] assertStatewideReconciliation did not reject a mismatched total.");
  } catch (err) {
    if (!err.message.includes("statewide reconciliation failed")) throw err;
  }

  console.log("[self-test] running assertStatewideReconciliation against the fixture's real total (must not throw)...");
  const fixtureTotal = fixturePrecinctRows.reduce((sum, r) => sum + r.ballotsCast, 0);
  assertStatewideReconciliation(fixturePrecinctRows, "2099", fixtureTotal);

  const { records, knownGaps } = buildCityRecords(fixturePrecinctRows, fixtureCvapByFips, {
    sosSourceUrl: "https://example.invalid/sos",
    cvapSourceUrl: "https://example.invalid/cvap",
  });

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
  assert.equal(testville.sourceUrl, "https://example.invalid/sos", "[self-test] sourceUrl must come from the passed-in options, not a hardcoded constant");
  assert.equal(testville.cvapSource, "https://example.invalid/cvap");

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

  // normalizePrecinctRows must read the precinct-id field by whatever name
  // that year's file uses (VTD in 2012, VTDID everywhere else) — the
  // one concrete per-year format-drift case that isn't otherwise exercised
  // by buildCityRecords, which only ever sees already-normalized rows.
  console.log("[self-test] checking normalizePrecinctRows reads a configurable VTD-id field name...");
  const dbfLikeRowVtd = { VTD: "270000009", MCDNAME: "Fieldtown", MCDFIPS: "66666", COUNTYNAME: "Test County", CTU_TYPE: "city", MAILBALLOT: "", TOTVOTING: "10", REG7AM: "12", EDR: "1" };
  const normalizedVtd = normalizePrecinctRows([dbfLikeRowVtd], "VTD");
  assert.equal(normalizedVtd[0].vtdid, "270000009", "[self-test] normalizePrecinctRows must read the field named by its vtdIdField argument (2012's \"VTD\")");
  const dbfLikeRowVtdId = { VTDID: "270000010", MCDNAME: "Fieldtown", MCDFIPS: "66666", COUNTYNAME: "Test County", CTU_TYPE: "city", MAILBALLOT: "", TOTVOTING: "10", REG7AM: "12", EDR: "1" };
  const normalizedVtdId = normalizePrecinctRows([dbfLikeRowVtdId], "VTDID");
  assert.equal(normalizedVtdId[0].vtdid, "270000010", "[self-test] normalizePrecinctRows must read \"VTDID\" when configured for it");

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
