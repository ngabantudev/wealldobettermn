#!/usr/bin/env node
// scripts/ingest/mn-campaign-finance.mjs
//
// SCAFFOLD — FEATURES.md Phase 8 ("Optional / later"). This script is not
// wired into `npm run data:all` and does not ship real data yet. It
// establishes the shape and, critically, the donor-privacy enforcement
// point for a future MN Campaign Finance Board importer, per AGENTS.md
// §1b/§1d.
//
// Dependency-free Node, same convention as every other scripts/*.mjs in
// this repo: built-in fetch + node:fs only, no npm dependency added for
// parsing.
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
// --- What's actually implemented here vs. left as a TODO -------------
//
// The MN CFB bulk-download endpoint (exact URL/format: CSV export vs. an
// API) is not filled in below — recording an unverified URL as fact would
// violate this project's own sourcing discipline (AGENTS.md §3.3). Fetch
// https://cfb.mn.gov/ (Data & Statistics / Public Records section) by
// hand, confirm the current bulk-file URL and its exact column schema,
// and fill in fetchRawContributions() before this script ingests real
// data. Everything downstream of "an array of raw contribution rows in
// the shape parseRawRow() expects" is implemented and enforced.

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
const OUTPUT_PATH = path.join(__dirname, "../../public/campaign-finance.json");

const USER_AGENT = "wealldobettermn-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pipeline)";

const SOURCE_AGENCY = "Minnesota Campaign Finance and Public Disclosure Board";
const SOURCE_LICENCE = "Public record under Minn. Stat. ch. 10A — verify current redistribution terms on cfb.mn.gov before publishing.";

// TODO(Phase 8): confirm the current bulk-download URL on cfb.mn.gov and
// replace this placeholder. Left unresolved rather than guessed, per
// AGENTS.md §3.3 ("Never fabricate or infer. If an upstream field or link
// does not exist, leave it null").
const BULK_DATA_SOURCE_URL = null;

/**
 * Fetches the raw upstream rows. Deliberately unimplemented — see the
 * TODO above. Throwing rather than returning a mock/sample array is the
 * point: AGENTS.md §0.3 and this task's own scope forbid shipping
 * placeholder data as if it were real, even in a scaffold.
 * @returns {Promise<RawContributionRow[]>}
 */
async function fetchRawContributions() {
  if (!BULK_DATA_SOURCE_URL) {
    throw new Error(
      "[mn-campaign-finance] BULK_DATA_SOURCE_URL is not configured yet. " +
        "This is a Phase 8 scaffold — confirm the current MN CFB bulk-data " +
        "URL and column schema, fill in BULK_DATA_SOURCE_URL and parseRawRow(), " +
        "then remove this guard. Not implemented as a stand-in with sample data " +
        "because this project never ships placeholder data as fact (AGENTS.md §0.3).",
    );
  }
  const res = await fetch(BULK_DATA_SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${BULK_DATA_SOURCE_URL}`);
  const raw = await res.text();
  return parseRawRows(raw);
}

/**
 * @typedef {Object} RawContributionRow
 * @property {string} donorName
 * @property {string} donorType - upstream's own donor-type field, expected
 *   values include "individual" plus the entity types in
 *   NAMED_ENTITY_DONOR_TYPES (campaignFinanceConfig.mjs) — normalize
 *   whatever the real CFB schema calls these before this reaches the
 *   filter, so the filter doesn't have to know upstream's exact vocabulary.
 * @property {string} recipientCommittee
 * @property {string} cycle
 * @property {number} amountUsd
 * @property {string} date - ISO date
 * @property {string} donorCity - present on the upstream record; never
 *   forwarded to output for any donor type, and never geocoded, per
 *   AGENTS.md §1b ("Never geocode a donor address").
 */

/**
 * Parses the raw upstream payload into RawContributionRow[]. Left
 * unimplemented alongside fetchRawContributions() above — the exact
 * upstream format (CSV columns, delimiter, header names) needs to be
 * confirmed against the real bulk file, not guessed.
 * @param {string} raw
 * @returns {RawContributionRow[]}
 */
function parseRawRows(raw) {
  void raw;
  throw new Error("[mn-campaign-finance] parseRawRows() is not implemented yet — see BULK_DATA_SOURCE_URL TODO.");
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
 * @param {RawContributionRow[]} rows
 * @param {{ primarySourceUrl: string, documentId: string|null, issuedDate: string|null, fetchedAt: string, contentHash: string }} provenance
 * @returns {{ aggregates: import("../../src/lib/campaignFinanceTypes.js").ContributionAggregate[], namedEntityContributions: import("../../src/lib/campaignFinanceTypes.js").NamedEntityContribution[] }}
 */
export function filterAndAggregate(rows, provenance) {
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
        primarySourceUrl: provenance.primarySourceUrl,
        sourceAgency: SOURCE_AGENCY,
        documentType: "campaign finance bulk export",
        documentId: provenance.documentId,
        issuedDate: provenance.issuedDate,
        fetchedAt: provenance.fetchedAt,
        licence: SOURCE_LICENCE,
        contentHash: provenance.contentHash,
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
    primarySourceUrl: provenance.primarySourceUrl,
    sourceAgency: SOURCE_AGENCY,
    documentType: "campaign finance bulk export",
    documentId: provenance.documentId,
    issuedDate: provenance.issuedDate,
    fetchedAt: provenance.fetchedAt,
    licence: SOURCE_LICENCE,
    contentHash: provenance.contentHash,
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

async function main() {
  const fetchedAt = new Date().toISOString();
  const rawRows = await fetchRawContributions();

  const contentHash = createHash("sha256").update(JSON.stringify(rawRows)).digest("hex");
  const provenance = {
    primarySourceUrl: BULK_DATA_SOURCE_URL ?? "https://cfb.mn.gov/",
    documentId: null,
    issuedDate: null,
    fetchedAt,
    contentHash,
  };

  const { aggregates, namedEntityContributions } = filterAndAggregate(rawRows, provenance);

  // Required before the write below — see assertNoIndividualDonorLeak()'s
  // own comment for why this can't be skipped or moved after writeFile.
  assertNoIndividualDonorLeak({ aggregates, namedEntityContributions });

  /** @type {import("../../src/lib/campaignFinanceTypes.js").CampaignFinanceExport} */
  const output = {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    itemizationThresholdUsd: ITEMIZATION_THRESHOLD_USD,
    itemizationThresholdSourceUrl: ITEMIZATION_THRESHOLD_SOURCE_URL,
    aggregates,
    namedEntityContributions,
    knownGaps: [
      "Local (city/county) candidate filings are largely PDF-only and are not covered by this importer yet — FEATURES.md Phase 8.",
      "Federal receipts (OpenFEC) are not merged into this file.",
    ],
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[done] wrote ${aggregates.length} aggregate(s) and ${namedEntityContributions.length} named-entity record(s) to ${OUTPUT_PATH}`);
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
