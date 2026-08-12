#!/usr/bin/env node
// scripts/ingest/mn-election-results.mjs
//
// MN Secretary of State election results — 2026 MN state primary
// (ersElectionId=200, Aug 11 2026) is the first election this importer
// targets. Answers AGENTS.md question 1/2's "who won" question at the
// contest level only — see electionResultsTypes.ts's header comment for
// the structural "no winner field" rule this script enforces at runtime.
//
// --- Two hosts, two very different postures -----------------------------
//
// electionresults.sos.mn.gov and sos.mn.gov (the interactive results
// website) both sit behind a Radware bot-management wall. Verified live: a
// polite fetch carrying an honest, descriptive User-Agent gets 302'd to a
// JS challenge at validate.perfdrive.com — this blocks ALL automated
// fetching, including robots.txt itself. Per AGENTS.md §2.2 ("no block
// evasion"), this script does not attempt to solve or route around that
// challenge in any way. This part is unchanged from the prior pass.
//
// electionresultsfiles.sos.mn.gov is a SEPARATE host — confirmed live,
// 2026-08-12 — that serves the same underlying result files as plain
// static text, with no bot wall at all: electionresultsfiles.sos.mn.gov
// /robots.txt is a clean 404 (an unrelated IIS static file server, nothing
// to violate), and every URL in BULK_DATA_SOURCES below returns a clean
// HTTP 200, `Content-Type: text/plain`, and a real `Last-Modified` header
// for a plain, honest, descriptive-User-Agent curl. This is the AGENTS.md
// §2.2 "good-citizen fetcher" pattern this project already uses in
// mn-campaign-finance.mjs and fetch-state-legislature.mjs — fetchFromNetwork()
// below is the primary path this script now uses.
//
// This file host's URL pattern (`/<YYYYMMDD>/<filename>.txt`) was found by
// direct inspection of a real results link, not published or documented
// anywhere by SOS — see the "undocumented file host" knownGaps entry below
// for the §0.8 risk that implies, and how this script fails if the pattern
// ever changes or the host disappears.
//
// The manual-drop-directory workflow the prior pass built is KEPT as an
// explicit, opt-in fallback (`--offline` / `--from-manual-drop`) for
// exactly that scenario — see readFromManualDropDirectory() below and
// scripts/ingest/data/mn-election-results-raw/<ersElectionId>/README.md.
// It is never used as a silent automatic fallback: if a live fetch is
// attempted and a source fails, this script throws and exits nonzero
// rather than quietly serving whatever is sitting in the drop directory
// (AGENTS.md §3.1 — a real breakage must be loud, not hidden behind stale
// data that happens to still parse).
//
// --- Confirmed file format ------------------------------------------------
//
// SOS publishes semicolon-delimited text result files, one row per
// candidate per contest per geography. Column order below was confirmed
// two ways: first (prior pass) via the Star Tribune's open-source, MIT-
// licensed `striblab/mn-elections-api` parser of these same files; now
// (this pass) directly, against real rows fetched live from
// electionresultsfiles.sos.mn.gov — see parseResultLine() below for the
// exact mapping, now "confirmed" rather than merely "corroborated" per
// AGENTS.md §3.3.
//
// Files exist at multiple geographic granularities (statewide, county,
// district, precinct) — same row shape, different scope. This importer
// targets statewide/county/district-level files only (see
// BULK_DATA_SOURCES); precinct-level rows are structurally skipped (any
// row with a non-empty Precinct field — see parseRawFile()), not just
// discouraged by convention, so a precinct-level file pointed at this
// script by mistake contributes nothing rather than silently leaking
// precinct rows.
//
// Confirmed live (2026-08-12), fixing two prior-pass bugs:
//   1. A statewide/aggregate row's County and Precinct columns are EMPTY
//      STRINGS, not the placeholder sentinels "00"/"0000" the prior pass
//      assumed. Empty precinct = "not precinct-level" (row kept); any
//      other precinct value = true precinct-level data (row skipped,
//      defensively). Empty county = "no specific county" (mapped to
//      `null`); any other value is a real 2-digit county code (row kept,
//      county field populated) — currently only cntyRaces.txt uses this.
//   2. At least one confirmed source (cntyRaces.txt) is Windows-1252, not
//      UTF-8 (real curly-quote candidate names appear, e.g. Melissa "Mel"
//      Lawlis using a plain ASCII quote in the row actually fetched, but
//      the encoding itself is still Windows-1252 per `file`'s own report —
//      decoding it as UTF-8 would corrupt any non-ASCII byte a future
//      refresh's rows do carry, e.g. the confirmed "María Isa Pérez-Vega"
//      row). See decodeWindows1252() below — every source is decoded with
//      it, not `res.text()`/`readFile(path, 'utf8')`, so a UTF-8 assumption
//      never silently corrupts a Windows-1252 file.
//
// --- certificationStatus is manual, not inferred -------------------------
//
// AGENTS.md's "no LIVE framing" decision: this script has no way to know
// whether a county canvassing board (~Aug 14, 2026) or the State
// Canvassing Board (~Aug 18, 2026, per Minn. Stat. § 204C.32) has met yet
// — that's a real-world legal event, not something derivable from a
// results file's own bytes. CERTIFICATION_STATUS below is a constant a
// human edits by hand (or overrides via --certification-status=<value> on
// the CLI) after confirming the canvass actually happened; it is never
// guessed from a date. Unchanged from the prior pass.
//
// Run with --self-test to exercise the parser/aggregation/assertion logic
// against an inline fixture instead of any file on disk or network — never
// touches public/ or the network. See runSelfTest() below.
//
// Run with --offline (or --from-manual-drop) to skip the network fetch
// entirely and read only from the manual drop directory — see main()
// below for why this is an explicit opt-in, never an automatic fallback.

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { updateDataManifest } from "../lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SELF_TEST = process.argv.includes("--self-test");
const OFFLINE_FLAGS = new Set(["--offline", "--from-manual-drop"]);
const OFFLINE_MODE = process.argv.some((arg) => OFFLINE_FLAGS.has(arg));

