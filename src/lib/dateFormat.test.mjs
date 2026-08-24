#!/usr/bin/env node
// src/lib/dateFormat.test.mjs
//
// Tests for formatUtcDate() — extracted from 5 independently-implemented
// call sites (issue #130): WardModal.tsx's formatTeaserDate/
// formatOfficeSince, WardMap.tsx's formatLastUpdated, meetings/page.tsx's
// formatMeetingDate, and recap/page.tsx's formatDate (a 5th site found
// during this fix, not in the issue's original list — exactly the
// "silently reintroduces the day-rollback bug" risk the issue warned
// about, though this one already had `timeZone: "UTC"` set correctly).
// Same convention as electionConfig.test.mjs — Node's built-in test
// runner, no dependency added.
//
// Run directly: node src/lib/dateFormat.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { formatUtcDate } from "./dateFormat.ts";

test("formatUtcDate never rolls a bare date back a day for a zone west of UTC", () => {
  // The bug this function exists to prevent: without an explicit UTC
  // timeZone, a bare "2026-08-01" formatted in a zone west of UTC (e.g.
  // America/Chicago, UTC-5/-6) renders as July 31 instead of August 1.
  // Node's ICU data resolves the "en-US" locale's default timeZone from
  // the environment, so this doesn't pin a specific zone — it just
  // confirms the UTC override actually wins regardless of what that
  // default is, by checking the exact expected calendar date comes back.
  assert.equal(formatUtcDate("2026-08-01", { month: "long", day: "numeric", year: "numeric" }), "August 1, 2026");
});

test("formatUtcDate reproduces each of the 5 previously-duplicated call sites exactly", () => {
  // WardModal.tsx's formatTeaserDate
  assert.equal(formatUtcDate("2026-08-12", { weekday: "short", month: "short", day: "numeric" }), "Wed, Aug 12");
  // WardModal.tsx's formatOfficeSince
  assert.equal(formatUtcDate("2026-01-05", { month: "long", year: "numeric" }), "January 2026");
  // WardMap.tsx's formatLastUpdated
  assert.equal(formatUtcDate("2026-08-12", { month: "short", day: "numeric", year: "numeric" }), "Aug 12, 2026");
  // meetings/page.tsx's formatMeetingDate
  assert.equal(
    formatUtcDate("2026-08-26", { weekday: "short", month: "long", day: "numeric", year: "numeric" }),
    "Wed, August 26, 2026",
  );
  // recap/page.tsx's formatDate
  assert.equal(formatUtcDate("2026-08-06", { month: "long", day: "numeric", year: "numeric" }), "August 6, 2026");
});

test("formatUtcDate handles a year boundary correctly (Dec 31 doesn't roll to Jan 1 of the wrong year)", () => {
  assert.equal(formatUtcDate("2025-12-31", { month: "long", day: "numeric", year: "numeric" }), "December 31, 2025");
});
