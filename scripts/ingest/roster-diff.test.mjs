#!/usr/bin/env node
// scripts/ingest/roster-diff.test.mjs
//
// Tests for the Phase 5 roster diff engine. Uses Node's built-in test
// runner (`node --test`) — no dependency added for this, per AGENTS.md
// §0.8 / FEATURES.md principle 4 ("dependency-free Node").
//
// Run directly: node scripts/ingest/roster-diff.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_MUTATION_TYPES,
  assertNoDeletions,
  diffRoster,
  hashRoster,
  normalizeRoster,
} from "./roster-diff.mjs";

const SOURCE_URL = "https://example.gov/roster";

test("normalizeRoster sorts and hashes deterministically regardless of input order", () => {
  const a = [
    { office_ocd_id: "ocd-division/.../ward:2", person_external_id: "p2", name: "B Person" },
    { office_ocd_id: "ocd-division/.../ward:1", person_external_id: "p1", name: "A Person" },
  ];
  const b = [a[1], a[0]];

  const normA = normalizeRoster(a);
  const normB = normalizeRoster(b);

  assert.equal(normA.hash, normB.hash);
  assert.deepEqual(
    normA.rows.map((r) => r.office_ocd_id),
    ["ocd-division/.../ward:1", "ocd-division/.../ward:2"],
  );
});

test("normalizeRoster rejects rows missing required fields instead of coercing them", () => {
  assert.throws(() => normalizeRoster([{ office_ocd_id: "x", person_external_id: "y" }]), TypeError);
  assert.throws(() => normalizeRoster([{ office_ocd_id: "", person_external_id: "y", name: "Z" }]), TypeError);
});

test("normalizeRoster rejects two rows for the same (office, person) pair", () => {
  const dupe = [
    { office_ocd_id: "ward:1", person_external_id: "p1", name: "A" },
    { office_ocd_id: "ward:1", person_external_id: "p1", name: "A Duplicate" },
  ];
  assert.throws(() => normalizeRoster(dupe), /duplicate/);
});

test("hashRoster is stable for identical rows and changes when a row changes", () => {
  const rows = normalizeRoster([{ office_ocd_id: "ward:1", person_external_id: "p1", name: "A" }]).rows;
  const h1 = hashRoster(rows);
  const h2 = hashRoster(rows);
  assert.equal(h1, h2);

  const changed = normalizeRoster([{ office_ocd_id: "ward:1", person_external_id: "p1", name: "A Renamed" }]).rows;
  assert.notEqual(h1, hashRoster(changed));
});

test("diffRoster on a first run (no previous snapshot) opens every holding and never deletes", () => {
  const result = diffRoster({
    jurisdictionId: "minneapolis",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: [{ office_ocd_id: "ward:1", person_external_id: "p1", name: "A" }],
  });

  assert.equal(result.changed, true);
  assert.equal(result.mutations.length, 1);
  assert.equal(result.mutations[0].type, "open_holding");
  assertNoDeletions(result.mutations);
});

test("diffRoster reports unchanged when the roster hash is identical", () => {
  const roster = [{ office_ocd_id: "ward:1", person_external_id: "p1", name: "A" }];
  const first = diffRoster({
    jurisdictionId: "minneapolis",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: roster,
  });

  const second = diffRoster({
    jurisdictionId: "minneapolis",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-08T00:00:00Z",
    previousSnapshot: first.snapshot,
    currentRosterRaw: roster,
  });

  assert.equal(second.changed, false);
  assert.deepEqual(second.mutations, []);
  assert.equal(second.event, null);
});

// --- Invariant: never delete a holding -------------------------------

test("INVARIANT: diffRoster only ever emits close_holding / open_holding / rename_person, never a delete", () => {
  const before = [
    { office_ocd_id: "ward:1", person_external_id: "p1", name: "Alice Old" },
    { office_ocd_id: "ward:2", person_external_id: "p2", name: "Bob" },
  ];
  const after = [
    // ward:1 holder resigned, replaced by a new person (appointed replacement / special election)
    { office_ocd_id: "ward:1", person_external_id: "p3", name: "Carol" },
    // ward:2 holder's name changed but they're still the same person
    { office_ocd_id: "ward:2", person_external_id: "p2", name: "Robert" },
    // a brand-new office appeared (e.g. redistricting)
    { office_ocd_id: "ward:3", person_external_id: "p4", name: "Dana" },
  ];

  const seed = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: before,
  });

  const result = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-02-01T00:00:00Z",
    previousSnapshot: seed.snapshot,
    currentRosterRaw: after,
  });

  assert.equal(result.changed, true);
  const types = result.mutations.map((m) => m.type);
  for (const type of types) {
    assert.ok(ALLOWED_MUTATION_TYPES.includes(type), `unexpected mutation type: ${type}`);
    assert.notEqual(type, "delete_holding");
  }
  // Never throws — the module structurally cannot produce a deletion.
  assert.doesNotThrow(() => assertNoDeletions(result.mutations));

  // ward:1's original holding is closed, not removed.
  const closed = result.mutations.find((m) => m.type === "close_holding" && m.person_external_id === "p1");
  assert.ok(closed, "expected a close_holding mutation for the departed holder");
  assert.equal(closed.end_date, "2026-02-01T00:00:00Z");

  // The replacement is a new open_holding, not a mutation of the old row.
  const opened = result.mutations.find((m) => m.type === "open_holding" && m.person_external_id === "p3");
  assert.ok(opened, "expected an open_holding mutation for the replacement");

  // The name change produced a rename_person mutation, not a holding churn.
  const renamed = result.mutations.find((m) => m.type === "rename_person");
  assert.ok(renamed, "expected a rename_person mutation");
  assert.equal(renamed.previous_name, "Bob");
  assert.equal(renamed.name, "Robert");

  // The new office is an open_holding flagged distinctly from ordinary turnover.
  const newOffice = result.mutations.find((m) => m.person_external_id === "p4");
  assert.equal(newOffice.type, "open_holding");
  assert.equal(newOffice.reason, "new_office_in_roster");
});