// --- Configuration ---------------------------------------------------------

// The 2026 MN state primary — the first (and, as of this commit, only)
// election this importer is configured for. A future election gets a new
// ersElectionId here (and its own raw-input subdirectory), not a second
// copy of this script.
const ERS_ELECTION_ID = "200";
const ELECTION_NAME = "2026 Minnesota State Primary";
const ELECTION_DATE = "2026-08-11";

// The confirmed, undocumented file host — see header comment. Derived date
// path segment (not hardcoded) so this doesn't silently drift if
// ELECTION_DATE is ever updated without updating the URL pattern.
const FILE_HOST_BASE_URL = "https://electionresultsfiles.sos.mn.gov";
const FILE_HOST_DATE_PATH = ELECTION_DATE.replace(/-/g, "");

const RAW_INPUT_DIR = path.join(
  __dirname,
  "data/mn-election-results-raw",
  ERS_ELECTION_ID,
);
// Files a human might reasonably leave alongside the real data drops —
// never treated as a results file.
const IGNORED_INPUT_FILENAMES = new Set(["README.md", ".gitkeep", ".DS_Store"]);

// See the header comment above — never inferred from a date. Overridable
// via `--certification-status=county-canvassed` etc. on the CLI for the
// human running the canvass-day refresh; defaults to the conservative
// "unofficial" per AGENTS.md's "no LIVE framing" decision.
const CERTIFICATION_STATUS_FLAG_PREFIX = "--certification-status=";
const VALID_CERTIFICATION_STATUSES = new Set(["unofficial", "county-canvassed", "state-certified"]);
function resolveCertificationStatus() {
  const flag = process.argv.find((arg) => arg.startsWith(CERTIFICATION_STATUS_FLAG_PREFIX));
  if (!flag) return "unofficial";
  const value = flag.slice(CERTIFICATION_STATUS_FLAG_PREFIX.length);
  if (!VALID_CERTIFICATION_STATUSES.has(value)) {
    throw new Error(
      `[mn-election-results] --certification-status must be one of ${[...VALID_CERTIFICATION_STATUSES].join(", ")}, got "${value}".`,
    );
  }
  return value;
}

const SOURCE_AGENCY = "Office of the Minnesota Secretary of State";
// The interactive, bot-walled site — still the canonical human-facing
// citation target (a resident can open this in a browser and see the same
// numbers), even though this script fetches from FILE_HOST_BASE_URL.
const INTERACTIVE_SITE_URL = `https://electionresults.sos.mn.gov/Select/MediaFiles/Index?ersElectionId=${ERS_ELECTION_ID}`;
const USER_AGENT =
  "wealldobettermn-ETL/1.0 (+https://github.com/steveyang-dev/wealldobettermn; civic transparency data ingest; contact: steveyang.dev@proton.me)";

// Redistribution posture, hedged the same way mn-campaign-finance.mjs's
// SOURCE_LICENCE and mn-economic-interest.mjs's SOURCE_LICENCE are — an
// honest working answer under the MGDPA (Minn. Stat. ch. 13), not a
// definitive legal claim. Election results are affirmatively public
// record under Minn. Stat. § 13.37/§ 204C (canvassed and unofficial
// returns are both released publicly by SOS itself). No SOS-published
// terms-of-use page was found for either electionresults.sos.mn.gov or
// electionresultsfiles.sos.mn.gov; this reading is a well-sourced working
// answer, not a substitute for attorney sign-off before publishing a
// definitive compliance claim — see AGENTS.md §3.4.
const SOURCE_LICENCE =
  "Public record under the Minnesota Government Data Practices Act (Minn. Stat. ch. 13) " +
  "and Minnesota election law (Minn. Stat. ch. 204C); election results are affirmatively " +
  "public data. No published terms-of-use page was found for either " +
  "electionresults.sos.mn.gov or electionresultsfiles.sos.mn.gov (this reading is a " +
  "well-sourced working answer, not a substitute for attorney review before publishing a " +
  "definitive compliance claim).";

const OUTPUT_DIR = path.join(__dirname, "../../public/election-results");
const INDEX_PATH = path.join(OUTPUT_DIR, "index.json");
const CONTESTS_DIR = path.join(OUTPUT_DIR, "contests");

// The 10 confirmed-working file sources on electionresultsfiles.sos.mn.gov,
// same BULK_DATA_SOURCES convention as mn-campaign-finance.mjs. Full scope
// previously agreed: county + state legislature + federal + statewide
// constitutional offices; no municipal/school, no precinct-level (see
// header comment).
const BULK_DATA_SOURCES = [
  { label: "us-senate-statewide", filename: "ussenate.txt", description: "U.S. Senator — Statewide" },
  { label: "us-house-by-district", filename: "ushouse.txt", description: "U.S. Representative — by District" },
  { label: "governor-statewide", filename: "governor.txt", description: "Governor & Lieutenant Governor — Statewide" },
  { label: "secretary-of-state-statewide", filename: "secofstate.txt", description: "Secretary of State — Statewide" },
  { label: "attorney-general-statewide", filename: "attorneygen.txt", description: "Attorney General — Statewide" },
  { label: "state-auditor-statewide", filename: "auditor.txt", description: "State Auditor — Statewide" },
  { label: "state-senate-by-district", filename: "stsenate.txt", description: "State Senator — by District" },
  {
    label: "state-house-by-district",
    filename: "LegislativeByDistrict.txt",
    description:
      "State Representative — by District. Despite the generic filename, this file is confirmed " +
      "(direct grep of the live file, 2026-08-12) to contain ONLY 'State Representative District ...' " +
      "contest rows — zero 'State Senator' rows. House-only; do not assume this file covers both chambers.",
  },
  { label: "judicial-district-court", filename: "judicialdst.txt", description: "District Court Races (judicial)" },
  {
    label: "county-races",
    filename: "cntyRaces.txt",
    description: "County Races (e.g. County Commissioner, County Attorney, County Sheriff)",
  },
];

