#!/usr/bin/env node
// src/lib/officials.test.mjs
//
// Tests for resolveOfficialsAtPoint's point-in-polygon resolution. Uses
// Node's built-in test runner (`node --test`), same convention as
// electionConfig.test.mjs.
//
// Run directly: node src/lib/officials.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { officialIdentity, resolveAllCityOfficials, resolveOfficialsAtPoint } from "./officials.ts";

// --- fixtures -------------------------------------------------------------
// Two adjacent, non-overlapping square wards sharing an edge at lng=0, a
// commissioner district covering both, and a house+senate pair covering
// only ward A — enough to exercise "inside one," "inside none," "inside
// all three tiers," and "on a shared boundary" without real map data.

function square(swLng, swLat, neLng, neLat) {
  return [
    [
      [swLng, swLat],
      [neLng, swLat],
      [neLng, neLat],
      [swLng, neLat],
      [swLng, swLat],
    ],
  ];
}

function rep(overrides) {
  return {
    role: "Council Member",
    city: "Testville",
    county: null,
    ward: null,
    wardName: null,
    district: null,
    stateDistrict: null,
    chamber: null,
    repName: null,
    repParty: "Nonpartisan",
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: "2020-01-01", termEnd: null, current: true, sourceUrl: "https://example.com/testville" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: null,
    candidates: [],
    isContested: false,
    partyUnityPercent: null,
    recentVotes: [],
    ...overrides,
  };
}

const wardA = {
  type: "Feature",
  properties: rep({ role: "Council Member", city: "Testville", ward: 1, repName: "Ward A Rep" }),
  geometry: { type: "Polygon", coordinates: square(-1, -1, 0, 1) },
};

const wardB = {
  type: "Feature",
  properties: rep({ role: "Council Member", city: "Testville", ward: 2, repName: "Ward B Rep" }),
  geometry: { type: "Polygon", coordinates: square(0, -1, 1, 1) },
};

const mayor = {
  type: "Feature",
  properties: rep({ role: "Mayor", city: "Testville", ward: null, repName: "The Mayor" }),
  geometry: { type: "Point", coordinates: [-0.5, 0] },
};

const commissioner = {
  type: "Feature",
  properties: rep({
    role: "County Commissioner",
    city: "Testville",
    county: "Test County",
    district: 9,
    repName: "The Commissioner",
  }),
  geometry: { type: "Polygon", coordinates: square(-1, -1, 1, 1) },
};

const houseDistrict = {
  type: "Feature",
  properties: rep({
    role: "State Representative",
    city: "Testville",
    stateDistrict: "1A",
    chamber: "house",
    repName: "The Rep",
  }),
  geometry: { type: "Polygon", coordinates: square(-1, -1, 0, 1) },
};

const senateDistrict = {
  type: "Feature",
  properties: rep({
    role: "State Senator",
    city: "Testville",
    stateDistrict: "1",
    chamber: "senate",
    repName: "The Senator",
  }),
  geometry: { type: "Polygon", coordinates: square(-1, -1, 0, 1) },
};

const sources = {
  wards: { type: "FeatureCollection", features: [wardA, wardB] },
  mayors: { type: "FeatureCollection", features: [mayor] },
  commissioners: { type: "FeatureCollection", features: [commissioner] },
  stateLeg: { type: "FeatureCollection", features: [houseDistrict, senateDistrict] },
};

// A ward that elects two council members off one shared polygon — Blaine's
// and Brooklyn Park's wards do this in the real data, each as two separate
// Feature entries with identical geometry and different repName. Regression
// coverage for the bug where dedupeByIdentity collapsed both hits into one
// because officialIdentity didn't distinguish same-ward seats — see its
// own comment.
const wardCTwinA = {
  type: "Feature",
  properties: rep({ role: "Council Member", city: "Testville", ward: 3, repName: "Ward C Rep One" }),
  geometry: { type: "Polygon", coordinates: square(-2, -1, -1, 1) },
};
const wardCTwinB = {
  type: "Feature",
  properties: rep({ role: "Council Member", city: "Testville", ward: 3, repName: "Ward C Rep Two" }),
  geometry: { type: "Polygon", coordinates: square(-2, -1, -1, 1) },
};
const sourcesWithTwinWard = {
  ...sources,
  wards: { type: "FeatureCollection", features: [wardA, wardB, wardCTwinA, wardCTwinB] },
};

// --- resolveOfficialsAtPoint ----------------------------------------------

