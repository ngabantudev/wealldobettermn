#!/usr/bin/env node
// scripts/ingest/mn-campaign-finance.mjs
//
// FEATURES.md Phase 8 ("Optional / later"). Not yet wired into
// `npm run data:all` — see knownGaps in the output for what's still
// missing (party-unit/PAC recipient files, local/federal receipts) — but
// as of 2026-08-06 this script fetches and parses real MN Campaign
// Finance Board data end to end, with the donor-privacy filter enforced
// at ingest per AGENTS.md §1b/§1d.
//
// Dependency-free Node, same convention as every other scripts/*.mjs in
// this repo: built-in fetch + node:fs only, no npm dependency added for
// CSV parsing (see splitCsvLine() below).
//
// --- Why the filter lives here, not in a component -------------------
//
// AGENTS.md §1d: "Campaign finance importers must filter donors against
// this rule at ingest, not at render — unpublished-but-present data is a
// leak waiting for a careless export." Concretely: if this script ever
// wrote every parsed contribution row to public/ and relied on the UI to
// only *display* the named-entity ones, the small-donor rows would still
// sit in a public, fetchable JSON file — one bulk-export button or one
// forgotten filter in a future component away from leaking names,
// employers, and home cities of ordinary people who gave $20 to a school
// board candidate. Filtering here means that data is never written to
// disk in the first place. There is nothing to leak because it was
// discarded before the first writeFile call, and the assertion in
// main() below exists so a future edit to this file can't quietly
// reintroduce a per-individual record without the script itself refusing
// to run.
//
// --- Verified live against cfb.mn.gov, 2026-08-06 ---------------------
//
// BULK_DATA_SOURCES points at a real, confirmed-working, session-less CSV
// export (cold curl, no cookie, stable filename). The full column schema,
// the real distribution of "Contrib type" values (~82% "Individual"), and
// the fact that CFB's own $200 itemization line is a per-cycle running
// total rather than per-transaction (a $125 single gift still appeared,
// itemized, once its donor crossed the line) were all confirmed by
// downloading and inspecting the actual file — see mapDonorType() and the
// RawContributionRow typedef below for what that means for this filter.

import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  ITEMIZATION_THRESHOLD_USD,
  ITEMIZATION_THRESHOLD_SOURCE_URL,
  CONTRIBUTION_SIZE_BANDS,
  bandForAmount,
  isNamedEntityDonor,
} from "../../src/lib/campaignFinanceConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chunked output per AGENTS.md §0.7/§4 budget — see the header comment on
// CampaignFinanceIndex in src/lib/campaignFinanceTypes.ts for why this
// replaced a single ~41MB public/campaign-finance.json. INDEX_PATH is the
// one file loaded upfront; CANDIDATES_DIR holds one small detail file per
// candidate committee, fetched lazily.
const OUTPUT_DIR = path.join(__dirname, "../../public/campaign-finance");
const INDEX_PATH = path.join(OUTPUT_DIR, "index.json");
const CANDIDATES_DIR = path.join(OUTPUT_DIR, "candidates");

const USER_AGENT = "wealldobettermn-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pipeline)";

const SOURCE_AGENCY = "Minnesota Campaign Finance and Public Disclosure Board";
const SOURCE_LICENCE = "Public record under Minn. Stat. ch. 10A — verify current redistribution terms on cfb.mn.gov before publishing.";

// Live-verified 2026-08-06 against cfb.mn.gov's own data-downloads page
// (https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/):
// each row on that page is a static, session-less, directly-fetchable CSV
// export — confirmed by a cold curl with no prior cookie/referrer, HTTP 200,
// stable Content-Disposition filename. The `?download=<id>` ids are opaque
// and could change if cfb.mn.gov regenerates the page, so this only covers
// the "Candidates" recipient-type file for now (the one most directly in
// scope per FEATURES.md Phase 8/AGENTS.md §1a — officeholder/candidate
// receipts). Party-unit and PAC recipient files exist on the same page
// (same column schema, confirmed by inspection) and can be added to this
// array later without any parsing changes.
const BULK_DATA_SOURCES = [
  {
    label: "candidates-contributions-received",
    url: "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/?download=-2026985457",
    description: "Candidates — Itemized Contributions Received Of Over $200 — Campaign Finance",
  },
];

/**
 * Fetches every configured bulk file and concatenates the parsed rows.
 * Returns the raw text alongside the parsed rows so main() can hash the
 * actual source document (per AGENTS.md §2.2's source_record.hash), not a
 * hash of this script's own parsed representation of it.
 * @returns {Promise<{ rows: RawContributionRow[], fetchedFiles: { label: string, url: string, byteLength: number }[], rawTexts: string[] }>}
 */