const KNOWN_GAPS = [
  "electionresults.sos.mn.gov and sos.mn.gov (the interactive results website) sit behind a Radware bot-management wall that blocks automated fetching outright, verified live (even a polite fetch with an honest, descriptive User-Agent is redirected to a JS challenge) — this importer does not fetch from that host at all, by design (AGENTS.md §2.2 forbids solving or evading the challenge).",
  "This importer instead fetches from electionresultsfiles.sos.mn.gov, a separate static file host serving the same underlying result files with no bot wall (confirmed live, 2026-08-12: clean robots.txt 404, HTTP 200 + Last-Modified on every configured source). That host's URL pattern was found by direct inspection of a real results link, not published or documented anywhere by SOS — it could change or disappear without notice (AGENTS.md §0.8). If it does, this script fails loudly (throws on any non-2xx response, no silent partial success) rather than serving stale or partial data; the manual drop-directory workflow (--offline / --from-manual-drop, see scripts/ingest/data/mn-election-results-raw/<ersElectionId>/README.md) is the documented recovery path.",
  "Precinct-level results and precinct geometry are not ingested or joined — only statewide/county/district-level files, per BULK_DATA_SOURCES. A precinct-resolution layer is a distinct, larger scope decision, not made here.",
  "No candidate/person records exist anywhere in this layer — results are contest-level vote totals only. A candidate name is a label on a vote total, never joined to this app's officeholder/Person data.",
  "No winner, projected, leading, or \"advances to November\" field is ever computed or published — see electionResultsTypes.ts's header comment and this script's assertNoForbiddenField().",
  "isWriteIn is a heuristic (candidate name matches a write-in naming pattern), not derived from an explicit SOS column — see isWriteInCandidate() below.",
  "certificationStatus is set by hand (CERTIFICATION_STATUS constant or --certification-status CLI flag), never inferred from a date — this script cannot detect a real-world county or state canvass on its own.",
  "No Minneapolis or St. Paul city races appear on this ballot: 2026 is the MN state primary, and both cities hold their municipal elections in odd years (2025, 2029, ...), on a separate ballot this layer does not cover at all.",
  "resultsAsOf is the MOST RECENT Last-Modified response header across all 10 fetched sources, used as a single combined 'as of' timestamp for the whole pull — not a per-contest-precise value (a contest from a source file with an earlier Last-Modified still carries the overall most-recent timestamp). See fetchFromNetwork() below.",
  "Only the file format's 16 confirmed columns are parsed. The source file's own reported 'Percent' column (column 15) is read but not published — this project computes its own votePercent from votes/contest-total, per the documented rounding rule in computeVotePercent().",
];

// --- Windows-1252 decoding ---------------------------------------------

// Standard Windows-1252 code-point mapping for the 0x80-0x9F byte range —
// the only range where Windows-1252 differs from ISO-8859-1/Latin-1. Bytes
// 0x00-0x7F and 0xA0-0xFF map 1:1 to the same Unicode code point in both
// encodings, so a plain 'latin1' decode is correct for those; only this
// range needs an explicit remap. Fixed, well-known table (WHATWG Encoding
// Standard's windows-1252 index) — five code points (0x81, 0x8D, 0x8F,
// 0x90, 0x9D) are undefined/unused in real Windows-1252 text and map to
// their own byte value (identity), matching the WHATWG spec's treatment
// rather than guessing a printable character for them.
const WINDOWS_1252_0x80_0x9F = {
  0x80: 0x20ac, // €
  0x81: 0x0081,
  0x82: 0x201a, // ‚
  0x83: 0x0192, // ƒ
  0x84: 0x201e, // „
  0x85: 0x2026, // …
  0x86: 0x2020, // †
  0x87: 0x2021, // ‡
  0x88: 0x02c6, // ˆ
  0x89: 0x2030, // ‰
  0x8a: 0x0160, // Š
  0x8b: 0x2039, // ‹
  0x8c: 0x0152, // Œ
  0x8d: 0x008d,
  0x8e: 0x017d, // Ž
  0x8f: 0x008f,
  0x90: 0x0090,
  0x91: 0x2018, // '
  0x92: 0x2019, // '
  0x93: 0x201c, // "
  0x94: 0x201d, // "
  0x95: 0x2022, // •
  0x96: 0x2013, // –
  0x97: 0x2014, // —
  0x98: 0x02dc, // ˜
  0x99: 0x2122, // ™
  0x9a: 0x0161, // š
  0x9b: 0x203a, // ›
  0x9c: 0x0153, // œ
  0x9d: 0x009d,
  0x9e: 0x017e, // ž
  0x9f: 0x0178, // Ÿ
};