test("resolves all three tiers for a point inside ward A", () => {
  const officials = resolveOfficialsAtPoint([-0.5, 0], sources);
  assert.deepEqual(
    officials.city.map((r) => r.repName),
    ["The Mayor", "Ward A Rep"],
  );
  assert.deepEqual(
    officials.county.map((r) => r.repName),
    ["The Commissioner"],
  );
  assert.deepEqual(
    officials.state.map((r) => r.repName),
    ["The Senator", "The Rep"],
  );
});

test("resolves ward B with no state-leg coverage (outside house/senate polygons)", () => {
  const officials = resolveOfficialsAtPoint([0.5, 0], sources);
  assert.deepEqual(
    officials.city.map((r) => r.repName),
    ["The Mayor", "Ward B Rep"],
  );
  assert.deepEqual(
    officials.county.map((r) => r.repName),
    ["The Commissioner"],
  );
  assert.deepEqual(officials.state, []);
});

test("a point outside every polygon resolves all three tiers empty", () => {
  const officials = resolveOfficialsAtPoint([10, 10], sources);
  assert.deepEqual(officials, { city: [], county: [], state: [] });
});

test("a point on the shared boundary between ward A and ward B resolves both (turf's inclusive-boundary convention)", () => {
  const officials = resolveOfficialsAtPoint([0, 0], sources);
  assert.deepEqual(
    officials.city.map((r) => r.repName).sort(),
    ["Ward A Rep", "Ward B Rep", "The Mayor"].sort(),
  );
});

test("known seeds its own tier and is never dropped, even off its own polygon", () => {
  // Point [10, 10] is outside every polygon, so PIP alone finds nothing —
  // but the mayor still resolves too, matched by `known`'s own city (the
  // same boundary-precision reasoning `known` exists for generally).
  const knownRep = rep({ role: "Council Member", city: "Testville", ward: 1, repName: "Ward A Rep" });
  const officials = resolveOfficialsAtPoint([10, 10], sources, knownRep);
  assert.deepEqual(
    officials.city.map((r) => r.repName).sort(),
    ["Ward A Rep", "The Mayor"].sort(),
  );
  assert.deepEqual(officials.county, []);
  assert.deepEqual(officials.state, []);
});

test("known does not produce a duplicate when PIP independently finds the same office", () => {
  const knownWardA = wardA.properties;
  const officials = resolveOfficialsAtPoint([-0.5, 0], sources, knownWardA);
  assert.equal(officials.city.filter((r) => r.repName === "Ward A Rep").length, 1);
});

test("known fills the sibling slot in its own tier via PIP — seeding the House rep still surfaces the Senator", () => {
  const knownHouse = houseDistrict.properties;
  const officials = resolveOfficialsAtPoint([-0.5, 0], sources, knownHouse);
  assert.deepEqual(
    officials.state.map((r) => r.repName).sort(),
    ["The Rep", "The Senator"],
  );
});

test("mayor is matched by city even when known (not PIP) is what puts the point in that city", () => {
  const sourcesNoWards = { ...sources, wards: { type: "FeatureCollection", features: [] } };
  const knownCouncilMember = wardA.properties;
  const officials = resolveOfficialsAtPoint([-0.5, 0], sourcesNoWards, knownCouncilMember);
  assert.deepEqual(
    officials.city.map((r) => r.repName).sort(),
    ["The Mayor", "Ward A Rep"],
  );
});

test("a ward electing two council members off one shared polygon surfaces both, not just one", () => {
  const officials = resolveOfficialsAtPoint([-1.5, 0], sourcesWithTwinWard);
  assert.deepEqual(
    officials.city.map((r) => r.repName).sort(),
    ["The Mayor", "Ward C Rep One", "Ward C Rep Two"].sort(),
  );
});

// --- resolveAllCityOfficials -----------------------------------------------

test("resolveAllCityOfficials returns every ward's council member plus the mayor, not just one", () => {
  const officials = resolveAllCityOfficials("Testville", sources);
  assert.deepEqual(
    officials.map((r) => r.repName).sort(),
    ["The Mayor", "Ward A Rep", "Ward B Rep"].sort(),
  );
});

test("resolveAllCityOfficials surfaces both seats of a ward with two council members", () => {
  const officials = resolveAllCityOfficials("Testville", sourcesWithTwinWard);
  assert.deepEqual(
    officials.map((r) => r.repName).sort(),
    ["The Mayor", "Ward A Rep", "Ward B Rep", "Ward C Rep One", "Ward C Rep Two"].sort(),
  );
});

test("resolveAllCityOfficials never mixes in another city's officials", () => {
  assert.deepEqual(resolveAllCityOfficials("Nowhereville", sources), []);
});

// --- atLargeBoundaries (a wardless, fully at-large city — Woodbury's shape) -

