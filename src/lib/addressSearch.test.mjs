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
import { parseQuery, resolve } from "./addressSearch.ts";

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

// Regression: cityMatchPattern/the cityHint loop used to strip a trailing
// city hint by testing a regex built from the *folded* city name ("ST
// PAUL") against the raw, unfolded query — so any city whose folded form
// dropped punctuation (fold() flattens "St." and "Saint" both to "ST")
// never matched the raw "St." or "Saint" text actually typed, and the city
// name stayed glued onto the street, which then failed to match anything
// in the index. This is the reported "St. Paul addresses don't come up"
// bug — covered for the natural "St." spelling, the spelled-out "Saint"
// form, and the already-working unpunctuated "St" form, so none of the
// three can regress independently.
test("parseQuery extracts a trailing city hint spelled 'St. Paul' (with period)", () => {
  const parsed = parseQuery("1501 N Pascal St, St. Paul", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "St. Paul");
  assert.equal(parsed.street, "N PASCAL ST");
});

test("parseQuery extracts a trailing city hint spelled out 'Saint Paul'", () => {
  const parsed = parseQuery("1501 N Pascal St, Saint Paul", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "St. Paul");
});

test("parseQuery extracts a trailing city hint spelled 'St Paul' (no period)", () => {
  const parsed = parseQuery("1501 N Pascal St, St Paul", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "St. Paul");
});

test("parseQuery extracts a trailing city hint for 'St. Louis Park' (two-word St. city)", () => {
  const parsed = parseQuery("100 Excelsior Blvd, St. Louis Park", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "St. Louis Park");
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

// Regression: a street address inside an AT_LARGE_CITIES city (Edina, Golden
// Valley, ...) has no ward polygon to match — those cities elect every seat
// citywide — so wardCandidates is always empty for them, even for a street
// scripts/fetch-addresses.mjs's own TIGER fetch genuinely indexed (they sit
// inside an indexed county, just not an indexed *ward*). Before
// cityCandidates existed, that indistinguishably fell to the same
// "not-covered" outcome as a real gap, which read as "Edina isn't a city
// this map covers" — false; Edina has a roster, just no ward map. A minimal
// synthetic index (rather than the real, large, regeneratable
// public/address-index/ chunks) is enough to exercise resolveAddress's own
// branch logic directly.
function makeIndex(streets, zips = {}) {
  return { schemaVersion: 1, generatedAt: "2026-01-01", sourceCounties: [], streets, zips };
}

test("resolve treats a street address inside an at-large city as 'city', not 'not-covered'", () => {
  const index = makeIndex({
    "INTERLACHEN BLVD": [
      {
        tlid: 1,
        coords: [],
        lfromhn: null,
        ltohn: null,
        rfromhn: "6500",
        rtohn: "6598",
        parityL: null,
        parityR: "E",
        zipl: null,
        zipr: "55436",
        wardCandidates: [],
        cityCandidates: ["Edina"],
      },
    ],
  });
  const outcome = resolve(index, { kind: "address", houseNumber: 6500, street: "INTERLACHEN BLVD", cityHint: null, zipHint: null });
  assert.equal(outcome.status, "city");
  assert.equal(outcome.city, "Edina");
});

test("resolve still returns 'not-covered' for a street with no ward AND no city candidates", () => {
  const index = makeIndex({
    "SOME RD": [
      {
        tlid: 2,
        coords: [],
        lfromhn: null,
        ltohn: null,
        rfromhn: "100",
        rtohn: "198",
        parityL: null,
        parityR: "E",
        zipl: null,
        zipr: null,
        wardCandidates: [],
        // no cityCandidates at all — a genuinely uncovered street, same as
        // before this fix existed.
      },
    ],
  });
  const outcome = resolve(index, { kind: "address", houseNumber: 100, street: "SOME RD", cityHint: null, zipHint: null });
  assert.equal(outcome.status, "not-covered");
});

test("resolve narrows by cityHint against cityCandidates, not just wardCandidates", () => {
  const index = makeIndex({
    "MAIN ST": [
      // A street name shared between a real ward city (Fridley) and an
      // at-large city (Edina) — an explicit ", Edina" hint must pick the
      // at-large match, not fall through to whichever edge happens first.
      {
        tlid: 3,
        coords: [[0, 0], [0, 0]],
        lfromhn: null,
        ltohn: null,
        rfromhn: "100",
        rtohn: "198",
        parityL: null,
        parityR: "E",
        zipl: null,
        zipr: null,
        wardCandidates: [{ city: "Fridley", ward: 1 }],
      },
      {
        tlid: 4,
        coords: [],
        lfromhn: null,
        ltohn: null,
        rfromhn: "100",
        rtohn: "198",
        parityL: null,
        parityR: "E",
        zipl: null,
        zipr: null,
        wardCandidates: [],
        cityCandidates: ["Edina"],
      },
    ],
  });
  const outcome = resolve(index, { kind: "address", houseNumber: 100, street: "MAIN ST", cityHint: "Edina", zipHint: null });
  assert.equal(outcome.status, "city");
  assert.equal(outcome.city, "Edina");
});
