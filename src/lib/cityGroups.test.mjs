#!/usr/bin/env node
// src/lib/cityGroups.test.mjs
//
// Tests for buildCityGroups/matchesCityQuery — the area-filter sidebar's
// county-grouping and filter-list substring matcher. Same convention as
// addressSearch.test.mjs.
//
// Run directly: node src/lib/cityGroups.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { buildCityGroups, matchesCityQuery } from "./cityGroups.ts";
import { CITIES, COUNTY_CITIES } from "./cities.ts";

test("matchesCityQuery matches case- and punctuation-insensitively", () => {
  assert.equal(matchesCityQuery("st paul", "St. Paul"), true);
  assert.equal(matchesCityQuery("ST. PAUL", "St. Paul"), true);
  assert.equal(matchesCityQuery("st. paul", "St. Paul"), true);
});

test("matchesCityQuery is a substring match, not a prefix match", () => {
  assert.equal(matchesCityQuery("grove", "Maple Grove"), true);
  assert.equal(matchesCityQuery("park", "Brooklyn Park"), true);
});

test("matchesCityQuery empty query matches every city", () => {
  for (const city of CITIES) {
    assert.equal(matchesCityQuery("", city), true);
    assert.equal(matchesCityQuery("   ", city), true);
  }
});

test("matchesCityQuery returns false for no match", () => {
  assert.equal(matchesCityQuery("xyzzy", "Minneapolis"), false);
});

test("buildCityGroups covers every requested city exactly in its county group(s)", () => {
  const groups = buildCityGroups(CITIES);
  for (const city of CITIES) {
    const expectedCounties = (Object.keys(COUNTY_CITIES)).filter((county) =>
      COUNTY_CITIES[county].includes(city),
    );
    const actualCounties = groups.filter((g) => g.cities.includes(city)).map((g) => g.county);
    assert.deepEqual([...actualCounties].sort(), [...expectedCounties].sort(), `city ${city} grouped incorrectly`);
  }
});

test("buildCityGroups lists a multi-county city (Blaine) under every county it touches", () => {
  const groups = buildCityGroups(CITIES);
  const blaineCounties = groups.filter((g) => g.cities.includes("Blaine")).map((g) => g.county);
  assert.ok(blaineCounties.includes("Anoka"));
  assert.ok(blaineCounties.includes("Ramsey"));
});

test("buildCityGroups sorts groups alphabetically by county and cities alphabetically within a group", () => {
  const groups = buildCityGroups(CITIES);
  const countyNames = groups.map((g) => g.county);
  assert.deepEqual(countyNames, [...countyNames].sort((a, b) => a.localeCompare(b)));
  for (const group of groups) {
    assert.deepEqual(group.cities, [...group.cities].sort((a, b) => a.localeCompare(b)));
  }
});

test("buildCityGroups restricts to the requested subset of cities, omitting groups left empty", () => {
  const groups = buildCityGroups(["Minneapolis", "St. Paul"]);
  const countyNames = groups.map((g) => g.county);
  assert.deepEqual(countyNames, ["Hennepin", "Ramsey"]);
  assert.deepEqual(
    groups.find((g) => g.county === "Hennepin")?.cities,
    ["Minneapolis"],
  );
  assert.deepEqual(
    groups.find((g) => g.county === "Ramsey")?.cities,
    ["St. Paul"],
  );
});

test("buildCityGroups returns no groups for an empty input list", () => {
  assert.deepEqual(buildCityGroups([]), []);
});
