#!/usr/bin/env node
// scripts/ingest/legistar.test.mjs
//
// Tests for the pure/testable logic in scripts/ingest/legistar.mjs — the
// officerecords -> Holding[] mapping, the vote-window bookkeeping, the
// vote-to-holding join, and the content-hashing helpers backing
// provenance.contentHash. Node's built-in test runner, no live network
// calls — same convention as scripts/ingest/roster-diff.test.mjs.
//
// Run directly: node scripts/ingest/legistar.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  buildOfficesPersonsHoldings,
  combineSnapshotHashes,
  dateRangeFilter,
  determineVoteWindow,
  findHoldingForVote,
  mapVoteValue,
  sha256Hex,
  slugify,
  stripInternal,
  toIsoDate,
} from "./legistar.mjs";

// --- sha256Hex / combineSnapshotHashes -------------------------------------

test("sha256Hex is deterministic and produces a 64-char hex digest", () => {
  const a = sha256Hex({ foo: "bar", n: 1 });
  const b = sha256Hex({ foo: "bar", n: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("sha256Hex changes when the input actually changes", () => {
  const a = sha256Hex({ n: 1 });
  const b = sha256Hex({ n: 2 });
  assert.notEqual(a, b);
});

test("combineSnapshotHashes is independent of input order (sorts by name first)", () => {
  const entries1 = [
    { name: "persons", hash: "p-hash" },
    { name: "bodies", hash: "b-hash" },
    { name: "officerecords", hash: "o-hash" },
  ];
  const entries2 = [entries1[2], entries1[0], entries1[1]];

  assert.equal(combineSnapshotHashes(entries1), combineSnapshotHashes(entries2));
});

test("combineSnapshotHashes changes if any one entry's hash changes", () => {
  const base = [
    { name: "bodies", hash: "b-hash" },
    { name: "persons", hash: "p-hash" },
  ];
  const changed = [
    { name: "bodies", hash: "b-hash" },
    { name: "persons", hash: "different-hash" },
  ];
  assert.notEqual(combineSnapshotHashes(base), combineSnapshotHashes(changed));
});

// --- dateRangeFilter --------------------------------------------------------

test("dateRangeFilter builds Legistar's documented OData datetime filter shape", () => {
  assert.equal(
    dateRangeFilter("EventDate", "2024-01-01", "2025-01-01"),
    "EventDate ge datetime'2024-01-01' and EventDate lt datetime'2025-01-01'",
  );
});

// --- toIsoDate ---------------------------------------------------------------

test("toIsoDate slices the date portion off Legistar's bare timestamp, no timezone shift", () => {
  assert.equal(toIsoDate("2024-03-05T00:00:00"), "2024-03-05");
  assert.equal(toIsoDate("2024-03-05T14:22:09"), "2024-03-05");
});

test("toIsoDate returns null for absent or unparseable dates rather than guessing", () => {
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate("not a date"), null);
  assert.equal(toIsoDate(undefined), null);
});

// --- addDays -----------------------------------------------------------------

test("addDays returns a date-only ISO string offset by the given number of days", () => {
  assert.equal(addDays(new Date("2026-08-06T00:00:00.000Z"), -60), "2026-06-07");
  assert.equal(addDays(new Date("2026-08-06T00:00:00.000Z"), 1), "2026-08-07");
});

// --- slugify -----------------------------------------------------------------

test("slugify normalizes to lowercase, hyphen-separated, trimmed of edge hyphens", () => {
  assert.equal(slugify("Councilmember"), "councilmember");
  assert.equal(slugify("City Council President"), "city-council-president");
  assert.equal(slugify("  --Weird!! Title--  "), "weird-title");
});

test("slugify falls back to 'unknown' for empty/unslugifiable input", () => {
  assert.equal(slugify(""), "unknown");
  assert.equal(slugify("   "), "unknown");
  assert.equal(slugify("!!!"), "unknown");
});

// --- stripInternal -------------------------------------------------------------

test("stripInternal drops underscore-prefixed bookkeeping fields only", () => {
  const out = stripInternal({ id: "x", name: "Y", _legistarPersonId: 42, _bodyId: 138 });
  assert.deepEqual(out, { id: "x", name: "Y" });
});

// --- mapVoteValue --------------------------------------------------------------

test("mapVoteValue normalizes known Legistar VoteValueName strings to models.ts's VoteValue enum", () => {
  assert.equal(mapVoteValue("Yea"), "yea");
  assert.equal(mapVoteValue("yes"), "yea");
  assert.equal(mapVoteValue("Nay"), "nay");
  assert.equal(mapVoteValue("No"), "nay");
  assert.equal(mapVoteValue("Absent"), "absent");
  assert.equal(mapVoteValue("Abstained"), "abstain");
});

test("mapVoteValue drops unrecognized values rather than guessing", () => {
  assert.equal(mapVoteValue("Recused"), null);
  assert.equal(mapVoteValue(""), null);
  assert.equal(mapVoteValue(null), null);
});

// --- buildOfficesPersonsHoldings -----------------------------------------------
// Fixture rows shaped like the live /officerecords response (field names and
// value shapes confirmed live against webapi.legistar.com/v1/stpaul on
// 2026-08-06 — OfficeRecordId 569/570/571 for Carter/Bostrom/Stark).

const clientConfig = { client: "stpaul", jurisdiction: "St. Paul City Council" };
const RUN_ISO = "2026-08-06";
const SOURCE_URL = "https://webapi.legistar.com/v1/stpaul/officerecords";

function officeRecord(overrides) {
  return {
    OfficeRecordId: 569,
    OfficeRecordFirstName: "Melvin",
    OfficeRecordLastName: "Carter III",
    OfficeRecordFullName: "Melvin Carter III",
    OfficeRecordStartDate: "2008-01-01T00:00:00",
    OfficeRecordEndDate: "2013-07-05T00:00:00",
    OfficeRecordPersonId: 176,
    OfficeRecordBodyId: 138,
    OfficeRecordBodyName: "City Council",
    OfficeRecordTitle: "Councilmember",
    ...overrides,
  };
}

test("buildOfficesPersonsHoldings builds a holding for an allowlisted officeholder title", () => {
  const result = buildOfficesPersonsHoldings(clientConfig, [officeRecord()], "legistar-stpaul", RUN_ISO, SOURCE_URL);

  assert.equal(result.holdings.length, 1);
  assert.equal(result.persons.length, 1);
  assert.equal(result.offices.length, 1);
  assert.equal(result.persons[0].official_name, "Melvin Carter III");
  assert.equal(result.holdings[0].term_start, "2008-01-01");
  assert.equal(result.holdings[0].term_end, "2013-07-05");
  assert.equal(result.holdings[0].person_id, result.persons[0].id);
  assert.equal(result.holdings[0].office_id, result.offices[0].id);
  assert.equal(result.droppedTitles.length, 0);
});

test("buildOfficesPersonsHoldings drops rows with a non-officeholder title (staff/clerk roles)", () => {
  const rows = [officeRecord({ OfficeRecordId: 999, OfficeRecordTitle: "Recording Secretary" })];
  const result = buildOfficesPersonsHoldings(clientConfig, rows, "legistar-stpaul", RUN_ISO, SOURCE_URL);

  assert.equal(result.holdings.length, 0);
  assert.deepEqual(result.droppedTitles, ["Recording Secretary"]);
});

test("buildOfficesPersonsHoldings drops rows belonging to an excluded internal/clerical body", () => {
  const rows = [officeRecord({ OfficeRecordId: 1000, OfficeRecordBodyName: "Clerk to the Board" })];
  const result = buildOfficesPersonsHoldings(clientConfig, rows, "legistar-stpaul", RUN_ISO, SOURCE_URL);

  assert.equal(result.holdings.length, 0);
  assert.deepEqual(result.droppedBodies, ["Clerk to the Board"]);
});

test("buildOfficesPersonsHoldings drops rows missing a start date rather than fabricating one", () => {
  const rows = [officeRecord({ OfficeRecordId: 1001, OfficeRecordStartDate: null })];
  const result = buildOfficesPersonsHoldings(clientConfig, rows, "legistar-stpaul", RUN_ISO, SOURCE_URL);

  assert.equal(result.holdings.length, 0);
  assert.equal(result.droppedNoStartDate, 1);
});

test("buildOfficesPersonsHoldings dedupes the same person/office across multiple officerecords rows", () => {
  const rows = [
    officeRecord({ OfficeRecordId: 569, OfficeRecordStartDate: "2008-01-01T00:00:00", OfficeRecordEndDate: "2013-07-05T00:00:00" }),
    officeRecord({ OfficeRecordId: 700, OfficeRecordStartDate: "2016-01-01T00:00:00", OfficeRecordEndDate: null }),
  ];
  const result = buildOfficesPersonsHoldings(clientConfig, rows, "legistar-stpaul", RUN_ISO, SOURCE_URL);

  assert.equal(result.persons.length, 1, "same OfficeRecordPersonId should map to one Person");
  assert.equal(result.offices.length, 1, "same body+title should map to one Office");
  assert.equal(result.holdings.length, 2, "each officerecords row is still its own Holding (distinct terms)");
});

// --- determineVoteWindow ---------------------------------------------------

test("determineVoteWindow bounds the window to VOTE_WINDOW_DAYS before the run date", () => {
  const bodyMetaList = [{ BodyId: 138, BodyName: "City Council", BodyTypeName: "Primary Legislative Body", BodyActiveFlag: 1 }];
  const holdings = [{ _bodyId: 138, term_start: "2024-01-01", term_end: null }];
  const runDate = new Date("2026-08-06T00:00:00.000Z");

  const result = determineVoteWindow(clientConfig, holdings, bodyMetaList, runDate);

  assert.equal(result.primaryBodyId, 138);
  assert.equal(result.primaryBodyName, "City Council");
  assert.equal(result.windowStartIso, "2026-06-07"); // 60 days before 2026-08-06
  assert.ok(result.knownGaps.length >= 1);
});

test("determineVoteWindow reports a knownGaps entry and skips the window when no primary body is found", () => {
  const result = determineVoteWindow(clientConfig, [], [], new Date("2026-08-06T00:00:00.000Z"));

  assert.equal(result.primaryBodyId, null);
  assert.equal(result.windowStartIso, null);
  assert.equal(result.knownGaps.length, 1);
  assert.match(result.knownGaps[0], /No body with BodyTypeName/);
});

// --- findHoldingForVote -----------------------------------------------------

test("findHoldingForVote matches a voter to the holding active on the vote's action date", () => {
  const holdings = [
    { id: "h1", _legistarPersonId: 176, _bodyId: 138, term_start: "2008-01-01", term_end: "2013-07-05" },
    { id: "h2", _legistarPersonId: 176, _bodyId: 138, term_start: "2016-01-01", term_end: null },
  ];

  assert.equal(findHoldingForVote(holdings, 176, 138, "2010-05-01").id, "h1");
  assert.equal(findHoldingForVote(holdings, 176, 138, "2020-05-01").id, "h2");
});

test("findHoldingForVote returns null when no holding covers the person/body/date", () => {
  const holdings = [{ id: "h1", _legistarPersonId: 176, _bodyId: 138, term_start: "2016-01-01", term_end: null }];

  assert.equal(findHoldingForVote(holdings, 999, 138, "2020-01-01"), null, "wrong person");
  assert.equal(findHoldingForVote(holdings, 176, 1, "2020-01-01"), null, "wrong body");
  assert.equal(findHoldingForVote(holdings, 176, 138, "2010-01-01"), null, "before term start");
});
