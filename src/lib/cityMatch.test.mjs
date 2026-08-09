#!/usr/bin/env node
// src/lib/cityMatch.test.mjs
//
// Run directly: node --test src/lib/cityMatch.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { matchCity } from "./cityMatch.ts";

test("recognizes a real, uncovered MN city and reports it as not already covered", () => {
  const result = matchCity("Worthington");
  assert.equal(result.recognized, true);
  assert.equal(result.alreadyCovered, false);
  assert.equal(result.canonicalName, "Worthington");
  assert.equal(typeof result.lng, "number");
  assert.equal(typeof result.lat, "number");
});

test("recognizes an already-covered city and flags it as such", () => {
  const result = matchCity("Minneapolis");
  assert.equal(result.recognized, true);
  assert.equal(result.alreadyCovered, true);
});

test("reconciles 'Saint Paul' (CTU spelling) with the covered 'St. Paul'", () => {
  const result = matchCity("Saint Paul");
  assert.equal(result.recognized, true);
  assert.equal(result.alreadyCovered, true);
});

test("does not recognize a made-up place name", () => {
  const result = matchCity("Not A Real Minnesota City At All");
  assert.equal(result.recognized, false);
  assert.equal(result.alreadyCovered, false);
  assert.equal(result.canonicalName, null);
});

test("is case- and whitespace-insensitive", () => {
  const result = matchCity("  worthington  ");
  assert.equal(result.recognized, true);
  assert.equal(result.canonicalName, "Worthington");
});

test("treats a blank submission as unrecognized rather than throwing", () => {
  const result = matchCity("   ");
  assert.equal(result.recognized, false);
});