// Dependency-free Windows-1252 decoder — deliberately NOT built on Node's
// `TextDecoder('windows-1252')`, since that requires full-ICU and throws
// `ERR_ENCODING_NOT_SUPPORTED` in a small-ICU Node build. Decodes the raw
// bytes as Latin-1 first (a correct 1:1 byte->code-point mapping for every
// byte outside 0x80-0x9F), then remaps only that range via the table
// above. See this file's header comment for why UTF-8 decoding
// (`res.text()`/`readFile(path, 'utf8')`) is wrong for at least one
// confirmed source (cntyRaces.txt).
/**
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decodeWindows1252(buffer) {
  const latin1 = buffer.toString("latin1");
  let result = "";
  for (let i = 0; i < latin1.length; i++) {
    const codePoint = latin1.charCodeAt(i);
    if (codePoint >= 0x80 && codePoint <= 0x9f) {
      const mapped = WINDOWS_1252_0x80_0x9F[codePoint];
      result += String.fromCharCode(mapped !== undefined ? mapped : codePoint);
    } else {
      result += latin1[i];
    }
  }
  return result;
}

// --- Parsing -----------------------------------------------------------

/**
 * @typedef {Object} RawResultRow
 * @property {string} state
 * @property {string} countyCode - "" for a statewide/no-specific-county
 *   row; any other value is a real 2-digit county code.
 * @property {string} precinctCode - "" for a non-precinct (statewide/
 *   county/district-level) row; any other value is a true precinct-level
 *   row and is skipped before this type is ever constructed further
 *   downstream (see parseRawFile()).
 * @property {string} contestId
 * @property {string} contestName
 * @property {string} district
 * @property {string} candidateNumber
 * @property {string} candidateName
 * @property {string} suffix
 * @property {string} incumbentIndicator
 * @property {string} party
 * @property {number} precinctsReporting
 * @property {number} totalPrecincts
 * @property {number} votes
 * @property {string} sourcePercent - raw, unparsed "Percent" column text;
 *   never published (see KNOWN_GAPS) — kept only for debugging a parse.
 * @property {number} contestTotalVotes
 */

/**
 * Parses one semicolon-delimited row into a RawResultRow. Column order per
 * this file's header comment (confirmed 2026-08-12 against real rows
 * fetched from electionresultsfiles.sos.mn.gov):
 *   1 State; 2 County; 3 Precinct; 4 Contest ID; 5 Contest name;
 *   6 District; 7 Candidate number; 8 Candidate name; 9 Suffix;
 *   10 Incumbent indicator; 11 Party; 12 Precincts reporting;
 *   13 Total precincts; 14 Votes; 15 Percent; 16 Total votes.
 * Returns null (never throws) for a malformed line — e.g. a trailing
 * blank line or a line with the wrong field count — so one bad line
 * degrades to "skipped," not a whole-file failure. Per AGENTS.md §3.3,
 * never guesses a missing/malformed field.
 * @param {string} line
 * @returns {RawResultRow | null}
 */
export function parseResultLine(line) {
  if (line.trim().length === 0) return null;
  const fields = line.split(";");
  if (fields.length < 16) return null;

  const votes = Number(fields[13]);
  const contestTotalVotes = Number(fields[15]);
  const precinctsReporting = Number(fields[11]);
  const totalPrecincts = Number(fields[12]);
  if (!Number.isFinite(votes) || !Number.isFinite(contestTotalVotes)) {
    // Malformed numeric field (e.g. a header row or a trailing summary
    // line) — skip rather than guess a value, per AGENTS.md §3.3.
    return null;
  }

  return {
    state: fields[0].trim(),
    countyCode: fields[1].trim(),
    precinctCode: fields[2].trim(),
    contestId: fields[3].trim(),
    contestName: fields[4].trim(),
    district: fields[5].trim(),
    candidateNumber: fields[6].trim(),
    candidateName: fields[7].trim(),
    suffix: fields[8].trim(),
    incumbentIndicator: fields[9].trim(),
    party: fields[10].trim(),
    precinctsReporting: Number.isFinite(precinctsReporting) ? precinctsReporting : 0,
    totalPrecincts: Number.isFinite(totalPrecincts) ? totalPrecincts : 0,
    votes,
    sourcePercent: fields[14].trim(),
    contestTotalVotes,
  };
}

/**
 * Parses every line of one raw input file's text into RawResultRow[],
 * skipping malformed lines and precinct-level rows (see RawResultRow's own
 * doc comment above — any row with a non-empty Precinct field).
 * @param {string} raw
 * @returns {{ rows: RawResultRow[], skippedPrecinctRowCount: number, skippedMalformedRowCount: number }}
 */
export function parseRawFile(raw) {
  const lines = raw.split(/\r\n|\r|\n/);
  const rows = [];
  let skippedPrecinctRowCount = 0;
  let skippedMalformedRowCount = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const row = parseResultLine(line);
    if (!row) {
      skippedMalformedRowCount++;
      continue;
    }
    if (row.precinctCode !== "") {
      skippedPrecinctRowCount++;
      continue;
    }
    rows.push(row);
  }
  return { rows, skippedPrecinctRowCount, skippedMalformedRowCount };
}

// Write-in naming convention MN SOS results files use in the confirmed
// column layout — a heuristic on the candidate name text, not a distinct
// column of its own (no such column exists in the 16-column layout this
// file parses). Documented as a knownGaps entry, not asserted as
// definitive.
const WRITE_IN_RE = /write[\s-]?in/i;

/**
 * @param {string} candidateName
 * @returns {boolean}
 */
export function isWriteInCandidate(candidateName) {
  return WRITE_IN_RE.test(candidateName);
}

// "X" is the confirmed incumbent-indicator marker in the column this
// project could verify secondhand via striblab/mn-elections-api's own
// column mapping; anything else (blank, "N", etc.) is treated as
// not-incumbent. Not currently surfaced on CandidateResult (the type has
// no isIncumbent field) — parsed here only so a future maintainer adding
// that field has the extraction logic ready, not because it's published
// today.
function isIncumbentIndicator(raw) {
  return raw.trim().toUpperCase() === "X";
}
// Referenced by isIncumbentIndicator's own doc comment above — kept as a
// real (if currently unused) export so `npm run lint`'s unused-var check
// doesn't flag dead code silently reintroduced later; exported rather than
// prefixed-underscore since a future consumer is the documented intent.
export { isIncumbentIndicator };