test("assertNoDeletions rejects a hypothetical delete mutation type and requires end_date on close", () => {
  assert.throws(() => assertNoDeletions([{ type: "delete_holding" }]), /not in ALLOWED_MUTATION_TYPES/);
  assert.throws(
    () => assertNoDeletions([{ type: "close_holding", end_date: null }]),
    /must carry an end_date/,
  );
});

// --- Edge cases named explicitly in FEATURES.md Phase 5 --------------

test("edge case: mid-term resignation with no replacement yet leaves the office vacant", () => {
  const before = [{ office_ocd_id: "ward:1", person_external_id: "p1", name: "Alice" }];
  const seed = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: before,
  });

  const result = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-03-01T00:00:00Z",
    previousSnapshot: seed.snapshot,
    currentRosterRaw: [], // seat vacant, no replacement in the source yet
  });

  assert.equal(result.mutations.length, 1);
  assert.equal(result.mutations[0].type, "close_holding");
  assert.equal(result.mutations[0].reason, "office_no_longer_in_roster");
});

test("edge case: appointed replacement / special election produces close + open at the same office", () => {
  const seed = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: [{ office_ocd_id: "ward:1", person_external_id: "p1", name: "Alice" }],
  });

  const result = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-03-01T00:00:00Z",
    previousSnapshot: seed.snapshot,
    currentRosterRaw: [{ office_ocd_id: "ward:1", person_external_id: "p9", name: "Appointed Person" }],
  });

  const closed = result.mutations.find((m) => m.type === "close_holding");
  const opened = result.mutations.find((m) => m.type === "open_holding");
  assert.equal(closed.person_external_id, "p1");
  assert.equal(opened.person_external_id, "p9");
  assert.equal(opened.reason, "new_officeholder");
});

test("edge case: redistricting changes office identity — old office closes, new office_ocd_id opens", () => {
  const seed = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: [{ office_ocd_id: "ward:3", person_external_id: "p1", name: "Alice" }],
  });

  // Redistricting: ward:3 (old boundaries) is retired, ward:3a (new
  // boundaries) is created. Same person may or may not still hold it —
  // here they do, but under a *different* office_ocd_id, which is the
  // point: the office's identity changed, not just its holder.
  const result = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-06-01T00:00:00Z",
    previousSnapshot: seed.snapshot,
    currentRosterRaw: [{ office_ocd_id: "ward:3a", person_external_id: "p1", name: "Alice" }],
  });

  const closed = result.mutations.find((m) => m.type === "close_holding");
  const opened = result.mutations.find((m) => m.type === "open_holding");
  assert.equal(closed.office_ocd_id, "ward:3");
  assert.equal(closed.reason, "office_no_longer_in_roster");
  assert.equal(opened.office_ocd_id, "ward:3a");
  assert.equal(opened.reason, "new_office_in_roster");
  // The old office_ocd_id is never reused for the new seat.
  assert.notEqual(closed.office_ocd_id, opened.office_ocd_id);
});

test("edge case: two people with the same name at different offices are never conflated", () => {
  const roster = [
    { office_ocd_id: "ward:1", person_external_id: "p1", name: "Chris Johnson" },
    { office_ocd_id: "ward:7", person_external_id: "p2", name: "Chris Johnson" },
  ];
  const normalized = normalizeRoster(roster);
  assert.equal(normalized.rows.length, 2);
  assert.notEqual(normalized.rows[0].person_external_id, normalized.rows[1].person_external_id);
});

test("edge case: name change alone does not close or open any holding", () => {
  const seed = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-01-01T00:00:00Z",
    previousSnapshot: null,
    currentRosterRaw: [{ office_ocd_id: "ward:1", person_external_id: "p1", name: "Pat Smith" }],
  });

  const result = diffRoster({
    jurisdictionId: "test-city",
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-04-01T00:00:00Z",
    previousSnapshot: seed.snapshot,
    currentRosterRaw: [{ office_ocd_id: "ward:1", person_external_id: "p1", name: "Pat Jones" }],
  });

  assert.equal(result.mutations.length, 1);
  assert.equal(result.mutations[0].type, "rename_person");
});
