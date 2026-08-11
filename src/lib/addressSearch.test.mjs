#!/usr/bin/env node
// src/lib/addressSearch.test.mjs
//
// Tests for parseQuery/resolve's "ambiguous-name" handling — the city of
// Ramsey (Anoka County) and Ramsey County (St. Paul's county) share a bare
// name, and per AGENTS.md §2.5 that must be surfaced, never silently
// resolved to one or the other. Same convention as officials.test.mjs.
//
// Run directly: node src/lib/addressSearch.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { fold, parseQuery, resolve } from "./addressSearch.ts";

test("parseQuery treats a bare name that's both a covered city and a covered county as ambiguous", () => {
  const parsed = parseQuery("Ramsey", null);
  assert.equal(parsed.kind, "ambiguous-name");
  assert.equal(parsed.city, "Ramsey");
  assert.equal(parsed.county, "Ramsey");
});

test("parseQuery resolves 'Ramsey County' (explicit suffix) unambiguously to the county", () => {
  const parsed = parseQuery("Ramsey County", null);
  assert.equal(parsed.kind, "county");
  assert.equal(parsed.county, "Ramsey");
});

test("parseQuery still resolves an unambiguous city name normally", () => {
  const parsed = parseQuery("Fridley", null);
  assert.equal(parsed.kind, "city");
  assert.equal(parsed.city, "Fridley");
});

// Regression: the cityHint-extraction loop (meant for "123 Main St, City")
// used to strip a BARE city name down to "" too, since it never checked
// whether the whole query was just the city name rather than a trailing
// suffix on a longer address — every bare city search was silently
// "unparseable" as a result. Covered for a city with no name collision
// (Bloomington) and separately for the address-with-trailing-city shape,
// so the fix can't regress either direction.
test("parseQuery does not swallow a bare city name into an empty remainder", () => {
  const parsed = parseQuery("Bloomington", null);
  assert.equal(parsed.kind, "city");
  assert.equal(parsed.city, "Bloomington");
});

test("parseQuery still extracts a trailing city hint from a real address", () => {
  const parsed = parseQuery("123 Main St, Fridley", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "Fridley");
  assert.equal(parsed.houseNumber, 123);
});

test("parseQuery still resolves an unambiguous county name normally", () => {
  const parsed = parseQuery("Hennepin", null);
  assert.equal(parsed.kind, "county");
  assert.equal(parsed.county, "Hennepin");
});

test("resolve surfaces both options for an ambiguous name rather than picking one", () => {
  const outcome = resolve(null, { kind: "ambiguous-name", city: "Ramsey", county: "Ramsey" });
  assert.equal(outcome.status, "ambiguous-name");
  assert.equal(outcome.city, "Ramsey");
  assert.equal(outcome.county, "Ramsey");
});

// --- "uncovered-place" -> SearchOutcome (AGENTS.md §2.6 entry point) -------

test("resolve gives an uncovered CITY the actionable uncovered-city status, with the plain name and a reason", () => {
  const outcome = resolve(null, { kind: "uncovered-place", name: "Worthington", placeType: "city" });
  assert.equal(outcome.status, "uncovered-city");
  assert.equal(outcome.name, "Worthington");
  assert.match(outcome.reason, /Worthington/);
});

test("resolve keeps an uncovered COUNTY on plain not-covered — §2.6 scopes the pipeline to cities only", () => {
  const outcome = resolve(null, { kind: "uncovered-place", name: "Watonwan", placeType: "county" });
  assert.equal(outcome.status, "not-covered");
  assert.match(outcome.reason, /Watonwan County/);
});

test("parseQuery classifies a real, uncovered MN city as uncovered-place when allPlaces is provided", () => {
  const allPlaces = { cities: ["Worthington"], counties: ["Watonwan"] };
  const parsed = parseQuery("Worthington", allPlaces);
  assert.equal(parsed.kind, "uncovered-place");
  assert.equal(parsed.name, "Worthington");
  assert.equal(parsed.placeType, "city");
});

test("parseQuery falls back to unparseable for an uncovered place when allPlaces hasn't loaded yet", () => {
  const parsed = parseQuery("Worthington", null);
  assert.equal(parsed.kind, "unparseable");
});

// --- fold() (shared between addressSearch.ts and WardMap.tsx/WardModal.tsx's
// own CTU-vs-CITIES spelling reconciliation — AGENTS.md §2.6) ---------------

test("fold() reconciles 'Saint' (CTU spelling) with 'St.' (CITIES spelling)", () => {
  assert.equal(fold("Saint Paul"), fold("St. Paul"));
  assert.equal(fold("Saint Louis Park"), fold("St. Louis Park"));
});

test("fold() is case-insensitive and punctuation/whitespace-insensitive", () => {
  assert.equal(fold("st.  paul"), fold("ST PAUL"));
});

test("fold() does not conflate two genuinely different city names", () => {
  assert.notEqual(fold("St. Paul"), fold("St. Louis Park"));
});
