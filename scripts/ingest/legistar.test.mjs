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
  diffMeetings,
  findHoldingForVote,
  isConsentAgendaItem,
  mapEventItemToAgendaItem,
  mapEventToMeeting,
  mapVoteValue,
  normalizeTimeTo24h,
  selectMeetingsThisWeek,
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

// --- isConsentAgendaItem / mapEventToMeeting / mapEventItemToAgendaItem ----
// (issue #58 — meetings/agenda ingest)

test("isConsentAgendaItem reads Legistar's own EventItemConsent flag only", () => {
  assert.equal(isConsentAgendaItem({ EventItemConsent: 1 }), true);
  assert.equal(isConsentAgendaItem({ EventItemConsent: 0 }), false);
  assert.equal(isConsentAgendaItem({ EventItemConsent: null }), false);
  assert.equal(isConsentAgendaItem({}), false, "missing field is never guessed as consent");
});

test("mapEventToMeeting carries EventInSiteURL through as sourceUrl with no scraping", () => {
  const event = {
    EventId: 7663,
    EventBodyId: 138,
    EventBodyName: "City Council",
    EventDate: "2026-06-03T00:00:00",
    EventTime: "3:30 PM",
    EventLocation: "Council Chambers - 3rd Floor",
    EventAgendaStatusName: "Final-revised",
    EventAgendaFile: "https://legistar1.granicus.com/StPaul/meetings/2026/6/7663_A.pdf",
    EventMinutesFile: null,
    EventVideoStatus: "Public",
    EventInSiteURL: "https://stpaul.legistar.com/MeetingDetail.aspx?LEGID=7663&GID=125&G=abc",
    EventLastModifiedUtc: "2026-06-04T15:12:07.17",
  };

  const meeting = mapEventToMeeting("stpaul", event);

  assert.equal(meeting.id, "legistar-stpaul-meeting-7663");
  assert.equal(meeting.body_id, "legistar-stpaul-body-138");
  assert.equal(meeting.date, "2026-06-03");
  assert.equal(meeting.time, "15:30", "EventTime's 12-hour '3:30 PM' is normalized to 24-hour at ingest");
  assert.equal(meeting.sourceUrl, event.EventInSiteURL);
  assert.equal(meeting.agendaUrl, event.EventAgendaFile);
  assert.equal(meeting.minutesUrl, null);
});

test("mapEventItemToAgendaItem flags consent items and passes matter linkage through", () => {
  const item = {
    EventItemId: 214511,
    EventItemAgendaSequence: 3,
    EventItemAgendaNumber: "1",
    EventItemTitle: "Authorizing the reallocation of grant funds.",
    EventItemConsent: 1,
    EventItemActionName: "Adopted",
    EventItemPassedFlagName: "Pass",
    EventItemMatterFile: "RES 26-1145",
    EventItemMatterId: 52382,
    EventItemMatterType: "Resolution",
  };

  const agendaItem = mapEventItemToAgendaItem("stpaul", "legistar-stpaul-meeting-7663", item);

  assert.equal(agendaItem.id, "legistar-stpaul-eventitem-214511");
  assert.equal(agendaItem.meeting_id, "legistar-stpaul-meeting-7663");
  assert.equal(agendaItem.isConsent, true);
  assert.equal(agendaItem.matterFile, "RES 26-1145");
});

test("mapEventItemToAgendaItem falls back to a generated title, never a fabricated one, when EventItemTitle is missing", () => {
  const agendaItem = mapEventItemToAgendaItem("stpaul", "m1", { EventItemId: 1 });
  assert.equal(agendaItem.title, "Agenda item 1");
  assert.equal(agendaItem.isConsent, false);
});

// --- diffMeetings (AGENTS.md §0.5 — diff on refresh) ------------------------

test("diffMeetings reports added and removed meeting ids", () => {
  const previous = [{ id: "m1", date: "2026-08-01" }];
  const next = [{ id: "m2", date: "2026-08-02" }];

  const diff = diffMeetings(previous, next);

  assert.deepEqual(diff.addedIds, ["m2"]);
  assert.deepEqual(diff.removedIds, ["m1"]);
  assert.deepEqual(diff.changed, []);
});

test("diffMeetings reports a per-field change for a rescheduled meeting (same id, different date)", () => {
  const previous = [{ id: "m1", date: "2026-08-01", time: "3:30 PM", location: "Chambers" }];
  const next = [{ id: "m1", date: "2026-08-08", time: "3:30 PM", location: "Chambers" }];

  const diff = diffMeetings(previous, next);

  assert.equal(diff.addedIds.length, 0);
  assert.equal(diff.removedIds.length, 0);
  assert.deepEqual(diff.changed, [{ id: "m1", field: "date", from: "2026-08-01", to: "2026-08-08" }]);
});

test("diffMeetings is a no-op when nothing changed", () => {
  const meetings = [{ id: "m1", date: "2026-08-01", time: "3:30 PM", location: "Chambers" }];
  const diff = diffMeetings(meetings, meetings);
  assert.deepEqual(diff, { addedIds: [], removedIds: [], changed: [] });
});

