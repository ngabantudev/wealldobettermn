#!/usr/bin/env node
// src/lib/termExpires.test.mjs
//
// Run directly: node --test src/lib/termExpires.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { isTermExpired, parseTermExpiresDate } from "./termExpires.ts";

const NOW = new Date("2026-08-11T00:00:00Z");

test("parses a full written-out date", () => {
  const parsed = parseTermExpiresDate("December 31, 2028");
  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2028);
});

test("parses a bare 4-digit year as Dec 31 of that year", () => {
  const parsed = parseTermExpiresDate("Term Expires: 2026");
  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 11); // December
  assert.equal(parsed.getDate(), 31);
});

test("returns null for genuinely unparseable text, never throws", () => {
  assert.equal(parseTermExpiresDate("whenever the council feels like it"), null);
  assert.doesNotThrow(() => parseTermExpiresDate(""));
});

test("isTermExpired is true for a past date", () => {
  assert.equal(isTermExpired("December 31, 2024", NOW), true);
});

test("isTermExpired is false for a future date", () => {
  assert.equal(isTermExpired("December 31, 2028", NOW), false);
});

test("isTermExpired is false (not true) for unparseable text — never a false positive", () => {
  assert.equal(isTermExpired("some day eventually", NOW), false);
});

test("isTermExpired is false for null", () => {
  assert.equal(isTermExpired(null, NOW), false);
});

test("a bare past year is correctly reported as expired", () => {
  assert.equal(isTermExpired("2024", NOW), true);
});

test("parses a real page's exact label+date shape (Hugo, MN: 'Term Expires 12/31/26')", () => {
  const parsed = parseTermExpiresDate("Term Expires 12/31/28");
  assert.ok(parsed);
  assert.equal(parsed.getMonth(), 11);
  assert.equal(parsed.getDate(), 31);
});

test("a bare year embedded in a longer label still expires at year-end, not Jan 1 (the JS Date leniency this module works around)", () => {
  const parsed = parseTermExpiresDate("Term Expires: 2026");
  assert.equal(parsed.getMonth(), 11); // December, not January
  assert.equal(parsed.getDate(), 31);
});
