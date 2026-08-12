#!/usr/bin/env node
// scripts/ingest/turnout.test.mjs
//
// Tests for the pure/testable logic in scripts/ingest/turnout.mjs — the
// precinct-to-city join (buildCityRecords), the slug/cityId scheme
// (slugifyCityName), and the below-threshold flagging in
// src/lib/turnoutConfig.mjs. Node's built-in test runner, no live network
// calls — same convention as scripts/ingest/mn-campaign-finance.test.mjs.
//
// Run directly: node scripts/ingest/turnout.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import test from "node:test";
import { buildCityRecords, slugifyCityName } from "./turnout.mjs";
import { MIN_REGISTERED_THRESHOLD, isBelowRegisteredThreshold } from "../../src/lib/turnoutConfig.mjs";

function precinct(overrides = {}) {
  return {
    vtdid: "270000000",
    cityName: "Testville",
    mcdFips: "11111",
    countyName: "Test County",
    ctuType: "city",
    mailOnly: false,
    ballotsCast: 100,
    registeredAt7am: 110,
    electionDayRegistrations: 5,
    ...overrides,
  };
}

const CVAP_FIXTURE = new Map([
  ["11111", { cvapEst: 1000, cvapMoe: 50, geoname: "Testville city, Test State" }],
  ["22222", { cvapEst: 500, cvapMoe: 30, geoname: "Otherburg city, Test State" }],
]);

// --- Join logic --------------------------------------------------------------