/**
 * Rounds votes/contestTotalVotes to a percentage with 1 decimal place.
 * Documented rounding rule: standard round-half-up on the value
 * (votes / contestTotalVotes) * 100, via Math.round(x * 10) / 10 — e.g.
 * 33.45 rounds to 33.5, not 33.4. A contest with zero recorded total
 * votes (rare edge case — e.g. a contest row present with no votes cast
 * yet) returns 0 rather than NaN/Infinity, since "0% of 0" is the only
 * honest reading and this project never fabricates a number (AGENTS.md
 * §3.3).
 * @param {number} votes
 * @param {number} contestTotalVotes
 * @returns {number}
 */
export function computeVotePercent(votes, contestTotalVotes) {
  if (!Number.isFinite(contestTotalVotes) || contestTotalVotes <= 0) return 0;
  return Math.round((votes / contestTotalVotes) * 1000) / 10;
}

/**
 * Groups parsed rows into Contest records, one per (contestId, county)
 * pair — a genuinely statewide/no-specific-county contest has an empty-
 * string countyCode and produces one Contest with county: null; a
 * county-level breakdown (e.g. a county commissioner race) produces one
 * Contest per county. Candidates within a contest are sorted by vote
 * count, descending — a plain restatement of the numbers, never a
 * computed "winner" (see electionResultsTypes.ts's header comment); ties
 * keep their original (source) relative order, since Array.prototype.sort
 * is stable in Node's engine.
 * @param {RawResultRow[]} rows
 * @param {{ certificationStatus: import("../../src/lib/electionResultsTypes.js").CertificationStatus, provenance: import("../../src/lib/electionResultsTypes.js").ElectionResultsProvenance, resultsAsOf: string | null }} context
 * @returns {import("../../src/lib/electionResultsTypes.js").Contest[]}
 */
export function buildContests(rows, context) {
  /** @type {Map<string, { contestId: string, contestName: string, district: string, county: string | null, precinctsReporting: number, totalPrecincts: number, totalVotes: number, candidates: import("../../src/lib/electionResultsTypes.js").CandidateResult[] }>} */
  const byKey = new Map();

  for (const row of rows) {
    const county = row.countyCode === "" ? null : row.countyCode;
    const key = `${row.contestId}::${county ?? ""}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        contestId: row.contestId,
        contestName: row.contestName,
        district: row.district || null,
        county,
        // A contest's precinct-reporting/total-precinct/total-votes
        // figures are repeated identically on every candidate row within
        // it in the confirmed format — taken from the first row seen for
        // this key rather than summed, to avoid double-counting.
        precinctsReporting: row.precinctsReporting,
        totalPrecincts: row.totalPrecincts,
        totalVotes: row.contestTotalVotes,
        candidates: [],
      });
    }
    const bucket = byKey.get(key);
    const displayName = [row.candidateName, row.suffix].filter(Boolean).join(" ").trim();
    bucket.candidates.push({
      candidateName: displayName || row.candidateName,
      candidateParty: row.party || null,
      votes: row.votes,
      votePercent: computeVotePercent(row.votes, row.contestTotalVotes),
      isWriteIn: isWriteInCandidate(row.candidateName),
    });
  }

  const contests = [];
  for (const bucket of byKey.values()) {
    bucket.candidates.sort((a, b) => b.votes - a.votes);
    contests.push({
      schemaVersion: 1,
      contestId: bucket.county ? `${bucket.contestId}-${bucket.county}` : bucket.contestId,
      contestName: bucket.contestName,
      district: bucket.district,
      county: bucket.county,
      precinctsReporting: bucket.precinctsReporting,
      totalPrecincts: bucket.totalPrecincts,
      totalVotes: bucket.totalVotes,
      certificationStatus: context.certificationStatus,
      resultsAsOf: context.resultsAsOf ?? null,
      candidates: bucket.candidates,
      provenance: context.provenance,
    });
  }
  // Deterministic output order regardless of input row order.
  contests.sort((a, b) => a.contestId.localeCompare(b.contestId));
  return contests;
}

// --- Structural backstop: no winner/projected/advances-to field --------
//
// Runtime guard mirroring assertNoIndividualDonorLeak() in
// mn-campaign-finance.mjs and assertNoHouseholdOrFamilyLeak() in
// mn-economic-interest.mjs — a test that the "no winner field" rule
// documented in electionResultsTypes.ts is actually enforced, not just
// promised in a comment. Walks every key on a contest and its candidates
// and refuses to write output if any forbidden-looking key is present, so
// a future edit that reintroduces a computed "winner"/"projected"/
// "advancesTo" field fails the build instead of shipping silently.
const FORBIDDEN_FIELD_RE = /winner|projected|advances?to|leading|iscalled|calledat/i;

/**
 * @param {import("../../src/lib/electionResultsTypes.js").Contest[]} contests
 */
export function assertNoForbiddenField(contests) {
  for (const contest of contests) {
    for (const key of Object.keys(contest)) {
      assert.ok(
        !FORBIDDEN_FIELD_RE.test(key),
        `[mn-election-results] forbidden field "${key}" found on contest ${contest.contestId}. ` +
          `AGENTS.md §1c: no winner/projected/leading/advances-to field is ever published. Refusing to write output.`,
      );
    }
    for (const candidate of contest.candidates) {
      for (const key of Object.keys(candidate)) {
        assert.ok(
          !FORBIDDEN_FIELD_RE.test(key),
          `[mn-election-results] forbidden field "${key}" found on a candidate in contest ${contest.contestId}. ` +
            `AGENTS.md §1c: no winner/projected/leading/advances-to field is ever published. Refusing to write output.`,
        );
      }
    }
  }
}

// --- Fetching: network (primary) and manual-drop (explicit fallback) ---

/**
 * Fetches every configured source from electionresultsfiles.sos.mn.gov.
 * Throws on any non-ok response — no silent partial success, matching
 * every other ingest script in this repo. Never called unless the network
 * path is selected in main() (i.e. --offline/--from-manual-drop was NOT
 * passed).
 * @returns {Promise<{ allRows: RawResultRow[], rawTexts: string[], totalSkippedPrecinct: number, totalSkippedMalformed: number, resultsAsOf: string | null, fetchedFiles: { label: string, url: string, byteLength: number }[] }>}
 */
export async function fetchFromNetwork() {
  const allRows = [];
  const rawTexts = [];
  const fetchedFiles = [];
  let totalSkippedPrecinct = 0;
  let totalSkippedMalformed = 0;
  let mostRecentLastModified = null;

  for (const source of BULK_DATA_SOURCES) {
    const url = `${FILE_HOST_BASE_URL}/${FILE_HOST_DATE_PATH}/${source.filename}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      throw new Error(
        `[mn-election-results] HTTP ${res.status} ${res.statusText} for ${url} (${source.label}). ` +
          `This host's URL pattern is undocumented by SOS (AGENTS.md §0.8 risk) — if it has changed, ` +
          `use --offline/--from-manual-drop with a fresh manual download as the recovery path ` +
          `(see scripts/ingest/data/mn-election-results-raw/${ERS_ELECTION_ID}/README.md).`,
      );
    }

    const lastModifiedHeader = res.headers.get("last-modified");
    if (lastModifiedHeader) {
      const parsed = new Date(lastModifiedHeader);
      // Never guess a timestamp per AGENTS.md §3.3 — an unparseable header
      // is treated the same as a missing one (ignored for the "most
      // recent" comparison) rather than coerced into some fallback date.
      if (!Number.isNaN(parsed.getTime())) {
        if (!mostRecentLastModified || parsed.getTime() > mostRecentLastModified.getTime()) {
          mostRecentLastModified = parsed;
        }
      }
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const raw = decodeWindows1252(buffer);
    rawTexts.push(raw);
    fetchedFiles.push({ label: source.label, url, byteLength: buffer.byteLength });

    const { rows, skippedPrecinctRowCount, skippedMalformedRowCount } = parseRawFile(raw);
    for (const row of rows) allRows.push(row);
    totalSkippedPrecinct += skippedPrecinctRowCount;
    totalSkippedMalformed += skippedMalformedRowCount;
  }

  return {
    allRows,
    rawTexts,
    totalSkippedPrecinct,
    totalSkippedMalformed,
    resultsAsOf: mostRecentLastModified ? mostRecentLastModified.toISOString() : null,
    fetchedFiles,
  };
}

