#!/usr/bin/env node
// src/lib/turnoutJoin.test.mjs
//
// Tests for turnoutJoin.ts — the city-boundaries <-> turnout-city join.
// Same convention as cityGroups.test.mjs: imports the sibling .ts file
// directly (Node's native TS stripping, no build step) and uses
// node:assert/strict + node:test.
//
// Run directly: node src/lib/turnoutJoin.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeCityKey,
  normalizeCountyKey,
  joinCityBoundaryToTurnout,
  joinAllCityBoundaries,
} from "./turnoutJoin.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("normalizeCityKey treats 'Saint' and 'St.' spellings as equal", () => {
  assert.equal(normalizeCityKey("Saint Paul"), normalizeCityKey("St. Paul"));
  assert.equal(normalizeCityKey("Saint Anthony"), normalizeCityKey("St. Anthony"));
  assert.equal(normalizeCityKey("Ada"), "ada");
});

test("normalizeCountyKey handles punctuation and 'Saint'/'St.' the same way", () => {
  assert.equal(normalizeCountyKey("St. Louis"), normalizeCountyKey("Saint Louis"));
  assert.equal(normalizeCountyKey("Hennepin"), "hennepin");
});

// The real, confirmed collision this module exists to handle: two
// distinct Minnesota cities are both named St. Anthony/Saint Anthony —
// a Hennepin/Ramsey-straddling city and an unrelated small city in
// Stearns County. Fixture built from the real shapes both datasets use
// (city-boundaries.geojson's per-county polygon properties; turnout's
// per-cityId records), not simplified away, since the collision is
// exactly the case the join has to get right.
const STEARNS_ST_ANTHONY = {
  cityId: "st-anthony-2",
  cityName: "St. Anthony",
  counties: ["Stearns"],
  turnoutOfRegistered: 0.9074074074074074,
  turnoutOfCVAP: 1.225,
  belowThreshold: true,
  ballotsCast: 49,
  registeredAt7am: 53,
  electionDayRegistrations: 1,
};

const HENNEPIN_RAMSEY_ST_ANTHONY = {
  cityId: "st-anthony",
  cityName: "St. Anthony",
  counties: ["Hennepin", "Ramsey"],
  turnoutOfRegistered: 0.8424413424413424,
  turnoutOfCVAP: 0.842316258351893,
  belowThreshold: false,
  ballotsCast: 5673,
  registeredAt7am: 6332,
  electionDayRegistrations: 402,
};

const ST_ANTHONY_TURNOUT_CITIES = [STEARNS_ST_ANTHONY, HENNEPIN_RAMSEY_ST_ANTHONY];

test("joinCityBoundaryToTurnout resolves the St. Anthony/Saint Anthony same-name collision by county — Hennepin polygon", () => {
  const result = joinCityBoundaryToTurnout(
    { name: "Saint Anthony", county: "Hennepin" },
    ST_ANTHONY_TURNOUT_CITIES,
  );
  assert.equal(result.turnout?.cityId, "st-anthony");
  assert.equal(result.matchReason, "name-and-county");
});

test("joinCityBoundaryToTurnout resolves the St. Anthony/Saint Anthony same-name collision by county — Ramsey polygon", () => {
  const result = joinCityBoundaryToTurnout(
    { name: "Saint Anthony", county: "Ramsey" },
    ST_ANTHONY_TURNOUT_CITIES,
  );
  assert.equal(result.turnout?.cityId, "st-anthony");
  assert.equal(result.matchReason, "name-and-county");
});

test("joinCityBoundaryToTurnout resolves the St. Anthony/Saint Anthony same-name collision by county — Stearns polygon", () => {
  const result = joinCityBoundaryToTurnout(
    { name: "Saint Anthony", county: "Stearns" },
    ST_ANTHONY_TURNOUT_CITIES,
  );
  assert.equal(result.turnout?.cityId, "st-anthony-2");
  assert.equal(result.matchReason, "name-and-county");
});

test("joinCityBoundaryToTurnout returns null (ambiguous) rather than guessing when county is missing and the name is shared", () => {
  const result = joinCityBoundaryToTurnout({ name: "Saint Anthony", county: null }, ST_ANTHONY_TURNOUT_CITIES);
  assert.equal(result.turnout, null);
  assert.equal(result.reason, "ambiguous-no-county");
});

test("joinCityBoundaryToTurnout returns null when the boundary's county matches none of the shared-name candidates", () => {
  const result = joinCityBoundaryToTurnout({ name: "Saint Anthony", county: "Winona" }, ST_ANTHONY_TURNOUT_CITIES);
  assert.equal(result.turnout, null);
  assert.equal(result.reason, "ambiguous-county-mismatch");
});

