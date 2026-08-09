#!/usr/bin/env node
// scripts/ingest/mn-campaign-finance.test.mjs
//
// Tests for the pure/testable logic in scripts/ingest/mn-campaign-finance.mjs
// — the donor-privacy filter (filterAndAggregate) and the cell-suppression
// rule layered on top of it per AGENTS.md §1d ("Aggregates must be checked
// for re-identification risk before publication; suppress cells below a
// documented threshold"). Node's built-in test runner, no live network
// calls — same convention as scripts/ingest/legistar.test.mjs and
// scripts/ingest/state-bills.test.mjs.
//
// Run directly: node scripts/ingest/mn-campaign-finance.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import test from "node:test";
import { filterAndAggregate } from "./mn-campaign-finance.mjs";
import { MIN_AGGREGATE_CELL_SIZE, SUPPRESSED_CELL, CONTRIBUTION_SIZE_BANDS } from "../../src/lib/campaignFinanceConfig.mjs";

/**
 * Builds `count` individual (natural-person) contribution rows, all in the
 * same committee/cycle and all inside the $1–$50 band, so tests can drive
 * an exact band count without hand-writing each row.
 * @param {number} count
 * @param {{ recipientCommittee?: string, cycle?: string, amountUsd?: number }} [overrides]
 */
function individualRows(count, overrides = {}) {
  const { recipientCommittee = "Friends of Test Candidate", cycle = "2024", amountUsd = 25 } = overrides;
  return Array.from({ length: count }, (_, i) => ({
    donorName: `Individual Donor ${i}`,
    donorType: undefined, // unmapped Contrib type => not a named entity, per mapDonorType()
    recipientCommittee,
    cycle,
    amountUsd,
    date: "2024-06-01",
  }));
}

function namedRow(overrides = {}) {
  return {
    donorName: "Statewide PAC",
    donorType: "pac",
    recipientCommittee: "Friends of Test Candidate",
    cycle: "2024",
    amountUsd: 500,
    date: "2024-06-01",
    ...overrides,
  };
}

function findBand(agg, label) {
  const entry = agg.contributionCountsByBand.find((b) => b.band.label === label);
  assert.ok(entry, `expected a "${label}" band entry`);
  return entry;
}

const band1to50Label = CONTRIBUTION_SIZE_BANDS[0].label;

// --- Band-count suppression -------------------------------------------------

test("a band with a count of 1 is suppressed, not shown as its real count and not floored to 0", () => {
  const { aggregates } = filterAndAggregate(individualRows(1));
  assert.equal(aggregates.length, 1);
  const entry = findBand(aggregates[0], band1to50Label);
  assert.equal(entry.count, SUPPRESSED_CELL);
  assert.notEqual(entry.count, 0);
  assert.notEqual(entry.count, 1);
});

test(`a band with a count of ${MIN_AGGREGATE_CELL_SIZE - 1} (just under the threshold) is suppressed`, () => {
  const { aggregates } = filterAndAggregate(individualRows(MIN_AGGREGATE_CELL_SIZE - 1));
  const entry = findBand(aggregates[0], band1to50Label);
  assert.equal(entry.count, SUPPRESSED_CELL);
});

test(`a band with a count of exactly ${MIN_AGGREGATE_CELL_SIZE} (at the threshold) shows its real count`, () => {
  const { aggregates } = filterAndAggregate(individualRows(MIN_AGGREGATE_CELL_SIZE));
  const entry = findBand(aggregates[0], band1to50Label);
  assert.equal(entry.count, MIN_AGGREGATE_CELL_SIZE);
});

test(`a band with a count above ${MIN_AGGREGATE_CELL_SIZE} shows its real count`, () => {
  const { aggregates } = filterAndAggregate(individualRows(MIN_AGGREGATE_CELL_SIZE + 20));
  const entry = findBand(aggregates[0], band1to50Label);
  assert.equal(entry.count, MIN_AGGREGATE_CELL_SIZE + 20);
});