// --- normalizeTimeTo24h -----------------------------------------------------

test("normalizeTimeTo24h converts Legistar's 12-hour AM/PM strings to zero-padded 24-hour", () => {
  assert.equal(normalizeTimeTo24h("3:30 PM"), "15:30");
  assert.equal(normalizeTimeTo24h("9:00 AM"), "09:00");
  assert.equal(normalizeTimeTo24h("12:00 PM"), "12:00", "noon stays 12, not 24");
  assert.equal(normalizeTimeTo24h("12:00 AM"), "00:00", "midnight becomes 0, not 12");
});

test("normalizeTimeTo24h passes an already-24-hour string through zero-padded", () => {
  assert.equal(normalizeTimeTo24h("9:30"), "09:30");
  assert.equal(normalizeTimeTo24h("15:30"), "15:30");
});

test("normalizeTimeTo24h returns null for empty input and passes through anything unrecognized", () => {
  assert.equal(normalizeTimeTo24h(null), null);
  assert.equal(normalizeTimeTo24h(""), null);
  assert.equal(normalizeTimeTo24h("TBD"), "TBD", "unrecognized shape is passed through, never guessed at");
});

// --- selectMeetingsThisWeek (WardModal sidebar teaser, issue #58, revised
// after #102's follow-up: no longer picks one "primary body" meeting —
// every meeting in the window, any body, chronological) -------------------

test("selectMeetingsThisWeek returns every meeting in the window in chronological order, any body", () => {
  const meetings = [
    { id: "m1", bodyName: "City Council", date: "2026-08-13", time: "09:30", sourceUrl: "u1", agendaUrl: "a1" },
    { id: "m2", bodyName: "Mayor's Budget Address", date: "2026-08-12", time: "11:00", sourceUrl: "u2", agendaUrl: "a2" },
  ];

  const week = selectMeetingsThisWeek(clientConfig, meetings, "2026-08-12");

  // The earlier, non-Council meeting comes first — this is the exact
  // bug reported live against Minneapolis's real calendar: the old
  // primary-body-preferring selectNextMeeting() would have shown "City
  // Council, Aug 13" and never mentioned the Aug 12 Budget Address.
  assert.deepEqual(
    week.map((m) => m.bodyName),
    ["Mayor's Budget Address", "City Council"],
  );
});

test("selectMeetingsThisWeek sorts same-day meetings by time, not just date", () => {
  const meetings = [
    { id: "m1", bodyName: "Late Committee", date: "2026-08-12", time: "16:30", sourceUrl: null, agendaUrl: null },
    { id: "m2", bodyName: "Early Committee", date: "2026-08-12", time: "09:00", sourceUrl: null, agendaUrl: null },
  ];

  const week = selectMeetingsThisWeek(clientConfig, meetings, "2026-08-12");

  assert.deepEqual(
    week.map((m) => m.bodyName),
    ["Early Committee", "Late Committee"],
  );
});

test("selectMeetingsThisWeek excludes past meetings and anything beyond the window", () => {
  const meetings = [
    { id: "m1", bodyName: "City Council", date: "2026-08-01", time: "09:00", sourceUrl: null, agendaUrl: null }, // past
    { id: "m2", bodyName: "City Council", date: "2026-08-25", time: "09:00", sourceUrl: null, agendaUrl: null }, // beyond 7-day window
  ];

  assert.deepEqual(selectMeetingsThisWeek(clientConfig, meetings, "2026-08-12"), []);
});

test("selectMeetingsThisWeek returns [] (not null) when nothing is in the window", () => {
  assert.deepEqual(selectMeetingsThisWeek(clientConfig, [], "2026-08-12"), []);
});

test("selectMeetingsThisWeek derives isCancelled from agendaStatus and includes cancelled meetings rather than dropping them", () => {
  const meetings = [
    { id: "m1", bodyName: "City Council", date: "2026-08-13", time: "09:30", agendaStatus: "Cancelled", sourceUrl: null, agendaUrl: null },
    { id: "m2", bodyName: "City Council", date: "2026-08-13", time: "13:00", agendaStatus: "Final", sourceUrl: null, agendaUrl: null },
  ];

  const week = selectMeetingsThisWeek(clientConfig, meetings, "2026-08-12");

  assert.equal(week.length, 2, "cancelled meetings are included, not filtered out");
  assert.equal(week[0].isCancelled, true);
  assert.equal(week[1].isCancelled, false);
});

test("selectMeetingsThisWeek passes members through only when the source Meeting has them", () => {
  const withMembers = [
    { id: "m1", bodyName: "City Council", date: "2026-08-13", time: "09:30", members: [{ id: 1, name: "Elliott Payne", type: "President" }] },
  ];
  const withoutMembers = [{ id: "m2", bodyName: "City Council", date: "2026-08-13", time: "09:30" }];

  assert.deepEqual(selectMeetingsThisWeek(clientConfig, withMembers, "2026-08-12")[0].members, [
    { id: 1, name: "Elliott Payne", type: "President" },
  ]);
  assert.equal("members" in selectMeetingsThisWeek(clientConfig, withoutMembers, "2026-08-12")[0], false);
});
