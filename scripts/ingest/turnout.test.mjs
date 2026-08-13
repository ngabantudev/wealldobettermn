#!/usr/bin/env node
// scripts/ingest/turnout.test.mjs
//
// Tests for the pure/testable logic in scripts/ingest/turnout.mjs — the
// precinct-to-city join (buildCityRecords), the slug/cityId scheme
// (slugifyCityName), the below-threshold flagging in
// src/lib/turnoutConfig.mjs, and (added for the 2012-2022 historical
// backfill) the per-year statewide reconciliation guard
// (assertStatewideReconciliation), the configurable precinct-id field name
// (normalizePrecinctRows — 2012's DBF names it "VTD", every other year
// "VTDID"), and the CVAP CSV format drift across vintages
// (parseCvapPlaceRows — uppercase vs. lowercase headers, and a 7- vs.
// 9-character geoid prefix). Node's built-in test runner, no live network
// calls — same convention as scripts/ingest/mn-campaign-finance.test.mjs.
//
// Run directly: node scripts/ingest/turnout.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCityRecords,
  slugifyCityName,
  normalizePrecinctRows,
  assertStatewideReconciliation,
  parseCvapPlaceRows,
} from "./turnout.mjs";
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

// buildCityRecords() takes its source URLs as an explicit options argument
// (not a hardcoded module constant) precisely so each year's own
// SOS/CVAP source can be threaded through per the historical backfill —
// tests pass a fixture pair here rather than relying on any default.
const FIXTURE_OPTIONS = { sosSourceUrl: "https://example.invalid/sos", cvapSourceUrl: "https://example.invalid/cvap" };

// --- Join logic --------------------------------------------------------------

test("aggregates multiple precincts of the same city into one record, summing counts", () => {
  const rows = [
    precinct({ vtdid: "1", ballotsCast: 300, registeredAt7am: 350, electionDayRegistrations: 20 }),
    precinct({ vtdid: "2", ballotsCast: 100, registeredAt7am: 120, electionDayRegistrations: 5, mailOnly: true }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
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
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
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
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
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
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  const ids = records.map((r) => r.cityId).sort();
  assert.deepEqual(ids, ["twin-city", "twin-city-2"]);
});

test("a city spanning two counties reports both in the counties array", () => {
  const rows = [
    precinct({ vtdid: "1", cityName: "Border City", mcdFips: "11111", countyName: "County A" }),
    precinct({ vtdid: "2", cityName: "Border City", mcdFips: "11111", countyName: "County B" }),
  ];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].counties, ["County A", "County B"]);
});

// --- Mail-only precincts: flagged, never zeroed -----------------------------

