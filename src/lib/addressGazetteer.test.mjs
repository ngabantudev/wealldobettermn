// src/lib/addressChunks.test.mjs
//
// Tests for mergeIndex/suggestStreetNamesFromManifest — the chunked-
// gazetteer plumbing added for issue #70. The load-bearing property under
// test is AGENTS.md §2.5's "ambiguity is surfaced, never silently
// resolved": a street that exists in two counties must merge edges from
// both loaded chunks, never let one overwrite the other.
//
// Also covers suggestStreetsForHouseNumberFromManifest — the manifest-
// only house-number suggestion path added so a bare house number
// ("1501", nothing else typed yet) can suggest real streets instantly,
// before any county chunk has been fetched. See houseNumberRanges' own
// comment on AddressGazetteerManifest (src/lib/types.ts) for why it's a
// coarse [min, max] span rather than the real per-segment ranges, and why
// that's safe (suggestion-only; resolveAddress in addressSearch.ts never
// reads this field).
//
// Run directly: node src/lib/addressChunks.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { mergeIndex, suggestStreetNamesFromManifest, suggestStreetsForHouseNumberFromManifest } from "./addressGazetteer.ts";

function makeManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-08",
    sourceCounties: [
      { key: "hennepin", name: "Hennepin County, MN", fips: "27053", url: "https://example.test/hennepin" },
      { key: "ramsey", name: "Ramsey County, MN", fips: "27123", url: "https://example.test/ramsey" },
    ],
    chunks: [],
    zips: { "55401": [{ city: "Minneapolis", ward: 3 }] },
    streetChunks: { "MAIN ST": ["hennepin", "ramsey"], "1ST AVE": ["hennepin"] },
    houseNumberRanges: {},
    ...overrides,
  };
}

function makeChunk(key, streets) {
  return { schemaVersion: 1, county: { key, name: `${key} County`, fips: "00000" }, streets };
}

test("mergeIndex combines edges from two loaded chunks for the same street, never overwriting one with the other", () => {
  const manifest = makeManifest();
  const hennepinEdge = { tlid: 1, coords: [], lfromhn: "100", ltohn: "200", rfromhn: null, rtohn: null, parityL: "B", parityR: null, zipl: null, zipr: null, wardCandidates: [{ city: "Minneapolis", ward: 3 }] };
  const ramseyEdge = { tlid: 2, coords: [], lfromhn: "300", ltohn: "400", rfromhn: null, rtohn: null, parityL: "B", parityR: null, zipl: null, zipr: null, wardCandidates: [{ city: "St. Paul", ward: 5 }] };
  const chunks = new Map([
    ["hennepin", makeChunk("hennepin", { "MAIN ST": [hennepinEdge] })],
    ["ramsey", makeChunk("ramsey", { "MAIN ST": [ramseyEdge] })],
  ]);

  const merged = mergeIndex(manifest, chunks);

  assert.equal(merged.streets["MAIN ST"].length, 2);
  assert.deepEqual(merged.streets["MAIN ST"].map((e) => e.tlid).sort(), [1, 2]);
});

test("mergeIndex's zips always come straight from the manifest, regardless of which chunks are loaded", () => {
  const manifest = makeManifest();
  const merged = mergeIndex(manifest, new Map());
  assert.deepEqual(merged.zips, manifest.zips);
});

test("mergeIndex never invents a street that isn't in any loaded chunk", () => {
  const manifest = makeManifest();
  const chunks = new Map([["hennepin", makeChunk("hennepin", { "1ST AVE": [] })]]);
  const merged = mergeIndex(manifest, chunks);
  assert.equal(merged.streets["MAIN ST"], undefined);
  assert.ok("1ST AVE" in merged.streets);
});

test("suggestStreetNamesFromManifest matches by prefix over the full street universe, not just loaded chunks", () => {
  const manifest = makeManifest();
  const matches = suggestStreetNamesFromManifest(manifest, "MAIN", 10);
  assert.deepEqual(matches, ["MAIN ST"]);
});

test("suggestStreetNamesFromManifest returns nothing for an empty prefix", () => {
  const manifest = makeManifest();
  assert.deepEqual(suggestStreetNamesFromManifest(manifest, "", 10), []);
});

test("suggestStreetsForHouseNumberFromManifest finds a street whose span contains the house number", () => {
  const manifest = makeManifest({ houseNumberRanges: { "N PASCAL ST": [1, 2299], "MAIN ST": [100, 198] } });
  const matches = suggestStreetsForHouseNumberFromManifest(manifest, 1501, 8);
  assert.deepEqual(matches, ["N PASCAL ST"]);
});

test("suggestStreetsForHouseNumberFromManifest excludes a street whose span doesn't contain the number", () => {
  const manifest = makeManifest({ houseNumberRanges: { "MAIN ST": [100, 198] } });
  const matches = suggestStreetsForHouseNumberFromManifest(manifest, 1501, 8);
  assert.deepEqual(matches, []);
});

test("suggestStreetsForHouseNumberFromManifest matches at the exact span boundaries (inclusive)", () => {
  const manifest = makeManifest({ houseNumberRanges: { "MAIN ST": [100, 198] } });
  assert.deepEqual(suggestStreetsForHouseNumberFromManifest(manifest, 100, 8), ["MAIN ST"]);
  assert.deepEqual(suggestStreetsForHouseNumberFromManifest(manifest, 198, 8), ["MAIN ST"]);
  assert.deepEqual(suggestStreetsForHouseNumberFromManifest(manifest, 199, 8), []);
  assert.deepEqual(suggestStreetsForHouseNumberFromManifest(manifest, 99, 8), []);
});

test("suggestStreetsForHouseNumberFromManifest respects the limit and returns sorted results", () => {
  const manifest = makeManifest({
    houseNumberRanges: { "C ST": [1, 100], "A ST": [1, 100], "B ST": [1, 100] },
  });
  const matches = suggestStreetsForHouseNumberFromManifest(manifest, 50, 2);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches, [...matches].sort());
});
