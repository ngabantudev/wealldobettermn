#!/usr/bin/env node
// src/lib/meetingTime.test.mjs
//
// Tests for filterMeetingsThisWeek() — the fix for meetings not reflecting
// the current week (WardModal.tsx used to render whatever 7-day window
// scripts/ingest/legistar.mjs's selectMeetingsThisWeek() had baked in at
// the moment the ingest script last ran, which goes stale the very next
// day since nothing runs that ingest on a schedule). Same convention as
// electionConfig.test.mjs — Node's built-in test runner, no dependency
// added.
//
// Run directly: node src/lib/meetingTime.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { formatMeetingTime, filterMeetingsThisWeek } from "./meetingTime.ts";

// --- formatMeetingTime --------------------------------------------------

test("formatMeetingTime converts zero-padded 24-hour to 12-hour with AM/PM", () => {
  assert.equal(formatMeetingTime("15:30"), "3:30 PM");
  assert.equal(formatMeetingTime("00:00"), "12:00 AM");
  assert.equal(formatMeetingTime("12:00"), "12:00 PM");
  assert.equal(formatMeetingTime("09:05"), "9:05 AM");
});

test("formatMeetingTime returns null for null input and passes through unrecognized shapes", () => {
  assert.equal(formatMeetingTime(null), null);
  assert.equal(formatMeetingTime("TBD"), "TBD");
});

// --- filterMeetingsThisWeek ----------------------------------------------

function meeting(date) {
  return { date, bodyName: "Test Body" };
}

test("filterMeetingsThisWeek keeps only meetings within the 7-day window starting today", () => {
  const today = new Date("2026-08-20T00:00:00Z");
  const meetings = [
    meeting("2026-08-13"), // last week — excluded
    meeting("2026-08-19"), // yesterday — excluded
    meeting("2026-08-20"), // today — included
    meeting("2026-08-23"), // within window — included
    meeting("2026-08-26"), // last day of window (today + 6) — included
    meeting("2026-08-27"), // one day past the window — excluded
    meeting("2026-09-05"), // well beyond the window — excluded
  ];
  assert.deepEqual(
    filterMeetingsThisWeek(meetings, today).map((m) => m.date),
    ["2026-08-20", "2026-08-23", "2026-08-26"],
  );
});

test("filterMeetingsThisWeek recomputes against whatever `today` is passed — the core fix for staleness", () => {
  // Same underlying (wide, ~30-day) data set; two different "current" dates
  // a week apart should each see a different current-week slice, proving
  // the result isn't baked in at ingest time.
  const meetings = [meeting("2026-08-20"), meeting("2026-08-27"), meeting("2026-09-03")];
  assert.deepEqual(
    filterMeetingsThisWeek(meetings, new Date("2026-08-20T00:00:00Z")).map((m) => m.date),
    ["2026-08-20"],
  );
  assert.deepEqual(
    filterMeetingsThisWeek(meetings, new Date("2026-08-27T00:00:00Z")).map((m) => m.date),
    ["2026-08-27"],
  );
});

test("filterMeetingsThisWeek excludes meetings with a null date rather than crashing", () => {
  const meetings = [meeting(null), meeting("2026-08-20")];
  assert.deepEqual(
    filterMeetingsThisWeek(meetings, new Date("2026-08-20T00:00:00Z")).map((m) => m.date),
    ["2026-08-20"],
  );
});

test("filterMeetingsThisWeek returns [] (not null) when nothing falls in the window", () => {
  const meetings = [meeting("2026-01-01")];
  assert.deepEqual(filterMeetingsThisWeek(meetings, new Date("2026-08-20T00:00:00Z")), []);
});

test("filterMeetingsThisWeek defaults `today` to the real current date when omitted", () => {
  // Not asserting a specific result (that would make the test itself
  // date-dependent) — just confirming the default parameter path runs
  // without needing a `today` argument.
  assert.doesNotThrow(() => filterMeetingsThisWeek([meeting("2026-08-20")]));
});