test("mail-only precincts are counted via mailOnlyPrecincts, and their real ballot/registration counts are still published (never zeroed)", () => {
  const rows = [precinct({ vtdid: "1", mailOnly: true, ballotsCast: 584, registeredAt7am: 643, electionDayRegistrations: 36 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
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
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  assert.equal(records[0].precincts, 3);
  assert.equal(records[0].mailOnlyPrecincts, 1);
});

// --- CVAP join: never guessed, always flagged when unresolved --------------

test("a city with a real CVAP match gets a real turnoutOfCVAP and a non-null cvapMarginOfError", () => {
  const rows = [precinct({ ballotsCast: 250 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  assert.equal(records[0].turnoutOfCVAP, 250 / 1000);
  assert.equal(records[0].cvapMarginOfError, 50);
  assert.ok(records[0].cvapSource);
});

test("sourceUrl and cvapSource come from the passed-in options, not a hardcoded constant — required so each year's own SOS/CVAP citation can be threaded through", () => {
  const rows = [precinct({ ballotsCast: 250 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, {
    sosSourceUrl: "https://example.invalid/2016-sos",
    cvapSourceUrl: "https://example.invalid/2012-2016-cvap",
  });
  assert.equal(records[0].sourceUrl, "https://example.invalid/2016-sos");
  assert.equal(records[0].cvapSource, "https://example.invalid/2012-2016-cvap");
});

test("buildCityRecords with no options at all ships sourceUrl/cvapSource as null rather than falling back to a hardcoded default", () => {
  const rows = [precinct({ ballotsCast: 250 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE);
  assert.equal(records[0].sourceUrl, null);
  assert.equal(records[0].cvapSource, null);
});

test("a city with no CVAP match ships turnoutOfCVAP/cvapSource/cvapMarginOfError as null and records a knownGaps entry, never a guessed number", () => {
  const rows = [precinct({ cityName: "No Match City", mcdFips: "77777" })];
  const { records, knownGaps } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
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
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  assert.equal(records[0].belowThreshold, false);
});

test("a small city below the registered-voter threshold is flagged but still publishes its real raw counts (never suppressed)", () => {
  const rows = [precinct({ cityName: "Tiny City", mcdFips: "33333", ballotsCast: 8, registeredAt7am: 9, electionDayRegistrations: 1 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  const [record] = records;
  assert.equal(record.belowThreshold, true);
  assert.equal(record.ballotsCast, 8);
  assert.equal(record.registeredAt7am, 9);
});

// --- turnoutOfRegistered math ------------------------------------------------

test("turnoutOfRegistered divides ballotsCast by registeredAt7am + electionDayRegistrations", () => {
  const rows = [precinct({ ballotsCast: 105, registeredAt7am: 100, electionDayRegistrations: 20 })];
  const { records } = buildCityRecords(rows, CVAP_FIXTURE, FIXTURE_OPTIONS);
  assert.equal(records[0].turnoutOfRegistered, 105 / 120);
});

// --- slugifyCityName ---------------------------------------------------------

test("slugifyCityName lowercases, hyphenates, and strips punctuation", () => {
  assert.equal(slugifyCityName("St. Paul"), "st-paul");
  assert.equal(slugifyCityName("St. Louis Park"), "st-louis-park");
  assert.equal(slugifyCityName("Coon Rapids"), "coon-rapids");
});

// --- normalizePrecinctRows: configurable VTD-id field name (2012's DBF
// names it "VTD"; every other year names it "VTDID") --------------------

function dbfRow(overrides = {}) {
  return {
    MCDNAME: "Fieldtown",
    MCDFIPS: "66666",
    COUNTYNAME: "Test County",
    CTU_TYPE: "city",
    MAILBALLOT: "",
    TOTVOTING: "10",
    REG7AM: "12",
    EDR: "1",
    ...overrides,
  };
}

test("normalizePrecinctRows reads the precinct id from whichever field name is configured (2012's \"VTD\")", () => {
  const rows = normalizePrecinctRows([dbfRow({ VTD: "270000009" })], "VTD");
  assert.equal(rows[0].vtdid, "270000009");
});

test("normalizePrecinctRows reads \"VTDID\" for every other year", () => {
  const rows = normalizePrecinctRows([dbfRow({ VTDID: "270000010" })], "VTDID");
  assert.equal(rows[0].vtdid, "270000010");
});

test("normalizePrecinctRows still parses REG7AM/EDR/TOTVOTING correctly when they're stored as DBF float-notation ASCII text (2018/2020/2024's \"F19\" field type)", () => {
  // Confirmed live in the real files: some years store these as plain
  // integers ("845"), others as scientific-notation float text
  // ("8.45000000000e+02") — Number.parseFloat handles both without a
  // per-year branch, but this pins the behavior against regression.
  const rows = normalizePrecinctRows(
    [dbfRow({ VTDID: "1", TOTVOTING: "8.45000000000e+02", REG7AM: "1.11900000000e+03", EDR: "7.50000000000e+01" })],
    "VTDID",
  );
  assert.equal(rows[0].ballotsCast, 845);
  assert.equal(rows[0].registeredAt7am, 1119);
  assert.equal(rows[0].electionDayRegistrations, 75);
});

test("normalizePrecinctRows throws on a non-numeric voting-statistic field rather than silently coercing it", () => {
  assert.throws(() => normalizePrecinctRows([dbfRow({ VTDID: "1", TOTVOTING: "N/A" })], "VTDID"));
});

// --- assertStatewideReconciliation: per-year expected total, exact match,
// never a tolerance band ------------------------------------------------

test("assertStatewideReconciliation passes when the summed ballotsCast exactly matches that year's expected total", () => {
  const rows = [precinct({ ballotsCast: 100 }), precinct({ vtdid: "2", ballotsCast: 200 })];
  assert.doesNotThrow(() => assertStatewideReconciliation(rows, "2016", 300));
});

test("assertStatewideReconciliation throws, naming the year, on any mismatch — even off by one", () => {
  const rows = [precinct({ ballotsCast: 100 }), precinct({ vtdid: "2", ballotsCast: 200 })];
  assert.throws(() => assertStatewideReconciliation(rows, "2016", 301), /2016/);
  assert.throws(() => assertStatewideReconciliation(rows, "2016", 299), /statewide reconciliation failed/);
});

test("assertStatewideReconciliation sums ballotsCast across every ctuType (city, township, unorganized territory), not just city rows", () => {
  const rows = [
    precinct({ ballotsCast: 100, ctuType: "city" }),
    precinct({ vtdid: "2", ballotsCast: 50, ctuType: "township" }),
    precinct({ vtdid: "3", ballotsCast: 25, ctuType: "unorganized territory" }),
  ];
  assert.doesNotThrow(() => assertStatewideReconciliation(rows, "2020", 175));
  assert.throws(() => assertStatewideReconciliation(rows, "2020", 100), /statewide reconciliation failed/);
});

// --- parseCvapPlaceRows: CVAP CSV format drift across vintages ----------
//
// Confirmed live 2026-08-12 against all seven vintages this pipeline uses:
// column headers are UPPERCASE in the 2008-2012 through 2012-2016
// vintages and lowercase from 2014-2018 onward, and the geoid's
// place-level prefix is the 7-character "16000US" through 2014-2018 but
// the 9-character "1600000US" from 2016-2020 onward. Both fixtures below
// are built from the real header/row shape of each family, not guessed.

test("parseCvapPlaceRows handles UPPERCASE headers (2008-2012 through 2012-2016 vintages)", () => {
  const header = "GEONAME,LNTITLE,GEOID,LNNUMBER,TOT_EST,TOT_MOE,ADU_EST,ADU_MOE,CIT_EST,CIT_MOE,CVAP_EST,CVAP_MOE";
  const csv =
    `${header}\n` +
    `"St. Paul city, Minnesota",Total,16000US2758000,1,300000,50,230000,1000,285000,1500,190860,1156\n`;
  const byFips = parseCvapPlaceRows(Buffer.from(csv, "latin1"));
  assert.equal(byFips.get("58000").cvapEst, 190860);
  assert.equal(byFips.get("58000").cvapMoe, 1156);
});

test("parseCvapPlaceRows handles lowercase headers (2014-2018 onward)", () => {
  const csv =
    "geoname,lntitle,geoid,lnnumber,tot_est,tot_moe,adu_est,adu_moe,cit_est,cit_moe,cvap_est,cvap_moe\n" +
    `"St. Paul city, Minnesota",Total,16000US2758000,1,300000,50,230000,1000,285000,1500,190860,1156\n`;
  const byFips = parseCvapPlaceRows(Buffer.from(csv, "latin1"));
  assert.equal(byFips.get("58000").cvapEst, 190860);
});

test("parseCvapPlaceRows handles the 9-character \"1600000US\" geoid prefix (2016-2020 vintage onward), same as the 7-character \"16000US\" prefix", () => {
  const csv =
    "geoname,lntitle,geoid,lnnumber,tot_est,tot_moe,adu_est,adu_moe,cit_est,cit_moe,cvap_est,cvap_moe\n" +
    `"St. Paul city, Minnesota",Total,1600000US2758000,1,300000,50,230000,1000,285000,1500,215640,1611\n`;
  const byFips = parseCvapPlaceRows(Buffer.from(csv, "latin1"));
  assert.equal(byFips.get("58000").cvapEst, 215640);
});

test("parseCvapPlaceRows filters to Minnesota (state FIPS 27) only, regardless of geoid prefix length", () => {
  const csv =
    "geoname,lntitle,geoid,lnnumber,tot_est,tot_moe,adu_est,adu_moe,cit_est,cit_moe,cvap_est,cvap_moe\n" +
    `"Some City, Iowa",Total,1600000US1954000,1,1000,10,900,10,850,10,700,10\n` +
    `"St. Paul city, Minnesota",Total,1600000US2758000,1,300000,50,230000,1000,285000,1500,215640,1611\n`;
  const byFips = parseCvapPlaceRows(Buffer.from(csv, "latin1"));
  assert.equal(byFips.size, 1);
  assert.ok(byFips.has("58000"));
});

test("parseCvapPlaceRows only keeps the Total row (lnnumber \"1\"), not the per-race/ethnicity breakout rows", () => {
  const csv =
    "geoname,lntitle,geoid,lnnumber,tot_est,tot_moe,adu_est,adu_moe,cit_est,cit_moe,cvap_est,cvap_moe\n" +
    `"St. Paul city, Minnesota",Total,1600000US2758000,1,300000,50,230000,1000,285000,1500,215640,1611\n` +
    `"St. Paul city, Minnesota",Not Hispanic or Latino,1600000US2758000,2,280000,40,210000,900,265000,1400,203250,1500\n`;
  const byFips = parseCvapPlaceRows(Buffer.from(csv, "latin1"));
  assert.equal(byFips.size, 1);
  assert.equal(byFips.get("58000").cvapEst, 215640, "must be the Total row's figure, not the breakout row's");
});

test("parseCvapPlaceRows throws a clear error when an expected column is missing, rather than silently misreading columns", () => {
  const csv = "geoname,geoid,lnnumber,cvap_est\n" + `"St. Paul city, Minnesota",1600000US2758000,1,215640\n`;
  assert.throws(() => parseCvapPlaceRows(Buffer.from(csv, "latin1")), /expected CVAP column/);
});