async function fetchRawContributions() {
  const rows = [];
  const fetchedFiles = [];
  const rawTexts = [];
  for (const source of BULK_DATA_SOURCES) {
    const res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${source.url}`);
    const raw = await res.text();
    fetchedFiles.push({ label: source.label, url: source.url, byteLength: Buffer.byteLength(raw) });
    rawTexts.push(raw);
    // Plain loop, not `rows.push(...parsed)` — spreading a ~268k-element
    // array as individual call arguments blows V8's call stack at this
    // scale (confirmed live: "Maximum call stack size exceeded" against
    // the real 267,990-row CFB export). Array.prototype.push.call per
    // element avoids both the spread blowup and an intermediate copy.
    for (const parsedRow of parseRawRows(raw)) rows.push(parsedRow);
  }
  return { rows, fetchedFiles, rawTexts };
}

/**
 * @typedef {Object} RawContributionRow
 * @property {string} donorName - the CFB "Contributor" column, forwarded
 *   only when donorType maps to a named-entity type (see mapDonorType).
 * @property {string} [donorType] - normalized via mapDonorType() below;
 *   absent/undefined for anything not on the confirmed-safe allowlist, so
 *   isNamedEntityDonor()'s Set.has() check fails closed by construction.
 * @property {string} recipientCommittee - CFB "Recipient" column.
 * @property {string} cycle - CFB "Year" column, as a string.
 * @property {number} amountUsd - CFB "Amount" column.
 * @property {string} date - CFB "Receipt date" column, already ISO
 *   (YYYY-MM-DD) in the real export — no reformatting needed.
 *
 * Deliberately NOT on this type: the CFB file's "Contrib zip" and "Contrib
 * Employer name" columns. Per AGENTS.md §1b ("Never geocode a donor
 * address") and the file's own header comment above, these are dropped at
 * CSV-parse time — never attached to a RawContributionRow at all — so
 * there is no field for a future edit to accidentally forward into a
 * named record. This is stricter than filtering at the output boundary:
 * the data is discarded before it exists in memory as a named-record
 * candidate.
 */

// Real "Contrib type" values confirmed 2026-08-06 by downloading and
// inspecting BULK_DATA_SOURCES[0] directly (219,877 "Individual" rows out
// of ~267k total, confirming CFB's own itemization is per-cycle-total, not
// per-transaction — a single $125 gift showed up itemized once its donor's
// running total crossed $200). Every value CFB actually uses is listed
// here explicitly; anything not listed (a CFB schema change, a typo, a
// future "Corporation" or "Lobbyist Principal" value in a file this
// script doesn't fetch yet) maps to `undefined` and is silently treated
// as NOT a named entity — fail-closed per AGENTS.md §1d "when in doubt,
// leave it out," never fail-open on an unrecognized category.
//
// "Self" (a candidate contributing to their own committee) and "Other"
// are deliberately left unmapped rather than treated as named, even though
// "Self" arguably describes the candidate's own money rather than a third
// party's: AGENTS.md §1d's structural rule is "no variant for a private
// individual, by construction," and a self-funding candidate is still a
// natural person in CFB's own schema. If a maintainer wants "Self" to
// surface as a named figure (a legitimate transparency question — "how
// much did the candidate self-fund"), that's a deliberate policy addition
// to make explicitly here, not a default this importer should assume.
const CFB_DONOR_TYPE_MAP = {
  "Political Committee/Fund": "pac",
  "Party Unit": "party_unit",
  "Lobbyist": "lobbyist_principal",
  "Candidate Committee": "candidate_committee",
};

/**
 * @param {string} rawContribType
 * @returns {string | undefined}
 */
function mapDonorType(rawContribType) {
  return CFB_DONOR_TYPE_MAP[rawContribType];
}

// Minimal RFC-4180-ish CSV line splitter — handles double-quoted fields
// containing commas (e.g. `"Davids, Gregory M House Committee"`) and
// escaped `""` quotes, which the real CFB export uses throughout. No
// dependency added, per this repo's scripts/*.mjs convention.
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
 * Parses one CFB bulk-download CSV into RawContributionRow[]. Confirmed
 * 2026-08-06 against the real header:
 *   "Recipient reg num",Recipient,"Recipient type","Recipient subtype",
 *   Amount,"Receipt date",Year,Contributor,"Contrib Reg Num","Contrib type",
 *   "Receipt type","In kind?","In-kind descr","Contrib zip",
 *   "Contrib Employer name"
 * Only the columns RawContributionRow needs are read; "Contrib zip" and
 * "Contrib Employer name" are never touched, per the typedef comment above.
 * @param {string} raw
 * @returns {RawContributionRow[]}
 */
function parseRawRows(raw) {
  const lines = raw.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]);
  const col = (name) => {
    const idx = header.indexOf(name);
    if (idx === -1) {
      throw new Error(
        `[mn-campaign-finance] expected column "${name}" not found in CFB export header. ` +
          `Upstream schema may have changed — re-verify against a fresh download before trusting this parse.`,
      );
    }
    return idx;
  };
  const idx = {
    recipient: col("Recipient"),
    amount: col("Amount"),
    receiptDate: col("Receipt date"),
    year: col("Year"),
    contributor: col("Contributor"),
    contribType: col("Contrib type"),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const amountUsd = Number(fields[idx.amount]);
    if (!Number.isFinite(amountUsd)) {
      // Malformed row (e.g. a trailing summary line) — skip rather than
      // guess a value. Never fabricate a number per AGENTS.md §3.3.
      continue;
    }
    const rawContribType = fields[idx.contribType];
    rows.push({
      donorName: fields[idx.contributor],
      donorType: mapDonorType(rawContribType),
      recipientCommittee: fields[idx.recipient],
      cycle: fields[idx.year],
      amountUsd,
      date: fields[idx.receiptDate],
    });
  }
  return rows;
}

/**
 * The donor-privacy filter itself, applied at ingest. Splits raw rows
 * into exactly the two shapes AGENTS.md §1b permits: per-cycle aggregates
 * (every row contributes to a total and a size-band count, regardless of
 * donor type) and named-entity records (only rows whose donor type is on
 * the structural allowlist in campaignFinanceConfig.mjs). No natural-
 * person donor — at any contribution amount — ever produces a named
 * record; isNamedEntityDonor() is the single point of truth for that
 * distinction, imported from config rather than re-implemented here so
 * this function can't quietly drift from the allowlist it's supposed to
 * enforce.
 *
 * Provenance is no longer attached per-record (see CampaignFinanceIndex /
 * CampaignFinanceCandidateDetail in campaignFinanceTypes.ts) — it is
 * written once per output file by main() below. This function's rows
 * carry only the data fields.
 *
 * @param {RawContributionRow[]} rows
 * @returns {{ aggregates: import("../../src/lib/campaignFinanceTypes.js").ContributionAggregate[], namedEntityContributions: import("../../src/lib/campaignFinanceTypes.js").NamedEntityContribution[] }}
 */
export function filterAndAggregate(rows) {
  /** @type {Map<string, { recipientCommittee: string, cycle: string, totalReceiptsUsd: number, bandCounts: Map<string, number> }>} */
  const byCommitteeAndCycle = new Map();
  const namedEntityContributions = [];

  for (const row of rows) {
    const key = `${row.recipientCommittee}::${row.cycle}`;
    if (!byCommitteeAndCycle.has(key)) {
      byCommitteeAndCycle.set(key, {
        recipientCommittee: row.recipientCommittee,
        cycle: row.cycle,
        totalReceiptsUsd: 0,
        bandCounts: new Map(CONTRIBUTION_SIZE_BANDS.map((band) => [band.label, 0])),
      });
    }
    const bucket = byCommitteeAndCycle.get(key);
    bucket.totalReceiptsUsd += row.amountUsd;

    const band = bandForAmount(row.amountUsd);
    if (band) bucket.bandCounts.set(band.label, (bucket.bandCounts.get(band.label) ?? 0) + 1);

    // The entire donor-privacy decision, in one branch: named entities
    // (PAC, party unit, lobbyist principal, corporate) get a named
    // record; everyone else — every natural person, regardless of amount
    // — contributes only to the totals/band counts above and is dropped
    // here, before anything is written to disk.
    if (isNamedEntityDonor(row)) {
      namedEntityContributions.push({
        schemaVersion: 1,
        donorName: row.donorName,
        donorType: row.donorType,
        recipientCommittee: row.recipientCommittee,
        cycle: row.cycle,
        amountUsd: row.amountUsd,
        date: row.date,
      });
    }
  }

  const aggregates = Array.from(byCommitteeAndCycle.values()).map((bucket) => ({
    schemaVersion: 1,
    recipientCommittee: bucket.recipientCommittee,
    cycle: bucket.cycle,
    totalReceiptsUsd: bucket.totalReceiptsUsd,
    contributionCountsByBand: CONTRIBUTION_SIZE_BANDS.map((band) => ({
      band,
      count: bucket.bandCounts.get(band.label) ?? 0,
    })),
  }));

  return { aggregates, namedEntityContributions };
}

// Runtime guard, not just a code-review convention: asserts the donor-
// privacy filter was actually applied to a given output before it's
// allowed anywhere near a writeFile call. This is the "test asserting the
// filter is applied before any file write" this scaffold is required to
// carry. It re-checks every named-entity record's donorType against the
// same allowlist filterAndAggregate() used, and independently confirms no
// record in either output array carries donor-identifying fields
// (donorName/donorCity) without a permitted donorType — so a future edit
// that adds an "individual" branch back into filterAndAggregate(), or
// that starts forwarding donorCity, trips this before anything is
// written, not after.
function assertNoIndividualDonorLeak({ aggregates, namedEntityContributions }) {
  for (const record of namedEntityContributions) {
    assert.ok(
      isNamedEntityDonor({ donorType: record.donorType }),
      `[mn-campaign-finance] donor-privacy filter violated: named record for "${record.donorName}" ` +
        `has donorType "${record.donorType}", which is not on the structural allowlist. Refusing to write output.`,
    );
    assert.ok(
      !("donorCity" in record) && !("donorAddress" in record),
      `[mn-campaign-finance] donor-privacy filter violated: named record for "${record.donorName}" ` +
        `carries a location field. Donor addresses/cities are never emitted, per AGENTS.md §1b.`,
    );
  }
  for (const agg of aggregates) {
    assert.ok(
      !("donorName" in agg) && !("contributors" in agg),
      `[mn-campaign-finance] donor-privacy filter violated: aggregate record for ` +
        `"${agg.recipientCommittee}" carries a per-donor field. Aggregates are totals and band counts only.`,
    );
  }
}

const KNOWN_GAPS = [
  "Local (city/county) candidate filings are largely PDF-only and are not covered by this importer yet — FEATURES.md Phase 8.",
  "Federal receipts (OpenFEC) are not merged into this file.",
  "Only the 'Candidates' recipient-type bulk file is ingested — Party unit and PAC recipient files (same schema, confirmed 2026-08-06) are not yet included.",
  "'Self' (candidate self-funding) and 'Other' Contrib-type rows are counted in aggregates but never surfaced as named records — a deliberate fail-closed default, not a gap in coverage of what CFB reports (see mapDonorType() comment).",
];

/**
 * Deterministic filename-safe slug for a recipient committee name — the
 * candidate detail file id. Pure function of the name (no randomness, no
 * run order dependence for the common case) per AGENTS.md §2.2
 * "deterministic and re-runnable." Collisions (two distinct committee
 * names slugifying to the same string — rare, but the real CFB export
 * does contain near-duplicate committee names) are resolved by the
 * caller, which walks committees in a fixed sort order and appends a
 * stable numeric suffix, so the same input file always produces the same
 * ids.
 * @param {string} name
 * @returns {string}
 */
function slugifyCommitteeName(name) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "committee";
}

/**
 * Groups aggregates and named-entity contributions by recipient committee
 * and assigns each committee a deterministic id/slug. Chunking-only
 * reshaping — see the header comment in campaignFinanceTypes.ts. Uses
 * plain loops throughout (never `array.push(...bigArray)`) per the V8
 * call-stack note at the top of this file.
 * @param {import("../../src/lib/campaignFinanceTypes.js").ContributionAggregate[]} aggregates
 * @param {import("../../src/lib/campaignFinanceTypes.js").NamedEntityContribution[]} namedEntityContributions
 * @returns {Map<string, { id: string, recipientCommittee: string, aggregates: import("../../src/lib/campaignFinanceTypes.js").ContributionAggregate[], namedEntityContributions: import("../../src/lib/campaignFinanceTypes.js").NamedEntityContribution[] }>}
 *   keyed by recipientCommittee, in a fixed (sorted) iteration order.
 */
function groupByCommittee(aggregates, namedEntityContributions) {
  const byCommittee = new Map();
  const committeeNamesInOrder = [];

  const ensureBucket = (recipientCommittee) => {
    if (!byCommittee.has(recipientCommittee)) {
      byCommittee.set(recipientCommittee, {
        id: null,
        recipientCommittee,
        aggregates: [],
        namedEntityContributions: [],
      });
      committeeNamesInOrder.push(recipientCommittee);
    }
    return byCommittee.get(recipientCommittee);
  };

  for (const agg of aggregates) ensureBucket(agg.recipientCommittee).aggregates.push(agg);
  for (const rec of namedEntityContributions) ensureBucket(rec.recipientCommittee).namedEntityContributions.push(rec);

  // Sort committee names for a stable, run-order-independent id
  // assignment, then walk in that fixed order so a slug collision always
  // resolves the same way given the same input roster.
  committeeNamesInOrder.sort((a, b) => a.localeCompare(b));
  const usedSlugs = new Set();
  for (const name of committeeNamesInOrder) {
    const baseSlug = slugifyCommitteeName(name);
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    byCommittee.get(name).id = slug;
  }

  return byCommittee;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const { rows: rawRows, fetchedFiles, rawTexts } = await fetchRawContributions();

  const contentHash = createHash("sha256").update(rawTexts.join("\n")).digest("hex");

  const { aggregates, namedEntityContributions } = filterAndAggregate(rawRows);

  // Required before any write below — see assertNoIndividualDonorLeak()'s
  // own comment for why this can't be skipped or moved after writeFile.
  assertNoIndividualDonorLeak({ aggregates, namedEntityContributions });

  const individualRowCount = rawRows.length - namedEntityContributions.length;

  /** @type {import("../../src/lib/campaignFinanceTypes.js").CampaignFinanceProvenance} */
  const provenance = {
    primarySourceUrl: BULK_DATA_SOURCES[0].url,
    sourceAgency: SOURCE_AGENCY,
    documentType: "campaign finance bulk export",
    documentId: null,
    issuedDate: null,
    fetchedAt,
    licence: SOURCE_LICENCE,
    contentHash,
  };

  const byCommittee = groupByCommittee(aggregates, namedEntityContributions);

  await mkdir(CANDIDATES_DIR, { recursive: true });

  const cycles = new Set();
  const candidateSummaries = [];

  // Sorted iteration (Map insertion order here already follows the sorted
  // committeeNamesInOrder walk in groupByCommittee) keeps both the written
  // file set and the index's candidate list order deterministic.
  for (const bucket of byCommittee.values()) {
    let totalReceiptsUsdAllCycles = 0;
    for (const agg of bucket.aggregates) {
      cycles.add(agg.cycle);
      totalReceiptsUsdAllCycles += agg.totalReceiptsUsd;
    }

    const dataPath = `/campaign-finance/candidates/${bucket.id}.json`;

    /** @type {import("../../src/lib/campaignFinanceTypes.js").CampaignFinanceCandidateDetail} */
    const detail = {
      schemaVersion: 1,
      id: bucket.id,
      recipientCommittee: bucket.recipientCommittee,
      provenance,
      aggregates: bucket.aggregates,
      namedEntityContributions: bucket.namedEntityContributions,
    };
    await writeFile(path.join(CANDIDATES_DIR, `${bucket.id}.json`), JSON.stringify(detail));

    candidateSummaries.push({
      id: bucket.id,
      recipientCommittee: bucket.recipientCommittee,
      cycles: bucket.aggregates.map((agg) => agg.cycle).sort((a, b) => a.localeCompare(b)),
      totalReceiptsUsdAllCycles,
      dataPath,
    });
  }

  /** @type {import("../../src/lib/campaignFinanceTypes.js").CampaignFinanceIndex} */
  const index = {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    itemizationThresholdUsd: ITEMIZATION_THRESHOLD_USD,
    itemizationThresholdSourceUrl: ITEMIZATION_THRESHOLD_SOURCE_URL,
    provenance,
    cycles: Array.from(cycles).sort((a, b) => a.localeCompare(b)),
    candidates: candidateSummaries,
    knownGaps: KNOWN_GAPS,
  };

  // Compact, not pretty-printed — same convention as the per-candidate
  // detail files above. This is the one file every visitor loads upfront
  // (AGENTS.md §0.7), so indentation whitespace is pure budget waste here.
  await writeFile(INDEX_PATH, JSON.stringify(index));

  console.log(
    `[done] parsed ${rawRows.length} row(s) from ${fetchedFiles.length} file(s) ` +
      `(${individualRowCount} individual/unmapped rows folded into aggregates only); ` +
      `wrote ${candidateSummaries.length} candidate detail file(s) under ${CANDIDATES_DIR} ` +
      `and index to ${INDEX_PATH} ` +
      `(${aggregates.length} aggregate(s), ${namedEntityContributions.length} named-entity record(s) total)`,
  );
}

// Only run when invoked directly (`node scripts/ingest/mn-campaign-finance.mjs`),
// not when filterAndAggregate/assertNoIndividualDonorLeak are imported for
// review or by a future test runner.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[fatal]", err.message);
    process.exit(1);
  });
}
