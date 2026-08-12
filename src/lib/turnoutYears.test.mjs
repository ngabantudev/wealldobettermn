#!/usr/bin/env node
// src/lib/turnoutYears.test.mjs
//
// Tests for turnoutYears.ts — the year-slider's pure index/data-path
// resolution logic. Same convention as turnoutJoin.test.mjs: imports the
// sibling .ts file directly (Node's native TS stripping, no build step)
// and uses node:assert/strict + node:test.
//
// Run directly: node src/lib/turnoutYears.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { yearAtIndex, indexOfYear, resolveYearDataPath } from "./turnoutYears.ts";

const ONE_YEAR = [{ year: "2024", electionType: "general", dataPath: "/turnout/city/2024.json" }];

const SIX_YEARS = [
  { year: "2012", electionType: "general", dataPath: "/turnout/city/2012.json" },
  { year: "2014", electionType: "general", dataPath: "/turnout/city/2014.json" },
  { year: "2016", electionType: "general", dataPath: "/turnout/city/2016.json" },
  { year: "2018", electionType: "general", dataPath: "/turnout/city/2018.json" },
  { year: "2020", electionType: "general", dataPath: "/turnout/city/2020.json" },
  { year: "2022", electionType: "general", dataPath: "/turnout/city/2022.json" },
];

test("yearAtIndex resolves an in-range index to the matching manifest entry", () => {
  assert.equal(yearAtIndex(SIX_YEARS, 0)?.year, "2012");
  assert.equal(yearAtIndex(SIX_YEARS, 3)?.year, "2018");
  assert.equal(yearAtIndex(SIX_YEARS, 5)?.year, "2022");
});

test("yearAtIndex snaps discrete: never returns a mid-step fractional result", () => {
  assert.equal(yearAtIndex(SIX_YEARS, 2.4)?.year, "2016");
  assert.equal(yearAtIndex(SIX_YEARS, 2.6)?.year, "2018");
});

test("yearAtIndex clamps out-of-range indices to the nearest real stop rather than returning null", () => {
  assert.equal(yearAtIndex(SIX_YEARS, -5)?.year, "2012");
  assert.equal(yearAtIndex(SIX_YEARS, 999)?.year, "2022");
});

test("yearAtIndex returns null only when there are no years at all", () => {
  assert.equal(yearAtIndex([], 0), null);
});

test("yearAtIndex on a single-year manifest always resolves to that one year", () => {
  assert.equal(yearAtIndex(ONE_YEAR, 0)?.year, "2024");
  assert.equal(yearAtIndex(ONE_YEAR, 5)?.year, "2024");
});

test("indexOfYear finds the active year's position", () => {
  assert.equal(indexOfYear(SIX_YEARS, "2012"), 0);
  assert.equal(indexOfYear(SIX_YEARS, "2020"), 4);
  assert.equal(indexOfYear(SIX_YEARS, "2022"), 5);
});

test("indexOfYear defaults to the most recent year, not 0, when the active year is unknown/null", () => {
  assert.equal(indexOfYear(SIX_YEARS, null), 5);
  assert.equal(indexOfYear(SIX_YEARS, "1999"), 5);
});

test("indexOfYear on an empty list returns 0 without throwing", () => {
  assert.equal(indexOfYear([], "2024"), 0);
});

test("resolveYearDataPath returns the manifest-declared path for a known year", () => {
  assert.equal(resolveYearDataPath(SIX_YEARS, "2018"), "/turnout/city/2018.json");
  assert.equal(resolveYearDataPath(ONE_YEAR, "2024"), "/turnout/city/2024.json");
});

test("resolveYearDataPath returns null for a year not present in the manifest, never a guessed path", () => {
  assert.equal(resolveYearDataPath(SIX_YEARS, "2013"), null);
  assert.equal(resolveYearDataPath([], "2024"), null);
});