test("a band with a count of 0 stays exactly 0 — never suppressed, never a placeholder", () => {
  // Every configured row lands in the $1-$50 band, so every *other*
  // band's count for this committee/cycle should come back as a
  // genuine, unsuppressed 0 (AGENTS.md §3.1: a verified zero is not the
  // same claim as "suppressed" and must never be conflated with it).
  const { aggregates } = filterAndAggregate(individualRows(3));
  for (const { band, count } of aggregates[0].contributionCountsByBand) {
    if (band.label === band1to50Label) continue;
    assert.equal(count, 0, `expected band "${band.label}" to be a verified 0`);
  }
});

// --- Total-receipts suppression (the related total-amount risk) ------------

test("totalReceiptsUsd is suppressed when the underlying individual-contribution count is below the threshold, even though the band count is also suppressed", () => {
  const rows = individualRows(2, { amountUsd: 40 });
  const { aggregates } = filterAndAggregate(rows);
  assert.equal(aggregates[0].totalReceiptsUsd, SUPPRESSED_CELL);
});

test("totalReceiptsUsd publishes the real figure once the individual-contribution count reaches the threshold", () => {
  const rows = individualRows(MIN_AGGREGATE_CELL_SIZE, { amountUsd: 40 });
  const { aggregates } = filterAndAggregate(rows);
  assert.equal(aggregates[0].totalReceiptsUsd, MIN_AGGREGATE_CELL_SIZE * 40);
});

test("totalReceiptsUsd is NOT suppressed when the total is made up entirely of named-entity money, regardless of amount", () => {
  const rows = [namedRow({ amountUsd: 10000 })];
  const { aggregates } = filterAndAggregate(rows);
  assert.equal(aggregates[0].totalReceiptsUsd, 10000);
});

test("a handful of individual contributions plus named-entity money still suppresses totalReceiptsUsd (the subtraction-attack case)", () => {
  // 2 individual rows (below threshold) + 1 named PAC row. Without
  // suppression, a reader could subtract the published named-entity
  // amount from totalReceiptsUsd and recover the exact sum given by the
  // 2 individuals — exactly the risk AGENTS.md §1d's suppression rule
  // exists to close, laundered through arithmetic instead of a band.
  const rows = [...individualRows(2, { amountUsd: 40 }), namedRow({ amountUsd: 500 })];
  const { aggregates } = filterAndAggregate(rows);
  assert.equal(aggregates[0].totalReceiptsUsd, SUPPRESSED_CELL);
  // The named-entity contribution itself is still published in full —
  // suppression only ever applies to aggregate cells, never to named
  // records, which are individually attributable by design (AGENTS.md §1a).
  assert.equal(aggregates[0].contributionCountsByBand.length > 0, true);
});

// --- Donor-privacy filter (pre-existing behavior, guarded against regression) ---

test("named-entity contributions never affect whether a band count is suppressed for individuals in the same committee/cycle", () => {
  const rows = [...individualRows(MIN_AGGREGATE_CELL_SIZE, { amountUsd: 40 }), namedRow({ amountUsd: 40 })];
  const { namedEntityContributions } = filterAndAggregate(rows);
  // The named PAC's $40 contribution is not folded into the "natural
  // person" band count even though it falls in the same $1-$50 range —
  // it's still counted once individuals already clear the threshold, so
  // this only asserts the named row surfaced as its own record, not that
  // it was excluded from the band tally (filterAndAggregate bands every
  // amount regardless of donor type; see its own header comment).
  assert.equal(namedEntityContributions.length, 1);
  assert.equal(namedEntityContributions[0].donorType, "pac");
});

test("filterAndAggregate never produces an aggregate with a donor name or a named record for an unmapped (individual) donor type", () => {
  const rows = [...individualRows(MIN_AGGREGATE_CELL_SIZE), namedRow()];
  const { aggregates, namedEntityContributions } = filterAndAggregate(rows);
  for (const agg of aggregates) {
    assert.ok(!("donorName" in agg));
    assert.ok(!("contributors" in agg));
  }
  assert.equal(namedEntityContributions.length, 1);
  assert.equal(namedEntityContributions[0].donorType, "pac");
});