/**
 * Reads every non-ignored file in `dir`, returns [] (not an error) if the
 * directory itself doesn't exist yet — the honest-empty-state path per
 * AGENTS.md §3.1, same posture as mn-economic-interest.mjs's empty
 * KNOWN_OFFICIAL_IDS handling.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listInputFiles(dir) {
  try {
    const entries = await readdir(dir);
    const files = [];
    for (const entry of entries) {
      if (IGNORED_INPUT_FILENAMES.has(entry)) continue;
      const full = path.join(dir, entry);
      const info = await stat(full);
      if (info.isFile()) files.push(full);
    }
    return files.sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Reads and parses every file already sitting in the manual drop
 * directory — the explicit, opt-in fallback (--offline /
 * --from-manual-drop). Never touches the network. Files are read as raw
 * bytes and decoded with decodeWindows1252(), same as the network path,
 * since a human-downloaded file is the same underlying SOS format and
 * carries the same encoding risk. Returns { inputFiles: [] } (not an
 * error) if the directory doesn't exist or is empty yet — see main() for
 * how that's turned into an honest empty index.
 * @returns {Promise<{ allRows: RawResultRow[], rawTexts: string[], totalSkippedPrecinct: number, totalSkippedMalformed: number, inputFiles: string[] }>}
 */
export async function readFromManualDropDirectory() {
  const inputFiles = await listInputFiles(RAW_INPUT_DIR);
  const allRows = [];
  const rawTexts = [];
  let totalSkippedPrecinct = 0;
  let totalSkippedMalformed = 0;

  for (const filePath of inputFiles) {
    const buffer = await readFile(filePath);
    const raw = decodeWindows1252(buffer);
    rawTexts.push(raw);
    const { rows, skippedPrecinctRowCount, skippedMalformedRowCount } = parseRawFile(raw);
    for (const row of rows) allRows.push(row);
    totalSkippedPrecinct += skippedPrecinctRowCount;
    totalSkippedMalformed += skippedMalformedRowCount;
  }

  return { allRows, rawTexts, totalSkippedPrecinct, totalSkippedMalformed, inputFiles };
}

// --- Main ----------------------------------------------------------------

/**
 * Writes the honest empty-state index.json (zero contests) — used only by
 * the --offline path when the manual drop directory has no files yet. The
 * live network path never silently produces this: a fetch failure throws
 * instead (see fetchFromNetwork()'s own comment), so an empty index is
 * never confused with a real outage.
 */