test("aggregates multiple precincts of the same city into one record, summing counts", () => {
  const rows = [
    precinct({ vtdid: "1", ballotsCast: 300, registeredAt7am: 350, electionDayRegistrations: 20 }),
    precinct({ vtdid: "2", ballotsCast: 100, registeredAt7am: 120, electionDayRegistrations: 5, mailOnly: true }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records.length, 1);
  const [testville] = records;
  assert.equal(testville.precincts, 2);
  assert.equal(testville.ballotsCast, 400);
  assert.equal(testville.registeredAt7am, 470);
  assert.equal(testville.electionDayRegistrations, 25);
  assert.equal(testville.mailOnlyPrecincts, 1);
});

test("excludes townships and unorganized territory from city output entirely", () => {
  const rows = [
    precinct({ vtdid: "1" }),
    precinct({ vtdid: "2", cityName: "Some Township", mcdFips: "99999", ctuType: "township" }),
    precinct({ vtdid: "3", cityName: "Unorganized Area", mcdFips: "88888", ctuType: "unorganized territory" }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records.length, 1);
  assert.equal(records[0].cityName, "Testville");
});

test("two different cities that share a name (grouped by name, not FIPS) never merge into one record", () => {
  // The real-world case: Minnesota has two distinct, unrelated cities both
  // named "St. Anthony" (Hennepin/Ramsey vs. Stearns County). Grouping by
  // MCDFIPS instead of city name is what keeps them apart.
  const rows = [
    precinct({ vtdid: "1", cityName: "Twin City", mcdFips: "11111", countyName: "County A", ballotsCast: 40 }),
    precinct({ vtdid: "2", cityName: "Twin City", mcdFips: "22222", countyName: "County B", ballotsCast: 10 }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records.length, 2, "expected two separate records, not one merged record");
  const total = records.reduce((sum, r) => sum + r.ballotsCast, 0);
  assert.equal(total, 50);
  assert.ok(records.every((r) => r.ballotsCast === 40 || r.ballotsCast === 10), "ballot counts must never be summed together across the two cities");
});

test("a same-name city collision gets a disambiguated cityId (base slug + numeric suffix), never a duplicate id", () => {
  const rows = [
    precinct({ vtdid: "1", cityName: "Twin City", mcdFips: "11111", countyName: "County A" }),
    precinct({ vtdid: "2", cityName: "Twin City", mcdFips: "22222", countyName: "County B" }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  const ids = records.map((r) => r.cityId).sort();
  assert.deepEqual(ids, ["twin-city", "twin-city-2"]);
});

test("a city spanning two counties reports both in the counties array", () => {
  const rows = [
    precinct({ vtdid: "1", cityName: "Border City", mcdFips: "11111", countyName: "County A" }),
    precinct({ vtdid: "2", cityName: "Border City", mcdFips: "11111", countyName: "County B" }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].counties, ["County A", "County B"]);
});

// --- Mail-only precincts: flagged, never zeroed -----------------------------

test("mail-only precincts are counted via mailOnlyPrecincts, and their real ballot/registration counts are still published (never zeroed)", () => {
  const rows = [precinct({ vtdid: "1", mailOnly: true, ballotsCast: 584, registeredAt7am: 643, electionDayRegistrations: 36 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  const [record] = records;
  assert.equal(record.mailOnlyPrecincts, 1);
  // A mail ballot precinct still has real, nonzero voting statistics —
  // "mail-only" describes how ballots were cast, not that nobody voted.
  assert.equal(record.ballotsCast, 584);
  assert.equal(record.registeredAt7am, 643);
  assert.notEqual(record.ballotsCast, 0);
});

test("mailOnlyPrecincts only counts the flagged precincts within a multi-precinct city, not the whole city", () => {
  const rows = [
    precinct({ vtdid: "1", mailOnly: true }),
    precinct({ vtdid: "2", mailOnly: false }),
    precinct({ vtdid: "3", mailOnly: false }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records[0].precincts, 3);
  assert.equal(records[0].mailOnlyPrecincts, 1);
});

// --- CVAP join: never guessed, always flagged when unresolved --------------

test("a city with a real CVAP match gets a real turnoutOfCVAP and a non-null cvapMarginOfError", () => {
  const rows = [precinct({ ballotsCast: 250 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records[0].turnoutOfCVAP, 250 / 1000);
  assert.equal(records[0].cvapMarginOfError, 50);
  assert.ok(records[0].cvapSource);
});

test("a city with no CVAP match ships turnoutOfCVAP/cvapSource/cvapMarginOfError as null and records a knownGaps entry, never a guessed number", () => {
  const rows = [precinct({ cityName: "No Match City", mcdFips: "77777" })];
  const { records, knownGaps } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records[0].turnoutOfCVAP, null);
  assert.equal(records[0].cvapSource, null);
  assert.equal(records[0].cvapMarginOfError, null);
  assert.ok(knownGaps.some((g) => g.includes("No Match City")));
});

// --- Below-threshold flagging -----------------------------------------------

test("isBelowRegisteredThreshold is true just under MIN_REGISTERED_THRESHOLD and false at/above it", () => {
  assert.equal(isBelowRegisteredThreshold(MIN_REGISTERED_THRESHOLD - 1, 0), true);
  assert.equal(isBelowRegisteredThreshold(MIN_REGISTERED_THRESHOLD, 0), false);
  assert.equal(isBelowRegisteredThreshold(0, MIN_REGISTERED_THRESHOLD), false);
});

test("belowThreshold uses registeredAt7am + electionDayRegistrations, not registeredAt7am alone", () => {
  // 150 pre-registered + 60 same-day = 210, at/above the 200 threshold —
  // must NOT be flagged, even though registeredAt7am alone (150) is below it.
  const rows = [precinct({ registeredAt7am: 150, electionDayRegistrations: 60 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records[0].belowThreshold, false);
});

test("a small city below the registered-voter threshold is flagged but still publishes its real raw counts (never suppressed)", () => {
  const rows = [precinct({ cityName: "Tiny City", mcdFips: "33333", ballotsCast: 8, registeredAt7am: 9, electionDayRegistrations: 1 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  const [record] = records;
  assert.equal(record.belowThreshold, true);
  assert.equal(record.ballotsCast, 8);
  assert.equal(record.registeredAt7am, 9);
});

// --- turnoutOfRegistered math ------------------------------------------------

test("turnoutOfRegistered divides ballotsCast by registeredAt7am + electionDayRegistrations", () => {
  const rows = [precinct({ ballotsCast: 105, registeredAt7am: 100, electionDayRegistrations: 20 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records[0].turnoutOfRegistered, 105 / 120);
});

// --- slugifyCityName ---------------------------------------------------------

test("slugifyCityName lowercases, hyphenates, and strips punctuation", () => {
  assert.equal(slugifyCityName("St. Paul"), "st-paul");
  assert.equal(slugifyCityName("St. Louis Park"), "st-louis-park");
  assert.equal(slugifyCityName("Coon Rapids"), "coon-rapids");
});