test("joinCityBoundaryToTurnout matches a unique city name without needing county disambiguation", () => {
  const cities = [
    {
      cityId: "ada",
      cityName: "Ada",
      counties: ["Norman"],
      turnoutOfRegistered: 0.78,
      turnoutOfCVAP: 0.63,
      belowThreshold: false,
      ballotsCast: 863,
      registeredAt7am: 1003,
      electionDayRegistrations: 101,
    },
  ];
  const result = joinCityBoundaryToTurnout({ name: "Ada", county: "Norman" }, cities);
  assert.equal(result.turnout?.cityId, "ada");
  assert.equal(result.matchReason, "unique-name");

  // Even a wrong/mismatched county shouldn't stop a unique-name match —
  // county is only load-bearing for disambiguation, per the module's own
  // header comment.
  const resultWrongCounty = joinCityBoundaryToTurnout({ name: "Ada", county: "Some Other County" }, cities);
  assert.equal(resultWrongCounty.turnout?.cityId, "ada");
});

test("joinCityBoundaryToTurnout returns no-name-match, never a guess, for an unrecognized city name", () => {
  const result = joinCityBoundaryToTurnout({ name: "Not A Real City", county: "Hennepin" }, ST_ANTHONY_TURNOUT_CITIES);
  assert.equal(result.turnout, null);
  assert.equal(result.reason, "no-name-match");
});

test("joinCityBoundaryToTurnout returns no-name-match for a null boundary name", () => {
  const result = joinCityBoundaryToTurnout({ name: null, county: "Hennepin" }, ST_ANTHONY_TURNOUT_CITIES);
  assert.equal(result.turnout, null);
  assert.equal(result.reason, "no-name-match");
});

test("joinAllCityBoundaries returns one result per feature, matched or not, never dropping a feature", () => {
  const features = [
    { properties: { name: "Saint Anthony", county: "Hennepin" } },
    { properties: { name: "Saint Anthony", county: "Stearns" } },
    { properties: { name: "Nowhere Township", county: "Hennepin" } },
  ];
  const results = joinAllCityBoundaries(features, ST_ANTHONY_TURNOUT_CITIES);
  assert.equal(results.length, 3);
  assert.equal(results[0].turnout?.cityId, "st-anthony");
  assert.equal(results[1].turnout?.cityId, "st-anthony-2");
  assert.equal(results[2].turnout, null);
});

// Integration-style sanity check against the real committed data files —
// confirms the fixture above matches production reality, and that the
// join resolves every real St. Anthony/Saint Anthony boundary polygon
// without ambiguity. Skips gracefully (rather than failing the whole
// suite) if either file isn't present in this checkout.
test("real city-boundaries.geojson + turnout/city/2024.json: every Saint Anthony polygon resolves unambiguously", (t) => {
  let boundaries;
  let turnout;
  try {
    boundaries = JSON.parse(readFileSync(path.join(__dirname, "../../public/city-boundaries.geojson"), "utf8"));
    turnout = JSON.parse(readFileSync(path.join(__dirname, "../../public/turnout/city/2024.json"), "utf8"));
  } catch {
    t.skip("public/city-boundaries.geojson or public/turnout/city/2024.json not present in this checkout");
    return;
  }

  const stAnthonyFeatures = boundaries.features.filter((f) => f.properties.name === "Saint Anthony");
  assert.ok(stAnthonyFeatures.length >= 2, "expected at least 2 real Saint Anthony boundary polygons");

  for (const feature of stAnthonyFeatures) {
    const result = joinCityBoundaryToTurnout(feature.properties, turnout.cities);
    assert.notEqual(result.turnout, null, `Saint Anthony polygon in ${feature.properties.county} should resolve to a turnout record`);
  }

  // The Hennepin and Stearns polygons must resolve to different cityIds —
  // this is the collision the whole module exists to prevent collapsing.
  const hennepin = stAnthonyFeatures.find((f) => f.properties.county === "Hennepin");
  const stearns = stAnthonyFeatures.find((f) => f.properties.county === "Stearns");
  if (hennepin && stearns) {
    const hennepinResult = joinCityBoundaryToTurnout(hennepin.properties, turnout.cities);
    const stearnsResult = joinCityBoundaryToTurnout(stearns.properties, turnout.cities);
    assert.notEqual(hennepinResult.turnout?.cityId, stearnsResult.turnout?.cityId);
  }
});