async function writeEmptyIndex({ fetchedAt, certificationStatus, extraKnownGaps }) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  /** @type {import("../../src/lib/electionResultsTypes.js").ElectionResultsIndex} */
  const emptyIndex = {
    schemaVersion: 1,
    ersElectionId: ERS_ELECTION_ID,
    electionName: ELECTION_NAME,
    electionDate: ELECTION_DATE,
    generatedAt: fetchedAt,
    certificationStatus,
    resultsAsOf: null,
    provenance: {
      primarySourceUrl: INTERACTIVE_SITE_URL,
      sourceAgency: SOURCE_AGENCY,
      documentType: "election results text file",
      documentId: ERS_ELECTION_ID,
      issuedDate: null,
      fetchedAt,
      licence: SOURCE_LICENCE,
      contentHash: createHash("sha256").update("").digest("hex"),
    },
    contests: [],
    knownGaps: [...extraKnownGaps, ...KNOWN_GAPS],
  };
  const emptyOutput = JSON.stringify(emptyIndex);
  await writeFile(INDEX_PATH, emptyOutput);
  await updateDataManifest("election-results/index.json", emptyOutput);
  return emptyIndex;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const certificationStatus = resolveCertificationStatus();

  let allRows;
  let rawTexts;
  let totalSkippedPrecinct;
  let totalSkippedMalformed;
  let resultsAsOf;
  let sourceCount;
  let primarySourceUrl;

  if (OFFLINE_MODE) {
    const result = await readFromManualDropDirectory();
    if (result.inputFiles.length === 0) {
      // Honest empty state per AGENTS.md §3.1 — no files dropped yet is
      // the expected default until a human manually downloads files.
      // Never an error, never fabricated content.
      await writeEmptyIndex({
        fetchedAt,
        certificationStatus,
        extraKnownGaps: [
          `--offline/--from-manual-drop was passed and no raw result files were found in ` +
            `${path.relative(process.cwd(), RAW_INPUT_DIR)} — see that directory's README.md for the manual download workflow.`,
        ],
      });
      console.log(
        `[done] --offline mode: no input files found under ${RAW_INPUT_DIR} — wrote an honest empty index to ${INDEX_PATH}.`,
      );
      return;
    }
    ({ allRows, rawTexts, totalSkippedPrecinct, totalSkippedMalformed } = result);
    resultsAsOf = null; // manual-drop files carry no fetch-time Last-Modified header this script can read
    sourceCount = result.inputFiles.length;
    primarySourceUrl = INTERACTIVE_SITE_URL;
    console.log(`[mn-election-results] --offline mode: reading ${sourceCount} file(s) from ${RAW_INPUT_DIR}.`);
  } else {
    const result = await fetchFromNetwork();
    ({ allRows, rawTexts, totalSkippedPrecinct, totalSkippedMalformed, resultsAsOf } = result);
    sourceCount = result.fetchedFiles.length;
    primarySourceUrl = `${FILE_HOST_BASE_URL}/${FILE_HOST_DATE_PATH}/`;
    console.log(`[mn-election-results] fetched ${sourceCount} source(s) from ${FILE_HOST_BASE_URL}.`);
  }

  const contentHash = createHash("sha256").update(rawTexts.join("\n")).digest("hex");

  /** @type {import("../../src/lib/electionResultsTypes.js").ElectionResultsProvenance} */
  const provenance = {
    primarySourceUrl,
    sourceAgency: SOURCE_AGENCY,
    documentType: "election results text file",
    documentId: ERS_ELECTION_ID,
    issuedDate: null, // no per-row date column in the confirmed 16-column layout — never guessed
    fetchedAt,
    licence: SOURCE_LICENCE,
    contentHash,
  };

  const contests = buildContests(allRows, { certificationStatus, provenance, resultsAsOf });

  // Required before any write below — see assertNoForbiddenField()'s own
  // comment for why this can't be skipped or moved after writeFile.
  assertNoForbiddenField(contests);

  await mkdir(CONTESTS_DIR, { recursive: true });

  const contestSummaries = [];
  for (const contest of contests) {
    const dataPath = `/election-results/contests/${contest.contestId}.json`;
    await writeFile(path.join(CONTESTS_DIR, `${contest.contestId}.json`), JSON.stringify(contest));
    contestSummaries.push({
      contestId: contest.contestId,
      contestName: contest.contestName,
      district: contest.district,
      county: contest.county,
      precinctsReporting: contest.precinctsReporting,
      totalPrecincts: contest.totalPrecincts,
      totalVotes: contest.totalVotes,
      candidateCount: contest.candidates.length,
      dataPath,
    });
  }

  /** @type {import("../../src/lib/electionResultsTypes.js").ElectionResultsIndex} */
  const index = {
    schemaVersion: 1,
    ersElectionId: ERS_ELECTION_ID,
    electionName: ELECTION_NAME,
    electionDate: ELECTION_DATE,
    generatedAt: fetchedAt,
    certificationStatus,
    resultsAsOf,
    provenance,
    contests: contestSummaries,
    knownGaps: KNOWN_GAPS,
  };

  await writeFile(INDEX_PATH, JSON.stringify(index));
  await updateDataManifest("election-results/index.json", JSON.stringify(index));

  console.log(
    `[done] parsed ${allRows.length} row(s) from ${sourceCount} source(s) ` +
      `(${totalSkippedPrecinct} precinct-level row(s) skipped, ${totalSkippedMalformed} malformed line(s) skipped); ` +
      `wrote ${contestSummaries.length} contest detail file(s) under ${CONTESTS_DIR} ` +
      `and index to ${INDEX_PATH} (certificationStatus: ${certificationStatus}, resultsAsOf: ${resultsAsOf ?? "null"})`,
  );
}

