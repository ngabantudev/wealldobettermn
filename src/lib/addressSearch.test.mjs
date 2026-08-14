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
function makeIndex(streets, zips = {}, zipCities = {}) {
  return { schemaVersion: 1, generatedAt: "2026-01-01", sourceCounties: [], streets, zips, zipCities };
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

// Regression: MN_SUFFIX_RE used to strip *after* the city-hint loop ran,
// so a trailing state abbreviation ("..., St. Paul, MN") sat between the
// city name and the city-hint regex's own `$` anchor, and the loop never
// matched at all — reproducing the exact "St. Paul doesn't come up" bug
// this file's other St. Paul regression tests exist to catch, just for a
// very common real-world address format (state abbreviation included).
test("parseQuery extracts a trailing city hint even with a trailing state abbreviation", () => {
  const parsed = parseQuery("1501 N Pascal St, St. Paul, MN", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "St. Paul");
  assert.equal(parsed.street, "N PASCAL ST");
});

test("parseQuery extracts a trailing city hint with both a state abbreviation and a ZIP", () => {
  const parsed = parseQuery("1501 N Pascal St, St. Paul, MN 55108", null);
  assert.equal(parsed.kind, "address");
  assert.equal(parsed.cityHint, "St. Paul");
  assert.equal(parsed.zipHint, "55108");
  assert.equal(parsed.street, "N PASCAL ST");
});

// Regression: a shared-boundary edge whose own cityCandidates lists more
// than one at-large city (a real, not-rare shape for small enclave cities
// — Hilltop is a literal enclave inside Columbia Heights, and TIGER's own
// edge data reuses the same boundary segment for both) used to fall to
// "not-covered" even when an explicit cityHint already said which one —
// requiring cities.length === 1 ignored a disambiguation already given.
test("resolve honors an explicit cityHint even when the matched edge's cityCandidates lists two cities", () => {
  const index = makeIndex({
    "MONROE ST NE": [
      {
        tlid: 5,
        coords: [],
        lfromhn: null,
        ltohn: null,
        rfromhn: "4900",
        rtohn: "4928",
        parityL: null,
        parityR: "E",
        zipl: null,
        zipr: null,
        wardCandidates: [],
        cityCandidates: ["Hilltop", "Columbia Heights"],
      },
    ],
  });
  const outcome = resolve(index, {
    kind: "address",
    houseNumber: 4900,
    street: "MONROE ST NE",
    cityHint: "Hilltop",
    zipHint: null,
  });
  assert.equal(outcome.status, "city");
  assert.equal(outcome.city, "Hilltop");
});

test("resolve surfaces an honest, actionable message for a multi-city edge with no hint to disambiguate", () => {
  const index = makeIndex({
    "MONROE ST NE": [
      {
        tlid: 6,
        coords: [],
        lfromhn: null,
        ltohn: null,
        rfromhn: "4900",
        rtohn: "4928",
        parityL: null,
        parityR: "E",
        zipl: null,
        zipr: null,
        wardCandidates: [],
        cityCandidates: ["Hilltop", "Columbia Heights"],
      },
    ],
  });
  const outcome = resolve(index, {
    kind: "address",
    houseNumber: 4900,
    street: "MONROE ST NE",
    cityHint: null,
    zipHint: null,
  });
  assert.equal(outcome.status, "not-covered");
  assert.match(outcome.reason, /Hilltop/);
  assert.match(outcome.reason, /Columbia Heights/);
});

// Regression: resolveZip only ever consulted index.zips (ward candidates),
// never index.zipCities — a ZIP touching both a real ward and an at-large
// city (confirmed on real data: ZIP 55436 is almost entirely Edina, but
// shares one border edge with a St. Louis Park ward) silently resolved to
// the ward alone, guessing wrong for the far more common at-large-city
// resident in that ZIP. Per AGENTS.md §2.5, silently choosing the wrong
// district is the worst failure this site can produce.
test("resolve refuses to silently pick a ward for a ZIP that also touches an at-large city", () => {
  const index = makeIndex({}, { "55436": [{ city: "St. Louis Park", ward: 2 }] }, { "55436": ["Edina"] });
  const outcome = resolve(index, { kind: "zip", zip: "55436" });
  assert.equal(outcome.status, "not-covered");
  assert.match(outcome.reason, /Edina/);
});

test("resolve still resolves a ZIP with only ward candidates exactly as before", () => {
  const index = makeIndex({}, { "55401": [{ city: "Minneapolis", ward: 3 }] });
  const outcome = resolve(index, { kind: "zip", zip: "55401" });
  assert.equal(outcome.status, "single");
  assert.deepEqual(outcome.wards, [{ city: "Minneapolis", ward: 3 }]);
});

test("resolve resolves a ZIP with only at-large city candidates straight to the city", () => {
  const index = makeIndex({}, {}, { "55436": ["Edina"] });
  const outcome = resolve(index, { kind: "zip", zip: "55436" });
  assert.equal(outcome.status, "city");
  assert.equal(outcome.city, "Edina");
});