// No wardHits are possible for this city by construction (it has zero
// features in `wards` above) — the only way its officials ever resolve
// for a point that isn't the pin itself is via atLargeBoundaries.
const atLargeMayor = {
  type: "Feature",
  properties: rep({ role: "Mayor", city: "Wardlessville", repName: "At-Large Mayor" }),
  geometry: { type: "Point", coordinates: [5, 5] },
};
const atLargeCouncilMember = {
  type: "Feature",
  properties: rep({ role: "Council Member", city: "Wardlessville", repName: "At-Large Council Member" }),
  geometry: { type: "Point", coordinates: [5, 5] },
};
const atLargeBoundary = {
  type: "Feature",
  // Deliberately carries only `{ city }` — see fetch-at-large-boundaries.mjs
  // and resolveOfficialsAtPoint's own comment on why this must never be
  // treated as a RepProperties itself.
  properties: { city: "Wardlessville" },
  geometry: { type: "Polygon", coordinates: square(4, 4, 6, 6) },
};
const sourcesWithAtLarge = {
  ...sources,
  mayors: { type: "FeatureCollection", features: [mayor, atLargeMayor, atLargeCouncilMember] },
  atLargeBoundaries: { type: "FeatureCollection", features: [atLargeBoundary] },
};

test("a point inside a wardless city's boundary resolves every mayors-sourced official for that city", () => {
  const officials = resolveOfficialsAtPoint([5, 5], sourcesWithAtLarge);
  assert.deepEqual(
    officials.city.map((r) => r.repName).sort(),
    ["At-Large Council Member", "At-Large Mayor"],
  );
  // Testville's own mayor must not leak in just because atLargeBoundaries
  // matched a different city's polygon.
  assert.ok(!officials.city.some((r) => r.repName === "The Mayor"));
});

test("a point outside every at-large boundary resolves none of that city's officials", () => {
  const officials = resolveOfficialsAtPoint([50, 50], sourcesWithAtLarge);
  assert.deepEqual(officials.city, []);
});

test("resolveAllCityOfficials covers a wardless (fully at-large) city too — matched by mayors.geojson alone, no ward polygons needed", () => {
  const officials = resolveAllCityOfficials("Wardlessville", sourcesWithAtLarge);
  assert.deepEqual(
    officials.map((r) => r.repName).sort(),
    ["At-Large Council Member", "At-Large Mayor"],
  );
});

test("atLargeBoundaries is optional — omitting it entirely never throws, just resolves normally", () => {
  const { atLargeBoundaries, ...sourcesWithout } = sourcesWithAtLarge;
  void atLargeBoundaries;
  assert.doesNotThrow(() => resolveOfficialsAtPoint([-0.5, 0], sourcesWithout));
  const officials = resolveOfficialsAtPoint([-0.5, 0], sourcesWithout);
  assert.deepEqual(
    officials.city.map((r) => r.repName),
    ["The Mayor", "Ward A Rep"],
  );
});

// --- officialIdentity -------------------------------------------------

test("officialIdentity distinguishes two seats sharing one ward, unlike role/district-only offices", () => {
  const a = officialIdentity(rep({ role: "Council Member", city: "Testville", ward: 3, repName: "Ward C Rep One" }));
  const b = officialIdentity(rep({ role: "Council Member", city: "Testville", ward: 3, repName: "Ward C Rep Two" }));
  assert.notEqual(a, b);
});

test("officialIdentity distinguishes offices sharing a role but different locators", () => {
  const a = officialIdentity(rep({ role: "Council Member", city: "X", ward: 1 }));
  const b = officialIdentity(rep({ role: "Council Member", city: "X", ward: 2 }));
  assert.notEqual(a, b);
});

test("officialIdentity is stable for the same office regardless of name/contact fields", () => {
  const a = officialIdentity(rep({ role: "State Senator", chamber: "senate", stateDistrict: "1", repName: "A" }));
  const b = officialIdentity(rep({ role: "State Senator", chamber: "senate", stateDistrict: "1", repName: "B" }));
  assert.equal(a, b);
});

test("officialIdentity falls back to a composite key (not a collision) for an unrecognized role", () => {
  // `role` comes from fetched JSON, not a runtime-validated schema — this
  // exercises the `default` branch a malformed/future upstream record
  // would hit, which TypeScript's exhaustive switch can't prevent at
  // runtime. Two different malformed records must not collide onto one
  // identity (that would silently drop one from the panel).
  const a = officialIdentity(rep({ role: "County Attorney", city: "X", repName: "A" }));
  const b = officialIdentity(rep({ role: "County Attorney", city: "X", repName: "B" }));
  assert.notEqual(a, b);
});