// --- Self-test -------------------------------------------------------------
//
// Exercises parseResultLine/parseRawFile/computeVotePercent/buildContests/
// assertNoForbiddenField/decodeWindows1252 against an inline fixture
// matching the real 16-column format — never touches scripts/ingest/data/,
// public/, or the network. Matches fetch-state-legislature.mjs's
// --self-test convention.
async function runSelfTest() {
  console.log("[self-test] running against an inline fixture (no files or network touched)...");

  // Two candidates in a statewide contest, plus one precinct-level row
  // (must be skipped) and one malformed line (must be skipped). Empty
  // County/Precinct fields (columns 2 and 3) are the confirmed real
  // aggregate-row placeholder — not "00"/"0000".
  const fixtureLines = [
    "MN;;;0100;Governor;;0001;Jane Q. Doe;;X;DFL;150;150;120000;60.0;200000",
    "MN;;;0100;Governor;;0002;John R. Smith;Jr.;;R;150;150;79500;39.8;200000",
    "MN;;;0100;Governor;;0003;Pat Write-In;;;WI;150;150;500;0.3;200000",
    "MN;27;0412;0100;Governor;;0001;Jane Q. Doe;;X;DFL;10;10;9000;60.0;200000", // precinct-level (non-empty precinct), must be skipped
    "not;enough;fields",
  ];
  const fixtureRaw = fixtureLines.join("\n");

  const { rows, skippedPrecinctRowCount, skippedMalformedRowCount } = parseRawFile(fixtureRaw);
  if (rows.length !== 3) {
    throw new Error(`[self-test] expected 3 parsed rows, got ${rows.length}`);
  }
  if (skippedPrecinctRowCount !== 1) {
    throw new Error(`[self-test] expected 1 skipped precinct-level row, got ${skippedPrecinctRowCount}`);
  }
  if (skippedMalformedRowCount !== 1) {
    throw new Error(`[self-test] expected 1 skipped malformed line, got ${skippedMalformedRowCount}`);
  }

  const votePercent = computeVotePercent(120000, 200000);
  if (votePercent !== 60) {
    throw new Error(`[self-test] computeVotePercent(120000, 200000) expected 60, got ${votePercent}`);
  }
  if (computeVotePercent(1, 3) !== 33.3) {
    throw new Error(`[self-test] computeVotePercent(1, 3) expected 33.3, got ${computeVotePercent(1, 3)}`);
  }
  if (computeVotePercent(0, 0) !== 0) {
    throw new Error(`[self-test] computeVotePercent(0, 0) expected 0 (never NaN/Infinity), got ${computeVotePercent(0, 0)}`);
  }

  const provenance = {
    primarySourceUrl: INTERACTIVE_SITE_URL,
    sourceAgency: SOURCE_AGENCY,
    documentType: "election results text file",
    documentId: ERS_ELECTION_ID,
    issuedDate: null,
    fetchedAt: new Date().toISOString(),
    licence: SOURCE_LICENCE,
    contentHash: createHash("sha256").update(fixtureRaw).digest("hex"),
  };
  const contests = buildContests(rows, { certificationStatus: "unofficial", provenance, resultsAsOf: null });
  if (contests.length !== 1) {
    throw new Error(`[self-test] expected 1 contest, got ${contests.length}`);
  }
  const [contest] = contests;
  if (contest.candidates.length !== 3) {
    throw new Error(`[self-test] expected 3 candidates, got ${contest.candidates.length}`);
  }
  if (contest.candidates[0].candidateName !== "Jane Q. Doe" || contest.candidates[0].votes !== 120000) {
    throw new Error("[self-test] candidates are not sorted by votes descending");
  }
  if (!contest.candidates[2].isWriteIn) {
    throw new Error('[self-test] "Pat Write-In" was not detected as a write-in candidate');
  }
  if (contest.candidates[1].candidateName !== "John R. Smith Jr.") {
    throw new Error(`[self-test] suffix was not appended to candidate name, got "${contest.candidates[1].candidateName}"`);
  }
  if (contest.county !== null) {
    throw new Error(`[self-test] expected county: null for an empty-string County field, got ${JSON.stringify(contest.county)}`);
  }

  // Confirm assertNoForbiddenField actually fires on a violation, not just
  // passes on clean input.
  assertNoForbiddenField(contests); // should not throw
  let threwOnForbiddenField = false;
  try {
    assertNoForbiddenField([{ ...contest, winner: "Jane Q. Doe" }]);
  } catch {
    threwOnForbiddenField = true;
  }
  if (!threwOnForbiddenField) {
    throw new Error("[self-test] assertNoForbiddenField did not reject a contest carrying a winner field");
  }

  // decodeWindows1252: curly double quotes (0x93/0x94) and plain ASCII
  // round-trip.
  const curlyQuotesDecoded = decodeWindows1252(Buffer.from([0x93, 0x41, 0x94]));
  if (curlyQuotesDecoded !== "“A”") {
    throw new Error(`[self-test] decodeWindows1252 curly-quote decode failed, got ${JSON.stringify(curlyQuotesDecoded)}`);
  }
  const asciiDecoded = decodeWindows1252(Buffer.from("Jane Q. Doe", "ascii"));
  if (asciiDecoded !== "Jane Q. Doe") {
    throw new Error(`[self-test] decodeWindows1252 ASCII round-trip failed, got ${JSON.stringify(asciiDecoded)}`);
  }

  console.log(
    "[self-test] PASS — parser/precinct-filter/malformed-line-skip/vote-percent-rounding/contest-grouping/" +
      "write-in-detection/forbidden-field-assertion/windows-1252-decoding all behave as expected against the fixture.",
  );
}

if (SELF_TEST) {
  runSelfTest().catch((err) => {
    console.error("[fatal]", err.message);
    process.exit(1);
  });
} else if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[fatal]", err.message);
    process.exit(1);
  });
}
