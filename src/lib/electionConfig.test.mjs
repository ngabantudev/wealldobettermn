#!/usr/bin/env node
// src/lib/electionConfig.test.mjs
//
// Tests for the AGENTS.md §3.2 enforcement functions. Uses Node's
// built-in test runner (`node --test`), same convention as
// scripts/ingest/roster-diff.test.mjs — no dependency added for this.
//
// Run directly: node src/lib/electionConfig.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import {
  MN_STATE_GENERAL_ELECTION_DATE,
  STALENESS_THRESHOLD_DAYS,
  assertVerifiedSinceLastGeneralElection,
  isStale,
} from "./electionConfig.ts";

// --- assertVerifiedSinceLastGeneralElection ---------------------------

test("assertVerifiedSinceLastGeneralElection throws when verifiedAt predates the election", () => {
  assert.throws(
    () => assertVerifiedSinceLastGeneralElection("2024-11-04", MN_STATE_GENERAL_ELECTION_DATE, "test record"),
    /predates the most recent/,
  );
});

test("assertVerifiedSinceLastGeneralElection does not throw when verifiedAt is exactly the election date", () => {
  assert.doesNotThrow(() =>
    assertVerifiedSinceLastGeneralElection(MN_STATE_GENERAL_ELECTION_DATE, MN_STATE_GENERAL_ELECTION_DATE, "test record"),
  );
});

test("assertVerifiedSinceLastGeneralElection does not throw when verifiedAt is after the election", () => {
  assert.doesNotThrow(() =>
    assertVerifiedSinceLastGeneralElection("2026-01-01", MN_STATE_GENERAL_ELECTION_DATE, "test record"),
  );
});

test("assertVerifiedSinceLastGeneralElection's message names the failing record's context", () => {
  assert.throws(
    () =>
      assertVerifiedSinceLastGeneralElection(
        "2000-01-01",
        MN_STATE_GENERAL_ELECTION_DATE,
        "public/state-legislature.geojson district 47B",
      ),
    /public\/state-legislature\.geojson district 47B/,
  );
});

// --- isStale ------------------------------------------------------------

test("isStale is false the day a record is verified", () => {
  const asOf = new Date("2026-06-01T00:00:00Z");
  assert.equal(isStale("2026-06-01", asOf), false);
});

test("isStale is false exactly at the threshold boundary", () => {
  const asOf = new Date("2026-06-01T00:00:00Z");
  const verifiedAt = new Date(asOf.getTime() - STALENESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  assert.equal(isStale(verifiedAt, asOf), false);
});

test("isStale is true just past the threshold boundary", () => {
  const asOf = new Date("2026-06-01T00:00:00Z");
  const verifiedAt = new Date(asOf.getTime() - (STALENESS_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  assert.equal(isStale(verifiedAt, asOf), true);
});

test("isStale treats an unparseable/missing verifiedAt as stale, never as fresh", () => {
  assert.equal(isStale(undefined, new Date("2026-06-01T00:00:00Z")), true);
  assert.equal(isStale("", new Date("2026-06-01T00:00:00Z")), true);
  assert.equal(isStale("not-a-date", new Date("2026-06-01T00:00:00Z")), true);
});
